// tests/scripts/watcher/main.test.js
// The watcher process: one per project, observe -> diff -> route -> bundle ->
// wake, the cursor written after each wake, and health written each loop.
// The observation, the clock and every `claude` are stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runWatcher, healthFile, lockFile } from '../../../scripts/watcher/main.js';
import { readWake } from '../../../scripts/watcher/waker.js';
import { readCursor, writeCursor } from '../../../scripts/watcher/core.js';
import { LOOKBACK_MS } from '../../../scripts/watcher/sources.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { takeStartLock } from '../../../scripts/lib/start-lock.js';
import { readProject, writeProject } from '../../../scripts/lib/projects.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const P = 'o__p';
const T0 = Date.parse('2026-10-19T09:00:00.000Z');
const SEC = 1000;
const HOUR = 60 * 60 * SEC;
const DAY = 24 * HOUR;

const config = (over = {}) => readConfig(JSON.stringify({
  v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], routing: { foreman: 'model-a' }, ...over,
}));

function checkout() {
  const found = readProject(P);
  if (found) return found.folder;
  const main = tempFolder('wh-main-');
  writeProject(P, {
    folder: main, remoteUrl: 'https://github.com/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
  });
  return main;
}

// A clock that moves only when the watcher sleeps; `jumps` gives some sleeps a length of their own.
function clock(jumps = {}) {
  let t = T0;
  let sleeps = 0;
  return {
    now: () => new Date(t),
    sleep: async (ms) => {
      sleeps += 1;
      t += jumps[sleeps] ?? ms;
    },
    at: () => t,
  };
}

const INCIDENT = { id: 'ev-1', kind: 'incident', data: { id: 'outage', what: 'Down' } };

// A stand-in for observe: the incident in the first observation (or those given), nothing after.
function looker(first = [INCIDENT], { stop = false } = {}) {
  const calls = [];
  const observe = async ({ now, awake, prev }) => {
    calls.push({ awake, prev });
    return {
      at: now().toISOString(), awake, events: calls.length === 1 ? first : [], features: {}, prs: {}, testMerges: [], stop, polled: {}, stateIds: [],
    };
  };
  return { observe, calls };
}

// A stand-in waker that keeps every wake.
function fakeWaker({ onForeman = () => {} } = {}) {
  const wakes = [];
  return {
    wakes,
    wakeForeman: async (file) => { onForeman(file); wakes.push(['foreman', file]); },
    wakeFeature: async (work, file) => { wakes.push(['feature', work, file]); },
    startFeature: async () => { throw new Error('not here'); },
    pump: async () => [],
    waiting: () => [],
  };
}

const quiet = () => {};

test('a second watcher for the same project does not start', () => withHome(async () => {
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const first = looker([]);
  const running = runWatcher({
    project: P, config: config(), observe: first.observe, waker: fakeWaker(), loops: 2, sleep: () => gate, log: quiet,
  });
  while (first.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));

  const second = looker([]);
  const answer = await runWatcher({ project: P, config: config(), observe: second.observe, waker: fakeWaker(), loops: 1, log: quiet });
  assert.equal(answer.started, false);
  assert.equal(second.calls.length, 0, 'it observes nothing');

  open();
  assert.equal((await running).started, true);
  assert.equal(fs.existsSync(lockFile(P)), false, 'the lock is let go at the end');
  const third = await runWatcher({ project: P, config: config(), observe: looker([]).observe, waker: fakeWaker(), loops: 1, sleep: async () => {}, log: quiet });
  assert.equal(third.started, true);
}));

test('a lock held by another watcher stops this one at its next loop, and is left alone', () => withHome(async () => {
  const c = clock();
  const seen = looker([]);
  const result = await runWatcher({
    project: P,
    config: config(),
    observe: async (args) => {
      fs.writeFileSync(lockFile(P), '999999\n'); // another watcher took the lock over
      return seen.observe(args);
    },
    waker: fakeWaker(),
    loops: 5,
    now: c.now,
    sleep: c.sleep,
    log: quiet,
  });
  assert.equal(result.started, true);
  assert.equal(seen.calls.length, 1);
  assert.equal(fs.readFileSync(lockFile(P), 'utf8'), '999999\n');
}));

