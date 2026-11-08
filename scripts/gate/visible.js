// scripts/gate/visible.js
// Whether a change shows something users see, judged from the change itself (design section 8 of the director's way of working).
// Intake judges visibility when the request comes in; this is the gate's own reading of the files and text that changed, so a
// change that turns out visible waits for the director even if intake thought otherwise.
//
//   visibleFromChange({ paths, diff, config }) -> { visible, unsure, reasons }
//     paths:  the changed files, repository-relative
//     diff:   the change as one unified diff (git diff --unified=0), read by the helper
//     files:  the changed manifests as { base, head } text, for package.json
//     config: the project's configuration; `visibility.paths` adds globs for files that are visible in that project
// Path detectors name pages, components, templates, styles, locales, command-line entry points, flags, settings and API routes.
// A text detector looks for changed string literals in code outside the tests. A file no detector knows is `unsure`, and so is a
// change whose paths or diff can't be read: unsure is the director's, so it waits. Pure.
import { matchGlob } from './glob.js';

const VISIBLE_PATHS = Object.freeze([
  ['page', ['**/pages/**', '**/views/**', '**/screens/**', '**/app/**/page.*', '**/app/**/layout.*', '**/*.html', '**/*.htm']],
  ['component', ['**/components/**', '**/*.jsx', '**/*.tsx', '**/*.vue', '**/*.svelte', '**/*.astro']],
  ['template', ['**/templates/**', '**/*.hbs', '**/*.ejs', '**/*.mustache', '**/*.pug', '**/*.njk', '**/*.erb', '**/*.liquid', '**/*.jinja', '**/*.j2']],
  ['style', ['**/*.css', '**/*.scss', '**/*.sass', '**/*.less', '**/*.styl', '**/styles/**']],
  ['locale', ['**/locales/**', '**/i18n/**', '**/lang/**', '**/translations/**']],
  ['command-line entry', ['bin/**', '**/cli.*', '**/cli/**', '**/commands/**']],
  ['flag', ['**/flags/**', '**/flags.*', '**/feature-flags.*', '**/features.*']],
  ['setting', ['**/settings.*', '**/settings/**', '**/preferences.*']],
  ['API route', ['**/api/**', '**/routes/**', '**/routes.*', '**/endpoints/**', '**/controllers/**']],
  ['image or font', ['**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp', '**/*.svg', '**/*.ico', '**/*.woff', '**/*.woff2', '**/*.ttf', '**/*.otf']],
]);

// What users never see: tests, documents, the tools around the code, lock files.
const TEST_PATHS = Object.freeze(['tests/**', 'test/**', 'spec/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*']);
const INTERNAL_PATHS = Object.freeze([
  'docs/**', 'LICENSE*', '.github/**', '.gitlab/**', '.gitlab-ci.yml',
  '.gitignore', '.gitattributes', '.editorconfig', '.nvmrc', '.npmrc', '.prettierrc*', '.prettierignore', '.eslintrc*', '.eslintignore', 'eslint.config.*',
  'tsconfig*.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'Gemfile.lock', 'Cargo.lock', 'go.sum', 'poetry.lock',
]);

// Code, whose changed text is read for string literals.
const CODE = /\.(?:js|mjs|cjs|ts|mts|cts|py|rb|go|rs|java|kt|swift|php|cs|c|h|cpp|hpp|sh|lua)$/i;

const matchesAny = (patterns, file) => patterns.some((p) => matchGlob(p, file, { ignoreCase: true }));

const UNREADABLE_PATHS = 'the changed files could not be read';
const UNREADABLE_DIFF = 'the change\'s text could not be read';

// One diff's sections by file: file -> { lines, binary }. A file that is not found has no section.
function sections(diff) {
  const found = new Map();
  let current = null;
  for (const line of diff.split('\n')) {
    const head = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (head) {
      current = { lines: [], binary: false };
      found.set(head[2], current);
      if (head[1] !== head[2]) found.set(head[1], current);
    } else if (current !== null) {
      if (/^(?:Binary files .* differ|GIT binary patch)$/.test(line)) current.binary = true;
      else if (/^[+-]/.test(line) && !/^(?:\+\+\+|---) /.test(line)) current.lines.push(line);
    }
  }
  return found;
}

