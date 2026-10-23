// scripts/watcher/main.js
// The watcher process (build-loop design, section 11), run as
//   node scripts/watcher/main.js <project>
// One runs per project: a start lock, projects/<p>/watcher/watcher.lock,
// turns a second away, and a watcher whose lock another has taken over stops
// at its next loop. Each loop it:
//   1. writes projects/<p>/watcher/health.json, `{ pid, at, shape, lastOk?,
//      lastError? }`: when a loop last went through whole, and the last
//      thing that went wrong (a failed loop, a wake that keeps failing, a
//      session that ran past its time), as `{ at, message }`;
//   2. wakes the foreman to read the views when the cursor's last observation
//      is older than the look-back (the watcher, or the computer, was off for
//      over a week), since the events from then are not sent;
//   3. observes (sources.js), with `awake` the time since the last loop,
//      capped at twice the shortest interval, so a computer that slept counts
//      as at most one loop and no feature is called stuck for it;
//   4. diffs and routes (core.js) and gives what it found to the bundler;
//   5. writes each bundle that is due as a wake and hands it to the waker
//      (waker.js), then lets the waker deliver what was waiting. A bundle
//      whose wake can never be written is reported and dropped, so it never
//      holds up the rest;
//   6. only then writes the cursor, with the bundler's `held`. A stop between
//      a wake and the cursor wakes again on restart; it never loses a wake.
// A feature's wake held by the files in its folder that steer agents
// (control-files.js) is raised through the helper as a plain record, for the
// director's card (raiseRecord).
//
// Under STOP it goes on observing and recording, and the waker holds every
// wake until STOP lifts.
//
// The configuration is the default branch's, asked of the helper, which reads
// it in its own mirror: never the working copy, which an agent can edit. Until
// it has been read, the watcher wakes and starts nothing, not even by the
// defaults: each loop asks again and does nothing else, and health.json says
// why (its `shape` is null meanwhile). Nothing is lost: the cursor does not
// move, so what happened meanwhile is found once the configuration is read. A
// configuration that reads but leaves keys out has the defaults for those.
//
// Shape 1: started detached and hidden by the foreman's start script, and by
// the session start when it isn't running (Task 19), and by the front desk's
// tick on the mod's timer. Shape 2: one loop at each tick of the mod's timer
// in the foreman's session (scripts/mod/watch.js), with a printer that
// collects the wake lines; run from the command line, stdout carries the wake
// lines and nothing else, and messages go to stderr.
import fs from 'node:fs';
import path from 'node:path';
import { makeBundler, readCursor, route, step, writeCursor } from './core.js';
import { readHandled } from './handled.js';
import { INTERVALS, LOOKBACK_MS, observe } from './sources.js';
import { makeWaker, watcherDir, watcherFolder, writeJsonFile, writeWake } from './waker.js';
import { foremanTools } from '../foreman/tools.js';
import { readConfig } from '../gate/guardrails.js';
import { helperClient } from '../host/helper-client.js';
import { takeStartLock } from '../lib/start-lock.js';
import { PROTECTED_KINDS, makeEvent } from '../state/events.js';
import { startedAsScript } from '../lib/started-as-script.js';

// How often old wake files are pruned.
const PRUNE_MS = 60 * 60 * 1000;

export function healthFile(project) {
  return path.join(watcherDir(project), 'health.json');
}

export function lockFile(project) {
  return path.join(watcherDir(project), 'watcher.lock');
}

// The project's configuration from its default branch, through the helper,
// as `{ config }`, or `{ config: null, why }` when the helper can't answer or
// its answer doesn't read. The working copy is never read.
export async function projectConfig(project, client) {
  let answer;
  try {
    answer = await client.config({ project });
  } catch {
    answer = null;
  }
  if (answer?.ok === true) {
    try {
      return { config: readConfig(JSON.stringify(answer.config)) };
    } catch {
      return { config: null, why: 'the configuration on the default branch can\'t be read' };
    }
  }
  return { config: null, why: typeof answer?.refused === 'string' ? answer.refused : 'the helper gave no answer' };
}

