// scripts/gate/visible.js
// Whether a change shows something users see, judged from the change itself (design section 8 of the director's way of working).
// Intake judges visibility when the request comes in; this is the gate's own reading of the files and text that changed, so a
// change that turns out visible waits for the director even if intake thought otherwise.
//
//   visibleFromChange({ paths, diff, config }) -> { visible, unsure, reasons }
//     paths:  the changed files, repository-relative
//     diff:   the change as one unified diff (git diff --unified=0), read by the helper
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
  'docs/**', '*.md', 'LICENSE*', '.github/**', '.gitlab/**', '.gitlab-ci.yml',
  '.gitignore', '.gitattributes', '.editorconfig', '.nvmrc', '.npmrc', '.prettierrc*', '.prettierignore', '.eslintrc*', '.eslintignore', 'eslint.config.*',
  'tsconfig*.json', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'Gemfile.lock', 'Cargo.lock', 'go.sum', 'poetry.lock',
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

// A line's string literals, in order, leaving out the specifiers of imports and requires, comments, and any without a letter.
function literalsOf(line) {
  const text = line.trim();
  if (/^(?:\/\/|\/\*|\*|#|--)/.test(text)) return [];
  const bare = text
    .replace(/\bfrom\s+(["'`]).*?\1/g, '')
    .replace(/\b(?:require|import)\s*\(\s*(["'`]).*?\1\s*\)/g, '')
    .replace(/^\s*import\s+(["'`]).*?\1/, '')
    .replace(/\s\/\/.*$/, '');
  const found = [];
  for (const m of bare.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    if (/[A-Za-z]/.test(m[2]) && m[2] !== 'use strict') found.push(m[2]);
  }
  return found;
}

// Whether the literals taken out and put in differ, as counts (so a line moved is not a change).
function literalsChanged(lines) {
  const counts = new Map();
  for (const line of lines) {
    const sign = line[0] === '+' ? 1 : -1;
    for (const lit of literalsOf(line.slice(1))) counts.set(lit, (counts.get(lit) ?? 0) + sign);
  }
  return [...counts.values()].some((n) => n !== 0);
}

export function visibleFromChange(input) {
  const { paths, diff, config } = input !== null && typeof input === 'object' ? input : {};
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
    if (!CODE.test(file)) { unsure.push(`${file}: a kind of file that can't be judged`); continue; }
    const section = read.get(file) ?? read.get(raw);
    if (section === undefined || section.binary) { unsure.push(`${file}: its changed text could not be read`); continue; }
    if (literalsChanged(section.lines)) visible.push(`${file}: changed text in code`);
  }
  return { visible: visible.length > 0, unsure: unsure.length > 0, reasons: [...visible, ...unsure] };
}
