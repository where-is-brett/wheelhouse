// tests/scripts/watcher/main.test.js
// The watcher process: one per project, observe -> diff -> route -> bundle ->
// wake, the cursor written after each wake, and health written each loop.
// The observation, the helper, the clock and every `claude` are stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runWatcher, healthFile, lockFile, projectConfig, cliOptions } from '../../../scripts/watcher/main.js';
import { recordHandled } from '../../../scripts/watcher/handled.js';
import { foremanTools } from '../../../scripts/foreman/tools.js';
import {
  makeWaker, readWake, wakesDir, outboxFile, spawnDetached, PROMPTS,
} from '../../../scripts/watcher/waker.js';
import { readCursor, writeCursor } from '../../../scripts/watcher/core.js';
import { LOOKBACK_MS } from '../../../scripts/watcher/sources.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
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
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
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

// A stand-in for observe: `first` in the first observation, nothing after; `prs` in every one.
function looker(first = [INCIDENT], { stop = false, prs = {} } = {}) {
  const calls = [];
  const observe = async ({ now, awake, prev }) => {
    calls.push({ awake, prev });
    return {
      at: now().toISOString(), awake, events: calls.length === 1 ? first : [], features: {}, prs, testMerges: [], stop, polled: {}, stateIds: [],
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
    prune: async () => {},
    waiting: () => [],
  };
}

// The real waker with a stand-in for starting processes.
function starter({ alive = () => true } = {}) {
  const calls = [];
  let pid = 4000;
  const wakerOptions = {
    run: (file, args, options) => { pid += 1; calls.push({ file, args, ...options, pid }); return { pid }; },
    alive,
    startTimeOf: async () => null,
    bootedAt: () => 0,
    claude: { kind: 'direct', file: 'claude' },
    baseEnv: { PATH: '/bin' },
  };
  return { calls, wakerOptions };
}

const quiet = () => {};
const copyOf = (record) => path.join(checkout(), '.wheelhouse', 'foreman', 'wakes', path.basename(record));

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

test('a watcher lock left by a process that has gone, or untouched for too long, is taken over', (t) => withHome(async () => {
  const keep = setInterval(() => {}, 50);
  t.after(() => clearInterval(keep));
  const gone = await spawnDetached(process.execPath, ['-e', '0']);
  await gone.exited;
  fs.mkdirSync(path.dirname(lockFile(P)), { recursive: true });
  fs.writeFileSync(lockFile(P), `${gone.pid}\n`);
  const a = await runWatcher({ project: P, config: config(), observe: looker([]).observe, waker: fakeWaker(), loops: 1, log: quiet });
  assert.equal(a.started, true);

  // A live process's lock that has not been touched in over ten minutes.
  fs.writeFileSync(lockFile(P), `${process.ppid}\n`);
  const old = new Date(Date.now() - 11 * 60 * SEC);
  fs.utimesSync(lockFile(P), old, old);
  const b = await runWatcher({ project: P, config: config(), observe: looker([]).observe, waker: fakeWaker(), loops: 1, log: quiet });
  assert.equal(b.started, true);
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

test('a crash after the outbox is saved but before the cursor is written repeats the wake, which then goes once', () => withHome(async () => {
  checkout();
  const c = clock();
  const live = new Set();
  const { calls, wakerOptions } = starter({ alive: (pid) => live.has(pid) });
  const run = wakerOptions.run;
  wakerOptions.run = (...a) => { const r = run(...a); live.add(r.pid); return r; };
  const real = makeWaker({ shape: 1, project: P, config: config(), now: c.now, ...wakerOptions });
  // Saved to the outbox and started, then the watcher stops before the cursor.
  const crashing = { ...real, wakeForeman: async (file) => { await real.wakeForeman(file); throw new Error('the watcher stopped here'); } };
  await runWatcher({ project: P, config: config(), observe: looker().observe, waker: crashing, loops: 5, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(calls.length, 1);
  assert.deepEqual(readCursor(P).held.foreman.events.map((e) => e.id), ['ev-1'], 'not recorded as sent');

  // Restarted while that foreman still runs: the bundle is sent again and waits behind it.
  await runWatcher({ project: P, config: config(), observe: looker([]).observe, wakerOptions, loops: 1, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(calls.length, 1);
  assert.equal(readCursor(P).held.foreman, null);

  // Once it ends, both copies of the wake go together, each event once.
  live.clear();
  await runWatcher({ project: P, config: config(), observe: looker([]).observe, wakerOptions, loops: 1, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(calls.length, 2);
  const merged = path.join(wakesDir(P), path.basename(calls[1].args[1].slice(PROMPTS.foreman('').length)));
  assert.equal(readWake(merged).merged.length, 2);
  assert.deepEqual(readWake(merged).events.map((e) => e.id), ['ev-1']);
}));

test('a bundle whose wake can never be written is reported and dropped, and the rest go on', () => withHome(async () => {
  const c = clock();
  const waker = fakeWaker();
  const prs = { 7: { work: 'Not A Slug', head: 'h1', ci: 'failure', mergeable: 'yes', review: 'none' } };
  await runWatcher({ project: P, config: config(), observe: looker([INCIDENT], { prs }).observe, waker, loops: 6, now: c.now, sleep: c.sleep, log: quiet });
  assert.deepEqual(waker.wakes.map((w) => w[0]), ['foreman']);
  const cursor = readCursor(P);
  assert.equal(cursor.held.foreman, null);
  assert.deepEqual(cursor.held.features, {}, 'dropped, not held for ever');
  const health = JSON.parse(fs.readFileSync(healthFile(P), 'utf8'));
  assert.match(health.lastError.message, /Not A Slug couldn't be written and was dropped/);
}));

test('each loop writes health.json with the pid, the time, the shape, and the last good loop and error', () => withHome(async () => {
  const c = clock();
  await runWatcher({ project: P, config: config({ watcherShape: 2 }), observe: looker([]).observe, waker: fakeWaker(), loops: 3, now: c.now, sleep: c.sleep, log: quiet });
  const health = JSON.parse(fs.readFileSync(healthFile(P), 'utf8'));
  assert.deepEqual(health, { pid: process.pid, at: new Date(T0 + 30 * SEC).toISOString(), shape: 2, lastOk: new Date(T0 + 15 * SEC).toISOString() });

  let n = 0;
  const failing = async (args) => { n += 1; if (n === 2) throw new Error('the clone is busy'); return looker([]).observe(args); };
  await runWatcher({ project: P, config: config(), observe: failing, waker: fakeWaker(), loops: 3, now: c.now, sleep: c.sleep, log: quiet });
  const after = JSON.parse(fs.readFileSync(healthFile(P), 'utf8'));
  assert.equal(after.lastError.message, "The watcher's loop failed: the clone is busy");
  assert.equal(after.lastError.at, new Date(T0 + 45 * SEC).toISOString(), 'the second run\'s second loop');
  assert.equal(after.lastOk, new Date(T0 + 30 * SEC).toISOString(), 'written at the next loop: the last good one before it');
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
  await runWatcher({ project: P, config: config(), observe: seen.observe, waker, loops: 2, now: c.now, sleep: c.sleep, log: quiet });
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

test('a long gap while the watcher runs (a computer asleep for over a week) wakes the foreman at the next loop', () => withHome(async () => {
  const c = clock({ 2: 8 * DAY });
  const waker = fakeWaker();
  await runWatcher({ project: P, config: config(), observe: looker([]).observe, waker, loops: 4, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(waker.wakes.length, 1);
  const wake = readWake(waker.wakes[0][1]);
  assert.deepEqual(wake.events.map((e) => e.type), ['long-gap']);
  assert.equal(wake.events[0].detail.since, new Date(T0 + 15 * SEC).toISOString());
}));

test('under STOP the loop observes and records, but starts and wakes nothing until it lifts', () => withHome(async () => {
  checkout();
  const { calls, wakerOptions } = starter({ alive: () => false });
  const c = clock();
  setStop({ by: 'prompt' });
  const seen = looker([INCIDENT], { stop: true });
  await runWatcher({ project: P, config: config(), observe: seen.observe, wakerOptions, loops: 6, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(seen.calls.length, 6, 'it kept observing');
  assert.equal(calls.length, 0, 'nothing started');
  assert.ok(readCursor(P).seen.includes('ev-1'), 'and recorded');
  const waiting = JSON.parse(fs.readFileSync(outboxFile(P), 'utf8')).entries;
  assert.equal(waiting.length, 1);
  assert.deepEqual(readWake(waiting[0].file).events.map((e) => e.id), ['ev-1', 'stop:0'], 'STOP itself waits for the foreman too');

  liftStop();
  await runWatcher({ project: P, config: config(), observe: looker([]).observe, wakerOptions, loops: 1, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 2), ['-p', `Wheelhouse foreman: follow wheelhouse:foreman to handle ${copyOf(waiting[0].file)}`]);
  assert.equal(calls[0].env.WHEELHOUSE_ROLE, 'foreman');
}));

test('Shape 1 starts a foreman for a due bundle; Shape 2 prints its line', () => withHome(async () => {
  checkout();
  const { calls, wakerOptions } = starter();
  const lines = [];
  wakerOptions.print = (line) => lines.push(line);
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

test('the configuration comes from the default branch through the helper, never the working copy', () => withHome(async () => {
  const main = checkout();
  // The working copy says Shape 2 and bypass: an agent could have written it. It is never read.
  fs.mkdirSync(path.join(main, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude', 'wheelhouse.json'), JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], watcherShape: 2, sessionMode: 'bypassPermissions' }));
  const asked = [];
  const client = (answer) => ({ config: async (args) => { asked.push(args); return answer; } });
  const branch = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], watcherShape: 2, routing: { foreman: 'model-a' } };

  assert.deepEqual(await projectConfig(P, client({ ok: true, config: branch })), { config: readConfig(JSON.stringify(branch)) });
  assert.deepEqual(asked, [{ project: P }]);
  // One that reads but leaves keys out has the defaults for those.
  const bare = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
  assert.deepEqual((await projectConfig(P, client({ ok: true, config: bare }))).config, readConfig(null));
  assert.deepEqual(await projectConfig(P, client({ ok: false, refused: 'the helper is not running' })), { config: null, why: 'the helper is not running' });
  assert.equal((await projectConfig(P, client({ ok: true, config: { ...branch, sessionMode: 'bypassPermissions' } }))).config, null, 'an answer that doesn\'t read');
  assert.equal((await projectConfig(P, client({ ok: true }))).config, null);
  assert.equal((await projectConfig(P, { config: async () => { throw new Error('no socket'); } })).config, null);

  const c = clock();
  await runWatcher({ project: P, client: client({ ok: true, config: branch }), observe: looker([]).observe, waker: fakeWaker(), loops: 1, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(JSON.parse(fs.readFileSync(healthFile(P), 'utf8')).shape, 2);
  assert.equal(fs.existsSync(lockFile(P)), false);
}));

test('until the configuration is read, the watcher wakes and starts nothing, asks again each loop, and says why', () => withHome(async () => {
  checkout();
  let answer = { ok: false, refused: 'the helper is not running' };
  let asks = 0;
  const client = { config: async () => { asks += 1; return answer; } };
  const { calls, wakerOptions } = starter();
  const seen = looker();
  const c = clock();
  await runWatcher({ project: P, client, observe: seen.observe, wakerOptions, loops: 6, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(asks, 6, 'asked at every loop');
  assert.equal(seen.calls.length, 0, 'nothing observed');
  assert.equal(calls.length, 0, 'nothing started, not even by the defaults');
  assert.equal(fs.existsSync(outboxFile(P)), false, 'nothing queued');
  assert.equal(readCursor(P).prev, null, 'the cursor kept as it was');
  const health = JSON.parse(fs.readFileSync(healthFile(P), 'utf8'));
  assert.equal(health.shape, null);
  assert.match(health.lastError.message, /waiting for the project's configuration .*the helper is not running/);

  // Once it reads, the watcher goes on, and what happened meanwhile wakes the foreman.
  answer = { ok: true, config: { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], routing: { foreman: 'model-a' } } };
  await runWatcher({ project: P, client, observe: seen.observe, wakerOptions, loops: 6, now: c.now, sleep: c.sleep, log: quiet });
  assert.equal(asks, 7, 'asked once more, then kept');
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(healthFile(P), 'utf8')).shape, 1);
}));

test('the command line gives the watcher the handled ids and the foreman its tools', () => withHome(async () => {
  const options = cliOptions(P);
  assert.equal(options.project, P);
  assert.deepEqual(options.wakerOptions, { foremanTools: foremanTools() });
  assert.deepEqual(options.handled(), new Set(), 'none yet');
  recordHandled(P, ['ev-1']);
  assert.deepEqual(options.handled(), new Set(['ev-1']), 'read afresh at each call');

  // Through the loop: an incident the foreman wrote while handling a wake goes
  // to the digest, and wakes no one.
  const c = clock();
  const quietWaker = fakeWaker();
  await runWatcher({
    project: P, config: config(), observe: looker().observe, waker: quietWaker, handled: options.handled, loops: 6, now: c.now, sleep: c.sleep, log: quiet,
  });
  assert.deepEqual(quietWaker.wakes, []);
  assert.deepEqual(readCursor(P).held.digest.map((e) => [e.id, e.handled]), [['ev-1', true]]);

  // A foreman the watcher starts gets exactly the tools.
  fs.rmSync(path.dirname(healthFile(P)), { recursive: true });
  checkout();
  const { calls, wakerOptions } = starter();
  await runWatcher({
    project: P, config: config(), observe: looker().observe, wakerOptions: { ...wakerOptions, ...options.wakerOptions }, loops: 5, now: c.now, sleep: c.sleep, log: quiet,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(2), ['--permission-mode', 'acceptEdits', '--model', 'model-a', '--allowedTools', ...foremanTools()]);
}));
