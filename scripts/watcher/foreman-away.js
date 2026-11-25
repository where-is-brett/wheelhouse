// scripts/watcher/foreman-away.js
// When Desktop is closed (builders and settings design, section 7.5). While a wake waits and the Desktop foreman's heartbeat is
// over 3 minutes old, the watcher records the fact `foreman-away` once for the spell (a plain note in the Logbook, and a file
// in the watcher's folder that marks the spell), and asks for one phone notice, at most once a day. It starts nothing: no
// session, no process, and never a fallback to the background route. A route changes only by the director's setting.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';
import { FOREMAN_AWAY_MS, checkInAge } from '../foreman/check-in.js';
import { oldestWaiting, takeWakes } from './desktop-queue.js';

export const AWAY_STATE = 'foreman-away';
// The notice goes again after a day, and a notice that was held or had no channel is asked again after ten minutes.
export const NOTICE_EVERY_MS = 24 * 60 * 60 * 1000;
export const NOTICE_RETRY_MS = 10 * 60 * 1000;

// projects/<p>/watcher/foreman-away.json: `since` while a spell is on (its record made), `noticeAt` for the last notice sent.
export const awayFile = (project) => path.join(path.dirname(stateDir(project)), 'watcher', 'foreman-away.json');

function read(project) {
  try {
    const stat = fs.lstatSync(awayFile(project));
    if (!stat.isFile() || stat.size > 4096) return {};
    const v = JSON.parse(fs.readFileSync(awayFile(project), 'utf8'));
    const ok = (x) => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : undefined);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? { since: ok(v.since), noticeAt: ok(v.noticeAt) } : {};
  } catch {
    return {};
  }
}

function write(project, state) {
  const file = awayFile(project);
  const kept = Object.fromEntries(Object.entries(state).filter(([, v]) => v !== undefined));
  if (Object.keys(kept).length === 0) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(kept)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// When the notice was last asked for and came to nothing (held, or no channel), kept in memory: a restart asks again.
const asked = new Map();

// One look, each tick on the Desktop route. `raise({ kind, data })` writes the record; `notify({ count })` asks the helper for the
// phone notice and answers `{ sent }`, `{ held }` or `{ none }`. Both are given, and neither is trusted to succeed: a failure is
// said to `onError` and tried again at the next tick. Gives `{ away: false }` or `{ away: true, wakes }`.
export async function watchForeman(project, { now = () => new Date(), raise = async () => {}, notify = async () => ({ none: true }), onError = () => {} } = {}) {
  const wakes = takeWakes(project);
  const t = now().getTime();
  const age = checkInAge(project, { now });
  const oldest = oldestWaiting(project);
  const away = wakes.length > 0 && (age === null ? t - Date.parse(oldest) > FOREMAN_AWAY_MS : age > FOREMAN_AWAY_MS);
  const state = read(project);
  if (!away) {
    // The spell is over; the day's notice stays on record.
    if (state.since !== undefined) write(project, { noticeAt: state.noticeAt });
    return { away: false };
  }
  let { since } = state;
  if (since === undefined) {
    const n = wakes.length;
    try {
      await raise({ kind: 'note', data: { about: 'engine', words: `Claude Desktop isn't running the foreman: ${n} ${n === 1 ? 'wake waits' : 'wakes wait'} until it is open and the foreman is started from the First Mate.` } });
      since = now().toISOString();
      write(project, { ...state, since });
    } catch (error) {
      onError(`The foreman's absence couldn't be recorded: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
  const due = state.noticeAt === undefined || t - Date.parse(state.noticeAt) >= NOTICE_EVERY_MS;
  const gap = asked.get(project);
  if (due && (gap === undefined || t - gap >= NOTICE_RETRY_MS)) {
    try {
      const got = await notify({ count: wakes.length });
      if (got?.sent === true) {
        asked.delete(project);
        write(project, { since, noticeAt: now().toISOString() });
      } else {
        asked.set(project, t);
      }
    } catch (error) {
      asked.set(project, t);
      onError(`The notice that work is waiting couldn't be sent: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
  return { away: true, wakes: wakes.length };
}
