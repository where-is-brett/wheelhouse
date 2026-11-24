// scripts/lib/read-json-named.js
// Reads one of Wheelhouse's own JSON files and, when it can't be read, says which file and where: the line and column of
// the first fault, and a plain hint for mending it. A missing file is not a fault. A file that is there and can't be read
// is never taken for an empty one or for "nothing wrong": every caller sees the fault. Nothing of the file's text is ever
// given back with a fault (settings files hold tokens), only its place.
import fs from 'node:fs';

export const BACKSLASH_HINT = 'a single `\\` inside a path must be written `\\\\`, or use `/`';

// The hint for each kind of fault, in plain words.
const HINTS = {
  backslash: BACKSLASH_HINT,
  comment: 'notes starting `//` or `/*` aren\'t allowed in this file: take the note out',
  comma: 'take out the comma just before the closing bracket',
  'missing-comma': 'a comma is missing just before this point, between two entries',
  name: 'each name must be in double quotes, "like this"',
  colon: 'a colon `:` is missing after the name',
  word: 'a value must be true, false, null, a number, or text in double quotes',
  line: 'a text in quotes runs onto the next line: close its quote mark on the same line',
  control: 'a text in quotes holds a tab or another hidden character: type that text again',
  end: 'the file ends too soon: a closing `}`, `]` or quote mark is missing',
  after: 'there is more after the last closing bracket: take it out',
};
// A file that is JSON but not one object, as Claude Code's settings and Wheelhouse's own files must be.
export const OBJECT_HINT = 'the settings must be written inside one pair of curly brackets `{ }`';
const USUAL_HINT = 'often a stray comma, or a missing bracket or quote mark';

// Whether the `\` at `i` in `text` starts a valid JSON escape: one of `"\/bfnrt`, or `u` and four hex digits.
export function validEscapeAt(text, i) {
  const next = text[i + 1];
  if (next === 'u') return /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6));
  return next !== undefined && '"\\/bfnrt'.includes(next);
}

// Where in `text` (an offset) the first `\` is that does not start a valid JSON escape, inside a string; -1 when none.
export function loneBackslash(text) {
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (!inString) {
      if (c === '"') inString = true;
    } else if (c === '\\') {
      if (!validEscapeAt(text, i)) return i;
      i += 1;
    } else if (c === '"') inString = false;
  }
  return -1;
}

// The first fault in text that isn't JSON, as { at, kind }: read here rather than from JSON.parse's message, which
// differs between Node versions, sometimes gives no place, and quotes the file's text.
function locate(text) {
  let i = 0;
  const fail = (kind, at = i) => {
    throw Object.assign(new Error(kind), { at, kind });
  };
  const space = () => {
    while (i < text.length) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i += 1;
      else if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) fail('comment');
      else break;
    }
  };
  const string = () => {
    i += 1;
    for (;;) {
      if (i >= text.length) fail('end');
      const c = text[i];
      if (c === '"') {
        i += 1;
        return;
      }
      if (c === '\\') {
        if (!validEscapeAt(text, i)) fail('backslash');
        i += text[i + 1] === 'u' ? 6 : 2;
        continue;
      }
      if (c < ' ') fail(c === '\n' || c === '\r' ? 'line' : 'control');
      i += 1;
    }
  };
  // The entries of an object or array up to `close`; `entry` reads one.
  const entries = (close, entry) => {
    i += 1;
    space();
    if (text[i] === close) {
      i += 1;
      return;
    }
    for (;;) {
      entry();
      space();
      if (i >= text.length) fail('end');
      if (text[i] === close) {
        i += 1;
        return;
      }
      if (text[i] !== ',') fail('missing-comma');
      const comma = i;
      i += 1;
      space();
      if (text[i] === close) fail('comma', comma);
    }
  };
  const value = () => {
    space();
    if (i >= text.length) fail('end');
    const c = text[i];
    if (c === '{') {
      entries('}', () => {
        space();
        if (i >= text.length) fail('end');
        if (text[i] !== '"') fail('name');
        string();
        space();
        if (i >= text.length) fail('end');
        if (text[i] !== ':') fail('colon');
        i += 1;
        value();
      });
    } else if (c === '[') entries(']', value);
    else if (c === '"') string();
    else {
      const word = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i, i + 64));
      if (word === null) fail('word');
      i += word[0].length;
    }
  };
  try {
    value();
    space();
    if (i < text.length) fail('after');
  } catch (error) {
    if (typeof error?.kind === 'string') return { at: error.at, kind: error.kind };
  }
  return { at: text.length, kind: '' };
}

// The 1-based line and column of an offset in `text`.
function lineAndColumn(text, offset) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') {
      line += 1;
      column = 1;
    } else column += 1;
  }
  return { line, column };
}

// The fault in `text` as { line, column, hint }, or null when it is JSON.
export function faultIn(text) {
  const clean = text.replace(/^\uFEFF/, '');
  try {
    JSON.parse(clean);
    return null;
  } catch {
    const { at, kind } = locate(clean);
    return { ...lineAndColumn(clean, at), hint: HINTS[kind] ?? USUAL_HINT };
  }
}

// { ok: true, value } | { ok: true, missing: true } | { ok: false, file, line, column, hint }. A file that can't be
// opened at all has no place in it: its line and column are null.
export function readJsonNamed(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { ok: true, missing: true };
    const hint = error?.code === 'EACCES' || error?.code === 'EPERM' ? 'this computer\'s permissions don\'t let Wheelhouse open it' : error?.code === 'EISDIR' ? 'it is a folder, not a file' : 'it couldn\'t be opened';
    return { ok: false, file, line: null, column: null, hint };
  }
  const fault = faultIn(text);
  if (fault !== null) return { ok: false, file, ...fault };
  return { ok: true, value: JSON.parse(text.replace(/^\uFEFF/, '')) };
}

// The health and facts line for a fault.
export function faultLine({ file, line, column, hint }) {
  const where = Number.isInteger(line) ? `line ${line}, column ${column}.` : '';
  return `${file} can't be read: ${[where, hint].filter(Boolean).join(' ')}`;
}
