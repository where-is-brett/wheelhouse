// scripts/lib/first-mate-seat.js
// The First Mate's seat: one file per project naming the one session that holds it, judged by
// the process that session runs in. The hooks write it; no function here decides a session's role.
//
// Every function takes a last `options` so a test can supply the process table and the clock:
//   home        the Wheelhouse home (default: wheelhouseHome())
//   alive       (pid) => boolean, whether a process is running (default: pidAlive)
//   startTime   async (pid) => string | null, when a process started (default: processStartTime)
//   ancestor    { pid, table }: the process to start the climb from (default: this process) and the
//               process table [{ pid, ppid, command }] (default: listProcesses())
//   now         () => Date (default: the clock)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from './paths.js';
import { pidAlive, processStartTime } from '../watcher/waker.js';
import { listProcesses } from '../engine/stop.js';

// Within this long since the holder last wrote, a held seat counts as in use. The same number as
// RECENT_MS in scripts/hooks/session-start.js (the computer card). It is written here rather than
// imported because that hook will import this file, and a cycle between them would leave one
// constant unset while the other loads.
export const RECENT_MS = 30 * 60 * 1000;
// A seat whose holder's process could not be recorded is free once it has been idle this long.
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
// `seenAt` is rewritten at most this often.
export const SEEN_EVERY_MS = 60 * 1000;

const clock = (options) => (options.now ?? (() => new Date()))();
const homeOf = (options) => options.home ?? wheelhouseHome();

export function seatFile(project, options = {}) {
  return path.join(homeOf(options), 'projects', project, 'first-mate.json');
}

const isTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isWhole = (seat) => seat !== null && typeof seat === 'object'
  && typeof seat.session === 'string' && seat.session !== ''
  && (seat.pid === null || Number.isInteger(seat.pid))
  && (seat.pidStart === null || typeof seat.pidStart === 'string')
  && typeof seat.folder === 'string' && isTime(seat.since) && isTime(seat.seenAt);

// The text of the file and the seat it holds (null when it isn't whole); raw is null when there is no file.
function look(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return { raw: null, seat: null }; }
  try {
    const seat = JSON.parse(raw);
    return { raw, seat: isWhole(seat) ? seat : null };
  } catch { return { raw, seat: null }; }
}

export function readSeat(project, options = {}) {
  return look(seatFile(project, options)).seat;
}

// Whether a command line is Claude Code's own: the program `claude` (by itself or at the end of a path,
// which may hold spaces), or Node running its package. `claude-foo` and `claude.app` are not it.
const isClaudeCode = (command) => /(^|[\\/\s])claude(\.exe)?(\s|$)/i.test(command) || /@anthropic-ai[\\/]claude-code/.test(command);

// The nearest Claude Code process above this one, and when it started; nulls where there is none
// to find (Windows lists no processes today).
export async function firstMatePid(options = {}) {
  const none = { pid: null, pidStart: null };
  try {
    const { pid: from = process.pid, table } = options.ancestor ?? {};
    const processes = table ?? await listProcesses();
    const parentOf = new Map(processes.map((p) => [p.pid, p]));
    const seen = new Set();
    for (let pid = from; parentOf.has(pid) && !seen.has(pid); pid = parentOf.get(pid).ppid) {
      seen.add(pid);
      const entry = parentOf.get(pid);
      if (pid !== from && isClaudeCode(entry.command)) {
        const startOf = options.startTime ?? processStartTime;
        return { pid, pidStart: (await startOf(pid)) ?? null };
      }
    }
  } catch { /* none found */ }
  return none;
}

// Whether the seat can be taken: the three rules of the design's section 6.2.
export async function seatFree(seat, options = {}) {
  if (!isWhole(seat)) return true;
  if (seat.pid === null) return clock(options).getTime() - Date.parse(seat.seenAt) > STALE_AFTER_MS;
  if (!(options.alive ?? pidAlive)(seat.pid)) return true;
  if (seat.pidStart === null) return false; // running, and no start time to tell a reused pid by
  const started = await (options.startTime ?? processStartTime)(seat.pid);
  return started !== null && started !== undefined && started !== seat.pidStart;
}

// Held seats only: within RECENT_MS of the holder's last write.
export function seatInUse(seat, options = {}) {
  return isWhole(seat) && clock(options).getTime() - Date.parse(seat.seenAt) < RECENT_MS;
}