// What a language writes a comment as: `#` is a comment in some and a directive or an attribute in others, so it is read by language.
const SLASH_COMMENTS = /\.(?:js|mjs|cjs|ts|mts|cts|go|rs|java|kt|swift|php|cs|c|h|cpp|hpp)$/i;
const HASH_COMMENTS = /\.(?:py|rb|sh|php)$/i;
const DASH_COMMENTS = /\.lua$/i;
// Words that start a line of code. A line that starts with one is code only if what follows has code shape: plain words after it are text.
const KEYWORDS = 'import|export|return|const|let|var|function|def|class|async|await|if|else|elif|for|while|switch|case|default|try|catch|except|finally|throw|raise|yield|new|do|end|pass|break|continue|with|assert|lambda|global|del|package|use|fn|func|pub|public|private|protected|static|type|interface|enum|struct|impl|trait|namespace|using|require|include|extend|module|puts|print|from|in|of|then';
const KEYWORD_START = new RegExp(`^(?:${KEYWORDS})(?![\\w$])`);
// A style declaration: `color: red;`, `font-size: 14px`, `margin: 0 auto`. Alone on a line in a code file it is the middle of a
// style block in a string, which users see.
const DECLARATION = /^[A-Za-z-]+\s*:\s*[^;{},]+;?$/;
// A value that is a code token and no word of text: digits, true/false/null/None, a dotted name, brackets, a blanked literal, a type.
const CODE_VALUE = /^(?:\d+(?:\.\d+)?|true|false|null|None|undefined|string|number|boolean|any|unknown|void|never|[\w$]+(?:\.[\w$]+)+|\[.*\]|\(.*\)|"")$/;
const ADJACENT_WORDS = /[A-Za-z0-9]\s+[A-Za-z0-9]/;

