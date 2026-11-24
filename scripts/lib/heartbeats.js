// scripts/lib/heartbeats.js
// Who is still running after All stop, read from the processes' own records and never guessed (builders and settings design,
// section 12A.6): the watcher's heartbeat (health.json, written every loop), the helper's running record (helper.json) and the
// run records of builders the watcher started. `stopped` is what the watcher recorded ending when All stop came on.
import fs from 'node:fs';
import path from 'node:path';
import { pidAlive } from './process-start.js';
import { stopState } from './stop.js';

// A watcher loop is a minute; a heartbeat older than this is a watcher that has gone (the watcher's own away line is 3 minutes).
export const HEARTBEAT_FRESH_MS = 3 * 60 * 1000;

const watcherFolder = (home, project) => path.join(home, 'projects', project, 'watcher');
export const stoppedFile = (home, project) => path.join(watcherFolder(home, project), 'all-stopped.json');

function readJson(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 64 * 1024) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// A name the card may show: the foreman, or a work id as the watcher writes one.
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const shown = (w) => typeof w === 'string' && (w === 'foreman' || NAME.test(w));

// Records the builders the watcher ended for the All stop set at `stop` (its `at`): `{ at, stop, stopped: [work] }`. A
// record for the same STOP gains the new names; one for an earlier STOP is replaced.
export function writeStopped(home, project, { at, stop, works }) {
  const file = stoppedFile(home, project);
  const kept = readJson(file);
  const before = kept !== null && kept.stop === stop && Array.isArray(kept.stopped) ? kept.stopped.filter(shown) : [];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ at, stop, stopped: [...new Set([...before, ...works.filter(shown)])] })}\n`);
}

// { stopped: string[], running: { name, why }[] }, from files only (a process id is asked of the system, nothing more).
// `stopped` is read only from the record for the All stop now on. Part 6 adds the foreman and Desktop builders to it.
export function stillRunning(home, project, { now = () => new Date(), alive = pidAlive, stopAt = () => stopState().at } = {}) {
  const kept = readJson(stoppedFile(home, project));
  const current = kept !== null && kept.stop !== undefined && kept.stop === stopAt();
  const works = current && Array.isArray(kept.stopped) ? kept.stopped.filter(shown) : [];
  const stopped = works.map((w) => (w === 'foreman' ? 'foreman' : `builder ${w}`));
  const running = [];

  const helper = readJson(path.join(home, 'helper.json'));
  if (Number.isInteger(helper?.pid) && alive(helper.pid)) running.push({ name: 'the helper', why: 'holds your keys and refuses every change' });

  const beat = readJson(path.join(watcherFolder(home, project), 'health.json'));
  const at = Date.parse(beat?.at ?? '');
  if (Number.isInteger(beat?.pid) && !Number.isNaN(at) && now().getTime() - at < HEARTBEAT_FRESH_MS && alive(beat.pid)) {
    running.push({ name: 'the watcher', why: 'idle, making no changes' });
  }

  let names = [];
  try {
    names = fs.readdirSync(path.join(watcherFolder(home, project), 'running'));
  } catch { /* none running */ }
  for (const n of names.sort()) {
    const m = /^feature-(.+)\.json$/.exec(n);
    if (m === null || !NAME.test(m[1])) continue;
    const run = readJson(path.join(watcherFolder(home, project), 'running', n));
    if (Number.isInteger(run?.pid) && alive(run.pid)) running.push({ name: `builder ${m[1]}`, why: 'still ending' });
  }
  return { stopped, running };
}

// The All stopped card's body, in the design's words (section 12A.6).
export function allStoppedWords({ stopped, running }) {
  const count = stopped.filter((s) => s.startsWith('builder ')).length;
  const others = stopped.filter((s) => !s.startsWith('builder '));
  const parts = [...(count > 0 ? [`${count} builder${count === 1 ? '' : 's'}`] : []), ...others.map((s) => `the ${s}`)];
  return [
    `Stopped: ${parts.length > 0 ? parts.join(', ') : 'nothing was running'}.`,
    `Still running: ${running.length > 0 ? running.map((r) => `${r.name} (${r.why})`).join(' and ') : 'nothing'}.`,
    'To carry on: **Lift All stop**. Work picks up where it stopped.',
  ].join('\n');
}
