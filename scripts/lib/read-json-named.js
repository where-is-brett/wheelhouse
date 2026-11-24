// scripts/lib/read-json-named.js
// Reads one of Wheelhouse's own JSON files and, when it can't be read, says which file and where: the line and column of
// the first fault, and a hint when the fault is one Windows paths cause. A missing file is not a fault. A file that is
// there and can't be read is never taken for an empty one or for "nothing wrong": every caller sees the fault.
import fs from 'node:fs';

export const BACKSLASH_HINT = 'a single `\\` inside a path must be written `\\\\`, or use `/`';

// Where in `text` (an offset) the first `\` is that does not start a valid JSON escape, inside a string; -1 when none.
export function loneBackslash(text) {
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (!inString) {
      if (c === '"') inString = true;
    } else if (c === '\\') {
      const next = text[i + 1];
      if (next === undefined || !'"\\/bfnrtu'.includes(next)) return i;
      i += 1;
    } else if (c === '"') inString = false;
  }
  return -1;
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
  const clean = text.replace(/^﻿/, '');
  try {
    JSON.parse(clean);
    return null;
  } catch (error) {
    const lone = loneBackslash(clean);
    const message = String(error?.message ?? '');
    const given = /position (\d+)/.exec(message);
    const offset = lone !== -1 ? lone : given ? Number(given[1]) : clean.length;
    return { ...lineAndColumn(clean, offset), hint: lone !== -1 ? BACKSLASH_HINT : '' };
  }
}

// { ok: true, value } | { ok: true, missing: true } | { ok: false, file, line, column, hint }.
export function readJsonNamed(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { ok: true, missing: true };
    return { ok: false, file, line: 1, column: 1, hint: `the file can't be opened (${error?.code ?? 'unknown'})` };
  }
  const fault = faultIn(text);
  if (fault !== null) return { ok: false, file, ...fault };
  return { ok: true, value: JSON.parse(text.replace(/^﻿/, '')) };
}

// The health and facts line for a fault.
export function faultLine({ file, line, column, hint }) {
  return `${file} can't be read: line ${line}, column ${column}.${hint ? ` ${hint}` : ''}`;
}
