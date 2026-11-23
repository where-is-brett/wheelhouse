// scripts/addon/validate.js
// Checks the VS Code add-on's package and source before its tests run (`node scripts/addon/validate.js [root]`,
// part of CI's validate job). It is the proof, from the package and the code, that only the panel's own buttons can
// reach an act: the add-on contributes no command but the one that opens its panel, no URI handler, no public API,
// no chat participant and no language-model tool; a call to the desk's `act` is made only in vscode/press.cjs, whose
// `press` checks the panel's nonce before it touches anything; and every message the panel posts is handed to `press`.
//
// The check reads the code with its comments taken out and works on names, so it is a guard against a mistake and a
// reader's aid, not against code written to hide a call. A reader of the diff is the guard against that.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startedAsScript } from '../lib/started-as-script.js';

export const OPEN_PANEL = 'wheelhouse.openPanel';
export const FOCUS_PANEL = 'wheelhouse.panel.focus';
const PRESS_FILE = 'vscode/press.cjs';
const DESK_CLIENT_FILE = 'vscode/desk-client.cjs';
const PRESS = 'press';
const REGISTERS = ['registerCommand', 'registerTextEditorCommand', 'registerDiffInformationCommand'];
// Ways to give the model or the chat a tool or a voice, which would reach the desk without a click.
const CHAT_REGISTERS = ['registerTool', 'createChatParticipant', 'registerChatParticipant', 'registerLanguageModelChatProvider', 'registerMcpServerDefinitionProvider'];

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const word = (name) => new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g');
const inside = (index, spans) => spans.some(([start, end]) => index >= start && index < end);

// The source with its comments taken out. Strings and template literals are read as they are, so a `//`
// inside one is not a comment. Regular expressions are not told from division; a `//` inside one is
// read as a comment, which only hides more of the line.
export function codeOf(source) {
  const text = String(source);
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      out += ' ';
    } else if (c === '\'' || c === '"' || c === '`') {
      out += c;
      i += 1;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') { out += text[i]; i += 1; }
        out += text[i] ?? '';
        i += 1;
      }
      out += c;
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

