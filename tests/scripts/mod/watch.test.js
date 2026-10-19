// tests/scripts/mod/watch.test.js
// Watching on the mod's timer: the front desk keeps a Shape 1 watcher running, and a Shape 2
// foreman's tick runs one watcher loop and hands back its wake lines as prompts. Starting a
// process is a stand-in that records the call, the clock is a stand-in, the helper is the
// foreman tests' stand-in, and the observation is a stand-in too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { watchTick, watchFile, SHAPE_FRESH_MS } from '../../../scripts/mod/watch.js';
import { FOREMAN_PROMPT_LEAD } from '../../../scripts/foreman/start.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { WATCH_EVERY_MS } from '../../../scripts/lib/mod-numbers.js';
import { takeStartLock } from '../../../scripts/lib/start-lock.js';
import { lockFile } from '../../../scripts/watcher/main.js';
import { withHome } from '../../helpers/homes.js';
import {
  P, T0, config, fakeClient, project, worktree,
} from '../../helpers/foreman.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SEC = 1000;

// A clock that moves only when told.
function clock(start = T0) {
  let t = start;
  return { now: () => new Date(t), move: (ms) => { t += ms; }, at: () => t };
}

// A stand-in spawn that keeps each call. The watcher it "starts" never takes its lock, so it
// counts as stopped again at the next check.
function fakeSpawn() {
  const calls = [];
  const spawn = (file, args, opts) => {
    calls.push({ file, args, opts });
    return { pid: process.pid, unref() {}, on() {} };
  };
  return { calls, spawn };
}

// The helper, counting the times it is asked for the configuration; `cfg` null refuses.
function helper(cfg) {
  const { client } = fakeClient({ cfg });
  let asked = 0;
  const config0 = client.config;
  client.config = async (...args) => { asked += 1; return config0(...args); };
  return { client, asked: () => asked, set: (next) => { client.config = async () => { asked += 1; return next === null ? { ok: false, refused: 'down' } : { ok: true, config: next }; }; } };
}

// A stand-in observation: `first` in the first, nothing after. Each call's `awake` is kept.
function looker(first) {
  const calls = [];
  const observe = async ({ now, awake }) => {
    calls.push({ awake });
    return {
      at: now().toISOString(), awake, events: calls.length === 1 ? first : [], features: {}, prs: {}, testMerges: [], stop: false, polled: {}, stateIds: [],
    };
  };
  return { observe, calls };
}

const INCIDENT = { id: 'ev-1', kind: 'incident', data: { id: 'outage', what: 'Down' } };
const BUILD = (work) => ({ id: 'ev-2', kind: 'feature', data: { work, step: 'building' } });
const quiet = () => {};

test('Shape 1: a front desk tick starts a watcher that has stopped, at most once a minute', () => withHome(async () => {
  await project();
  const h = helper(config());
  const c = clock();
  const fake = fakeSpawn();
  const tick = (role = 'front-desk') => watchTick({ project: P, role, client: h.client, now: c.now, pluginRoot: ROOT, spawn: fake.spawn, env: { PATH: '/bin', CLAUDECODE: '1' } });

  assert.deepEqual(await tick(), { watcher: 'started', submit: [] });
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].args, [path.join(ROOT, 'scripts', 'watcher', 'main.js'), P]);
  assert.deepEqual(fake.calls[0].opts.env, { PATH: '/bin' }, 'the watcher is no one\'s session');
  assert.equal(fake.calls[0].opts.detached, true);

  // Within the minute, the last check stands and nothing is asked or started.
  c.move(30 * SEC);
  assert.deepEqual(await tick(), { watcher: 'started', submit: [] });
  assert.equal(fake.calls.length, 1);
  assert.equal(h.asked(), 1);

  // A minute on, the watcher is found stopped again and started again, without waiting for a
  // session start; the shape comes from the cache, so the helper isn't asked again.
  c.move(WATCH_EVERY_MS - 30 * SEC);
  assert.deepEqual(await tick(), { watcher: 'started', submit: [] });
  assert.equal(fake.calls.length, 2);
  assert.equal(h.asked(), 1);

  // The shape and the check are kept in projects/<p>/mod/watch.json.
  assert.ok(watchFile(P).endsWith(path.join('projects', P, 'mod', 'watch.json')));
  const kept = JSON.parse(fs.readFileSync(watchFile(P), 'utf8'));
  assert.equal(kept.shape.value, 1);
  assert.equal(kept.check.watcher, 'started');
  assert.equal(kept.check.at, c.now().toISOString());

  // After ten minutes the shape is asked for again.
  c.move(SHAPE_FRESH_MS);
  await tick();
  assert.equal(h.asked(), 2);

  // A Shape 1 foreman and a feature session have nothing to watch, and start nothing.
  c.move(WATCH_EVERY_MS);
  assert.deepEqual(await tick('foreman'), { watcher: 'not-needed', submit: [] });
  assert.deepEqual(await tick('feature'), { watcher: 'not-needed', submit: [] });
  assert.equal(fake.calls.length, 3);

  // A watcher that can't be started is a failure, said in the pane, and tried again next minute.
  const failing = (file) => { throw new Error(`can't start ${file}`); };
  const broken = await watchTick({ project: P, role: 'front-desk', client: h.client, now: c.now, pluginRoot: ROOT, spawn: failing });
  assert.deepEqual(broken, { watcher: 'failed', submit: [] });
}));

