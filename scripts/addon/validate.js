// scripts/addon/validate.js
// Checks the VS Code add-on's package and source before its tests run (`node scripts/addon/validate.js`,
// part of CI's validate job). It is the proof, from the package and the code, that only the add-on's own
// pane's buttons can press a binding click (design for other agents, sections 6.3 and 8.6): the add-on
// registers no command but the one that opens its pane, no URI handler, and no chat tool or participant
// that could reach a press; the press functions are named only inside `onPaneMessage`, which checks the
// pane's nonce before it presses anything, and `onPaneMessage` is reached only as the pane's message handler.
//
// The check reads the code with its comments taken out and works on names, so it is a guard against a
// mistake and a reader's aid, not against code written to hide a call. A reader of the diff is the guard
// against that.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startedAsScript } from '../lib/started-as-script.js';

export const OPEN_PANE = 'wheelhouse.openPane';
// The functions that sign or record a binding click, and what reads their records.
// Also what sets or lifts STOP, and the briefing; and any call to the desk's `act`, below.
export const PRESS_NAMES = ['pressCard', 'pressSetting', 'signedRecords', 'keepEarned', 'whyCard', 'suggestCard', 'sendKept', 'liftStop', 'setStop', 'digestText'];
const HANDLER = 'onPaneMessage';
const REGISTERS = ['registerCommand', 'registerTextEditorCommand', 'registerDiffInformationCommand'];

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const word = (name) => new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g');

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
  for (const m of code.matchAll(new RegExp(`(?<![\\w$])${name}\\s*\\(`, 'g'))) {
    const open = m.index + m[0].length - 1;
    const end = closeOf(code, open);
    spans.push([m.index, end === -1 ? code.length : end]);
  }
  return spans;
}

// The spans of onPaneMessage's definitions: its name through the end of its body.
function handlerSpans(code, name = HANDLER) {
  const spans = [];
  const forms = [new RegExp(`(?:async\\s+)?function\\s+(${name})\\s*\\(`, 'g'), new RegExp(`(?:const|let|var)\\s+(${name})\\s*=\\s*(?:async\\s*)?(?:function\\s*)?\\(`, 'g')];
  for (const form of forms) {
    for (const m of code.matchAll(form)) {
      const nameAt = m.index + m[0].indexOf(name);
      const paramsOpen = m.index + m[0].length - 1;
      const paramsEnd = closeOf(code, paramsOpen);
      const bodyOpen = paramsEnd === -1 ? -1 : code.indexOf('{', paramsEnd);
      const end = bodyOpen === -1 ? -1 : closeOf(code, bodyOpen);
      spans.push({ nameAt, start: bodyOpen, end: end === -1 ? code.length : end });
    }
  }
  return spans;
}

const inside = (index, spans) => spans.some(([start, end]) => index >= start && index < end);