const unique = (file) => `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
const text = (seat) => `${JSON.stringify(seat, null, 2)}\n`;

// Writes through a temporary file and a rename, so a reader never sees half a seat.
function writeWhole(file, seat) {
  const temporary = `${unique(file)}.tmp`;
  try {
    fs.writeFileSync(temporary, text(seat));
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

// Every change to a seat that exists is made while holding `<seat>.lock`, an exclusive file kept for
// milliseconds, and re-reads the seat inside it. So a change judged against one seat never lands on
// another, and the seat file is never absent mid-change. (Only the first `wx` write of a fresh seat
// happens outside it; that needs the file to be absent, which no change under the lock leaves it.)
// A lock older than `lockStaleMs` is a dead taker's and is removed. Where the lock can't be had within
// `lockWaitMs`, `fn` is not run and the result is undefined.
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function underLock(file, options, fn) {
  const lock = `${file}.lock`;
  const until = Date.now() + (options.lockWaitMs ?? 2000);
  for (;;) {
    try {
      fs.writeFileSync(lock, `${process.pid}\n`, { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') return undefined;
    }
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs > (options.lockStaleMs ?? 10000)) fs.rmSync(lock, { force: true });
    } catch { /* gone already */ }
    if (Date.now() > until) return undefined;
    sleepSync(2);
  }
  try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
}

// Replaces the seat file with `seat` only while it still holds `judged` (the text that was judged).
// True when this call wrote it.
function replace(file, judged, seat, options) {
  return underLock(file, options, () => {
    if (look(file).raw !== judged) return false;
    writeWhole(file, seat);
    return true;
  }) === true;
}

const newSeat = async ({ session, folder }, options, since) => {
  const { pid, pidStart } = await firstMatePid(options);
  const now = clock(options).toISOString();
  return { session, pid, pidStart, folder, since: since ?? now, seenAt: now };
};

// Takes the seat for `session` where it is free. `held` is true when this session holds it afterwards.
export async function takeSeat(project, { session, folder }, options = {}) {
  const file = seatFile(project, options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let seen = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const mine = await newSeat({ session, folder }, options);
    try {
      fs.writeFileSync(file, text(mine), { flag: 'wx' });
      return { held: true, seat: mine };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const { raw, seat } = look(file);
    if (raw === null) continue; // gone between the write and the read
    seen = seat;
    if (seat?.session === session) {
      // Already this session's (a resume, or a restart in the same window): follow its process.
      const same = { ...seat, pid: mine.pid, pidStart: mine.pidStart, seenAt: mine.seenAt };
      if (replace(file, raw, same, options)) return { held: true, seat: same };
      continue; // the seat changed hands meanwhile: judge it again
    }
    if (!(await seatFree(seat, options))) return { held: false, seat };
    if (replace(file, raw, mine, options)) return { held: true, seat: mine };
  }
  return { held: false, seat: seen ?? readSeat(project, options) };
}

export function holdsSeat(project, session, options = {}) {
  return readSeat(project, options)?.session === session;
}

// Rewrites `seenAt` for the holder, at most once a minute. Never throws.
export function refreshSeat(project, session, options = {}) {
  try {
    const file = seatFile(project, options);
    underLock(file, options, () => {
      const { seat } = look(file);
      if (seat?.session !== session) return;
      const now = clock(options);
      if (now.getTime() - Date.parse(seat.seenAt) < SEEN_EVERY_MS) return;
      writeWhole(file, { ...seat, seenAt: now.toISOString() });
    });
  } catch { /* the seat is kept fresh on a later hook */ }
}

// Moves the seat to `session` while it still names `from.session` with `from.since` (the seat the
// take-over card was shown for). Otherwise nothing changes and the current seat comes back.
export async function handOverSeat(project, { session, folder, from }, options = {}) {
  const file = seatFile(project, options);
  const { raw, seat } = look(file);
  if (raw === null || seat?.session !== from.session || seat?.since !== from.since) {
    return { moved: false, seat: readSeat(project, options) };
  }
  const mine = await newSeat({ session, folder }, options);
  if (replace(file, raw, mine, options)) return { moved: true, seat: mine };
  return { moved: false, seat: readSeat(project, options) };
}

// Gives the seat up, only while it names this session. Never throws.
export function releaseSeat(project, session, options = {}) {
  try {
    const file = seatFile(project, options);
    underLock(file, options, () => {
      if (look(file).seat?.session === session) fs.rmSync(file, { force: true });
    });
  } catch { /* nothing to give up */ }
}