test('Shape 1: a watcher running is left alone', () => withHome(async () => {
  await project();
  const h = helper(config());
  const c = clock();
  const fake = fakeSpawn();
  fs.mkdirSync(path.dirname(lockFile(P)), { recursive: true });
  fs.writeFileSync(lockFile(P), `${process.pid}\n`);
  fs.utimesSync(lockFile(P), new Date(T0), new Date(T0));
  const answer = await watchTick({ project: P, role: 'front-desk', client: h.client, now: c.now, pluginRoot: ROOT, spawn: fake.spawn });
  assert.deepEqual(answer, { watcher: 'running', submit: [] });
  assert.equal(fake.calls.length, 0);

  // The front desk of a Shape 2 project starts nothing either: its foreman's session runs the loop.
  h.set(config({ watcherShape: 2 }));
  fs.rmSync(lockFile(P));
  fs.rmSync(watchFile(P));
  assert.deepEqual(await watchTick({ project: P, role: 'front-desk', client: h.client, now: c.now, pluginRoot: ROOT, spawn: fake.spawn }), { watcher: 'not-needed', submit: [] });
  assert.equal(fake.calls.length, 0);
}));

test('Shape 2: a foreman tick runs one watcher loop and hands back its wake lines, in order', () => withHome(async () => {
  const checkout = await project();
  const dir = worktree(checkout, 'login-page');
  const h = helper(config({ watcherShape: 2 }));
  const c = clock();
  const look = looker([INCIDENT, BUILD('login-page')]);
  const fake = fakeSpawn();
  const tick = () => watchTick({
    project: P,
    role: 'foreman',
    client: h.client,
    now: c.now,
    pluginRoot: ROOT,
    spawn: fake.spawn,
    loop: { observe: look.observe, log: quiet, wakerOptions: { locate: () => dir, run: () => { throw new Error('Shape 2 starts nothing'); } } },
  });

  // The first loop finds the events; they wait for the bundling window, so nothing goes yet.
  assert.deepEqual(await tick(), { watcher: 'running', submit: [] });
  assert.equal(look.calls.length, 1);
  assert.equal(look.calls[0].awake, 0, 'no loop ran before this one');

  // The next tick's loop sends both wakes, the foreman's first, each as the foreman's prompt.
  c.move(60 * SEC);
  const second = await tick();
  assert.equal(second.watcher, 'running');
  const foremanCopy = path.join(checkout, '.wheelhouse', 'foreman', 'wakes');
  const featureCopy = path.join(featurePaths(dir).dir, 'wakes');
  assert.equal(second.submit.length, 2);
  assert.match(second.submit[0], new RegExp(`^${FOREMAN_PROMPT_LEAD} WAKE foreman `));
  assert.equal(path.dirname(second.submit[0].slice(`${FOREMAN_PROMPT_LEAD} WAKE foreman `.length)), foremanCopy);
  assert.match(second.submit[1], new RegExp(`^${FOREMAN_PROMPT_LEAD} WAKE feature login-page `));
  assert.equal(path.dirname(second.submit[1].slice(`${FOREMAN_PROMPT_LEAD} WAKE feature login-page `.length)), featureCopy);
  for (const prompt of second.submit) assert.ok(fs.existsSync(prompt.split(' ').at(-1)));
  // The awake time is the time since the last loop, capped as the watcher caps it.
  assert.equal(look.calls[1].awake, 30 * SEC);

  // Each tick is one loop: the lock is given back, and a wake goes once.
  assert.equal(fs.existsSync(lockFile(P)), false);
  c.move(30 * SEC);
  assert.deepEqual(await tick(), { watcher: 'running', submit: [] });
  assert.equal(look.calls.length, 3);
  assert.equal(fake.calls.length, 0, 'no watcher process is started for Shape 2');
}));

test('Shape 2: a second foreman session\'s tick finds the lock taken and runs nothing', () => withHome(async () => {
  await project();
  const h = helper(config({ watcherShape: 2 }));
  const look = looker([INCIDENT]);
  // Another session's loop, or a monitor left over, holds the watcher's lock.
  const release = await takeStartLock(lockFile(P), { message: 'held', waitMs: 0 });
  try {
    const answer = await watchTick({ project: P, role: 'foreman', client: h.client, now: clock().now, loop: { observe: look.observe, log: quiet } });
    assert.deepEqual(answer, { watcher: 'running', submit: [] });
    assert.equal(look.calls.length, 0, 'it observes nothing');
    assert.equal(fs.readFileSync(lockFile(P), 'utf8'), `${process.pid}\n`, 'the lock is left as it was');
  } finally {
    release();
  }
}));

