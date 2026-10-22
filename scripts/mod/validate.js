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
//     the pane's origin is named;
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
  'session.start', 'session.measure', 'turn.start', 'turn.complete', 'prompt.submit', 'command.run{command=go}', 'session.receive',
  'command.run{command=wheelhouse}', 'command.run{command=digest}', `ui.render{component=Pane, requestId=${PANE_ID}}`,
];
// $.clock.now reads the time a tick's answer was read and the time the pane is drawn, for the
// line saying what is shown is old. $.prompt.submit hands the front desk the prompts a press's
// answer holds, and the settings view's Ask the front desk, and hands on the prompts a tick's
// answer holds: the courier's wake in the front desk, the watcher's lines in a Shape 2 foreman.
// $.session.surfaces reads the surfaces the session has attached, so the pane opens only once there is
// one. $.ui.invalidate draws the pane again while a tick hangs, so the line saying what is shown is
// old comes without a tick's answer; it only draws.
export const CALLS = [
  '$.clock.every', '$.clock.now', '$.command.register', '$.process.run', '$.prompt.submit', '$.session.id', '$.session.root',
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
export const FORBIDDEN_CALLS = ['$.tool.*', '$.agent.*', '$.fs.*', '$.settings.*', '$.http.*', '$.model.*', '$.command.run', '$.prompt.fill', '$.session.append', '$.process.spawn', '$.env.set'];

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
const ARGV = /^\s*\[\s*'node'\s*,\s*`\$\{\$\.plugin\.root\}\/scripts\/mod\/bridge\.js`\s*\]\s*$/;
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
  if (!ARGV.test(argv)) return "runs something other than ['node', `${$.plugin.root}/scripts/mod/bridge.js`], the bridge";
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
// A press is passed as a Button's onPress, directly or through the drawing kit's button functions
// (hooks/mod/calm.tsx), which take it as their last argument and set it as the Button's onPress.
const ON_PRESS = /(?:onPress\s*=\s*\{|\b(?:filled|outlined|small|stopButton)\([^\n]*,)\s*(?:async\s*)?(?:\([^)]*\)\s*=>\s*)?$/;

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

const NEVER_REACHED = (file) => file === 'scripts/protection/locked.js' || file.startsWith('scripts/setup/');
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
  for (const note of notes) {
    const hooked = /^(\S+) hooks: (.*)$/.exec(note);
    if (hooked) {
      hooks.push(...listed(hooked[2]));
      if (hooked[1] !== ENTRY) problems.push(`claude plugin validate lists hooks for ${hooked[1]}, not ${ENTRY}`);
    }
    const called = /^(\S+) calls: (.*)$/.exec(note);
    if (called) {
      calls.push(...listed(called[2]));
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
    if (matchesForbidden(hook, FORBIDDEN_HOOKS)) problems.push(`The mod hooks ${hook}, which the mod must never hook`);
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
  for (const check of [bridgeArgv(sources), paneOrigin(sources)]) if (!check.ok) problems.push(check.why);
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
