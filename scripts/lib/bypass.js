// scripts/lib/bypass.js
// Bypass mode: a marker per session, counted for two hours after it was written.
import fs from 'node:fs';
import path from 'node:path';
import { bypassDir } from './paths.js';

const ID_PATTERN = /^[A-Za-z0-9-]+$/;
const TWO_HOURS = 2 * 60 * 60 * 1000;

function markerFile(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length > 128 || !ID_PATTERN.test(sessionId)) {
    throw new Error('A session id may use only letters, digits and hyphens, up to 128 characters');
  }
  return path.join(bypassDir(), sessionId);
}

export function markBypass(sessionId, { now = () => new Date() } = {}) {
  const file = markerFile(sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ at: now().toISOString() })}\n`);
}

export function clearBypass(sessionId) {
  fs.rmSync(markerFile(sessionId), { recursive: true, force: true });
}

// True while any marker was written in the last two hours. A marker whose
// contents don't read is dated by its file time; an unreadable folder counts.
export function bypassActive({ now = () => new Date() } = {}) {
  const dir = bypassDir();
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (error) {
    return error?.code !== 'ENOENT'; // anything but plainly absent counts as active
  }
  const current = now().getTime();
  for (const name of names) {
    if (!ID_PATTERN.test(name) || name.length > 128) continue; // not a marker (such as .DS_Store)
    const file = path.join(dir, name);
    let written;
    try {
      written = Date.parse(JSON.parse(fs.readFileSync(file, 'utf8')).at);
    } catch { written = NaN; }
    if (Number.isNaN(written)) {
      try { written = fs.lstatSync(file).mtimeMs; } catch { return true; }
    }
    // A marker dated in the future counts as written now.
    if (current - Math.min(written, current) <= TWO_HOURS) return true;
  }
  return false;
}
