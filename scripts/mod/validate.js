// scripts/mod/validate.js
// Checks the mod before its tests run (npm run mod-check). It is the proof that the mod
// approves nothing, from three sides:
//   - `claude plugin validate --json` reads the mod's files as Claude Code will: the mod must
//     hook exactly the events its brief names and none of the forbidden hooks, never a
//     ui.render or ui.resolve with no matcher, and call only what the brief names and never a
//     forbidden call;
//   - the source of every module file (hooks/register.ts and everything under hooks/mod/) is
//     read for every member of `$` it touches, so nothing the validator doesn't list slips
//     past, and for the one `$.process.run` (the bridge's, in hooks/mod/ask.ts) and for where
//     the pane's origin is named, and that the drawing kit hands each press only to a Button;
//   - the bridge's static import graph is followed, so nothing it loads can write Claude
//     Code's settings.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/run.js';
import { PANE_ID } from '../lib/mod-numbers.js';
import { startedAsScript } from '../lib/started-as-script.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALIDATE_MS = 60000;

// The hooks, as the validator spells them, and the calls on `$` the brief allows: the whole
// mod's lists, each entry added by the task that first needs it.
export const HOOKS = [
  'session.start', 'session.measure', 'turn.start', 'turn.complete', 'prompt.submit', 'command.run{command=wheelhouse-go}', 'session.receive',
  'command.run{command=wheelhouse}', 'command.run{command=wheelhouse-digest}', 'tool.call{tool=AskUserQuestion}', `ui.render{component=Pane, requestId=${PANE_ID}}`,
];
// The one tool.call hook the mod may have, an exception to the rule that it hooks none (FORBIDDEN_HOOKS keeps tool.call):
// a Wheelhouse card open in the chat as a question closes by itself once it is answered elsewhere (director's ruling, 5
// November 2026). It is pinned three ways, so any other use of tool.call fails the check: the hook's exact matcher
// (CLOSE_HOOK), the file that holds it (CLOSE_FILE), and what it may return, which is { deny: CLOSED_IN_PANEL } and the
// result of `next(e)` run on the call as it came (closeException).
export const CLOSE_HOOK = 'tool.call{tool=AskUserQuestion}';
export const CLOSE_FILE = 'hooks/mod/close.ts';
// $.clock.now reads the time a tick's answer was read and the time the pane is drawn, for the
// line saying what is shown is old. $.prompt.submit hands the front desk the prompts a press's
// answer holds, and the settings view's Ask the front desk, and hands on the prompts a tick's
// answer holds: the courier's wake in the front desk, the watcher's lines in a Shape 2 foreman.
// $.session.append shows a counted press in the chat at once, as a notice row and a line only the front desk
// reads, and starts no turn. $.session.surfaces reads the surfaces the session has attached, so the pane opens only once there is
// one. $.ui.invalidate draws the pane again while a tick hangs, so the line saying what is shown is
// old comes without a tick's answer; it only draws. $.clock.after draws the settings view again when
// a change's minute of Undo is up, so Undo leaves then.
export const CALLS = [
  '$.clock.after', '$.clock.every', '$.clock.now', '$.command.register', '$.process.run', '$.prompt.submit', '$.session.append', '$.session.id', '$.session.root',
  '$.session.surfaces', '$.session.usage', '$.state.get', '$.state.set', '$.ui.close', '$.ui.invalidate', '$.ui.open', '$.ui.panes', '$.ui.resolve',
  '$.ui.status', '$.ui.toast',
];
// Hooks that must always carry a matcher: one with none would draw every component the engine draws.
const MATCHED_HOOKS = ['ui.render', 'ui.resolve'];
// A value of `$`, not a call, so the validator doesn't list it.
const VALUES = ['$.plugin.root'];

// What the mod must never hook or call, even if HOOKS or CALLS were to name it. A `*` stands
// for any rest of the name: `classic.*` is every classic hook, `$.fs.*` every call on `$.fs`.
export const FORBIDDEN_HOOKS = ['tool.check', 'tool.call', 'tool.describe', 'config.set', 'agent.offer', 'plugin.register', 'classic.*'];
export const FORBIDDEN_CALLS = ['$.tool.*', '$.agent.*', '$.fs.*', '$.settings.*', '$.http.*', '$.model.*', '$.command.run', '$.prompt.fill', '$.process.spawn', '$.env.set'];

// Whether a hook or call, as the validator or the source spells it, is one the patterns name.
// A hook may carry a matcher after its name (`tool.check{tool=Bash}`). A name that is itself
// a wildcard (`tool.*`, `$.*`, a bare `*`) is forbidden too when what it stands for covers any
// forbidden pattern: `tool.*` covers `tool.check`, `*` covers all of them.
export function matchesForbidden(name, patterns) {
  const bare = name.replace(/\{.*\}$/, '');
  if (bare.endsWith('*')) {
    const prefix = bare.slice(0, -1);
    if (patterns.some((pattern) => (pattern.endsWith('.*') ? pattern.slice(0, -2) : pattern).startsWith(prefix))) return true;
  }
  return patterns.some((pattern) => {
    if (pattern.endsWith('.*')) {
      const stem = pattern.slice(0, -2);
      return name === stem || name.startsWith(`${stem}.`);
    }
    return name === pattern || name.startsWith(`${pattern}{`);
  });
}

// The items of a note's list: split at the commas outside brackets, each without the
// "(via helper)" the validator adds to a call made inside one of the module's own functions.
function listed(line) {
  const items = [];
  let depth = 0;
  let item = '';
  for (const c of line) {
    if ('({['.includes(c)) depth += 1;
    if (')}]'.includes(c)) depth -= 1;
    if (c === ',' && depth === 0) { items.push(item); item = ''; } else item += c;
  }
  items.push(item);
  return items.map((i) => i.replace(/\s*\(via [^)]*\)$/, '').trim()).filter(Boolean);
}

// What may stand before a `/` that starts a regular expression, not a division.
const REGEX_AFTER = '(,=:[!&|?{};+-*%<>~^}';
const REGEX_AFTER_WORD = /(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)$/;