// The index just past the bracket that closes the one at `open`, strings skipped; -1 when it never closes.
function closeOf(code, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (c === '\'' || c === '"' || c === '`') {
      i += 1;
      while (i < code.length && code[i] !== c) i += code[i] === '\\' ? 2 : 1;
    } else if (pairs[c]) {
      stack.push(pairs[c]);
    } else if (c === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

// The spans [start, end) of the calls `name(...)` in the code, arguments included.
function callsOf(code, name) {
  const spans = [];
  for (const m of code.matchAll(new RegExp(`(?<![\\w$])${name}\\s*(?:\\?\\.\\s*)?\\(`, 'g'))) {
    const open = m.index + m[0].length - 1;
    const end = closeOf(code, open);
    spans.push([m.index, end === -1 ? code.length : end]);
  }
  return spans;
}

// The body span [start, end) of the function `name`, as a declaration; null when there is none.
function bodyOf(code, name) {
  const m = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(code);
  if (m === null) return null;
  const paramsEnd = closeOf(code, m.index + m[0].length - 1);
  const bodyOpen = paramsEnd === -1 ? -1 : code.indexOf('{', paramsEnd);
  if (bodyOpen === -1) return null;
  const end = closeOf(code, bodyOpen);
  return [bodyOpen, end === -1 ? code.length : end];
}

// The first argument of a call span, when it is a plain string (any quote), else null.
const plainFirst = (code, [start, end]) => /^\s*(['"`])([^'"`$\\]*)\1\s*(?:,|$)/.exec(code.slice(code.indexOf('(', start) + 1, end - 1))?.[2] ?? null;

function checkSource(file, source) {
  const code = codeOf(source);
  const problems = [];
  const add = (why) => problems.push(`${file}: ${why}`);
  const isPress = file === PRESS_FILE;

  // These names may appear only as the start of a call with the one approved plain string: never aliased, held in a
  // variable, reached by a computed name or called with another id.
  const approved = [...REGISTERS.map((name) => [name, name === 'registerCommand' ? OPEN_PANEL : null]), ['executeCommand', FOCUS_PANEL]];
  for (const [name, id] of approved) {
    const calls = id === null ? [] : callsOf(code, name).filter((span) => plainFirst(code, span) === id).map(([start]) => start);
    for (const m of code.matchAll(word(name))) {
      if (!calls.includes(m.index)) add(`${name} may appear only as a call with ${id ?? 'no id'}, as a plain string, never aliased or reached by a computed name`);
    }
  }
  if (word('registerUriHandler').test(code)) add('registerUriHandler: the add-on takes no address from outside');
  for (const name of CHAT_REGISTERS) {
    if (word(name).test(code)) add(`${name}: the add-on registers no chat participant, tool or model`);
  }
  if (word('eval').test(code)) add('eval: the add-on builds no code at run time');
  if (/(?<![\w$])(?:new\s+)?Function\s*\(/.test(code)) add('Function: the add-on builds no code at run time');

  // Only press.cjs calls an act, and no other file even holds one: no `.act` or `.answer` property access (which
  // covers calls, aliases, `.call` and `Reflect.apply`), no `{ act }` or `{ answer }` destructuring and no computed name.
  if (!isPress) {
    const reach = file === DESK_CLIENT_FILE ? [] : [
      // `dataset.act` is the page's own button attribute (data-act), not the desk's.
      [/(?<!dataset)\.\s*(?:act|answer)(?![\w$])/g, (m) => `the desk's ${m[0].replace(/[^\w]/g, '')} is reached outside ${PRESS_FILE}, where only the panel's messages reach it`],
      [/\{[^{}]*(?<![\w$])(?:act|answer)(?![\w$])[^{}]*\}\s*=(?![=>])/g, () => `the desk's act or answer is taken out of an object outside ${PRESS_FILE}`],
      [/\[\s*['"`](?:act|answer)['"`]\s*\]/g, (m) => `the desk's ${m[0]} is reached by a computed name`],
    ];
    for (const [pattern, say] of reach) for (const m of code.matchAll(pattern)) add(say(m));
    if (file !== DESK_CLIENT_FILE && /\/desk\/act/.test(code)) add('the desk\'s act route is named outside the desk client');
  } else {
    for (const m of code.matchAll(/\[\s*(?!['"`])[^\]]*\]\s*\(/g)) add(`a computed call (${m[0].trim()}) in ${PRESS_FILE}`);
    // `press` takes a message only with the latest nonce, before it touches the client, the cards or the app.
    const body = bodyOf(code, PRESS);
    if (body === null) {
      add(`${PRESS} is not defined as a function`);
    } else {
      const text = code.slice(body[0], body[1]);
      const check = /sameNonce\(\s*own\(message,\s*'nonce'\)\s*,\s*latestNonce\s*\)/.exec(text);
      if (check === null) add(`${PRESS} must check the nonce, as sameNonce(own(message, 'nonce'), latestNonce), before it does anything else`);
      else if (/(?<![\w$])(?:client|waiting|app)(?![\w$])/.test(text.slice(0, check.index))) add(`${PRESS} touches the client, the cards or the app before it checks the nonce`);
    }
  }

  // Every message the panel posts goes to `press`, and nowhere else.
  for (const span of callsOf(code, 'onDidReceiveMessage')) {
    const inner = code.slice(span[0], span[1]);
    if (!/(?<![\w$.])onPaneMessage\s*\(/.test(inner)) add('onDidReceiveMessage must hand every message to onPaneMessage');
  }
  const pane = bodyOf(code, 'onPaneMessage');
  if (pane !== null) {
    const text = code.slice(pane[0], pane[1]);
    if (!/(?<![\w$.])press\s*\(\s*message\b/.test(text)) add('onPaneMessage must hand its message to press');
  }
  // What `activate` returns is the extension's public API, readable by every other extension.
  const activate = bodyOf(code, 'activate');
  // Its last statement hands out something only when a test asks for it (`deps.expose`), and otherwise nothing.
  if (activate !== null && !/return\s+deps\.expose\s*\?[^;]*:\s*undefined\s*;\s*}$/.test(code.slice(activate[0], activate[1]))) {
    add('activate must end by returning only `deps.expose ? ... : undefined`: what it returns is every extension\'s to read');
  }
  // `press` is named nowhere but where it is defined, exported or taken in, and where onPaneMessage calls it.
  if (!isPress && pane !== null) {
    for (const m of code.matchAll(/(?<![\w$.])press\s*\(/g)) {
      if (!inside(m.index, [pane])) add('press is called outside onPaneMessage, where only the panel\'s messages reach it');
    }
  }
  return problems;
}

// checkAddon({ pkg, sources }) -> string[]
// `pkg` is the add-on's package.json read; `sources` is { 'vscode/file.cjs': text } for each of its source files.
// Never throws.
export function checkAddon({ pkg, sources } = {}) {
  const problems = [];
  try {
    if (!isRecord(pkg)) return ['The add-on\'s package.json is missing or is not an object'];
    const contributes = isRecord(pkg.contributes) ? pkg.contributes : {};
    const wrongId = (id, where) => { if (id !== OPEN_PANEL) problems.push(`${where} names the command ${String(id)}; the add-on has only ${OPEN_PANEL}`); };
    for (const entry of Array.isArray(contributes.commands) ? contributes.commands : []) wrongId(entry?.command, 'contributes.commands');
    for (const entry of Array.isArray(contributes.keybindings) ? contributes.keybindings : []) wrongId(entry?.command, 'contributes.keybindings');
    for (const [menu, entries] of Object.entries(isRecord(contributes.menus) ? contributes.menus : {})) {
      for (const entry of Array.isArray(entries) ? entries : []) if (entry?.command !== undefined) wrongId(entry.command, `contributes.menus.${menu}`);
    }
    for (const name of ['languageModelTools', 'chatParticipants', 'languageModelChatProviders', 'mcpServerDefinitionProviders']) {
      if (name in contributes && !(Array.isArray(contributes[name]) && contributes[name].length === 0)) problems.push(`contributes.${name} is present: the add-on offers the chat no tool, participant or model`);
    }
    for (const name of ['uriHandler', 'api', 'languageModelTools', 'chatParticipants']) {
      if (name in pkg) problems.push(`${name} is in package.json: the add-on has no public way in`);
    }
    for (const event of Array.isArray(pkg.activationEvents) ? pkg.activationEvents : []) {
      if (/^onUri/.test(event)) problems.push(`activationEvents has ${event}: the add-on takes no address from outside`);
      if (/^onCommand/.test(event) && event !== `onCommand:${OPEN_PANEL}`) problems.push(`activationEvents has ${event}, an onCommand other than ${OPEN_PANEL}`);
    }
    if (!Array.isArray(pkg.extensionKind) || pkg.extensionKind.length !== 1 || pkg.extensionKind[0] !== 'workspace') problems.push('extensionKind must be ["workspace"]');
    if (pkg.capabilities?.untrustedWorkspaces?.supported !== false) problems.push('capabilities.untrustedWorkspaces.supported must be false: the panel signs with its own key, so it runs only in a trusted folder');
    if (pkg.extensionDependencies !== undefined && !(Array.isArray(pkg.extensionDependencies) && pkg.extensionDependencies.length === 0)) problems.push('extensionDependencies must be empty: the add-on needs no other add-on');
    if (pkg.extensionPack !== undefined && !(Array.isArray(pkg.extensionPack) && pkg.extensionPack.length === 0)) problems.push('extensionPack must be empty: the add-on installs no other add-on');
    if (!isRecord(sources)) return [...problems, 'The add-on\'s sources are missing'];
    for (const [file, source] of Object.entries(sources)) problems.push(...checkSource(file, source));
  } catch (error) {
    problems.push(`The add-on couldn't be checked: ${error?.message ?? 'no reason given'}`);
  }
  return problems;
}

// The add-on's package and the source files of its folder (`vscode/`; not the pane's CSS or media), read from `root`.
export function readAddon(root) {
  const folder = path.join(root, 'vscode');
  const sources = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:cjs|js|mjs)$/.test(entry.name)) sources[path.relative(root, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(folder);
  return { pkg: JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')), sources };
}

if (startedAsScript(import.meta.url)) {
  const root = process.argv[2] === undefined ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') : path.resolve(process.argv[2]);
  const problems = checkAddon(readAddon(root));
  if (problems.length > 0) {
    process.stderr.write(`${problems.map((p) => `- ${p}`).join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('The add-on holds: only its panel\'s buttons reach an act.\n');
  }
}