function checkSource(file, source) {
  const code = codeOf(source);
  const problems = [];
  const add = (why) => problems.push(`${file}: ${why}`);
  const handlers = handlerSpans(code);
  const bodies = handlers.map((h) => [h.start, h.end]);

  for (const name of REGISTERS) {
    for (const [start, end] of callsOf(code, name)) {
      const args = code.slice(code.indexOf('(', start) + 1, end - 1);
      const id = /^\s*(['"`])([^'"`]*)\1\s*(?:,|$)/.exec(args)?.[2];
      if (name !== 'registerCommand' || id !== OPEN_PANE) add(`${name} may register only ${OPEN_PANE}, as a plain string`);
    }
  }
  if (word('registerUriHandler').test(code)) add('registerUriHandler: the add-on takes no address from outside');
  if (word('eval').test(code)) add('eval: the add-on builds no code at run time');
  if (/(?<![\w$])(?:new\s+)?Function\s*\(/.test(code)) add('Function: the add-on builds no code at run time');

  for (const name of PRESS_NAMES) {
    for (const m of code.matchAll(word(name))) {
      if (!inside(m.index, bodies)) add(`${name} is named outside ${HANDLER}, where only the pane's messages reach it`);
    }
  }

  for (const m of code.matchAll(/\.act\s*\(/g)) {
    if (!inside(m.index, bodies)) add(`a call to the desk's act is made outside ${HANDLER}, where only the pane's messages reach it`);
  }
  if (/(?:\b(?:deps|press|desk|stop)|\.(?:press|desk|stop))\s*\[/.test(code)) add('the press, the desk and STOP are reached by name, never by a computed one');
  // What activate returns is the extension's public API, readable by every other extension.
  for (const a of handlerSpans(code, 'activate')) {
    if (/\breturn\s+(?!undefined\b|;|deps\.expose\b)(?:add|state|nonces|desk|deps|real|press|\{)/.test(code.slice(a.start, a.end))) add('activate returns what another extension could press with');
  }
  const received = callsOf(code, 'onDidReceiveMessage');
  for (const [start, end] of received) {
    if (!word(HANDLER).test(code.slice(start, end))) add(`onDidReceiveMessage must hand every message to ${HANDLER}`);
  }
  for (const m of code.matchAll(word(HANDLER))) {
    const definition = handlers.some((h) => h.nameAt === m.index);
    const exported = /exports/.test(code.slice(code.lastIndexOf(';', m.index) + 1, m.index));
    // Taken in by a require of its own file, which only names it.
    const statementEnd = code.indexOf(';', m.index);
    const imported = /^\s*(?:const|let|var)\s*\{\s*onPaneMessage\s*\}\s*=\s*require\(\s*['"][^'"]*['"]\s*\)\s*$/.test(code.slice(code.lastIndexOf(';', m.index) + 1, statementEnd === -1 ? code.length : statementEnd));
    if (!definition && !exported && !imported && !inside(m.index, received)) add(`${HANDLER} is reached only as the pane's message handler`);
  }

  for (const h of handlers) {
    const body = code.slice(h.start, h.end);
    // The first thing after the message is known to be an object is the nonce check; nothing of deps is touched before it.
    const check = /deps\.nonces\.matches\(\s*msg\??\.nonce\s*\)/.exec(body);
    if (check === null || /deps\s*[.[]/.test(body.slice(0, check.index))) add(`${HANDLER} must check the nonce, as deps.nonces.matches(msg.nonce), before it touches anything of deps`);
  }
  return problems;
}

// checkAddon({ pkg, sources }) -> string[]
// `pkg` is the add-on's package.json read; `sources` is { file: text } for each of its source files. Never throws.
export function checkAddon({ pkg, sources } = {}) {
  const problems = [];
  try {
    if (!isRecord(pkg)) return ['The add-on\'s package.json is missing or is not an object'];
    const contributes = isRecord(pkg.contributes) ? pkg.contributes : {};
    const wrongId = (id, where) => { if (id !== OPEN_PANE) problems.push(`${where} names the command ${String(id)}; the add-on has only ${OPEN_PANE}`); };
    for (const entry of Array.isArray(contributes.commands) ? contributes.commands : []) wrongId(entry?.command, 'contributes.commands');
    for (const entry of Array.isArray(contributes.keybindings) ? contributes.keybindings : []) wrongId(entry?.command, 'contributes.keybindings');
    for (const [menu, entries] of Object.entries(isRecord(contributes.menus) ? contributes.menus : {})) {
      for (const entry of Array.isArray(entries) ? entries : []) if (entry?.command !== undefined) wrongId(entry.command, `contributes.menus.${menu}`);
    }
    for (const event of Array.isArray(pkg.activationEvents) ? pkg.activationEvents : []) {
      if (/^onUri/.test(event)) problems.push(`activationEvents has ${event}: the add-on takes no address from outside`);
      if (/^onCommand/.test(event) && event !== `onCommand:${OPEN_PANE}`) problems.push(`activationEvents has ${event}, an onCommand other than ${OPEN_PANE}`);
    }
    if (!Array.isArray(pkg.extensionKind) || pkg.extensionKind.length !== 1 || pkg.extensionKind[0] !== 'workspace') problems.push('extensionKind must be ["workspace"]');
    if (pkg.extensionDependencies !== undefined && !(Array.isArray(pkg.extensionDependencies) && pkg.extensionDependencies.length === 0)) problems.push('extensionDependencies must be empty: the add-on needs no other add-on');
    if (pkg.extensionPack !== undefined && !(Array.isArray(pkg.extensionPack) && pkg.extensionPack.length === 0)) problems.push('extensionPack must be empty: the add-on installs no other add-on');
    if (!isRecord(sources)) return [...problems, 'The add-on\'s sources are missing'];
    for (const [file, source] of Object.entries(sources)) problems.push(...checkSource(file, source));
  } catch (error) {
    problems.push(`The add-on couldn't be checked: ${error?.message ?? 'no reason given'}`);
  }
  return problems;
}

// The add-on's package and the source files of its folder (`vscode/`, not the pane's CSS or media), read from `root`.
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
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const problems = checkAddon(readAddon(root));
  if (problems.length > 0) {
    process.stderr.write(`${problems.map((p) => `- ${p}`).join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('The add-on holds: only its pane\'s buttons press.\n');
  }
}
