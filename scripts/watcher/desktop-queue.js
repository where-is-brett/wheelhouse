// scripts/watcher/desktop-queue.js
// The wake file of the Desktop route (builders and settings design, section 7.2). On the Desktop route the watcher starts no
// process: it queues what needs a session here, and the foreman's Desktop session takes it (scripts/foreman/wait-wake.js).
// One JSON file per wake in `projects/<p>/watcher/desktop-queue/`, apart from the bundle folder `watcher/wakes/`, which keeps
// holding what a session reads. A wake holds a kind, a piece's slug, the bundle file's path and a time: no free text, so a
// builder's prompt is built by the foreman's own script from the record, never from here.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SLUG } from '../lib/build-loop.js';
import { stateDir } from '../lib/paths.js';

// The watcher's folder, as the waker names it (projects/<p>/watcher); not imported from there, which imports this.
const watcherDir = (project) => path.join(path.dirname(stateDir(project)), 'watcher');

export const KINDS = Object.freeze(['foreman', 'feature-start', 'feature-wake']);
const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
const FILE = /^wake-(\d{13})-[0-9a-f]{12}\.json$/;

export const queueDir = (project) => path.join(watcherDir(project), 'desktop-queue');
const bundleDir = (project) => path.join(watcherDir(project), 'wakes');

const inside = (dir, file) => {
  const rel = path.relative(dir, path.resolve(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(path.sep);
};

// A queue file's wake, or null for anything that isn't a whole wake this module wrote.
function readWake(file) {
  try {
    const wake = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (wake === null || typeof wake !== 'object' || Array.isArray(wake) || !KINDS.includes(wake.kind)) return null;
    if (wake.work !== undefined && !(typeof wake.work === 'string' && SLUG.test(wake.work))) return null;
    if (typeof wake.file !== 'string' || typeof wake.at !== 'string' || Number.isNaN(Date.parse(wake.at))) return null;
    return wake;
  } catch {
    return null;
  }
}

const sameTarget = (a, b) => a.kind === b.kind && a.work === b.work;

// Queues one wake and gives its path. Refused: a kind that isn't one of the three, a `work` that isn't a slug (a foreman wake
// has none, a piece's wake needs one), a bundle file outside `watcher/wakes/`, a session id that isn't one. A wake for a piece
// with one waiting replaces it. Written to a temporary name and renamed, so no reader sees half of it.
export function queueWake(project, { kind, work, file, sessionId, now = () => new Date() } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`A queued wake is one of ${KINDS.join(', ')}`);
  if (kind === 'foreman' ? work !== undefined : !(typeof work === 'string' && SLUG.test(work))) {
    throw new Error(kind === 'foreman' ? 'A foreman wake names no piece' : 'A work id is lower-case letters, digits and hyphens');
  }
  if (typeof file !== 'string' || !inside(bundleDir(project), file)) throw new Error("A queued wake's file must be in the watcher's wakes folder");
  if (sessionId !== undefined && !(typeof sessionId === 'string' && SESSION_ID.test(sessionId))) throw new Error('A session id is letters, digits and hyphens');
  const dir = queueDir(project);
  fs.mkdirSync(dir, { recursive: true });
  const at = now();
  const wake = { kind, ...(work === undefined ? {} : { work }), file: path.resolve(file), ...(sessionId === undefined ? {} : { sessionId }), at: at.toISOString() };
  const name = `wake-${String(at.getTime()).padStart(13, '0')}-${crypto.randomBytes(6).toString('hex')}.json`;
  const target = path.join(dir, name);
  const temp = path.join(dir, `.${name}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(wake)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  // Older waiting wakes for the same piece (or the foreman) are replaced by this one.
  for (const old of takeWakes(project)) {
    if (old.path !== target && sameTarget(old, wake)) fs.rmSync(old.path, { force: true });
  }
  return target;
}

// Every waiting wake, oldest first, each with its `path`. A file that isn't a whole wake is left alone and not returned.
export function takeWakes(project) {
  let names;
  try {
    names = fs.readdirSync(queueDir(project));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.filter((n) => FILE.test(n)).sort()) {
    const file = path.join(queueDir(project), name);
    const wake = readWake(file);
    if (wake !== null) out.push({ ...wake, path: file });
  }
  return out;
}

// Removes the named wakes once they are handled. A path outside the queue folder is ignored.
export function dropWakes(project, paths) {
  const dir = queueDir(project);
  for (const p of Array.isArray(paths) ? paths : []) {
    if (typeof p === 'string' && FILE.test(path.basename(p)) && inside(dir, p)) fs.rmSync(p, { force: true });
  }
}

// When the oldest waiting wake was queued (an ISO time), or null when none waits.
export function oldestWaiting(project) {
  const wakes = takeWakes(project);
  return wakes.length === 0 ? null : wakes.map((w) => w.at).sort()[0];
}
