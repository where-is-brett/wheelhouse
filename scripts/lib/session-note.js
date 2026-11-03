// scripts/lib/session-note.js
// A session's note: a few lines about where the session has got to, kept at
// <wheelhouse home>/projects/<project>/sessions/<session id>.md beside the context gauge's reading. The host helper
// writes it, as the front desk's sandbox cannot write under the Wheelhouse home.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { wheelhouseHome } from './paths.js';

// The note's limit, in characters.
export const NOTE_CHARS = 1200;

// The note's file, or null for an id outside [A-Za-z0-9_-] or longer than 128 characters (the gauge's rule).
export function noteFile(project, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  return path.join(wheelhouseHome(), 'projects', project, 'sessions', `${id}.md`);
}

// Why `text` is not a note, or null.
export function noteProblem(text) {
  if (typeof text !== 'string' || text.trim() === '') return 'The note was empty: give it on standard input, four lines (the task, what is done, what is next, the decisions open)';
  const length = text.replace(/\r\n/g, '\n').trim().length;
  return length > NOTE_CHARS ? `The note is ${length} characters; keep it to ${NOTE_CHARS}` : null;
}

// Writes the note whole to a temporary name and renames it; returns the file.
export function writeNoteFile(project, id, text) {
  const file = noteFile(project, id);
  if (file === null) throw new Error('This session has no id to name its note by');
  const problem = noteProblem(text);
  if (problem !== null) throw new Error(problem);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID().slice(0, 12)}.tmp`;
  try {
    fs.writeFileSync(temp, `${text.replace(/\r\n/g, '\n').trim()}\n`, { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return file;
}