test('Shape 2: the waker stays Shape 2\'s while the shape is cached, and the configuration is asked for once a tick', () => withHome(async () => {
  const checkout = await project();
  const h = helper(config({ watcherShape: 2 }));
  const c = clock();
  const look = looker([INCIDENT]);
  const fake = fakeSpawn();
  const tick = () => watchTick({
    project: P,
    role: 'foreman',
    client: h.client,
    now: c.now,
    pluginRoot: ROOT,
    spawn: fake.spawn,
    loop: { observe: look.observe, log: quiet, wakerOptions: { run: () => { throw new Error('the bridge starts no session'); } } },
  });

  // The configuration read for the shape is the loop's: it isn't asked for twice.
  await tick();
  assert.equal(h.asked(), 1);

  // The default branch now says Shape 1, within the ten minutes the shape is kept: the loop's own
  // read of the configuration doesn't turn its waker into one that starts sessions.
  h.set(config());
  c.move(60 * SEC);
  const second = await tick();
  assert.equal(h.asked(), 2);
  assert.equal(second.submit.length, 1);
  assert.equal(path.dirname(second.submit[0].slice(`${FOREMAN_PROMPT_LEAD} WAKE foreman `.length)), path.join(checkout, '.wheelhouse', 'foreman', 'wakes'));
  assert.equal(fake.calls.length, 0);
}));

test('Shape 2: lines printed by a loop cut off at the bridge\'s limit are handed back at the next tick', () => withHome(async () => {
  await project();
  const h = helper(config({ watcherShape: 2 }));
  const c = clock();
  const seen = [];
  // A stand-in for the watcher's loop: prints `lines`, then answers as `ends` says.
  const runner = (lines, ends) => async (args) => {
    seen.push(args);
    for (const line of lines) args.wakerOptions.print(line);
    if (ends === 'never') return new Promise(() => {});
    return { started: ends === 'ran', loops: 1 };
  };
  const tick = (runWatcher) => watchTick({ project: P, role: 'foreman', client: h.client, now: c.now, loop: { runWatcher } });
  const lead = (line) => `${FOREMAN_PROMPT_LEAD} ${line}`;

  // The bridge's limit comes before the loop returns: the answer never goes.
  const late = new Promise((resolve) => { setTimeout(() => resolve('late'), 50); });
  assert.equal(await Promise.race([tick(runner(['WAKE foreman /w/a.json', 'WAKE feature login-page /w/b.json'], 'never')), late]), 'late');
  assert.equal(seen[0].config.watcherShape, 2, 'the configuration read on this tick is passed');
  assert.equal(seen[0].wakerOptions.shape, 2);

  // A tick whose loop finds the lock taken leaves them for the loop that runs.
  c.move(30 * SEC);
  assert.deepEqual(await tick(runner([], 'locked')), { watcher: 'running', submit: [] });

  // The next loop that runs hands them back first, then its own.
  c.move(30 * SEC);
  assert.deepEqual(await tick(runner(['WAKE foreman /w/c.json'], 'ran')), {
    watcher: 'running',
    submit: [lead('WAKE foreman /w/a.json'), lead('WAKE feature login-page /w/b.json'), lead('WAKE foreman /w/c.json')],
  });
  assert.equal(seen[2].config, null, 'a cached shape leaves the loop to read the configuration');
  // Once in an answer, they aren't handed back again.
  c.move(30 * SEC);
  assert.deepEqual(await tick(runner([], 'ran')), { watcher: 'running', submit: [] });
  assert.deepEqual(JSON.parse(fs.readFileSync(watchFile(P), 'utf8')).unsent, []);
}));

test('nothing starts before the default branch\'s configuration has been read', () => withHome(async () => {
  await project();
  const h = helper(null);
  const c = clock();
  const fake = fakeSpawn();
  const look = looker([INCIDENT]);
  const tick = (role) => watchTick({ project: P, role, client: h.client, now: c.now, pluginRoot: ROOT, spawn: fake.spawn, loop: { observe: look.observe, log: quiet } });

  // Not read yet: no watcher is started, no loop is run, and the answer names nothing.
  assert.deepEqual(await tick('front-desk'), { watcher: null, submit: [] });
  assert.deepEqual(await tick('foreman'), { watcher: null, submit: [] });
  assert.equal(fake.calls.length, 0);
  assert.equal(look.calls.length, 0);
  assert.equal(fs.existsSync(lockFile(P)), false);
  // Each tick asks again; no shape is kept from a refusal.
  assert.equal(h.asked(), 2);
  c.move(WATCH_EVERY_MS);
  await tick('front-desk');
  assert.equal(h.asked(), 3);
  assert.equal(fake.calls.length, 0);

  // Once read, the shape counts; a helper that goes down afterwards keeps the last shape read,
  // and it is asked again at each tick until it answers.
  h.set(config());
  c.move(WATCH_EVERY_MS);
  assert.equal((await tick('front-desk')).watcher, 'started');
  h.set(null);
  c.move(SHAPE_FRESH_MS + WATCH_EVERY_MS);
  assert.equal((await tick('front-desk')).watcher, 'started');
  assert.equal(fake.calls.length, 2);
}));