test('the cursor is written after each wake, so a crash mid-loop wakes again, not never', () => withHome(async () => {
  const c = clock();
  // The bundle falls due on the fifth loop (BUNDLE_MS after the first), and its wake fails there.
  const crashing = fakeWaker({ onForeman: () => { throw new Error('the watcher stopped here'); } });
  await runWatcher({ project: P, config: config(), observe: looker().observe, waker: crashing, loops: 5, now: c.now, sleep: c.sleep, log: quiet });
  const after = readCursor(P);
  assert.ok(after.seen.includes('ev-1'));
  assert.deepEqual(after.held.foreman.events.map((e) => e.id), ['ev-1'], 'the bundle is still held on disk');

  // Restarted: the held bundle wakes the foreman, and the cursor that drops it is written only after.
  const order = [];
  const working = fakeWaker({
    onForeman: (file) => {
      order.push('wake');
      assert.deepEqual(readCursor(P).held.foreman.events.map((e) => e.id), ['ev-1'], 'not yet written');
      assert.deepEqual(readWake(file).events.map((e) => e.id), ['ev-1']);
    },
  });
  await runWatcher({ project: P, config: config(), observe: looker([]).observe, waker: working, loops: 1, now: c.now, sleep: c.sleep, log: quiet });
  assert.deepEqual(order, ['wake']);
  assert.equal(readCursor(P).held.foreman, null, 'delivered, then written');

  // And not again.
  const later = fakeWaker();
  await runWatcher({ project: P, config: config(), observe: looker([]).observe, waker: later, loops: 3, now: c.now, sleep: c.sleep, log: quiet });
  assert.deepEqual(later.wakes, []);
}));

test('each loop writes health.json with the pid, the time and the shape', () => withHome(async () => {
  const c = clock();
  await runWatcher({ project: P, config: config({ watcherShape: 2 }), observe: looker([]).observe, waker: fakeWaker(), loops: 3, now: c.now, sleep: c.sleep, log: quiet });
  const health = JSON.parse(fs.readFileSync(healthFile(P), 'utf8'));
  assert.deepEqual(health, { pid: process.pid, at: new Date(T0 + 30 * SEC).toISOString(), shape: 2 });
}));

test('awake time counts a sleep of the computer as at most one loop', () => withHome(async () => {
  const c = clock({ 2: 10 * HOUR });
  const seen = looker([]);
  await runWatcher({ project: P, config: config(), observe: seen.observe, waker: fakeWaker(), loops: 4, now: c.now, sleep: c.sleep, log: quiet });
  assert.deepEqual(seen.calls.map((x) => x.awake), [0, 15 * SEC, 30 * SEC, 15 * SEC]);
}));

