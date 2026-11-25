// scripts/foreman/desktop-builders.js
// The builders Desktop started for the foreman (builders and settings design, section 7.3): one small file per piece in the
// watcher's `desktop-builders` folder. The builder's own prompt hook writes it from the marker line of its first prompt,
// naming the session, the worktree Desktop made and its branch; `act builder-started` reads it and records the piece; the
// foreman marks it ended when it has stopped or archived the session. It holds no free text: ids, a path and a branch.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';

const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
const WORK = /^[a-z0-9][a-z0-9-]{0,39}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

export const buildersDir = (project) => path.join(path.dirname(stateDir(project)), 'watcher', 'desktop-builders');
export const builderRecordFile = (project, work) => {
  if (typeof work !== 'string' || !WORK.test(work)) throw new Error('A work id is lower-case letters, digits and hyphens');
  return path.join(buildersDir(project), `${work}.json`);
};

function put(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// A builder's record, or null when there is none or it isn't a whole one.
export function readBuilder(project, work) {
  try {
    const file = builderRecordFile(project, work);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 8192) return null;
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
    if (typeof v.sessionId !== 'string' || !SESSION_ID.test(v.sessionId) || typeof v.worktree !== 'string' || v.worktree === '' || /[\r\n\0]/.test(v.worktree)) return null;
    if (typeof v.branch !== 'string' || !BRANCH.test(v.branch) || Number.isNaN(Date.parse(v.at))) return null;
    if (v.endedAt !== undefined && Number.isNaN(Date.parse(v.endedAt))) return null;
    return v;
  } catch {
    return null;
  }
}

// The builder's hook records what it found: `{ sessionId, worktree, branch }`. Values that aren't ids, an absolute path and a
// branch name are not written. A piece has one session, so a record replaces any before it.
export function recordBuilder(project, work, { sessionId, worktree, branch, now = () => new Date() }) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return false;
  if (typeof worktree !== 'string' || /[\r\n\0]/.test(worktree) || !path.isAbsolute(worktree)) return false;
  if (typeof branch !== 'string' || !BRANCH.test(branch)) return false;
  put(builderRecordFile(project, work), { sessionId, worktree, branch, at: now().toISOString() });
  return true;
}

// The foreman has stopped or archived the piece's session.
export function markEnded(project, work, { now = () => new Date() } = {}) {
  const kept = readBuilder(project, work);
  if (kept === null) return false;
  put(builderRecordFile(project, work), { ...kept, endedAt: now().toISOString() });
  return true;
}

// Every piece with a whole record, as `{ work, ...record }`, in the name's order.
export function listBuilders(project) {
  let names = [];
  try {
    names = fs.readdirSync(buildersDir(project));
  } catch { /* none */ }
  const out = [];
  for (const n of names.sort()) {
    const m = /^([a-z0-9][a-z0-9-]{0,39})\.json$/.exec(n);
    const rec = m === null ? null : readBuilder(project, m[1]);
    if (rec !== null) out.push({ work: m[1], ...rec });
  }
  return out;
}

// --- The offer made and not yet taken up ---
// With no `cwd` on an offer, the worktree doesn't exist when the foreman is given the offer, so the brief it will hold waits
// here, in the watcher's folder, until the builder has adopted its worktree and `act builder-started` writes it there.
const pendingDir = (project) => path.join(path.dirname(stateDir(project)), 'watcher', 'desktop-pending');
export const OFFER_FRESH_MS = 30 * 60 * 1000;

export function keepPending(project, work, { text, hash, approved, held = null, now = () => new Date() }) {
  builderRecordFile(project, work); // the work id is checked
  put(path.join(pendingDir(project), `${work}.json`), { text, hash, ...(approved === undefined || approved === null ? {} : { approved }), held, at: now().toISOString() });
}

// The kept offer, or null: none, one that isn't whole, or (with `fresh`) one older than OFFER_FRESH_MS.
export function readPending(project, work, { now = () => new Date(), fresh = false } = {}) {
  try {
    builderRecordFile(project, work);
    const file = path.join(pendingDir(project), `${work}.json`);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return null;
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof v?.text !== 'string' || typeof v.hash !== 'string' || Number.isNaN(Date.parse(v.at))) return null;
    if (fresh && now().getTime() - Date.parse(v.at) > OFFER_FRESH_MS) return null;
    return v;
  } catch {
    return null;
  }
}

export function dropPending(project, work) {
  builderRecordFile(project, work); // the work id is checked
  fs.rmSync(path.join(pendingDir(project), `${work}.json`), { force: true });
}

// --- A fresh start offered after Desktop closed (design section 7.5) ---
// `act resume-offer` keeps `{ session, worktree, at }` here: the piece's recorded session it stands in for, and its own worktree.
// `act builder-started` then keeps the new session only when it came up in that worktree. When it didn't (Desktop ignored `cwd`
// and opened it elsewhere), the resume is marked `missed`, and no more fresh starts are offered for that session.
const resumesDir = (project) => path.join(path.dirname(stateDir(project)), 'watcher', 'desktop-resumes');

export function keepResume(project, work, { session, worktree, missed = false, now = () => new Date() }) {
  builderRecordFile(project, work); // the work id is checked
  put(path.join(resumesDir(project), `${work}.json`), { session, worktree, ...(missed ? { missed: true } : {}), at: now().toISOString() });
}

// The kept resume, or null: none, or one that isn't whole.
export function readResume(project, work) {
  try {
    builderRecordFile(project, work);
    const file = path.join(resumesDir(project), `${work}.json`);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 8192) return null;
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof v?.session !== 'string' || typeof v.worktree !== 'string' || Number.isNaN(Date.parse(v.at))) return null;
    return { session: v.session, worktree: v.worktree, missed: v.missed === true, at: v.at };
  } catch {
    return null;
  }
}

export function dropResume(project, work) {
  builderRecordFile(project, work); // the work id is checked
  fs.rmSync(path.join(resumesDir(project), `${work}.json`), { force: true });
}
