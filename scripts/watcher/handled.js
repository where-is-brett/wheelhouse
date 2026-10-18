// scripts/watcher/handled.js
// The state event ids the foreman wrote while handling a wake (rulings R48,
// R64), at projects/<p>/watcher/handled.json: `{ entries: [{ id, at }] }`.
// The foreman's act command records each id it writes; the watcher reads them
// on every loop, and core's `diff` sends an event with one of these ids to the
// digest, not to a wake, so the foreman never wakes itself. A `build` the
// foreman wrote still reaches its feature (core's `route`).
//
// The file is written whole, to a temporary name renamed over the old one,
// keeping only entries within the look-back (an older state event is never
// sent, so its id is no longer needed) and at most HANDLED_CAP of them. A
// file that is missing, damaged, too big or not a regular file reads as no
// ids: the watcher must never stop on it.
import path from 'node:path';
import { SEEN_CAP } from './core.js';
import { LOOKBACK_MS } from './sources.js';
import { watcherDir, watcherFolder, writeJsonFile } from './waker.js';
import { readCapped } from '../feature/status.js';

// How many handled ids are kept: as many as the cursor's seen list.
export const HANDLED_CAP = SEEN_CAP;
const HANDLED_BYTES = 2 * 1024 * 1024;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isId = (x) => typeof x === 'string' && x !== '' && !/[\r\n]/.test(x);

export function handledFile(project) {
  return path.join(watcherDir(project), 'handled.json');
}

// The entries in the file within the look-back of `ms`, oldest first, or none.
function readEntries(project, ms) {
  let text;
  try {
    text = readCapped(handledFile(project), HANDLED_BYTES);
  } catch {
    return [];
  }
  if (text === null) return [];
  let kept;
  try {
    kept = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isPlain(kept) || !Array.isArray(kept.entries)) return [];
  return kept.entries.filter((e) => {
    if (!isPlain(e) || !isId(e.id) || typeof e.at !== 'string') return false;
    const when = Date.parse(e.at);
    return !Number.isNaN(when) && ms - when <= LOOKBACK_MS;
  });
}

// The ids the foreman has handled, as a Set. Never throws.
export function readHandled(project, { now = () => new Date() } = {}) {
  try {
    return new Set(readEntries(project, now().getTime()).map((e) => e.id));
  } catch {
    return new Set();
  }
}

// Adds `ids` to the file, each at `now`; an id already there moves to its
// latest time. Throws when the ids are not a list of ids, or the file can't be
// written (a link or folder in its place, or in the watcher folder's).
export function recordHandled(project, ids, { now = () => new Date() } = {}) {
  if (!Array.isArray(ids) || !ids.every(isId)) throw new Error('The handled ids are a list of event ids');
  const t = now();
  const at = t.toISOString();
  const fresh = new Set(ids);
  const entries = [
    ...readEntries(project, t.getTime()).filter((e) => !fresh.has(e.id)),
    ...[...fresh].map((id) => ({ id, at })),
  ].slice(-HANDLED_CAP);
  watcherFolder(project);
  writeJsonFile(handledFile(project), { entries }, () => { throw new Error("The foreman's handled ids can't be written"); });
}
