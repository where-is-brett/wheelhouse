// scripts/crew/hold.js
// The director's hold on a feature piece while they sit at its helm (crew visibility design, 9.1): one file per piece in the
// watcher's `helm` folder, and the one gate every automatic path asks, `helmHeld`. No other module reads `helm/*.json`.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { watcherDir } from '../watcher/waker.js';
import { makeEvent, writeEvent } from '../state/events.js';
import { SLUG } from '../lib/build-loop.js';

const helmDir = (project) => path.join(watcherDir(project), 'helm');

// The hold file for a piece. The work comes from records, so a name that is not a plain slug is refused: the path never
// leaves the helm folder.
export function holdFile(project, work) {
  if (typeof work !== 'string' || !SLUG.test(work)) throw new Error('A helm hold needs its work named by a short slug');
  return path.join(helmDir(project), `${work}.json`);
}

function present(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

// Writes `value` whole to a temporary name, then puts it at `file`: renamed over it, or, with `exclusive`, linked so that
// a file already there makes the call throw and two writers cannot both win.
function putJson(file, value, { exclusive = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID().slice(0, 12)}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value)}\n`, { flag: 'wx' });
    if (exclusive) fs.linkSync(temp, file);
    else fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// True whenever the hold file is there, including one that cannot be read: a broken hold still holds.
export function helmHeld(project, work) {
  let file;
  try {
    file = holdFile(project, work);
  } catch {
    return false;
  }
  return present(file);
}

// The hold, or null when there is none or the file cannot be read as one (`helmHeld` still says it holds).
export function readHold(project, work) {
  try {
    const hold = JSON.parse(fs.readFileSync(holdFile(project, work), 'utf8'));
    return hold !== null && typeof hold === 'object' && !Array.isArray(hold) ? hold : null;
  } catch {
    return null;
  }
}

// The first hold whose session is `sessionId`; files that cannot be read are skipped.
export function holdBySession(project, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return null;
  let names;
  try {
    names = fs.readdirSync(helmDir(project)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    const hold = readHold(project, name.slice(0, -'.json'.length));
    if (hold !== null && hold.sessionId === sessionId) return hold;
  }
  return null;
}

// Takes the hold: the file first, made so that an existing one refuses, then the `helm` record.
export async function takeHold(project, { work, sessionId, fromStart = false, now = () => new Date() }) {
  const file = holdFile(project, work);
  const at = now().toISOString();
  const hold = { work, sessionId, at, fromStart: fromStart === true, opened: false, pid: null, startTime: null };
  const event = makeEvent({ kind: 'helm', data: { work, at, fromStart: hold.fromStart }, now });
  try {
    putJson(file, hold, { exclusive: true });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`The helm of ${work} is already held`);
    throw error;
  }
  try {
    await writeEvent({ project, event, now });
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw error;
  }
  return hold;
}

// Notes that the helm's terminal is open: its process id and the time that process started, so a terminal closed without
// `/exit` can be told from one still open.
export function markOpened(project, work, { pid, startTime }) {
  const hold = readHold(project, work);
  if (hold === null) return null;
  const next = { ...hold, opened: true, pid, startTime };
  putJson(holdFile(project, work), next);
  return next;
}

// Hands the piece back: the file goes, then the `helm-ended` record.
export async function releaseHold(project, work, { why, now = () => new Date() } = {}) {
  const file = holdFile(project, work);
  const data = { work, at: now().toISOString(), ...(typeof why === 'string' && why !== '' ? { why } : {}) };
  const event = makeEvent({ kind: 'helm-ended', data, now });
  fs.rmSync(file, { force: true });
  await writeEvent({ project, event, now });
}

// A hold file this young is left alone: `takeHold` writes the file before its `helm` record, so views built a moment ago
// may not show the record yet.
export const ORPHAN_GRACE_MS = 60_000;

// Removes the hold files that have no open `helm` in the views, and returns the work they named. A file younger than
// ORPHAN_GRACE_MS is kept.
export function cleanOrphans(project, views, { now = () => new Date() } = {}) {
  let names;
  try {
    names = fs.readdirSync(helmDir(project)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const removed = [];
  for (const name of names.sort()) {
    const work = name.slice(0, -'.json'.length);
    if (!SLUG.test(work) || views?.helm?.[work] !== undefined) continue;
    const file = path.join(helmDir(project), name);
    let age;
    try {
      age = now().getTime() - fs.lstatSync(file).mtimeMs;
    } catch {
      continue;
    }
    if (age < ORPHAN_GRACE_MS) continue;
    fs.rmSync(file, { force: true });
    removed.push(work);
  }
  return removed;
}