// What the waker raises (a `control-file` record or its lift), written to the
// project's state through the helper. A `control-file` record is a signed kind
// (ruling P7-33), signed here with this computer's key and sent as its own
// record, so no session can write one; its lift is plain. Throws when the
// helper doesn't take it, so the waker raises it again at the next wake.
export function raiseRecord(project, client, { now = () => new Date() } = {}) {
  return async ({ kind, data }) => {
    const answer = PROTECTED_KINDS.includes(kind)
      ? await client.state.record({ project, event: makeEvent({ kind, data, now }) })
      : await client.state.write({ project, kind, data });
    if (answer?.ok !== true) throw new Error(typeof answer?.refused === 'string' ? answer.refused : 'the helper gave no answer');
  };
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
// watcher already runs for the project. `config`, `observe`, `waker` (or
// `wakerOptions` for makeWaker), `now`, `sleep` and `handled` are for tests
// and the start script; `handled(observation)` gives the ids the foreman
// wrote while handling a wake, which go to the digest (cliOptions reads them
// from handled.js).
export async function runWatcher({
  project,
  client = helperClient(),
  config = null,
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
    const health = { lastOk: null, lastError: null };
    const fault = (message) => {
      health.lastError = { at: now().toISOString(), message };
      log(message);
    };
    let settings = config;
    let shape = settings?.watcherShape ?? null;
    let wake = null;

    let cursor = readCursor(project);
    let bundler = makeBundler({ now, held: cursor.held });
    let pruned = null;
    let gapSent = null;
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

      // No configuration yet: ask again, and do nothing else this loop.
      if (settings === null) {
        const read = await projectConfig(project, client);
        if (read.config === null) fault(`The watcher is waiting for the project's configuration from its default branch: ${read.why}`);
        else {
          settings = read.config;
          shape = settings.watcherShape;
        }
      }
      if (settings !== null && wake === null) {
        try {
          wake = waker ?? makeWaker({
            shape, project, config: settings, now, onError: fault, raise: raiseRecord(project, client, { now }), ...wakerOptions,
          });
        } catch (error) {
          fault(`The watcher can't wake sessions with this configuration: ${error.message}`);
        }
      }

      try {
        writeJsonFile(healthFile(project), {
          pid: process.pid, at: t.toISOString(), shape, ...(health.lastOk ? { lastOk: health.lastOk } : {}), ...(health.lastError ? { lastError: health.lastError } : {}),
        });
      } catch (error) {
        log(`The watcher's health can't be written: ${error.message}`);
      }
      if (wake === null) continue; // nothing observed, nothing woken, the cursor kept as it is

      if (pruned === null || t.getTime() - pruned >= PRUNE_MS) {
        pruned = t.getTime();
        try {
          await wake.prune?.();
        } catch (error) {
          fault(`Old wakes couldn't be pruned: ${error.message}`);
        }
      }

      try {
        // Off for over a week: the foreman reads the views, since those events are not sent.
        const since = cursor.prev?.at;
        const sinceMs = typeof since === 'string' ? Date.parse(since) : Number.NaN;
        if (!Number.isNaN(sinceMs) && t.getTime() - sinceMs > LOOKBACK_MS && gapSent !== since) {
          const file = writeWake(project, {
            to: 'foreman', events: [{ type: 'long-gap', id: `long-gap:${since}`, detail: { since } }], digest: [], dropped: 0,
          }, { now });
          await wake.wakeForeman(file);
          gapSent = since; // once for this gap, even if the rest of the loop fails
        }

        const seen = await look({ project, client, now, intervals: every, prev: cursor.prev, awake });
        const { events, cursor: next } = step(cursor, seen, { handled: handled(seen) });
        bundler.add(route(events));
        for (const bundle of bundler.due()) {
          let file;
          try {
            file = writeWake(project, bundle, { now });
          } catch (error) {
            fault(`A wake for ${bundle.to === 'foreman' ? 'the foreman' : bundle.work} couldn't be written and was dropped: ${error.message}`);
            continue;
          }
          if (bundle.to === 'foreman') await wake.wakeForeman(file);
          else await wake.wakeFeature(bundle.work, file);
        }
        await wake.pump();
        const written = { ...next, held: bundler.held() };
        writeCursor(project, written);
        cursor = written;
        health.lastOk = t.toISOString();
      } catch (error) {
        // Nothing of this loop is kept: what was due is held again as last
        // written, and this loop's events are found again from the cursor.
        bundler = makeBundler({ now, held: cursor.held });
        fault(`The watcher's loop failed: ${error.message}`);
      }
    }
    return { started: true, loops };
  } finally {
    if (stillMine()) release();
  }
}

// What the command line runs the watcher with: the ids the foreman has handled,
// read afresh at each loop (rulings R48, R64), and the foreman's allowed tools,
// Read and its two scripts in this plugin (rulings R45, R63).
export function cliOptions(project) {
  return {
    project,
    handled: () => readHandled(project),
    wakerOptions: { foremanTools: foremanTools() },
  };
}

if (startedAsScript(import.meta.url)) {
  const project = process.argv[2];
  const stop = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop.abort());
  (async () => runWatcher({ ...cliOptions(project), signal: stop.signal }))().then((result) => {
    if (!result.started) process.stderr.write('A watcher is already running for this project.\n');
    process.exit(0);
  }, (error) => {
    process.stderr.write(`The watcher stopped: ${error.message}\n`);
    process.exit(1);
  });
}