// The source without its comments. Strings, template literals (and what a `${}` holds) and
// regular expressions are read as they are, so a `//` or a `/*` inside one is not a comment.
function codeOf(source) {
  const text = String(source);
  let out = '';
  let i = 0;
  // Whether each open ( follows if, while, for or with, and where the last such ) ended: a /
  // after it starts a regular expression, as after any other statement's head.
  const parens = [];
  let controlEnd = -1;
  const regexHere = () => {
    const tail = out.slice(-200).trimEnd();
    if (tail.endsWith(')') && controlEnd === out.trimEnd().length) return true;
    return tail === '' || REGEX_AFTER.includes(tail.slice(-1)) || REGEX_AFTER_WORD.test(tail);
  };
  const quoted = (quote) => {
    out += quote;
    i += 1;
    while (i < text.length && text[i] !== quote && text[i] !== '\n') {
      if (text[i] === '\\') { out += text[i]; i += 1; }
      if (i < text.length) { out += text[i]; i += 1; }
    }
    if (text[i] === quote) { out += quote; i += 1; }
  };
  const regex = () => {
    let inClass = false;
    out += '/';
    i += 1;
    while (i < text.length && text[i] !== '\n') {
      const c = text[i];
      out += c;
      i += 1;
      if (c === '\\') { if (i < text.length) { out += text[i]; i += 1; } } else if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) break;
    }
  };
  const template = () => {
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') { out += text.slice(i, i + 2); i += 2; continue; }
      out += c;
      i += 1;
      if (c === '`') return;
      if (c === '$' && text[i] === '{') {
        out += '{';
        i += 1;
        scan(true);
        if (text[i] === '}') { out += '}'; i += 1; }
      }
    }
  };
  function scan(inExpression) {
    let depth = 0;
    while (i < text.length) {
      const c = text[i];
      const next = text[i + 1];
      if (c === '/' && next === '/') {
        while (i < text.length && text[i] !== '\n') i += 1;
      } else if (c === '/' && next === '*') {
        const end = text.indexOf('*/', i + 2);
        const stop = end < 0 ? text.length : end + 2;
        out += ` ${text.slice(i, stop).replace(/[^\n]/g, '')}`;
        i = stop;
      } else if (c === '"' || c === "'") quoted(c);
      else if (c === '`') { out += c; i += 1; template(); } else if (c === '/' && regexHere()) regex();
      else {
        if (inExpression && c === '}') {
          if (depth === 0) return;
          depth -= 1;
        } else if (inExpression && c === '{') depth += 1;
        if (c === '(') parens.push(/(?:^|[^\w$.])(?:if|while|for|with)\s*$/.test(out.slice(-40)));
        out += c;
        i += 1;
        if (c === ')' && parens.pop()) controlEnd = out.length;
      }
    }
  }
  scan(false);
  return out;
}

// Every `$.noun.member` (or a bare `$.noun`) the source names outside its comments, sorted.
export function membersIn(source) {
  return membersOf(codeOf(source));
}

function membersOf(code) {
  const found = new Set();
  for (const m of code.matchAll(/(?<![\w$])\$\s*\??\.\s*([A-Za-z_]\w*)(?:\s*\??\.\s*([A-Za-z_]\w*))?/g)) found.add(m[2] ? `$.${m[1]}.${m[2]}` : `$.${m[1]}`);
  return [...found].sort();
}

// The same members read from the raw text, comments, strings and all: a check that no
// misread comment can hide a member from.
function rawMembersIn(source) {
  return membersOf(String(source));
}

const slashes = (file) => file.replaceAll('\\', '/');

// The mod's files, as repository-relative paths: hooks/register.ts and every file under
// hooks/mod/ (which may not exist yet).
export function moduleFiles(root) {
  const found = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else found.push(file);
    }
  };
  walk('hooks/mod');
  return ['hooks/register.ts', ...found.sort()];
}

// readMod(root) -> { sources, hooksJson }: the text of every module file and the parsed
// hooks/hooks.json (null when it can't be read), which is what checkMod reads besides the
// report. Throws, naming the file, when a module file can't be read.
export function readMod(root) {
  const sources = {};
  for (const file of moduleFiles(root)) {
    try {
      sources[file] = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      throw new Error(`${file} can't be read`);
    }
  }
  let hooksJson = null;
  try {
    hooksJson = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8'));
  } catch {
    hooksJson = null;
  }
  return { sources, hooksJson };
}

// A map ({ file: text }, or a Map) of the module's files as a list of [file, text].
function entriesOf(sources) {
  if (sources instanceof Map) return [...sources.entries()].map(([file, text]) => [slashes(file), String(text)]);
  if (sources !== null && typeof sources === 'object') return Object.entries(sources).map(([file, text]) => [slashes(file), String(text)]);
  return [];
}

// The mod's one entry file, the only module hooks/hooks.json and the validator's notes may name.
const ENTRY = './register.ts';
const ASK = 'hooks/mod/ask.ts';
const ARGV = /^\s*\[\s*'node'\s*,\s*`\$\{\$\.plugin\.root\}\/scripts\/hooks\/node-floor\.cjs`\s*,\s*`\$\{\$\.plugin\.root\}\/scripts\/mod\/bridge\.js`\s*\]\s*$/;
// The only options the call may pass: what goes in on standard input and how long to wait.
const OPTION = /^(?:stdin|timeoutMs)\s*(?::|$)/;

// The index just past the string or template literal that starts at `i` (a quote or a backtick).
function afterString(code, i) {
  const quote = code[i];
  let j = i + 1;
  while (j < code.length) {
    if (code[j] === '\\') j += 2;
    else if (code[j] === quote) return j + 1;
    else if (quote === '`' && code[j] === '$' && code[j + 1] === '{') {
      const end = closingOutsideStrings(code, j + 1);
      if (end < 0) return code.length;
      j = end + 1;
    } else j += 1;
  }
  return code.length;
}

// The index of the bracket closing the one at `open`, or -1, with brackets inside strings left out.
function closingOutsideStrings(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if ('\'"`'.includes(c)) i = afterString(code, i) - 1;
    else if ('({['.includes(c)) depth += 1;
    else if (')}]'.includes(c)) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// The text split at its commas outside brackets and strings, without a trailing empty item.
function splitTop(text) {
  const items = [];
  let item = '';
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if ('\'"`'.includes(c)) {
      const end = afterString(text, i);
      item += text.slice(i, end);
      i = end - 1;
      continue;
    }
    if ('({['.includes(c)) depth += 1;
    if (')}]'.includes(c)) depth -= 1;
    if (c === ',' && depth === 0) { items.push(item); item = ''; } else item += c;
  }
  if (item.trim() !== '' || items.length === 0) items.push(item);
  return items;
}

const OPTIONS_WHY = 'passes options other than stdin and timeoutMs (an object literal with those keys alone, holding no / or backtick and neither word env nor cwd), so it could run something other than the bridge';

