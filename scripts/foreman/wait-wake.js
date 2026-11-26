// scripts/foreman/wait-wake.js
// What the Desktop foreman keeps running in the background (builders and settings design, sections 7.2, 11 and 12A.6), run as
//   node scripts/foreman/wait-wake.js --project <p> --session <id>            wait for a wake
//   node scripts/foreman/wait-wake.js --project <p> --session <id> --take     take the waiting wakes
//   node scripts/foreman/wait-wake.js --project <p> --finish                  drop the wakes that were taken
//   node scripts/foreman/wait-wake.js --project <p> --ended <work>            note that a piece's session was stopped
// The wait heartbeats the foreman's check-in every 60 seconds and ends printing `wakes: <n>` as soon as one is queued,
// `no wake` after 50 minutes, `route changed` once builders no longer start in Desktop, `all stop` under STOP, or
// `another foreman` when another session holds the check-in. Claude Code wakes the session when it ends.
//
// Taking claims the queued wakes (one taker wins a wake, so the watcher moving the route back to the background and this
// session never both run it) and runs the checks again: under STOP or on another route they are given back and nothing is
// printed but the reason; a wake for a piece at the director's helm is dropped. Each other wake is one line,
// `WAKE <kind> <work or -> <session id or -> <file or ->`: ids and one path, nothing a wake file could carry as text. The file
// is the wake's bundle copied where the session that reads it can (the foreman's own wakes folder, or the piece's worktree),
// as the watcher copies it for a session it starts. A wake that can't be delivered is given back, named `not delivered`.
import fs from 'node:fs';
import path from 'node:path';
import { startedAsScript } from '../lib/started-as-script.js';
import { stateDir, wheelhouseHome } from '../lib/paths.js';
import { stopState } from '../lib/stop.js';
import { checkIn, endCheckIn, heartbeat } from './check-in.js';
import { listBuilders, markEnded } from './desktop-builders.js';

export const HEARTBEAT_MS = 60 * 1000;
export const WAIT_MAX_MS = 50 * 60 * 1000;
const POLL_MS = 2000;
const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
const PROJECT = /^[A-Za-z0-9._-]{1,100}$/;
const WORK = /^[a-z0-9][a-z0-9-]{0,39}$/;

// The route setting now, read through the one reader, only when asked (this script stays light until it must look).
async function currentRoute() {
  const { builderRoute } = await import('../lib/route.js');
  return builderRoute({ home: wheelhouseHome() });
}
const onDesktop = async (route) => (await route())?.route === 'desktop';

async function queue() {
  return import('../watcher/desktop-queue.js');
}

const takenFile = (project) => path.join(path.dirname(stateDir(project)), 'watcher', 'foreman-taken.json');

// All stop's record: the foreman, and the Desktop builders whose sessions the foreman stops, are named as stopped.
async function noteStopped(project, works, stop, now) {
  const { writeStopped } = await import('../lib/heartbeats.js');
  writeStopped(wheelhouseHome(), project, { at: now().toISOString(), stop: stop().at, works });
}

// Waits: `{ exit, text }`. The clock, the sleep, the route, STOP and the poll are given by tests.
export async function waitForWake(project, {
  sessionId, now = () => new Date(), sleep = (ms) => new Promise((r) => { setTimeout(r, ms); }), route = currentRoute, stop = stopState, poll = POLL_MS,
} = {}) {
  const { restoreStale, takeWakes } = await queue();
  const started = now().getTime();
  const first = checkIn(project, { sessionId, now });
  if (!first.ok) return { exit: 'another foreman', text: 'another foreman' };
  let beat = started;
  let checkedRoute = false;
  for (;;) {
    if (stop().on) {
      endCheckIn(project, { sessionId });
      await noteStopped(project, ['foreman'], stop, now);
      return { exit: 'all stop', text: 'all stop' };
    }
    const t = now().getTime();
    if (!checkedRoute || t - beat >= HEARTBEAT_MS) {
      if (checkedRoute && !heartbeat(project, { sessionId, now }).ok) return { exit: 'another foreman', text: 'another foreman' };
      checkedRoute = true;
      beat = t;
      if (!(await onDesktop(route))) {
        endCheckIn(project, { sessionId });
        return { exit: 'route changed', text: 'route changed' };
      }
    }
    // A claim taken and never finished (a foreman that ended mid-way) comes back here, not only when a new wake arrives.
    restoreStale(project, { now });
    const waiting = takeWakes(project);
    if (waiting.length > 0) return { exit: 'wakes', text: `wakes: ${waiting.length}` };
    if (t - started >= WAIT_MAX_MS) return { exit: 'no wake', text: 'no wake' };
    await sleep(poll);
  }
}

// Claims the waiting wakes and says what to do with each: `{ lines }`. The checks (STOP, the route, the director's helm) run
// again here, since they may have changed since the wait began.
export function takeWakes(project, { sessionId, route = currentRoute, stop = stopState, now = () => new Date(), deliver = deliverWake } = {}) {
  return takeWakesAsync(project, { sessionId, route, stop, now, deliver });
}

