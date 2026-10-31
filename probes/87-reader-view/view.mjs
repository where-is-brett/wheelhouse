// probes/87-reader-view/view.mjs
// Check 87 (D3), the trial of the reader's view: `cleanDiff(text)` takes a unified diff and gives back the diff with
// comments taken out for the file types it can read, and a list of every other file by path and size. Commit messages
// are never part of the input: the caller gives `git diff`, not `git log -p`. Nothing runs at import.
//
//   node probes/87-reader-view/view.mjs <diff-file>
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Comment syntax by extension: line markers, a block pair, and whether `'` and `"` open strings.
const SYNTAX = {
  '.js': { line: ['//'], block: ['/*', '*/'], quotes: '\'"`' },
  '.ts': { line: ['//'], block: ['/*', '*/'], quotes: '\'"`' },
  '.swift': { line: ['//'], block: ['/*', '*/'], quotes: '"' },
  '.py': { line: ['#'], block: null, quotes: '\'"', docstrings: true },
  '.yaml': { line: ['#'], block: null, quotes: '\'"' },
  '.md': { line: [], block: ['<!--', '-->'], quotes: '' },
};

const extOf = (file) => { const m = /\.[A-Za-z0-9]+$/.exec(file); return m ? m[0].toLowerCase() : ''; };

// One line with its comment text taken out. `state.block` carries an open block comment from line to line, and
// `state.quote` an open string, so a `//` inside a string stays. Returns the line, or null when only a comment was on it.
function stripLine(line, syntax, state) {
  let out = '';
  let i = 0;
  let sawComment = false;
  while (i < line.length) {
    if (state.doc) {
      const end = line.indexOf(state.doc, i);
      sawComment = true;
      if (end === -1) { i = line.length; break; }
      i = end + 3; state.doc = null; continue;
    }
    if (state.block) {
      const end = line.indexOf(syntax.block[1], i);
      sawComment = true;
      if (end === -1) { i = line.length; break; }
      i = end + syntax.block[1].length; state.block = false; continue;
    }
    if (state.quote) {
      const ch = line[i];
      if (ch === '\\') { out += line.slice(i, i + 2); i += 2; continue; }
      if (line.startsWith(state.quote, i)) { out += state.quote; i += state.quote.length; state.quote = null; continue; }
      out += ch; i += 1; continue;
    }
    if (syntax.block && line.startsWith(syntax.block[0], i)) { state.block = true; sawComment = true; i += syntax.block[0].length; continue; }
    const marker = syntax.line.find((m) => line.startsWith(m, i));
    if (marker) {
      // A `#` in YAML or Python starts a comment only at the start of the line or after a space.
      if (marker !== '#' || i === 0 || /\s/.test(line[i - 1])) { sawComment = true; break; }
    }
    if (syntax.docstrings && (line.startsWith('"""', i) || line.startsWith("'''", i))) {
      const mark = line.slice(i, i + 3);
      // A triple-quoted string that opens a statement is a docstring, so it counts as a comment; any other is a string.
      if (out.trim() === '') { state.doc = mark; sawComment = true; i += 3; continue; }
      state.quote = mark; out += mark; i += 3; continue;
    }
    if (syntax.quotes.includes(line[i])) { state.quote = line[i]; out += line[i]; i += 1; continue; }
    out += line[i]; i += 1;
  }
  // A string that is not triple-quoted ends with its line.
  if (state.quote && state.quote.length === 1 && !syntax.quotes.includes('`')) state.quote = null;
  const kept = out.replace(/\s+$/, '');
  if (sawComment && kept.trim() === '') return null;
  return kept;
}

// The diff cut into files: { header lines, path, body lines }.
function splitFiles(text) {
  const files = [];
  let current = null;
  for (const line of String(text).split('\n')) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) { current = { path: header[2], lines: [line] }; files.push(current); continue; }
    if (current) current.lines.push(line);
  }
  return files;
}

export function cleanDiff(text) {
  const out = [];
  const pathsOnly = [];
  for (const file of splitFiles(text)) {
    const syntax = SYNTAX[extOf(file.path)];
    const size = Buffer.byteLength(file.lines.join('\n'));
    if (!syntax) { pathsOnly.push(`${file.path} (${size} bytes of change)`); continue; }
    const state = { block: false, quote: null, doc: null };
    let inHunk = false;
    for (const line of file.lines) {
      if (!inHunk) {
        if (line.startsWith('@@')) { inHunk = true; out.push(line); } else if (/^(diff --git|---|\+\+\+|new file|deleted file|rename )/.test(line)) out.push(line);
        continue;
      }
      if (line.startsWith('@@')) { state.block = false; state.quote = null; state.doc = null; out.push(line); continue; }
      const tag = line[0];
      if (tag !== '+' && tag !== '-' && tag !== ' ') { continue; }
      const kept = stripLine(line.slice(1), syntax, state);
      if (kept === null) continue;
      out.push(tag + kept);
    }
  }
  return { diff: out.join('\n'), pathsOnly };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { diff, pathsOnly } = cleanDiff(fs.readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(`${diff}\n\nPath and size only:\n${pathsOnly.map((p) => `  ${p}`).join('\n')}\n`);
}
