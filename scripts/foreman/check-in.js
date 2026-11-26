// scripts/foreman/check-in.js
// The Desktop foreman's check-in (builders and settings design, sections 7.1 and 7.2): a file holding its session id and the
// time of its last heartbeat, in the watcher's folder. One foreman per project: a check-in for another session that is less
// than 3 minutes old refuses a second. Setup counts a check-in under 2 minutes old as the foreman running; the watcher counts
// one over 3 minutes as it being away.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';

export const FOREMAN_SETUP_MS = 2 * 60 * 1000;
export const FOREMAN_REFUSE_MS = 3 * 60 * 1000;
export const FOREMAN_AWAY_MS = 3 * 60 * 1000;
const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;

// projects/<p>/watcher/foreman-check-in.json, beside the watcher's other files (stateDir is projects/<p>/state).
export const checkInFile = (project) => path.join(path.dirname(stateDir(project)), 'watcher', 'foreman-check-in.json');

function readCheckIn(project) {
  const file = checkInFile(project);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 4096) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const at = Date.parse(value?.at);
    if (typeof value?.sessionId !== 'string' || !SESSION_ID.test(value.sessionId) || Number.isNaN(at)) return null;
    return { sessionId: value.sessionId, at };
  } catch {
    return null;
  }
}

function write(project, sessionId, now) {
  const file = checkInFile(project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify({ sessionId, at: now().toISOString() })}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// How old the check-in is in ms, or null when there is none (or it can't be read, which counts as none).
export function checkInAge(project, { now = () => new Date() } = {}) {
  const found = readCheckIn(project);
  return found === null ? null : Math.max(0, now().getTime() - found.at);
}

// The foreman session checks in: `{ ok: true }`, or `{ ok: false, running: { sessionId, at } }` while another session's
// check-in is under 3 minutes old. The same session checking in again is a heartbeat.
export function checkIn(project, { sessionId, now = () => new Date() } = {}) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return { ok: false, running: null, why: 'A session id is letters, digits and hyphens' };
  const found = readCheckIn(project);
  if (found !== null && found.sessionId !== sessionId && now().getTime() - found.at < FOREMAN_REFUSE_MS) {
    return { ok: false, running: { sessionId: found.sessionId, at: new Date(found.at).toISOString() } };
  }
  write(project, sessionId, now);
  return { ok: true };
}

// The heartbeat: only the session that holds the check-in refreshes it. `ok: false` says another session holds it (or none
// does), so the caller ends.
export function heartbeat(project, { sessionId, now = () => new Date() } = {}) {
  const found = readCheckIn(project);
  if (found === null || found.sessionId !== sessionId) return { ok: false, running: found === null ? null : { sessionId: found.sessionId } };
  write(project, sessionId, now);
  return { ok: true };
}

// The foreman ends: its check-in goes, only if it is its own.
export function endCheckIn(project, { sessionId } = {}) {
  const found = readCheckIn(project);
  if (found !== null && found.sessionId === sessionId) fs.rmSync(checkInFile(project), { force: true });
}
