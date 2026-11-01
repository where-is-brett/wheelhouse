// scripts/delegation/clean-diff.js
// A change with what its builder said taken out (check 87, D3). `cleanDiff(text)` takes `git diff` output, never
// `git log -p`, so commit messages are never in it, and gives the diff with its comments out for the file types it can
// read, and every other file, Markdown, JSON and plain text among them, by path and size only. A diff with the whole of
// each file as context reads a comment opened above the change as one; context far from a change is left out afterwards.
// A string in code stays, so a comment moved into a string is a known limit (check 87).

// Comment syntax by extension: line markers, a block pair, and which marks open a string. YAML's quotes aren't read, so
// a `#` in one is taken as a comment: more goes than need be, and nothing the builder said stays.
const C_LIKE = { line: ['//'], block: ['/*', '*/'], quotes: '\'"`' };
const HASH = { line: ['#'], block: null, quotes: '' };
const SYNTAX = {
  '.js': C_LIKE,
  '.mjs': C_LIKE,
  '.cjs': C_LIKE,
  '.ts': C_LIKE,
  '.swift': { line: ['//'], block: ['/*', '*/'], quotes: '"' },
  '.py': { ...HASH, quotes: '\'"', docstrings: true },
  '.yaml': HASH,
  '.yml': HASH,
};
// How many lines of context stay beside a change.
const NEAR = 3;

const extOf = (file) => /\.[A-Za-z0-9]+$/.exec(file)?.[0].toLowerCase() ?? '';
const fresh = () => ({ block: false, quote: null, doc: null });

// One line with its comment text out. `state` carries an open block comment or string from line to line. Null when
// only a comment was on the line.
function stripLine(line, syntax, state) {
  let out = '';
  let i = 0;
  let sawComment = false;
  while (i < line.length) {
    if (state.doc) {
      const end = line.indexOf(state.doc, i);
      sawComment = true;
      if (end === -1) break;
      i = end + 3;
      state.doc = null;
    } else if (state.block) {
      const end = line.indexOf(syntax.block[1], i);
      sawComment = true;
      if (end === -1) break;
      i = end + syntax.block[1].length;
      state.block = false;
    } else if (state.quote) {
      if (line[i] === '\\') {
        out += line.slice(i, i + 2);
        i += 2;
      } else if (line.startsWith(state.quote, i)) {
        out += state.quote;
        i += state.quote.length;
        state.quote = null;
      } else {
        out += line[i];
        i += 1;
      }
    } else if (syntax.block && line.startsWith(syntax.block[0], i)) {
      state.block = true;
      sawComment = true;
      i += syntax.block[0].length;
    } else if (syntax.line.some((m) => line.startsWith(m, i)) && (line[i] !== '#' || i === 0 || /\s/.test(line[i - 1]))) {
      // A `#` starts a comment only at the start of a line or after a space.
      sawComment = true;
      break;
    } else if (syntax.docstrings && (line.startsWith('"""', i) || line.startsWith("'''", i))) {
      const mark = line.slice(i, i + 3);
      i += 3;
      // A triple-quoted string that opens a statement is a docstring, so it counts as a comment.
      if (out.trim() === '') {
        state.doc = mark;
        sawComment = true;
      } else {
        state.quote = mark;
        out += mark;
      }
    } else {
      if (syntax.quotes.includes(line[i])) state.quote = line[i];
      out += line[i];
      i += 1;
    }
  }
  // Only a template string or a triple-quoted one runs on past its line.
  if (state.quote?.length === 1 && state.quote !== '`') state.quote = null;
  const kept = out.replace(/\s+$/, '');
  return sawComment && kept.trim() === '' ? null : kept;
}

// The diff cut into files, each from its own `diff --git` line: only a hunk's lines open otherwise, so none can pass for one.
function splitFiles(text) {
  const files = [];
  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const named = /^diff --git (?:"?a\/.+"? )"?b\/(.+?)"?$/.exec(line);
      files.push({ path: named?.[1] ?? line.slice('diff --git '.length), lines: [line] });
    } else {
      files.at(-1)?.lines.push(line);
    }
  }
  return files;
}

// The lines of a change kept: each side of a hunk read as its own file, the new side's words shown for context.
function cleanFile(lines, syntax) {
  const kept = [];
  let sides = null;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      sides = { '+': fresh(), '-': fresh() };
      kept.push({ hunk: /^@@ [^@]* @@/.exec(line)?.[0] ?? '@@' });
    } else if (sides && '+- '.includes(line[0] ?? '\\')) {
      const tag = line[0];
      if (tag === ' ') stripLine(line.slice(1), syntax, sides['-']);
      const text = stripLine(line.slice(1), syntax, sides[tag === ' ' ? '+' : tag]);
      if (text !== null) kept.push({ tag, text });
    }
  }
  return kept;
}

// The kept lines as text, with context further than NEAR from a change left out.
function nearChanges(kept) {
  const changed = kept.flatMap((row, at) => (row.tag === '+' || row.tag === '-' ? [at] : []));
  const out = [];
  let gap = false;
  kept.forEach((row, at) => {
    if (row.hunk) {
      out.push(row.hunk);
      gap = false;
    } else if (row.tag !== ' ' || changed.some((c) => Math.abs(c - at) <= NEAR)) {
      if (gap) out.push('@@');
      out.push(`${row.tag}${row.text}`);
      gap = false;
    } else {
      gap = out.length > 0 && !out.at(-1).startsWith('@@');
    }
  });
  return out;
}

export function cleanDiff(text) {
  const out = [];
  const pathsOnly = [];
  for (const file of splitFiles(text)) {
    const syntax = SYNTAX[extOf(file.path)];
    if (!syntax || !file.lines.some((line) => line.startsWith('@@'))) {
      pathsOnly.push(`${file.path} (${Buffer.byteLength(file.lines.join('\n'))} bytes of change)`);
      continue;
    }
    out.push(`--- ${file.path}`, ...nearChanges(cleanFile(file.lines, syntax)));
  }
  return { diff: out.join('\n'), pathsOnly };
}
