// scripts/digest/due.js
// When the daily digest is made, and where it waits until the director's next message (design section 9 of the director's way of
// working). The watcher's tick makes it once a day after `digestAt` (a setting, 17:00 local time unless the director changed it);
// there is no cron. The first digest seven days or more after the last carries the weekly decision log too.
//
// A digest made is kept in projects/<project>/digest.json and shown once, at the director's next message in the front desk
// (scripts/hooks/board-context.js), which then takes it away. Nothing here answers anything, and a digest the director never
// reads changes nothing: it only waits.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';

export const DEFAULT_AT = '17:00';
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;
// A week's log comes on the first digest this long after the last that carried it.
export const LOG_EVERY_MS = 7 * DAY_MS;

function msOf(now) {
  try {
    const value = typeof now === 'function' ? now() : now;
    const ms = new Date(value === undefined ? Date.now() : value).getTime();
    return Number.isFinite(ms) ? ms : NaN;
  } catch {
    return NaN;
  }
}

const timeMs = (value) => (typeof value === 'string' ? Date.parse(value) : NaN);

// digestDue({ seen, now, at }) -> whether a digest is due: it is after `at` today (local time), and none was made since then.
// `seen` is readDigestSeen's ({ digestAt, ... }). A clock that can't be read, or an `at` that isn't a time, falls back to
// 17:00 for the second and never makes a digest for the first.
export function digestDue({ seen, now, at = DEFAULT_AT }) {
  const nowMs = msOf(now);
  if (!Number.isFinite(nowMs)) return false;
  const [, hours, minutes] = TIME.exec(typeof at === 'string' ? at : '') ?? TIME.exec(DEFAULT_AT);
  const today = new Date(nowMs);
  const slot = new Date(today.getFullYear(), today.getMonth(), today.getDate(), Number(hours), Number(minutes)).getTime();
  if (nowMs < slot) return false;
  const last = timeMs(seen?.digestAt);
  return Number.isNaN(last) || last < slot;
}

// logDue({ seen, now }) -> whether this digest also carries the weekly decision log: none has been carried, or the last was seven
// days or more ago.
export function logDue({ seen, now }) {
  const nowMs = msOf(now);
  if (!Number.isFinite(nowMs)) return false;
  const last = timeMs(seen?.digestLogAt);
  return Number.isNaN(last) || nowMs - last >= LOG_EVERY_MS;
}

export function digestFile(project) {
  return path.join(path.dirname(stateDir(project)), 'digest.json');
}

// The digest waiting to be shown, { at, text, weekly, failures } (`failures`: how many failed alerts it says), or null when none waits or the file can't be read.
export function readDigest(project) {
  try {
    const kept = JSON.parse(fs.readFileSync(digestFile(project), 'utf8'));
    if (kept === null || typeof kept !== 'object' || typeof kept.text !== 'string' || kept.text === '' || typeof kept.at !== 'string') return null;
    return { at: kept.at, text: kept.text, weekly: kept.weekly === true, failures: Number.isInteger(kept.failures) && kept.failures > 0 ? kept.failures : 0 };
  } catch {
    return null;
  }
}

// Keeps a digest to be shown at the director's next message, written whole. One that waits unshown is replaced by the newer, which
// covers what it covered (its `since` is the last digest shown).
export function writeDigest(project, { at, text, weekly = false, failures = 0 }) {
  const file = digestFile(project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify({ at, text, weekly, failures }, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// Takes the waiting digest away once it has been shown.
export function clearDigest(project) {
  fs.rmSync(digestFile(project), { force: true });
}