// Copies a wake's bundle to where its reader can open it: the main checkout's foreman wakes folder, or the piece's worktree.
// A feature-start has no bundle to read, so nothing is copied for it. Gives the copy's path, or null.
async function deliverWake(project, wake) {
  if (wake.kind === 'feature-start') return null;
  const { copyWake, featureWakesDir, foremanWakesDir, locateFeature } = await import('../watcher/waker.js');
  if (wake.kind === 'foreman') {
    const { readProject } = await import('../lib/projects.js');
    const checkout = readProject(project)?.folder;
    if (typeof checkout !== 'string') throw new Error("The project's folder isn't known");
    return copyWake(project, wake.file, foremanWakesDir(checkout));
  }
  const worktree = locateFeature(project)(wake.work);
  if (worktree === null) throw new Error(`${wake.work} has no worktree`);
  return copyWake(project, wake.file, featureWakesDir(worktree));
}

async function takeWakesAsync(project, { route, stop, now, deliver }) {
  const { claimWakes, dropWakes, releaseWakes } = await queue();
  const { helmHeld } = await import('../crew/hold.js');
  // Wakes an earlier take handed over and no finish has dropped yet are still being handled: kept claimed, and kept on the list.
  const before = readTaken(project).filter((p) => lstatOf(p)?.isFile() === true);
  const claimed = claimWakes(project, { now, keep: before });
  const reason = stop().on ? 'all stop' : (await onDesktop(route)) ? null : 'route changed';
  if (reason !== null) {
    releaseWakes(project, claimed.map((w) => w.path));
    return { lines: [reason] };
  }
  const lines = [];
  const kept = [];
  const held = [];
  const back = [];
  for (const wake of claimed) {
    if (wake.work !== undefined && helmHeld(project, wake.work)) {
      held.push(wake.path);
      lines.push(`held ${wake.work}`);
      continue;
    }
    let copy = null;
    try {
      copy = await deliver(project, wake);
    } catch {
      back.push(wake.path);
      lines.push(`not delivered ${wake.kind} ${wake.work ?? '-'}`);
      continue;
    }
    kept.push(wake.path);
    lines.push(`WAKE ${wake.kind} ${wake.work ?? '-'} ${wake.sessionId ?? '-'} ${copy ?? '-'}`);
  }
  releaseWakes(project, back);
  dropWakes(project, held);
  fs.mkdirSync(path.dirname(takenFile(project)), { recursive: true });
  fs.writeFileSync(takenFile(project), `${JSON.stringify({ paths: [...before, ...kept] })}\n`);
  return { lines };
}

// The claims the takes since the last finish handed to the foreman.
function readTaken(project) {
  let paths = [];
  try {
    paths = JSON.parse(fs.readFileSync(takenFile(project), 'utf8')).paths;
  } catch { /* none taken */ }
  return Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : [];
}

function lstatOf(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

// Drops the wakes the takes since the last finish handed to the foreman: how many.
export async function finishTaken(project) {
  const { dropWakes } = await queue();
  const list = readTaken(project);
  dropWakes(project, list);
  fs.rmSync(takenFile(project), { force: true });
  return list.length;
}

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--take' || a === '--finish') out[a.slice(2)] = true;
    else if (['--project', '--session', '--ended'].includes(a) && typeof argv[i + 1] === 'string') {
      out[a.slice(2)] = argv[i + 1];
      i += 1;
    } else throw new Error(`Not an argument here: ${String(a).slice(0, 40)}`);
  }
  return out;
}

export async function main(argv, {
  out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t), now = () => new Date(), sleep, route = currentRoute, stop = stopState, deliver,
} = {}) {
  try {
    const a = parse(argv);
    if (typeof a.project !== 'string' || !PROJECT.test(a.project)) throw new Error('Give the project: --project <name>');
    stateDir(a.project);
    if (a.finish === true) {
      out(`finished: ${await finishTaken(a.project)}\n`);
      return 0;
    }
    if (a.ended !== undefined) {
      if (!WORK.test(a.ended)) throw new Error('--ended takes a work id');
      markEnded(a.project, a.ended, { now });
      if (stop().on) await noteStopped(a.project, [a.ended], stop, now);
      out(`ended: ${a.ended}\n`);
      return 0;
    }
    if (typeof a.session !== 'string' || !SESSION_ID.test(a.session)) throw new Error('Give the foreman\'s own session: --session <id>');
    if (a.take === true) {
      const { lines } = await takeWakes(a.project, { sessionId: a.session, route, stop, now, ...(deliver === undefined ? {} : { deliver }) });
      out(lines.length === 0 ? '' : `${lines.join('\n')}\n`);
      return 0;
    }
    const got = await waitForWake(a.project, { sessionId: a.session, now, ...(sleep === undefined ? {} : { sleep }), route, stop });
    out(`${got.text}\n`);
    return 0;
  } catch (error) {
    err(`${error instanceof Error ? error.message : 'That did not work'}\n`);
    return 1;
  }
}

if (startedAsScript(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