// Whether the text between the parentheses of the bridge's call is the bridge's argv and, if
// anything follows, one object literal whose only keys are stdin and timeoutMs: no env, cwd,
// spread, computed key or variable, any of which could change what runs.
function bridgeArguments(args) {
  const [argv, options, ...more] = splitTop(args);
  if (!ARGV.test(argv)) return "runs something other than ['node', `${$.plugin.root}/scripts/hooks/node-floor.cjs`, `${$.plugin.root}/scripts/mod/bridge.js`], the bridge";
  // A backstop on the text after the argv, unparsed, for what the reading of strings below
  // could miss (a regular expression holding a quote hides what follows it as a string): no
  // `/`, no backtick and neither word env nor cwd anywhere in it.
  const after = args.slice(args.indexOf(']') + 1);
  if (/[/`]/.test(after) || /\b(?:env|cwd)\b/.test(after)) return OPTIONS_WHY;
  if (options === undefined && more.length === 0) return null;
  const text = options.trim();
  const body = text.startsWith('{') && closingOutsideStrings(text, 0) === text.length - 1 ? splitTop(text.slice(1, -1)) : null;
  if (more.length > 0 || body === null || !body.every((entry) => entry.trim() === '' || OPTION.test(entry.trim()))) {
    return OPTIONS_WHY;
  }
  return null;
}

// bridgeArgv(sources) -> { ok, why? }: the sources hold exactly one `$.process.run(`, in
// hooks/mod/ask.ts, its argv is the literal ['node', `${$.plugin.root}/scripts/mod/bridge.js`] and
// its options, if any, are an object literal holding only stdin and timeoutMs.
// Every `process.run` counts, whatever stands before it (`$?.process.run`, `api.process.run`, a
// destructured `process`), so a second run can't hide under another receiver's name.
export function bridgeArgv(sources) {
  const mentions = [];
  let calls = 0;
  let raw = 0;
  for (const [file, text] of entriesOf(sources)) {
    // Counted in the raw text as well, with nothing stripped, so a comment the scan misreads
    // can't hide a second run: a mention in a comment fails too.
    raw += [...text.matchAll(/(?<![\w$])process\s*\??\.\s*run(?![\w$])/g)].length;
    const code = codeOf(text);
    for (const m of code.matchAll(/(?<![\w$])process\s*\??\.\s*run(?![\w$])/g)) {
      const rest = code.slice(m.index + m[0].length);
      mentions.push({ file, before: code.slice(0, m.index), rest });
      if (/^\s*(?:\?\.\s*)?\(/.test(rest)) calls += 1;
    }
  }
  if (raw !== 1 || mentions.length !== 1 || calls !== 1) {
    return { ok: false, why: `The mod's source must hold exactly one $.process.run( call, the bridge's, and no other mention of process.run, even in a comment; it holds ${Math.max(raw, mentions.length)} mention${Math.max(raw, mentions.length) === 1 ? '' : 's'} and ${calls} call${calls === 1 ? '' : 's'}` };
  }
  const [{ file, before, rest }] = mentions;
  if (file !== ASK) return { ok: false, why: `The mod's one $.process.run( is in ${file}, not ${ASK}` };
  if (!/(?<![\w$.])\$\s*\.\s*$/.test(before)) return { ok: false, why: `The mod's $.process.run( in ${ASK} isn't a call on $` };
  const open = rest.indexOf('(');
  // The call's end read two ways, with and without knowing strings: a string, template or
  // regular expression the reading can't tell apart makes them differ, and the call fails.
  const close = closing(rest, open);
  const problem = close < 0 || close !== closingOutsideStrings(rest, open) ? "can't be read" : bridgeArguments(rest.slice(open + 1, close));
  if (problem !== null) return { ok: false, why: `The mod's $.process.run( in ${ASK} ${problem}` };
  return { ok: true };
}

// The index of the bracket closing the one at `open`, or -1.
function closing(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if ('({['.includes(code[i])) depth += 1;
    else if (')}]'.includes(code[i])) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// The end of an arrow function's expression body that starts at `from`: the first `;` or
// line end outside brackets.
function expressionEnd(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const c = code[i];
    if ('({['.includes(c)) depth += 1;
    else if (')}]'.includes(c)) {
      if (depth === 0) return i;
      depth -= 1;
    } else if (depth === 0 && (c === ';' || c === '\n')) return i;
  }
  return code.length;
}

// The named functions of a file, read without a parser: `function name(…) {…}` and
// `const name = [async] (…) => …` or `= [async] function (…) {…}`. Each is { name, at, start,
// end }: where its name is and the range of its parameters and body.
function namedFunctions(code) {
  const found = [];
  const withBody = (name, at, start, parenAt) => {
    const close = closing(code, parenAt);
    if (close < 0) return;
    const brace = code.indexOf('{', close);
    const end = brace < 0 ? -1 : closing(code, brace);
    if (end >= 0) found.push({ name, at, start, end });
  };
  for (const m of code.matchAll(/(?<![\w$])function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    withBody(m[1], m.index + m[0].indexOf(m[1]), m.index, m.index + m[0].length - 1);
  }
  for (const m of code.matchAll(/(?<![\w$])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s+)?/g)) {
    const at = m.index + m[0].indexOf(m[1]);
    const from = m.index + m[0].length;
    if (/^function\b/.test(code.slice(from))) {
      const paren = code.indexOf('(', from);
      if (paren >= 0) withBody(m[1], at, m.index, paren);
      continue;
    }
    let after = -1;
    if (code[from] === '(') {
      const close = closing(code, from);
      const arrow = close < 0 ? null : /^\s*(?::[^{;]*?)?\s*=>/.exec(code.slice(close + 1));
      if (arrow) after = close + 1 + arrow[0].length;
    } else {
      const arrow = /^[A-Za-z_$][\w$]*\s*=>/.exec(code.slice(from));
      if (arrow) after = from + arrow[0].length;
    }
    if (after < 0) continue;
    const body = after + /^\s*/.exec(code.slice(after))[0].length;
    const end = code[body] === '{' ? closing(code, body) : expressionEnd(code, body);
    if (end >= 0) found.push({ name: m[1], at, start: m.index, end });
  }
  return found;
}

const PANE_FILES = ['cards.tsx', 'settings.tsx'];
// A press is passed as a Button's onPress, an Input's onSubmit, a Select's onSelect, or as the last
// argument of the drawing kit's button functions (hooks/mod/calm.tsx), and only as an arrow that calls it on a click: a press called
// while drawing, or in any other argument, would send as the pane draws. kitPresses checks the kit
// hands on what it is given only as a Button's onPress.
const ARROW = '(?:async\\s*)?\\(\\)\\s*=>\\s*$';
// A box's Enter hands the arrow the words typed, and a pick hands it the value picked, so an
// `onSubmit` or `onSelect` arrow takes that one parameter (a plain name, typed string or not) and
// nothing else.
const ARROW_OF_WORDS = '(?:async\\s*)?\\(\\s*[A-Za-z_$][\\w$]*(?:\\s*:\\s*string)?\\s*\\)\\s*=>\\s*$';
const ON_PRESS = new RegExp(`(?:onPress\\s*=\\s*\\{\\s*|\\b(?:filled|outlined|small)\\(\\s*t\\s*,[^,()]+,[^,()]+,\\s*|\\bstopButton\\(\\s*t\\s*,\\s*)${ARROW}|on(?:Submit|Select)\\s*=\\s*\\{\\s*${ARROW_OF_WORDS}`);

// paneOrigin(sources) -> { ok, why? }: `origin: 'pane'` appears only inside functions whose
// names begin `press` in cards.tsx and settings.tsx, which those files pass as `onPress` (or to the
// kit's button functions) and nothing else calls. Read by name, without a TypeScript parser.
export function paneOrigin(sources) {
  const problems = [];
  for (const [file, text] of entriesOf(sources)) {
    const code = codeOf(text);
    const origins = [...code.matchAll(/origin\s*:\s*['"`]pane['"`]/g)];
    if (!PANE_FILES.includes(path.posix.basename(file))) {
      if (origins.length > 0) problems.push(`origin: 'pane' appears in ${file}, which is neither cards.tsx nor settings.tsx`);
      continue;
    }
    const presses = namedFunctions(code).filter((f) => /^press/.test(f.name));
    for (const origin of origins) {
      if (!presses.some((f) => origin.index > f.start && origin.index < f.end)) {
        problems.push(`origin: 'pane' appears in ${file} outside a function whose name begins press`);
      }
    }
    for (const press of presses) {
      const pattern = new RegExp(`(?<![\\w$])${press.name.replaceAll('$', '\\$')}(?![\\w$])`, 'g');
      for (const use of code.matchAll(pattern)) {
        if (use.index === press.at) continue;
        if (!ON_PRESS.test(code.slice(0, use.index))) {
          problems.push(`${press.name} in ${file} is used other than passed as onPress`);
          break;
        }
      }
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, why: [...new Set(problems)].join('; ') };
}

// kitPresses(sources) -> { ok, why? }: the drawing kit (hooks/mod/calm.tsx) takes each press as a
// parameter typed `() => …` and only hands it to a Button as `onPress={…}`, so ON_PRESS's trust in
// its button functions holds: a press the kit called, or passed on any other way, would send as the
// pane draws.
const KIT = 'hooks/mod/calm.tsx';
export function kitPresses(sources) {
  const problems = [];
  for (const [file, text] of entriesOf(sources)) {
    if (file !== KIT) continue;
    const code = codeOf(text);
    const names = [...new Set([...code.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\(\s*\)\s*=>/g)].map((m) => m[1]))];
    for (const name of names) {
      const word = name.replaceAll('$', '\\$');
      const rest = code.replace(new RegExp(`(?<![\\w$])${word}\\s*:\\s*\\(\\s*\\)\\s*=>`, 'g'), '')
        .replace(new RegExp(`(?<![\\w$])onPress\\s*=\\s*\\{\\s*${word}\\s*\\}`, 'g'), '');
      if (new RegExp(`(?<![\\w$])${word}(?![\\w$])`).test(rest)) problems.push(`${name} in ${file} is used other than handed to a Button as onPress`);
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, why: problems.join('; ') };
}

// The line the closing hook refuses with, as hooks/mod/numbers.ts writes it.
const CLOSED_WORDS = 'Answered elsewhere; this question is closed';
// The registration, written out whole: the matcher, then one arrow that hands the call to the closing function and nothing
// else, then at most a catch that lets the call run.
const CLOSE_ON = /on\(\s*'tool\.call'\s*,\s*\{\s*tool:\s*'AskUserQuestion'\s*\}\s*,\s*\(\$,\s*e,\s*next\)\s*=>\s*closeWhenAnswered\(\$,\s*e,\s*next\)\s*\)(?:\s*\.catch\(\(\$,\s*e,\s*next\)\s*=>\s*next\(e\)\s*\))?/g;
// What the closing file may not say at all: an answer to the question, a tool result, a changed input.
const NEVER_IN_CLOSE = /(?<![\w$.])(?:result|results|answers|updatedInput|context|consent|isError)(?![\w$])/;
// The closing file is read as tokens and held to an allowlist, not searched for patterns, so another spelling of the
// same thing (an alias, `.call`, a computed key, a helper that writes) gets no further than the plain one.
const CLOSE_TOKEN = /\s+|[A-Za-z_$][\w$]*|\d[\w.]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|\.\.\.|>>>=|===|!==|\*\*=|<<=|>>=|>>>|&&=|\|\|=|\?\?=|=>|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\+\+|--|[-+*/%&|^]=|\*\*|<<|>>|[\s\S]/y;
// Words the closing file never uses: each is a way to write to the call, or to reach what it holds, with no assignment to see.
const CLOSE_BANNED = new Set(['Reflect', 'Object', 'Function', 'eval', 'delete', 'Proxy', 'globalThis', 'global', 'window', 'process', 'require',
  'constructor', 'prototype', '__proto__', 'call', 'apply', 'bind', 'with', 'for', 'this', 'arguments', 'super', 'class']);
// Methods that change what they are called on. `set` is allowed on the file's own map of pane presses.
const CLOSE_MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'clear', 'add', 'delete', 'set']);
// What the file holds and changes on its own: the counters of its check loop.
const CLOSE_LOCALS = new Set(['runs', 'asking', 'plain', 'told']);
// Names the file never declares itself, so each stands for what it was imported or built as.
const CLOSE_PROTECTED = new Set(['Promise', 'Array', 'Map', 'CLOSED_IN_PANEL', 'next', 'e', '$', 'ask', 'closeWhenAnswered', 'textsOf']);
const CLOSE_HEADER = 'export async function closeWhenAnswered ( $ : EngineInterface , e : { questions ? : unknown } , next : Next ) : Promise < unknown > {';
// The only things the hook itself returns: the refusal, what next(e) gave (held as running), and the choice between them.
const CLOSE_RETURNS = ['{ deny : CLOSED_IN_PANEL }', 'running', 'got === null ? { deny : CLOSED_IN_PANEL } : got . value'];
const CLOSE_RUNNING = 'const running = next ( e )';
const CLOSE_GOT = 'const got = await Promise . race ( [ running . then ( ( value ) => ( { value } ) ) , closing . then ( ( ) => null ) ] )';
// A `{` after one of these opens an object (or a type), not a block.
const CLOSE_OBJECT_AFTER = new Set(['(', ',', '=', ':', '?', '[', '||', '&&', '??', '|', '&', '<', '!', '+', '-', 'return', 'await', 'as', 'yield', 'typeof', 'throw', 'case', '...', '||=', '&&=', '??=', '+=']);
const closer = (w) => w === ')' || w === ']' || w === '}';
const opener = (w) => w === '(' || w === '[' || w === '{';

function closeTokens(code) {
  const out = [];
  CLOSE_TOKEN.lastIndex = 0;
  let nl = false;
  while (CLOSE_TOKEN.lastIndex < code.length) {
    const m = CLOSE_TOKEN.exec(code);
    if (m === null) break;
    if (/^\s/.test(m[0])) { nl ||= m[0].includes('\n'); continue; }
    out.push({ s: m[0], nl });
    nl = false;
  }
  return out;
}

// The index of the bracket that closes the one at i (or, from a closer, opens it); -1 if none.
function partner(s, i) {
  const step = closer(s[i]) ? -1 : 1;
  let depth = 0;
  for (let j = i; j >= 0 && j < s.length; j += step) {
    if (closer(s[j]) || opener(s[j])) depth += closer(s[j]) === (step === -1) ? 1 : -1;
    if (depth === 0) return j;
  }
  return -1;
}
const isName = (w) => w !== undefined && /^[A-Za-z_$][\w$]*$/.test(w);

// The problems with the closing file's code, as a list of lines.
function closeProblems(code) {
  const t = closeTokens(code);
  const s = t.map((x) => x.s);
  const at = (i) => s[i];
  const span = (from, to) => s.slice(from, to).join(' ');
  const problems = [];
  const say = (line) => { if (!problems.includes(line)) problems.push(line); };
  const changes = (what) => say(`${CLOSE_FILE} changes the call or its fields, or could (${what}), which the closing hook never does`);
  const dotted = (i) => at(i - 1) === '.' || at(i - 1) === '?.';

  s.forEach((w, i) => {
    if (CLOSE_BANNED.has(w)) changes(w);
    if (w === '...') say(`${CLOSE_FILE} uses a spread, which could put more into what it returns than the plain line`);
    if (w[0] === '`' && w.includes('${')) say(`${CLOSE_FILE} puts an expression inside a template string, which the check can't follow`);
    if (w === '/' || w === '/=') say(`${CLOSE_FILE} divides or writes a regular expression, which the check can't follow`);
    if (w === 'import' && at(i + 1) === '(') say(`${CLOSE_FILE} imports dynamically, which the check can't follow`);
    if (w === 'catch' && at(i + 1) === '(') say(`${CLOSE_FILE} names what it catches, which could hide a name the returns use`);
    if (dotted(i) && CLOSE_MUTATORS.has(w) && !(w === 'set' && at(i - 2) === 'pressed')) changes(`.${w}()`);
    if (['const', 'let', 'var', 'function'].includes(w) && CLOSE_PROTECTED.has(at(i + 1)) && !(w === 'function' && (at(i + 1) === 'textsOf' || at(i + 1) === 'closeWhenAnswered'))) say(`${CLOSE_FILE} declares ${at(i + 1)} itself, which it uses as it was given`);
  });

  // Assignments: only a declaration, the file's own counters and its timer.
  s.forEach((w, i) => {
    if (/^(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*%&|^])?=$/.test(w)) {
      let k = i - 1;
      if (isName(at(k))) {
        while (k >= 2 && (at(k - 1) === '.' || at(k - 1) === '?.') && isName(at(k - 2))) k -= 2;
        const left = span(k, i).replaceAll(' ', '');
        const before = at(k - 1);
        if (before === '.' || before === '?.' || before === ']') return changes(`an assignment to ${left}`);
        if ((before === 'const' || before === 'let' || before === 'type') && k === i - 1) return undefined;
        if (CLOSE_LOCALS.has(left) || left === 'held.timer') return undefined;
      }
      // A declaration with a type: const name: type = …
      let d = i - 1;
      for (; d >= 0; d--) {
        if (closer(at(d))) { d = partner(s, d); if (d < 0) break; continue; }
        if (['const', 'let', 'var'].includes(at(d))) break;
        if ([';', ',', '=', '=>', '(', '[', '{'].includes(at(d))) { d = -1; break; }
      }
      if (d >= 0 && w === '=' && isName(at(d + 1)) && at(d + 2) === ':') {
        const between = s.slice(d + 3, i);
        if (!between.some((x, n) => isName(x) && isName(between[n + 1]))) return undefined;
      }
      changes(`an assignment that is not a declaration, a counter or the timer: ${span(Math.max(0, i - 4), i + 2)}`);
    }
    if (w === '++' || w === '--') {
      if (!((CLOSE_LOCALS.has(at(i - 1)) && at(i - 2) !== '.') || (CLOSE_LOCALS.has(at(i + 1)) && at(i - 1) !== '.'))) changes('an increment or decrement');
    }
    return undefined;
  });

  // The call, e: handed to next(e), once, and textsOf(e); typed where it is a parameter; read as e.questions.
  const allowed = new Set();
  let nextCalls = 0;
  s.forEach((w, i) => {
    if (dotted(i)) return;
    if (w === 'next' && span(i, i + 4) === 'next ( e )') { nextCalls += 1; allowed.add(i).add(i + 2); }
    else if (w === 'next' && at(i - 1) === ',' && span(i, i + 4) === 'next : Next )') allowed.add(i);
    else if (w === 'textsOf' && span(i, i + 4) === 'textsOf ( e )') allowed.add(i + 2);
    else if (w === 'e' && (at(i - 1) === '(' || at(i - 1) === ',') && span(i, i + 8) === 'e : { questions ? : unknown }') allowed.add(i);
    else if (w === 'e' && span(i - 4, i + 4) === 'type Next = ( e : any )') allowed.add(i);
    else if (w === 'e' && span(i, i + 3) === 'e . questions') allowed.add(i);
  });
  s.forEach((w, i) => {
    if (dotted(i) || allowed.has(i)) return;
    if (w === 'e') say(`${CLOSE_FILE} gives the call to something other than next(e), textsOf(e) or a read of e.questions, which could change it or hand on a changed copy`);
    if (w === 'next') say(`${CLOSE_FILE} must call next only as next(e), once, with the call as it came (next is used another way: an alias, call, apply, bind or hand-over)`);
  });
  if (nextCalls !== 1) say(`${CLOSE_FILE} must call next only as next(e), once, with the call as it came`);

  // Objects have plain keys only: no computed key, string key, method or getter.
  s.forEach((w, i) => {
    if (w !== '{' || !CLOSE_OBJECT_AFTER.has(at(i - 1) ?? '')) return;
    const close = partner(s, i);
    let depth = 0;
    let part = [];
    const parts = [];
    for (const x of s.slice(i + 1, close < 0 ? s.length : close)) {
      if (opener(x)) depth += 1;
      else if (closer(x)) depth -= 1;
      if (x === ',' && depth === 0) { parts.push(part); part = []; } else part.push(x);
    }
    parts.push(part);
    for (const p of parts) if (p.length > 0 && !(isName(p[0]) && (p.length === 1 || p[1] === ':' || p[1] === '?'))) say(`${CLOSE_FILE} writes an object with a key that is not a plain name (a computed key, string key, method or getter): ${p.slice(0, 4).join(' ')}`);
  });

  // The hook: its header, and what it returns.
  const whole = ` ${s.join(' ')} `;
  const found = whole.indexOf(` ${CLOSE_HEADER} `);
  if (found < 0 || s.filter((w) => w === 'closeWhenAnswered').length !== 1) {
    say(`${CLOSE_FILE} must declare closeWhenAnswered once, as: ${CLOSE_HEADER} …`);
    return problems;
  }
  const open = whole.slice(0, found).split(' ').filter(Boolean).length + CLOSE_HEADER.split(' ').length - 1;
  const end = partner(s, open);
  const used = new Set();
  for (let i = open + 1; i < end; i++) {
    if (s[i] === '{' && s[i - 1] === '=>') { i = partner(s, i); continue; }
    if (s[i] !== 'return') continue;
    const hit = CLOSE_RETURNS.findIndex((r) => {
      const n = r.split(' ').length;
      return span(i + 1, i + 1 + n) === r && (i + 1 + n >= s.length || s[i + 1 + n] === ';' || s[i + 1 + n] === '}' || t[i + 1 + n].nl);
    });
    if (hit < 0) say(`${CLOSE_FILE} must refuse only with { deny: CLOSED_IN_PANEL } and otherwise return only what next(e) gave; it returns something else`);
    else used.add(hit);
  }
  const once = (decl) => whole.split(` ${decl} `).length === 2;
  if ((used.has(1) || used.has(2)) && !once(CLOSE_RUNNING)) say(`${CLOSE_FILE} must hold next(e)'s result as: ${CLOSE_RUNNING}, once`);
  if (used.has(2) && !once(CLOSE_GOT)) say(`${CLOSE_FILE} must build got as: ${CLOSE_GOT}, once`);
  for (const name of ['running', 'got']) {
    if (s.filter((w, i) => w === name && ['const', 'let', 'var', 'function'].includes(at(i - 1))).length > 1) say(`${CLOSE_FILE} declares ${name} more than once`);
  }
  return problems;
}
// The only files the closing file may import from.
const CLOSE_IMPORTS = ['claude-code', './ask', './numbers'];

// closeException(sources) -> { ok, why? }: the mod's one tool.call hook is exactly the closing hook. Read from the code
// of the module files: 'tool.call' is named once, in hooks/register.ts, as CLOSE_ON writes it; hooks/mod/close.ts returns
// of its own only { deny: CLOSED_IN_PANEL } (one `deny`, nowhere a result, answers, changed input or context), calls
// `next` only as next(e), with the call as it came, and CLOSED_IN_PANEL is the line hooks/mod/numbers.ts writes. The
// report from `claude plugin validate` (checkMod) holds the matcher.
export function closeException(sources) {
  const problems = [];
  const files = new Map(entriesOf(sources));
  const codes = new Map([...files].map(([file, text]) => [file, codeOf(text)]));
  const named = [...codes].flatMap(([file, code]) => [...code.matchAll(/['"`]tool\.call['"`]/g)].map(() => file));
  const registered = codes.get('hooks/register.ts') ?? '';
  const ons = [...registered.matchAll(CLOSE_ON)].length;
  if (named.length !== 1 || named[0] !== 'hooks/register.ts' || ons !== 1 || (registered.match(/(?<![\w$.])on\(\s*'tool\.call'/g) ?? []).length !== 1) {
    problems.push(`The mod must name 'tool.call' once, in hooks/register.ts, as the closing hook on { tool: 'AskUserQuestion' } handing the call to closeWhenAnswered and nothing else; it names it ${named.length} time${named.length === 1 ? '' : 's'}${named.length > 0 ? ` (in ${[...new Set(named)].join(', ')})` : ''}`);
  }
  if (!/import\s*\{\s*closeWhenAnswered\s*\}\s*from\s*'\.\/mod\/close'/.test(registered)) problems.push("hooks/register.ts doesn't import closeWhenAnswered from ./mod/close");
  const close = codes.get(CLOSE_FILE);
  if (close === undefined) return { ok: false, why: [...problems, `${CLOSE_FILE} can't be found`].join('; ') };
  problems.push(...closeProblems(close));
  if (NEVER_IN_CLOSE.test(close)) problems.push(`${CLOSE_FILE} says result, answers, updatedInput, context, consent or isError, which the closing hook never returns`);
  for (const { specifier } of importsIn(close)) if (!CLOSE_IMPORTS.includes(specifier)) problems.push(`${CLOSE_FILE} imports ${specifier}, which is not one of ${CLOSE_IMPORTS.join(', ')}`);
  if (!/import\s*\{\s*CLOSED_IN_PANEL\s*\}\s*from\s*'\.\/numbers'/.test(close)) problems.push(`${CLOSE_FILE} doesn't import CLOSED_IN_PANEL from ./numbers`);
  const words = /^export const CLOSED_IN_PANEL = '([^'\n]*)'/m.exec(files.get('hooks/mod/numbers.ts') ?? '');
  if (words === null || words[1] !== CLOSED_WORDS) problems.push(`hooks/mod/numbers.ts must write CLOSED_IN_PANEL as '${CLOSED_WORDS}'`);
  return problems.length === 0 ? { ok: true } : { ok: false, why: problems.join('; ') };
}

// scripts/setup/git.js is the one file of scripts/setup/ the bridge may reach: it is git's fence (an
// environment and an allowed list, importing only scripts/lib/), the records' git
// takes through scripts/lib/safe-git.js, and it writes no settings. It is to move into scripts/lib/.
const NEVER_REACHED = (file) => file === 'scripts/protection/locked.js' || (file.startsWith('scripts/setup/') && file !== 'scripts/setup/git.js');
const SETTINGS = 'scripts/protection/settings.js';
const WRITERS = ['writeSettings', 'mergeSettings'];
// managed.js is reached for its two readers, through hooks/kit.js's projectOf; it may be
// imported for those and nothing else.
const MANAGED = 'scripts/protection/managed.js';
const MANAGED_READERS = ['managedDir', 'lockedProjects'];
const IMPORT = /(?<![\w$.])(import|export)\s+(?:([\w$*\s{},]+?)\s+from\s+)?(['"])([^'"\n]+)\3/g;
const DYNAMIC = /(?<![\w$.])import\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;

// The imports of a file's code: { specifier, clause } for each `import … from '…'`, `export …
// from '…'`, side-effect `import '…'` and literal `import('…')`; `dynamic` counts the
// `import(…)` whose specifier isn't a literal.
function importsIn(code) {
  const found = [];
  for (const m of code.matchAll(IMPORT)) found.push({ specifier: m[4], clause: m[2] === undefined ? [] : taken(m[2]) });
  for (const m of code.matchAll(DYNAMIC)) found.push({ specifier: m[2], clause: ['*'] });
  found.dynamic = [...code.matchAll(/(?<![\w$.])import\s*\(\s*(?!['"])/g)].length;
  return found;
}

// What an import clause takes: the names, or '*' when it takes the whole file (a namespace
// or a default, which could be any of its names).
function taken(clause) {
  const text = clause.trim();
  if (text.includes('*')) return ['*'];
  const named = /\{([^}]*)\}/.exec(text);
  const names = named ? named[1].split(',').map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()).filter(Boolean) : [];
  const outside = text.replace(/\{[^}]*\}/, '').replace(/,/g, '').replace(/^type\s+/, '').trim();
  return outside ? ['*', ...names] : names;
}

// bridgeImports(root) -> { files, reaches, missing, unfollowed }: the bridge's static import graph from
// scripts/mod/bridge.js, followed through each file's relative `import … from '…'`,
// `export … from '…'` and `import('…')`; `node:` and bare specifiers are left. `reaches` names
// what writes Claude Code's settings: a file importing writeSettings or mergeSettings (or the
// whole file) from scripts/protection/settings.js, or anything but the readers managedDir and
// lockedProjects (or the whole file) from managed.js, or reaching locked.js or anything under
// scripts/setup/. The graph does reach settings.js itself, through the watcher's waker, which
// takes only the pure featureAllowRules, and managed.js, through hooks/kit.js's projectOf,
// which takes only the readers, so the check is on what is imported, not on the file.
// `missing` lists imports of files that can't be read; `unfollowed` lists the files in the graph
// that load another by a name the check can't read (an `import()` of anything but a literal, a
// `require(` or a `createRequire`), so nothing is loaded the check didn't see.
export function bridgeImports(root) {
  const files = new Set();
  const reaches = [];
  const missing = new Set();
  const unfollowed = [];
  const relative = (file) => slashes(path.relative(root, file));
  const resolve = (from, specifier) => {
    const base = path.resolve(path.dirname(path.join(root, from)), specifier);
    for (const candidate of [base, `${base}.js`, `${base}.ts`, path.join(base, 'index.js')]) {
      try {
        if (fs.statSync(candidate).isFile()) return relative(candidate);
      } catch {
        // Try the next spelling.
      }
    }
    return relative(base);
  };
  const visit = (file) => {
    if (files.has(file) || missing.has(file)) return;
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      missing.add(file);
      return;
    }
    files.add(file);
    if (NEVER_REACHED(file)) reaches.push(file);
    const code = codeOf(text);
    const imports = importsIn(code);
    if (imports.dynamic > 0 || /(?<![\w$])require\s*(?:\?\.\s*)?\(/.test(code) || /(?<![\w$])createRequire(?![\w$])/.test(code)) {
      unfollowed.push(`${file} loads a file by a name the checks can't follow (an import() that isn't a literal, a require( or a createRequire)`);
    }
    for (const { specifier, clause } of imports) {
      if (!specifier.startsWith('.')) continue;
      const target = resolve(file, specifier);
      if (target === SETTINGS) {
        const bad = clause.filter((name) => name === '*' || WRITERS.includes(name));
        if (bad.length > 0) reaches.push(`${file} imports ${bad.includes('*') ? 'the whole of the file' : bad.join(', ')} from ${SETTINGS}`);
      }
      if (target === MANAGED) {
        const bad = clause.filter((name) => name === '*' || !MANAGED_READERS.includes(name));
        if (bad.length > 0) reaches.push(`${file} imports ${bad.includes('*') ? 'the whole of the file' : bad.join(', ')} from ${MANAGED}`);
      }
      visit(target);
    }
  };
  visit('scripts/mod/bridge.js');
  return { files: [...files].sort(), reaches: [...new Set(reaches)], missing: [...missing].sort(), unfollowed };
}

// checkMod({ report, sources, allow }) -> { hooks, calls, problems }. `report` is what
// `claude plugin validate --json` printed; `sources` holds the text of every module file
// ({ 'hooks/register.ts': text, … }, as moduleFiles lists them); `allow` ({ hooks, calls })
// stands in for HOOKS and CALLS, which a test uses to show the forbidden lists hold alone.
// `hooksJson` is the parsed hooks/hooks.json (null when it can't be read; left out, it isn't
// checked, as in a test of the report alone); its `modules` must be ./register.ts and nothing else.
export function checkMod({ report, sources, hooksJson, allow = {} }) {
  const allowedHooks = allow.hooks ?? HOOKS;
  const allowedCalls = allow.calls ?? CALLS;
  const problems = [];
  if (report === null || typeof report !== 'object') {
    return { hooks: [], calls: [], problems: ['claude plugin validate gave no report'] };
  }
  const parts = [report.manifest, ...(Array.isArray(report.contents) ? report.contents : [])].filter((p) => p && typeof p === 'object');
  if (report.success !== true) problems.push('claude plugin validate did not pass');
  for (const part of parts) {
    for (const error of Array.isArray(part.errors) ? part.errors : []) problems.push(`claude plugin validate found an error: ${error?.path ?? ''} ${error?.message ?? ''}`.trim());
  }
  const notes = parts.filter((p) => p.type === 'hooks').flatMap((p) => (Array.isArray(p.notes) ? p.notes : []));
  const hooks = [];
  const calls = [];
  // Where the validator cut its calls list short ("$.ui.stat… [+34 chars]"): the cut item's start,
  // else null. Its list is sorted, so what the cut hides sorts at or after that start.
  let cutAt = null;
  for (const note of notes) {
    const hooked = /^(\S+) hooks: (.*)$/.exec(note);
    if (hooked) {
      hooks.push(...listed(hooked[2]));
      if (hooked[1] !== ENTRY) problems.push(`claude plugin validate lists hooks for ${hooked[1]}, not ${ENTRY}`);
    }
    const called = /^(\S+) calls: (.*)$/.exec(note);
    if (called) {
      const items = listed(called[2]);
      const cut = /^(.*)… \[\+\d+ chars\]$/.exec(items.at(-1) ?? '');
      if (cut) {
        items.pop();
        // A cut inside an item's "(via …)" leaves the item's own name whole.
        const named = /^(\S+) \(via /.exec(cut[1]);
        if (named) items.push(named[1]);
        cutAt = named ? named[1] : cut[1];
      }
      calls.push(...items);
      if (called[1] !== ENTRY) problems.push(`claude plugin validate lists calls for ${called[1]}, not ${ENTRY}`);
    }
  }
  if (hooksJson !== undefined) {
    const modules = hooksJson !== null && typeof hooksJson === 'object' ? hooksJson.modules : undefined;
    if (hooksJson === null || typeof hooksJson !== 'object') problems.push("hooks/hooks.json can't be read");
    else if (!Array.isArray(modules) || modules.length !== 1 || modules[0] !== ENTRY) problems.push(`hooks/hooks.json names ${Array.isArray(modules) ? JSON.stringify(modules) : 'no list of'} modules, not only ["${ENTRY}"]`);
  }
  for (const hook of hooks) {
    if (MATCHED_HOOKS.includes(hook)) problems.push(`The mod hooks ${hook} with no matcher, which would draw every component the engine draws`);
    if (hook !== CLOSE_HOOK && matchesForbidden(hook, FORBIDDEN_HOOKS)) problems.push(`The mod hooks ${hook}, which the mod must never hook`);
    else if (!allowedHooks.includes(hook)) problems.push(`The mod hooks ${hook}, which its brief doesn't name`);
  }
  for (const hook of allowedHooks) if (!hooks.includes(hook)) problems.push(`The mod doesn't hook ${hook}`);
  if (new Set(hooks).size !== hooks.length) problems.push('The mod hooks an event twice');
  for (const call of calls) {
    if (matchesForbidden(call, FORBIDDEN_CALLS)) problems.push(`The mod calls ${call}, which the mod must never call`);
    else if (!allowedCalls.includes(call)) problems.push(`The mod calls ${call}, which its brief doesn't name`);
  }
  const allowed = new Set([...allowedCalls, ...VALUES]);
  const files = entriesOf(sources);
  // A cut list: the members the source uses from the cut on stand for the list's hidden rest.
  if (cutAt !== null) {
    const hidden = [...new Set(files.flatMap(([, text]) => membersIn(text)))].filter((m) => m >= cutAt && !VALUES.includes(m) && !calls.includes(m)).sort();
    calls.push(...hidden);
  }
  const known = new Set(files.map(([file]) => file));
  for (const [file, text] of files) {
    const code = codeOf(text);
    const imports = importsIn(code);
    for (const { specifier } of imports) {
      if (!specifier.startsWith('.')) continue;
      const base = path.posix.join(path.posix.dirname(file), specifier);
      if (![base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`].some((candidate) => known.has(candidate))) {
        problems.push(`The mod's ${file} imports ${specifier}, which isn't one of the mod's files (hooks/register.ts and hooks/mod/)`);
      }
    }
    const stripped = new Set(membersIn(text));
    // Read again from the raw text: a forbidden member named anywhere, a comment included, fails.
    // A member the brief doesn't name fails here too, so a // the scan took for a comment (in
    // JSX text, say) can't hide a call.
    for (const member of rawMembersIn(text)) {
      if (stripped.has(member)) continue;
      if (matchesForbidden(member, FORBIDDEN_CALLS)) problems.push(`The mod's source names ${member}, which the mod must never call, in text that may be a comment (in ${file})`);
      else if (!allowed.has(member)) problems.push(`The mod's source names ${member}, which its brief doesn't name, in text that may be a comment (in ${file})`);
    }
    if (imports.dynamic > 0) problems.push(`The mod's ${file} imports a file by a name the checks can't read`);
    for (const member of membersIn(text)) {
      if (matchesForbidden(member, FORBIDDEN_CALLS)) problems.push(`The mod's source uses ${member}, which the mod must never call (in ${file})`);
      else if (!allowed.has(member)) problems.push(`The mod's source uses ${member}, which its brief doesn't name (in ${file})`);
      else if (!VALUES.includes(member) && !calls.includes(member)) problems.push(`The mod's source uses ${member}, which claude plugin validate doesn't list (in ${file})`);
    }
    if (/(?<![\w$])\$\s*(?:\?\.)?\s*\[/.test(code)) problems.push(`The mod's source reads a member of $ by a computed name, which the checks can't follow (in ${file})`);
  }
  for (const check of [bridgeArgv(sources), paneOrigin(sources), kitPresses(sources), closeException(sources)]) if (!check.ok) problems.push(check.why);
  return { hooks, calls, problems };
}

async function main() {
  let mod;
  try {
    mod = readMod(ROOT);
  } catch (error) {
    console.log(`The mod check failed: ${error.message}.`);
    return 1;
  }
  let report = null;
  try {
    const result = await run('claude', ['plugin', 'validate', '--json', ROOT], { timeoutMs: VALIDATE_MS });
    report = JSON.parse(result.stdout);
  } catch {
    report = null;
  }
  const { hooks, calls, problems } = checkMod({ report, ...mod });
  const graph = bridgeImports(ROOT);
  for (const reached of graph.reaches) problems.push(`The bridge's imports reach what writes Claude Code's settings: ${reached}`);
  for (const loose of graph.unfollowed) problems.push(`The bridge's imports can't be followed: ${loose}`);
  for (const gone of graph.missing) problems.push(`The bridge imports ${gone}, which can't be read`);
  console.log(`The mod hooks: ${hooks.length ? hooks.join(', ') : 'nothing'}.`);
  console.log(`It calls: ${calls.length ? calls.join(', ') : 'nothing'}.`);
  if (problems.length === 0) {
    console.log('The mod check passed.');
    return 0;
  }
  console.log('The mod check failed:');
  for (const problem of problems) console.log(`- ${problem}${/[.!?]$/.test(problem) ? "" : "."}`);
  return 1;
}

if (startedAsScript(import.meta.url)) {
  process.exitCode = await main();
}