test('a watcher off for over a week wakes the foreman once, to read the views', () => withHome(async () => {
  const old = new Date(T0 - LOOKBACK_MS - SEC).toISOString();
  writeCursor(P, { seen: [], prev: { at: old, seq: 3, features: {}, prs: {}, testMerges: [], stop: false }, held: null });
  const c = clock();
  const waker = fakeWaker();
  const seen = looker([]);
  await runWatcher({ project: P, config: config(), observe: seen.observe, waker, loops: 1, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(waker.wakes.length, 1);
  const wake = readWake(waker.wakes[0][1]);
  assert.equal(wake.to, 'foreman');
  assert.deepEqual(wake.events.map((e) => e.type), ['long-gap']);
  assert.equal(wake.events[0].detail.since, old);
  assert.match(wake.note, /off for over a week/);
  assert.match(wake.note, /views/);

  // Its cursor is now this run's, so the next start does not wake for the gap again.
  const next = fakeWaker();
  await runWatcher({ project: P, config: config(), observe: looker([]).observe, waker: next, loops: 1, now: c.now, sleep: c.sleep, log: quiet });
  assert.deepEqual(next.wakes, []);

  // Six days off is no long gap.
  const recent = new Date(T0 - 6 * DAY).toISOString();
  writeCursor(P, { seen: [], prev: { at: recent, seq: 3, features: {}, prs: {}, testMerges: [], stop: false }, held: null });
  const quietWaker = fakeWaker();
  await runWatcher({ project: P, config: config(), observe: looker([]).observe, waker: quietWaker, loops: 1, now: () => new Date(T0), sleep: async () => {}, log: quiet });
  assert.deepEqual(quietWaker.wakes, []);
}));

test('under STOP the loop observes and records, but starts and wakes nothing until it lifts', () => withHome(async () => {
  checkout();
  const calls = [];
  const wakerOptions = {
    run: (file, args, options) => { calls.push({ file, args, ...options }); return { pid: 4242 }; },
    alive: () => false,
    bootedAt: () => 0,
    claude: { kind: 'direct', file: 'claude' },
    baseEnv: { PATH: '/bin' },
  };
  const c = clock();
  setStop({ by: 'prompt' });
  const seen = looker([INCIDENT], { stop: true });
  await runWatcher({ project: P, config: config(), observe: seen.observe, wakerOptions, loops: 6, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(seen.calls.length, 6, 'it kept observing');
  assert.equal(calls.length, 0, 'nothing started');
  assert.ok(readCursor(P).seen.includes('ev-1'), 'and recorded');
  const waiting = JSON.parse(fs.readFileSync(path.join(path.dirname(healthFile(P)), 'outbox.json'), 'utf8')).entries;
  assert.equal(waiting.length, 1);
  assert.deepEqual(readWake(waiting[0].file).events.map((e) => e.id), ['ev-1', 'stop:0'], 'STOP itself waits for the foreman too');

  liftStop();
  await runWatcher({ project: P, config: config(), observe: looker([]).observe, wakerOptions, loops: 1, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 2), ['-p', `Wheelhouse foreman: handle ${waiting[0].file}`]);
  assert.equal(calls[0].env.WHEELHOUSE_ROLE, 'foreman');
}));

test('Shape 1 starts a foreman for a due bundle; Shape 2 prints its line', () => withHome(async () => {
  checkout();
  const calls = [];
  const lines = [];
  const wakerOptions = {
    run: (file, args, options) => { calls.push({ file, args, ...options }); return { pid: 4242 }; },
    alive: () => true,
    bootedAt: () => 0,
    claude: { kind: 'direct', file: 'claude' },
    baseEnv: { PATH: '/bin' },
    print: (line) => lines.push(line),
  };
  const c = clock();
  await runWatcher({ project: P, config: config(), observe: looker().observe, wakerOptions, loops: 5, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(2), ['--permission-mode', 'acceptEdits', '--model', 'model-a']);
  assert.deepEqual(lines, []);

  fs.rmSync(path.dirname(healthFile(P)), { recursive: true });
  await runWatcher({ project: P, config: config({ watcherShape: 2 }), observe: looker().observe, wakerOptions, loops: 5, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(calls.length, 1, 'Shape 2 starts nothing');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^WAKE foreman .+\.json$/);
}));

test('the configuration is read from the project\'s checkout, and one it cannot read stops the watcher', () => withHome(async () => {
  const main = checkout();
  fs.mkdirSync(path.join(main, '.claude'), { recursive: true });
  const file = path.join(main, '.claude', 'wheelhouse.json');
  fs.writeFileSync(file, JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], watcherShape: 2 }));
  const c = clock();
  await runWatcher({ project: P, observe: looker([]).observe, waker: fakeWaker(), loops: 1, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(JSON.parse(fs.readFileSync(healthFile(P), 'utf8')).shape, 2);

  fs.writeFileSync(file, JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], sessionMode: 'bypassPermissions' }));
  await assert.rejects(runWatcher({ project: P, observe: looker([]).observe, waker: fakeWaker(), loops: 1, log: quiet }), /configuration/);
  assert.equal(fs.existsSync(lockFile(P)), false);
}));
