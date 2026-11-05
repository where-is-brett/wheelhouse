// scripts/lib/kept-request.js
// The director's first request, kept while setup comes first, so a new session started part-way through setup still has it.
// One small file per folder under the Wheelhouse home (setup-requests/<hash of the folder>.json), written by the prompt hook
// from the director's own words, read by the session start, and removed once setup is finished. Every reader treats a missing
// or damaged file as none, and no writer throws.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from './paths.js';

export const MOST_CHARS = 2000;
// What the director types to carry on with setup is no request: nothing is kept for it.
const ABOUT_SETUP = /^\s*(?:\/wheelhouse:setup\b.*|(?:please\s+)?(?:carry on|continue|resume|go on|set\s*up)\b[^\n]{0,40})\s*$/i;

// The folder by its real path, so the hook and the session start name one file.
const realOf = (folder) => {
  try {
    return fs.realpathSync.native(String(folder));
  } catch {
    return String(folder);
  }
};
const fileFor = (folder) => path.join(wheelhouseHome(), 'setup-requests', `${crypto.createHash('sha256').update(realOf(folder)).digest('hex').slice(0, 24)}.json`);

// The request kept for the folder, or null.
export function keptRequest(folder) {
  try {
    const text = JSON.parse(fs.readFileSync(fileFor(folder), 'utf8'))?.text;
    return typeof text === 'string' && text.trim() !== '' ? text : null;
  } catch {
    return null;
  }
}

// Keeps the prompt as the folder's request when none is kept yet and it is a request. Whether it was kept.
export function keepRequest(folder, prompt, now = () => new Date()) {
  try {
    const text = String(prompt ?? '').replace(/\p{Cf}/gu, '').trim();
    if (text === '' || text.startsWith('/') || ABOUT_SETUP.test(text) || keptRequest(folder) !== null) return false;
    const file = fileFor(folder);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const part = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(part, `${JSON.stringify({ folder, text: text.slice(0, MOST_CHARS), at: now().toISOString() })}\n`, { mode: 0o600 });
    fs.renameSync(part, file);
    return true;
  } catch {
    return false;
  }
}

// Removes the folder's kept request, once setup is finished.
export function clearRequest(folder) {
  try {
    fs.rmSync(fileFor(folder), { force: true });
  } catch { /* nothing to remove */ }
}
