// scripts/mod/validate.js
// Checks the mod before its tests run (npm run mod-check). It is the proof that the mod
// approves nothing, from three sides:
//   - `claude plugin validate --json` reads the mod's files as Claude Code will: the mod must
//     hook exactly the events its brief names and none of the forbidden hooks, and call only
//     what the brief names and never a forbidden call;
//   - the source of every module file (hooks/register.ts and everything under hooks/mod/) is
//     read for every member of `$` it touches, so nothing the validator doesn't list slips
//     past, and for the one `$.process.run` (the bridge's, in hooks/mod/ask.ts) and for where
//     the pane's origin is named;
//   - the bridge's static import graph is followed, so nothing it loads can write Claude
//     Code's settings.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from '../lib/run.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALIDATE_MS = 60000;

// The hooks, as the validator spells them, and the calls on `$` the brief allows: the whole
// mod's lists, each entry added by the task that first needs it.
export const HOOKS = ['session.start', 'session.measure', 'prompt.submit', 'command.run{command=go}'];
export const CALLS = ['$.command.register', '$.process.run', '$.session.id', '$.session.root', '$.session.usage', '$.ui.toast'];
// A value of `$`, not a call, so the validator doesn't list it.
const VALUES = ['$.plugin.root'];

// What the mod must never hook or call, even if HOOKS or CALLS were to name it. A `*` stands
// for any rest of the name: `classic.*` is every classic hook, `$.fs.*` every call on `$.fs`.
export const FORBIDDEN_HOOKS = ['tool.check', 'tool.call', 'tool.describe', 'config.set', 'agent.offer', 'plugin.register', 'classic.*'];
export const FORBIDDEN_CALLS = ['$.tool.*', '$.agent.*', '$.fs.*', '$.settings.*', '$.http.*', '$.model.*', '$.command.run', '$.prompt.fill', '$.session.append', '$.process.spawn', '$.env.set'];

// Whether a hook or call, as the validator or the source spells it, is one the patterns name.
// A hook may carry a matcher after its name (`tool.check{tool=Bash}`).
export function matchesForbidden(name, patterns) {
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
const ARGV = /^\s*\(\s*\[\s*'node'\s*,\s*`\$\{\$\.plugin\.root\}\/scripts\/mod\/bridge\.js`\s*\]\s*[,)]/;

// bridgeArgv(sources) -> { ok, why? }: the sources hold exactly one `$.process.run(`, in
// hooks/mod/ask.ts, and its argv is the literal ['node', `${$.plugin.root}/scripts/mod/bridge.js`].
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
  if (!/(?<![\w$.])\$\s*\.\s*$/.test(before) || !ARGV.test(rest)) return { ok: false, why: `The mod's $.process.run( in ${ASK} runs something other than ['node', \`\${$.plugin.root}/scripts/mod/bridge.js\`], the bridge` };
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
const ON_PRESS = /onPress\s*=\s*\{\s*(?:async\s*)?(?:\([^)]*\)\s*=>\s*)?$/;

// paneOrigin(sources) -> { ok, why? }: `origin: 'pane'` appears only inside functions whose
// names begin `press` in cards.tsx and settings.tsx, which those files pass as `onPress` and
// nothing else calls. Read by name, without a TypeScript parser.
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

// bridgeImports(root) -> { files, reaches, missing }: the bridge's static import graph from
// scripts/mod/bridge.js, followed through each file's relative `import … from '…'`,
// `export … from '…'` and `import('…')`; `node:` and bare specifiers are left. `reaches` names
// what writes Claude Code's settings: a file importing writeSettings or mergeSettings (or the
// whole file) from scripts/protection/settings.js, or anything but the readers managedDir and
// lockedProjects (or the whole file) from managed.js, or reaching locked.js or anything under
// scripts/setup/. The graph does reach settings.js itself, through the watcher's waker, which
// takes only the pure featureAllowRules, and managed.js, through hooks/kit.js's projectOf,
// which takes only the readers, so the check is on what is imported, not on the file.
// `missing` lists imports of files that can't be read.
export function bridgeImports(root) {
  const files = new Set();
  const reaches = [];
  const missing = new Set();
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
    for (const { specifier, clause } of importsIn(code)) {
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
  return { files: [...files].sort(), reaches: [...new Set(reaches)], missing: [...missing].sort() };
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
    for (const member of rawMembersIn(text)) {
      if (!stripped.has(member) && matchesForbidden(member, FORBIDDEN_CALLS)) problems.push(`The mod's source names ${member}, which the mod must never call, in text that may be a comment (in ${file})`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
