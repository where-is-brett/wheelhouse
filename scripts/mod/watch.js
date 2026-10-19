// scripts/mod/watch.js
// The watcher on the mod's timer, through the bridge's tick. The shape is the project's
// configuration on its default branch, asked of the helper (ruling R50) and kept for ten minutes
// in projects/<p>/mod/watch.json; until it has been read once, nothing is started and no loop is
// run, as the watcher itself waits. A shape read once stands while the helper can't answer, and
// is asked for again at each tick until it does.
//
//   Shape 1, the front desk: at most every WATCH_EVERY_MS (the last check is kept in watch.json),
//   whether the watcher runs, and a start when it doesn't, so a watcher that stopped mid-session
//   starts again without waiting for a session start. Between checks the last check's answer
//   stands.
//   Shape 2, the foreman's own session: one watcher loop, with a printer that collects the wake
//   lines (WAKE foreman <file>, WAKE feature <work> <file>), handed back as the foreman's
//   prompts in order. The watcher's start lock keeps two loops of one project from running at
//   once, so a second foreman session, or a monitor left over, runs nothing. The loop's awake
//   time is the time since the last loop this file records, capped as the watcher caps it.
//   Any other role, or the other shape: nothing to do.
//
// watchTick never throws. Its `watcher` is 'running', 'started', 'failed' or 'not-needed', or
// null while the shape hasn't been read.
import fs from 'node:fs';
import path from 'node:path';
import { FOREMAN_PROMPT_LEAD, startWatcher } from '../foreman/start.js';
import { WATCH_EVERY_MS } from '../lib/mod-numbers.js';
import { stateDir } from '../lib/paths.js';
import { awakeSince, cliOptions, projectConfig, runWatcher } from '../watcher/main.js';
import { INTERVALS, observe as defaultObserve } from '../watcher/sources.js';
import { writeJsonFile } from '../watcher/waker.js';

// How long a shape read from the default branch is kept.
export const SHAPE_FRESH_MS = 10 * 60 * 1000;
const ANSWERS = ['running', 'started', 'failed', 'not-needed'];
const SMALL_BYTES = 64 * 1024;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// projects/<project>/mod/watch.json; stateDir refuses a name that is not a folder name.
export function watchFile(project) {
  return path.join(stateDir(project), '..', 'mod', 'watch.json');
}

// What watch.json keeps, or an empty record when it isn't there or can't be read.
function readKept(project) {
  try {
    const file = watchFile(project);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > SMALL_BYTES) return {};
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isRecord(kept) ? kept : {};
  } catch {
    return {};
  }
}

// Writes watch.json whole, through a temporary file. A file that can't be written costs only
// the cache: the next tick asks again.
function keep(project, kept) {
  try {
    const file = watchFile(project);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeJsonFile(file, kept);
  } catch { /* asked again next tick */ }
}

// The milliseconds since `at` (an ISO time) when it is a time not after `t`, otherwise null.
function since(at, t) {
  const ms = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  return Number.isFinite(ms) && t >= ms ? t - ms : null;
}

// The shape, 1 or 2, from the cache while it is fresh, otherwise from the default branch,
// otherwise the last one read; null when none has ever been read. `kept` is updated in place.
async function shapeOf(project, client, kept, t) {
  const cached = isRecord(kept.shape) && (kept.shape.value === 1 || kept.shape.value === 2) ? kept.shape : null;
  const age = since(cached?.at, t);
  if (cached !== null && age !== null && age < SHAPE_FRESH_MS) return cached.value;
  const read = await projectConfig(project, client);
  if (read.config !== null) {
    // As the start script reads it: anything but 2 is Shape 1.
    const value = read.config.watcherShape === 2 ? 2 : 1;
    kept.shape = { value, at: new Date(t).toISOString() };
    return value;
  }
  return cached?.value ?? null;
}

// Shape 1, at the front desk: the watcher started when it isn't running.
function keepRunning(project, { spawn, pluginRoot, alive, now, env }) {
  try {
    return startWatcher(project, {
      spawn, pluginRoot, alive, now, env,
    }).started ? 'started' : 'running';
  } catch {
    return 'failed';
  }
}

// Shape 2, in the foreman's session: one loop of the watcher, as its command line runs it, with
// the wake lines collected. `loop` passes the observation, the waker's options and the log in
// tests.
async function oneLoop(project, { client, now, kept, t, loop }) {
  const lines = [];
  const cap = 2 * Math.min(...Object.values(INTERVALS));
  const gap = since(kept.loop?.at, t);
  const awake = awakeSince(gap === null ? null : t - gap, t, cap);
  const look = loop.observe ?? defaultObserve;
  const options = cliOptions(project);
  const result = await runWatcher({
    ...options,
    client,
    now,
    loops: 1,
    log: loop.log ?? (() => {}),
    observe: (args) => look({ ...args, awake }),
    wakerOptions: { ...options.wakerOptions, ...loop.wakerOptions, print: (line) => lines.push(line) },
  });
  if (result.started) kept.loop = { at: new Date(t).toISOString() };
  return lines.map((line) => `${FOREMAN_PROMPT_LEAD} ${line}`);
}

// watchTick({ project, role, client, now, pluginRoot, spawn?, alive?, env?, loop? })
//   -> { watcher, submit: string[] }. Never throws.
export async function watchTick({
  project, role, client, now = () => new Date(), pluginRoot, spawn, alive, env, loop = {},
}) {
  const answer = (watcher, submit = []) => ({ watcher, submit });
  try {
    if (role !== 'front-desk' && role !== 'foreman') return answer('not-needed');
    const t = now().getTime();
    const kept = readKept(project);

    if (role === 'front-desk') {
      const age = since(kept.check?.at, t);
      if (age !== null && age < WATCH_EVERY_MS && ANSWERS.includes(kept.check.watcher)) return answer(kept.check.watcher);
    }
    const shape = await shapeOf(project, client, kept, t);
    if (shape === null) return answer(null);

    if (role === 'front-desk') {
      const watcher = shape === 1 ? keepRunning(project, {
        spawn, pluginRoot, alive, now, env,
      }) : 'not-needed';
      kept.check = { at: new Date(t).toISOString(), watcher };
      keep(project, kept);
      return answer(watcher);
    }

    if (shape !== 2) {
      keep(project, kept);
      return answer('not-needed');
    }
    let submit;
    try {
      submit = await oneLoop(project, {
        client, now, kept, t, loop,
      });
    } finally {
      keep(project, kept);
    }
    return answer('running', submit);
  } catch {
    return answer('failed');
  }
}