// Whether a line, with its literals blanked, is unmistakably code with no text on it. Anything else with letters in it is the safe
// side: unsure. A word or a comma, a keyword, a colon or `&&` that code also uses is not enough on its own.
function looksLikeCode(line) {
  const t = line.replace(/\$?\{[^{}]*\}/g, ' ').trim();
  if (!/[A-Za-z]/.test(t)) return true;
  if (DECLARATION.test(t) && (t.endsWith(';') || /^[A-Za-z]*-/.test(t) || /:\s*[^;]*[\d#%]/.test(t))) return false;
  let rest = t;
  for (let m = KEYWORD_START.exec(rest); m !== null; m = KEYWORD_START.exec(rest)) rest = rest.slice(m[0].length).trimStart();
  const started = rest !== t;
  // The block openers and statements below are whole lines whose shape only code has.
  // Block openers with their colon, and statements whose shape only code has.
  if (/^(?:else|try|finally):$/.test(t) || /^except:$/.test(t)) return true;
  const header = /^(?:if|elif|while)\s+(.+):$/.exec(t);
  if (header !== null && (/[=<>!()\[\]._\d]/.test(header[1]) || /^(?:not\s+)?[A-Za-z]$/.test(header[1]) || /^(?:True|False|None)$/.test(header[1]))) return true;
  if (/^for\s+(?:\w+|\(?\w+(?:,\s*\w+)*\)?)\s+in\s+[\w.()\[\]'"*,-]+:$/.test(t)) return true;
  if (/^except\s+(?:[A-Z]\w*(?:\.\w+)*(?:\s+as\s+\w+)?|\(.*\)(?:\s+as\s+\w+)?):$/.test(t) || /^class\s+[A-Z]\w*(?:\(.*\))?:$/.test(t)) return true;
  if (/^case\s+(?:\d+|""):$/.test(t)) return true;
  if (/^from\s+[\w.]+\s+import\s+[\w*]+(?:\s*,\s*[\w*]+)*$/.test(t) || /^import\s+[\w.]+(?:\s+as\s+\w+)?$/.test(t)) return true;
  if (/^import\s+[\w{}*,\s$]+\s+from\s*""$/.test(t) || /^import\s*""$/.test(t) || /^export\s+default\s+[\w$.]+;?$/.test(t)) return true;
  if (/^package\s+[a-z][\w.]*$/.test(t) || /^attr_(?:reader|accessor|writer)\s+:\w+/.test(t) || /^@[\w.]+$/.test(t)) return true;
  // Sentences and amounts are text, even with code punctuation in them.
  if (/\$\d/.test(t) || /[A-Za-z0-9][.!?](?:\s|$)/.test(t) || /\b[A-Za-z]{2,}\s+[A-Za-z]{2,}\s+[A-Za-z]{2,}\b/.test(rest)) return false;
  // A spread, or a line of arguments whose shape is code: `...rest,` `snake_case,` `a.b,` `x=1,` `foo(a),`.
  if (/^\.\.\.[\w$.]+,?$/.test(t) || /^[\w$]*[_.][\w$.]*,$/.test(t) || /^[\w$.]+\s*=\s*[^\s,=]+,$/.test(t)) return true;
  // A member whose value is a code token, not a word.
  const member = /^[A-Za-z_$][\w$]*\??\s*:\s*(.+?)\s*[,;]?$/.exec(t);
  if (member !== null && CODE_VALUE.test(member[1]) && !t.endsWith(';')) return true;
  // A call is a name with brackets that hold an argument: not a lone letter, not words with spaces between them; or a whole line
  // that is one call.
  const call = /[\w\])]\(([^()]*)\)/.exec(t);
  const callOk = (inside) => inside.trim() === '' || (!/^[A-Za-z]$/.test(inside.trim()) && !ADJACENT_WORDS.test(inside));
  if (call !== null && callOk(call[1]) && (started ? true : /^[\w$.@\[\]]+\(/.test(t) || !/[A-Za-z]\s+[\w$.]+\(/.test(t))) return true;
  if (/^[\w$.@\[\]]+\(.*\)[;,]?$/.test(t) && !ADJACENT_WORDS.test(t.slice(t.indexOf('(')))) return true;
  // Punctuation only code uses, on a line that is not text. Plain words after a keyword are not code shape.
  if (/[=;{}]/.test(t)) return true;
  return false;
}

// One line read as code: { lits, unsure }. `lits` are its string literals (and the text between tags), in order, leaving out the
// specifiers of imports and requires, comments, and any without a letter. `unsure` is a line that has text on it but no closed
// literal to show for it: the middle of a multi-line string, a string that opens or closes on it, or prose.
function readLine(line, file) {
  const slash = SLASH_COMMENTS.test(file);
  const hash = HASH_COMMENTS.test(file);
  const dash = DASH_COMMENTS.test(file);
  const text = line.trim();
  if (text === '') return { lits: [], unsure: false };
  if ((slash && /^(?:\/\/|\/\*|\*)/.test(text)) || (hash && text.startsWith('#')) || (dash && text.startsWith('--'))) return { lits: [], unsure: false };
  // Walk the line: take out the literals, and stop at a comment that is not inside one.
  const lits = [];
  let rest = '';
  let i = 0;
  let open = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === '\'' || ch === '`') {
      let j = i + 1;
      let body = '';
      while (j < text.length && text[j] !== ch) {
        if (text[j] === '\\' && j + 1 < text.length) { body += text.slice(j, j + 2); j += 2; } else { body += text[j]; j += 1; }
      }
      if (j >= text.length) { open = true; break; }
      const before = rest.trimEnd();
      const specifier = /\bfrom$/.test(before) || /\b(?:require|import)\s*\($/.test(before) || before === 'import';
      if (!specifier && /[A-Za-z]/.test(body) && body !== 'use strict') lits.push(body);
      rest += '""';
      i = j + 1;
    } else if (slash && ch === '/' && text[i + 1] === '/') {
      break;
    } else if (slash && ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 2;
    } else if (hash && ch === '#') {
      break;
    } else if (dash && ch === '-' && text[i + 1] === '-') {
      break;
    } else {
      rest += ch;
      i += 1;
    }
  }
  // Text between tags (JSX, or HTML in a code file) counts as text.
  let unsure = open;
  if (/<\/?[A-Za-z][^<>]*>|<\/[A-Za-z]/.test(rest) && (/<\/|\/>/.test(rest) || /^\s*</.test(rest))) {
    const withoutBraces = rest.replace(/\{[^{}]*\}/g, '');
    for (const m of withoutBraces.matchAll(/(?:^|>)([^<>]*)(?=<|$)/g)) {
      const words = m[1].trim();
      if (/[A-Za-z]{2}/.test(words)) lits.push(`tag:${words}`);
    }
  } else if (lits.length === 0 && !unsure) {
    // Text can be anywhere with no quote on its line, so a line with letters is unsure unless it plainly looks like code: it has code
    // punctuation or structure, or is a statement. Text put into a line by `{...}` is not code.
    if (/\$\{/.test(rest)) unsure = true;
    else if (/[A-Za-z]/.test(rest.replace(/\$?\{[^{}]*\}/g, ' ')) && !looksLikeCode(rest)) unsure = true;
  }
  if (/"{3}|'{3}/.test(text) && hash) unsure = true;
  return { lits, unsure };
}

// Whether the literals taken out and put in differ, as counts (so a line moved is not a change), and whether any changed line
// has text that could not be read as a literal.
function readLines(lines, file) {
  const counts = new Map();
  let unsure = false;
  for (const line of lines) {
    const sign = line[0] === '+' ? 1 : -1;
    const got = readLine(line.slice(1), file);
    if (got.unsure) unsure = true;
    for (const lit of got.lits) counts.set(lit, (counts.get(lit) ?? 0) + sign);
  }
  return { changed: [...counts.values()].some((n) => n !== 0), unsure };
}

// Whether a package.json change is in its development dependencies alone, read from the two versions of the file.
function onlyDevDependencies(entry) {
  try {
    if (typeof entry?.base !== 'string' || typeof entry?.head !== 'string') return false;
    const [before, after] = [JSON.parse(entry.base), JSON.parse(entry.head)];
    if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') return false;
    delete before.devDependencies;
    delete after.devDependencies;
    return JSON.stringify(sortKeys(before)) === JSON.stringify(sortKeys(after));
  } catch {
    return false;
  }
}
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  return value;
}

export function visibleFromChange(input) {
  const { paths, diff, config, files } = input !== null && typeof input === 'object' ? input : {};
  const unsureOnly = (why) => ({ visible: false, unsure: true, reasons: [why] });
  if (!Array.isArray(paths) || paths.length === 0 || !paths.every((p) => typeof p === 'string' && p !== '')) return unsureOnly(UNREADABLE_PATHS);
  if (typeof diff !== 'string') return unsureOnly(UNREADABLE_DIFF);
  const extra = Array.isArray(config?.visibility?.paths) ? config.visibility.paths.filter((p) => typeof p === 'string') : [];
  const read = sections(diff);
  const visible = [];
  const unsure = [];
  for (const raw of paths) {
    const file = raw.replace(/\\/g, '/');
    if (file.split('/').includes('..')) { unsure.push(`${raw}: a path that could not be read`); continue; }
    if (extra.length > 0 && matchesAny(extra, file)) { visible.push(`${file}: a path the project names as visible`); continue; }
    if (matchesAny(TEST_PATHS, file)) continue;
    const kind = VISIBLE_PATHS.find(([, patterns]) => matchesAny(patterns, file))?.[0];
    if (kind !== undefined) { visible.push(`${file}: ${kind}`); continue; }
    if (matchesAny(INTERNAL_PATHS, file)) continue;
    if (file === 'package.json' || file.endsWith('/package.json')) {
      if (!onlyDevDependencies(files?.[file] ?? files?.[raw])) unsure.push(`${file}: more than its development dependencies changed`);
      continue;
    }
    if (!CODE.test(file)) { unsure.push(`${file}: a kind of file that can't be judged`); continue; }
    const section = read.get(file) ?? read.get(raw);
    if (section === undefined || section.binary) { unsure.push(`${file}: its changed text could not be read`); continue; }
    const got = readLines(section.lines, file);
    if (got.changed) visible.push(`${file}: changed text in code`);
    else if (got.unsure) unsure.push(`${file}: changed lines with text that could not be read`);
  }
  return { visible: visible.length > 0, unsure: unsure.length > 0, reasons: [...visible, ...unsure] };
}
