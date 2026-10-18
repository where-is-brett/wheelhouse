// scripts/watcher/main.js
// The watcher process (build-loop design, section 11), run as
//   node scripts/watcher/main.js <project>
// One runs per project: a start lock, projects/<p>/watcher/watcher.lock,
// turns a second away. Each loop it:
//   1. writes projects/<p>/watcher/health.json, `{ pid, at, shape }`;
//   2. observes (sources.js), with `awake` the time since the last loop,
//      capped at twice the shortest interval, so a computer that slept counts
//      as at most one loop and no feature is called stuck for it;
//   3. diffs and routes (core.js) and gives what it found to the bundler;
//   4. writes each bundle that is due as a wake file and hands it to the
//      waker (waker.js), then lets the waker deliver what was waiting;
//   5. only then writes the cursor, with the bundler's `held`. A stop between
//      a wake and the cursor wakes again on restart; it never loses a wake.
// Under STOP it goes on observing and recording, and the waker holds every
// wake until STOP lifts. At start, when the cursor's last observation is older
// than the look-back (the watcher was off for over a week), the foreman is
// woken once to read the views, since events from then are not sent.
//
// Shape 1: started detached and hidden by the foreman's start script, and by
// the session start when it isn't running (Task 19). Shape 2: run by a plugin
// monitor in the foreman's session, so stdout carries the wake lines and
// nothing else; messages go to stderr. That monitor is not registered in
// hooks.json or plugin.json yet: it waits for check 26 (Task 6), which runs
// only for Shape 2.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeBundler, readCursor, route, step, writeCursor } from './core.js';
import { INTERVALS, LOOKBACK_MS, observe } from './sources.js';
import { makeWaker, watcherDir, watcherFolder, writeJsonFile, writeWake } from './waker.js';
import { readCapped } from '../feature/status.js';
import { readConfig } from '../gate/guardrails.js';
import { helperClient } from '../host/helper-client.js';
import { readProject } from '../lib/projects.js';
import { takeStartLock } from '../lib/start-lock.js';

const CONFIG_BYTES = 1024 * 1024;

export function healthFile(project) {
  return path.join(watcherDir(project), 'health.json');
}

export function lockFile(project) {
  return path.join(watcherDir(project), 'watcher.lock');
}

// The project's configuration, from .claude/wheelhouse.json in its main
// checkout. No file is the empty configuration; one that can't be read throws.
export function projectConfig(project) {
  const folder = readProject(project)?.folder;
  if (typeof folder !== 'string') throw new Error(`No project ${project} is set up on this computer`);
  const file = path.join(folder, '.claude', 'wheelhouse.json');
  let present = true;
  try {
    fs.lstatSync(file);
  } catch {
    present = false;
  }
  const text = present ? readCapped(file, CONFIG_BYTES) : null;
  if (present && text === null) throw new Error("The project's Wheelhouse configuration can't be read");
  return readConfig(text);
}

// The awake time since the last loop: none on the first, never below nothing
// (a clock set back), and at most `cap`.
export function awakeSince(last, t, cap) {
  if (last === null) return 0;
  return Math.min(Math.max(t - last, 0), cap);
}

const pause = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) {
    resolve();
    return;
  }
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
});

// Runs the watcher until `loops` loops have run, `signal` aborts, or another
// watcher has taken the lock. Resolves `{ started: false }` when another
// watcher already runs for the project. `observe`, `waker` (or `wakerOptions`
// for makeWaker), `now`, `sleep` and `handled` are for tests and the start
// script; `handled(observation)` gives the ids the foreman wrote while
// handling a wake, which go to the digest (none, until the foreman marks them).
export async function runWatcher({
  project,
  config = projectConfig(project),
  client = helperClient(),
  observe: look = observe,
  waker = null,
  wakerOptions = {},
  now = () => new Date(),
  sleep = pause,
  intervals = {},
  loops = Infinity,
  signal,
  handled = () => new Set(),
  log = (message) => process.stderr.write(`${message}\n`),
}) {
  const every = { ...INTERVALS, ...intervals };
  const cap = 2 * Math.min(...Object.values(every));
  const shape = config.watcherShape;
  const wake = waker ?? makeWaker({ shape, project, config, now, ...wakerOptions });

  watcherFolder(project);
  const lock = lockFile(project);
  let release;
  try {
    release = await takeStartLock(lock, { message: 'A watcher is already running for this project', waitMs: 0 });
  } catch {
    return { started: false };
  }
  const mine = `${process.pid}\n`;
  const stillMine = () => {
    try {
      return fs.readFileSync(lock, 'utf8') === mine;
    } catch {
      return false;
    }
  };

  try {
    let cursor = readCursor(project);
    let bundler = makeBundler({ now, held: cursor.held });

    // Off for over a week: the foreman reads the views, since those events are not sent.
    const since = cursor.prev?.at;
    const sinceMs = typeof since === 'string' ? Date.parse(since) : Number.NaN;
    if (!Number.isNaN(sinceMs) && now().getTime() - sinceMs > LOOKBACK_MS) {
      const file = writeWake(project, {
        to: 'foreman', events: [{ type: 'long-gap', id: `long-gap:${since}`, detail: { since } }], digest: [], dropped: 0,
      }, { now });
      await wake.wakeForeman(file);
    }

    let last = null;
    for (let n = 0; n < loops && !signal?.aborted; n += 1) {
      if (n > 0) await sleep(every.features, signal);
      if (signal?.aborted) break;
      if (!stillMine()) {
        log('Another watcher has taken over this project; this one stops.');
        return { started: true, loops: n };
      }
      const touched = new Date();
      try { fs.utimesSync(lock, touched, touched); } catch { /* checked again next loop */ }

      const t = now();
      const awake = awakeSince(last, t.getTime(), cap);
      last = t.getTime();
      try {
        writeJsonFile(healthFile(project), { pid: process.pid, at: t.toISOString(), shape });
      } catch (error) {
        log(`The watcher's health can't be written: ${error.message}`);
      }

      try {
        const seen = await look({ project, client, now, intervals: every, prev: cursor.prev, awake });
        const { events, cursor: next } = step(cursor, seen, { handled: handled(seen) });
        bundler.add(route(events));
        for (const bundle of bundler.due()) {
          const file = writeWake(project, bundle, { now });
          if (bundle.to === 'foreman') await wake.wakeForeman(file);
          else await wake.wakeFeature(bundle.work, file);
        }
        await wake.pump();
        const written = { ...next, held: bundler.held() };
        writeCursor(project, written);
        cursor = written;
      } catch (error) {
        // Nothing of this loop is kept: what was due is held again as last
        // written, and this loop's events are found again from the cursor.
        bundler = makeBundler({ now, held: cursor.held });
        log(`The watcher's loop failed: ${error.message}`);
      }
    }
    return { started: true, loops };
  } finally {
    if (stillMine()) release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const project = process.argv[2];
  const stop = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop.abort());
  (async () => runWatcher({ project, signal: stop.signal }))().then((result) => {
    if (!result.started) process.stderr.write('A watcher is already running for this project.\n');
    process.exit(0);
  }, (error) => {
    process.stderr.write(`The watcher stopped: ${error.message}\n`);
    process.exit(1);
  });
}
