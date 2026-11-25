// tests/scripts/watcher/waker-route.test.js
// The waker follows the builders' route (builders and settings design, sections 7.2, 9.3 and 11): on desktop it queues and
// starts nothing, on background it starts as it always has, and a change takes effect within one tick.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWaker, writeWake, ROUTE_GRACE_MS } from '../../../scripts/watcher/waker.js';
import { takeWakes } from '../../../scripts/watcher/desktop-queue.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { withHome } from '../../helpers/homes.js';
import { standInTools } from '../../helpers/host-stand-ins.js';
import fs from 'node:fs';
import { P, T0, config as projectConfig, project, worktree } from '../../helpers/foreman.js';
import { writeBaseline } from '../../../scripts/watcher/control-files.js';
import path from 'node:path';
import { holdFile } from '../../../scripts/crew/hold.js';
import { sessionFile } from '../../../scripts/watcher/waker.js';

const hostStandIns = standInTools();
after(() => hostStandIns.restore());

const foremanWake = () => writeWake(P, { to: 'foreman', events: [{ type: 'incident', id: 'e1', detail: {} }], digest: [], dropped: 0 }, { now: () => new Date(T0) });

function setUp(first, extra = {}) {
  const state = { route: first, at: T0, calls: [], killed: [] };
  const call = () => ({ file: 'agent', args: [], input: '', verbatim: false, env: {} });
  const sessions = {
    routes: ['desktop', 'background'],
    checkForeman: () => {}, checkFeature: () => {},
    foremanCall: call, featureStartCall: call, featureResumeCall: call, finalAnswer: () => null,
  };
  const w = makeWaker({
    shape: 1, project: P, config: readConfig(JSON.stringify(projectConfig({}))),
    run: (file, args, options) => { state.calls.push({ file, args, ...options }); return { pid: 4242 }; },
    alive: () => true, startTimeOf: async () => 'same-start', kill: (pid) => state.killed.push(pid),
    now: () => new Date(state.at), bootedAt: () => 0, baseEnv: { PATH: '/bin' }, print: () => {}, sessions, launchWords: () => null, ...extra,
    route: () => (state.route === null ? { route: null, from: 'unset' } : state.route === 'fault' ? { route: null, from: 'fault', signIn: { open: false, reason: "not started: builders can't sign in: the builders setting is damaged" } } : { route: state.route, from: 'profile', signIn: { open: true } }),
  });
  return { w, state };
}

test('on desktop the waker queues and starts nothing; on background it starts as now', () => withHome(async () => {
  await project();
  const desktop = setUp('desktop');
  await desktop.w.wakeForeman(foremanWake());
  assert.equal(desktop.state.calls.length, 0, 'nothing was started');
  assert.equal(desktop.w.waiting().length, 0, 'the wake left the outbox');
  assert.deepEqual(takeWakes(P).map((x) => x.kind), ['foreman']);
}));

test('on background the same wake starts a detached session', () => withHome(async () => {
  await project();
  const background = setUp('background');
  await background.w.wakeForeman(foremanWake());
  assert.equal(background.state.calls.length, 1);
  assert.deepEqual(takeWakes(P), []);
}));

test('no route chosen starts as it always has', () => withHome(async () => {
  await project();
  const none = setUp(null);
  await none.w.wakeForeman(foremanWake());
  assert.equal(none.state.calls.length, 1);
}));

test('a route setting that is damaged starts nothing, keeps the wake, and says why', () => withHome(async () => {
  await project();
  const errors = [];
  const { w } = setUp('fault', { onError: (m) => errors.push(m) });
  await w.wakeForeman(foremanWake());
  assert.equal(w.waiting().length, 1);
  assert.deepEqual(takeWakes(P), []);
  assert.match(errors[0], /builders setting is damaged/);
}));

test('a route change takes effect within one tick, and a detached session still running 30 minutes after a change to desktop is ended', () => withHome(async () => {
  await project();
  const { w, state } = setUp('background');
  await w.wakeForeman(foremanWake());
  assert.equal(state.calls.length, 1, 'started detached on background');
  // The route changes: the very next pass starts nothing and ends nothing yet.
  state.route = 'desktop';
  state.at = T0 + 60 * 1000;
  await w.pump();
  assert.deepEqual(state.killed, []);
  assert.equal(state.calls.length, 1);
  // Just before the grace ends, still running; after it, ended by the watcher and its wake goes to the Desktop queue.
  state.at = T0 + 60 * 1000 + ROUTE_GRACE_MS - 1000;
  await w.pump();
  assert.deepEqual(state.killed, []);
  state.at = T0 + 60 * 1000 + ROUTE_GRACE_MS + 1000;
  await w.pump();
  assert.deepEqual(state.killed, [4242]);
  assert.equal(state.calls.length, 1, 'nothing new was started');
  assert.deepEqual(takeWakes(P).map((x) => x.kind), ['foreman']);
}));

test('a change to background starts the queued wakes detached', () => withHome(async () => {
  await project();
  const { w, state } = setUp('desktop');
  await w.wakeForeman(foremanWake());
  assert.equal(state.calls.length, 0);
  assert.equal(takeWakes(P).length, 1);
  state.route = 'background';
  state.at = T0 + 1000;
  await w.pump();
  assert.equal(state.calls.length, 1, 'started detached');
  assert.deepEqual(takeWakes(P), [], 'the queue is empty');
}));

// The grace has passed since builders moved to Desktop: the next pass may end what still runs.
async function pastGrace(w, state) {
  state.route = 'desktop';
  state.at += 60 * 1000;
  await w.pump();
  state.at += ROUTE_GRACE_MS + 1000;
  await w.pump();
}

test('after the grace, a session whose start time can\'t be read is left running, its record and wake kept', () => withHome(async () => {
  await project();
  const notes = [];
  let started = false;
  const { w, state } = setUp('background', { startTimeOf: async () => (started ? null : 'same-start'), onNote: (m) => notes.push(m) });
  await w.wakeForeman(foremanWake());
  started = true;
  await pastGrace(w, state);
  assert.deepEqual(state.killed, [], 'a pid whose identity can\'t be confirmed is never signalled');
  assert.deepEqual(takeWakes(P), [], 'its wake was not sent again');
  assert.equal(w.waiting().length, 1, 'its wake is still the running session\'s');
  assert.ok(notes.some((m) => /couldn't be confirmed/.test(m)), notes.join('\n'));
}));

test('after the grace, a session whose end can\'t be signalled keeps its record and wake', () => withHome(async () => {
  await project();
  const { w, state } = setUp('background', { kill: (pid) => { state.killed.push(pid); return false; } });
  await w.wakeForeman(foremanWake());
  await pastGrace(w, state);
  assert.deepEqual(state.killed, [4242]);
  assert.deepEqual(takeWakes(P), [], 'nothing was sent again while the session may still run');
  assert.equal(w.waiting().length, 1);
}));

test('the wakes of a session the route ended are sent again, and not counted as failed when it exits', () => withHome(async () => {
  await project();
  let exit;
  const { w, state } = setUp('background', {
    run: (file, args, options) => { state.calls.push({ file, args, ...options }); return { pid: 4242, exited: new Promise((resolve) => { exit = resolve; }) }; },
  });
  await w.wakeForeman(foremanWake());
  await pastGrace(w, state);
  assert.deepEqual(state.killed, [4242]);
  exit(143);
  await w.pump();
  assert.deepEqual(takeWakes(P).map((x) => x.kind), ['foreman'], 'queued for Desktop once');
  assert.ok(w.waiting().every((e) => !Number.isInteger(e.failures)), JSON.stringify(w.waiting()));
}));

test('a feature at the director\'s helm is never ended by the route', () => withHome(async () => {
  const checkout = await project();
  const dir = worktree(checkout, 'login-page');
  writeBaseline(P, 'login-page', dir);
  const { w, state } = setUp('background', { locate: () => dir });
  await w.startFeature({ work: 'login-page', worktree: dir });
  assert.equal(state.calls.length, 1);
  // The director took the helm (a hold file of the piece's own; its run moving to the helm is the helm's work, not this test's).
  fs.mkdirSync(path.dirname(holdFile(P, 'login-page')), { recursive: true });
  fs.writeFileSync(holdFile(P, 'login-page'), '{}\n');
  await pastGrace(w, state);
  assert.deepEqual(state.killed, []);
}));

test('a wake already back in the outbox is not added again when builders move to the background', () => withHome(async () => {
  await project();
  const { w, state } = setUp('desktop');
  const file = foremanWake();
  await w.wakeForeman(file);
  assert.equal(takeWakes(P).length, 1);
  // The same wake is in the outbox again (a pass cut short after it queued it), held while the route can't be read.
  state.route = 'fault';
  await w.wakeForeman(file);
  assert.equal(w.waiting().length, 1);
  const { w: again } = setUp('background', { run: () => { throw new Error('no start'); } });
  await again.pump();
  assert.deepEqual(takeWakes(P), [], 'the queued copy was dropped');
  assert.equal(again.waiting().length, 1, 'one entry, not two');
  assert.equal(again.waiting()[0].file, file);
}));

test('a builder start queued for Desktop is started on the background when builders move there', () => withHome(async () => {
  const checkout = await project();
  const dir = worktree(checkout, 'login-page');
  writeBaseline(P, 'login-page', dir);
  const { w, state } = setUp('desktop', { locate: () => dir });
  const queued = await w.startFeature({ work: 'login-page', worktree: dir });
  assert.equal(queued.queued, true);
  assert.deepEqual(takeWakes(P).map((x) => x.kind), ['feature-start']);
  state.route = 'background';
  state.at += 1000;
  await w.pump();
  assert.equal(state.calls.length, 1, 'started detached');
  assert.equal(state.calls[0].cwd, dir);
  assert.deepEqual(takeWakes(P), []);
  assert.ok(fs.existsSync(sessionFile(P, 'login-page')), 'its session id is kept, so its wakes resume it');
}));

test('a queued builder start waits while All stop is on', () => withHome(async () => {
  const checkout = await project();
  const dir = worktree(checkout, 'login-page');
  writeBaseline(P, 'login-page', dir);
  let stop = false;
  const { w, state } = setUp('desktop', { locate: () => dir, stopped: () => stop });
  await w.startFeature({ work: 'login-page', worktree: dir });
  stop = true;
  state.route = 'background';
  await w.pump();
  assert.equal(state.calls.length, 0);
  assert.equal(takeWakes(P).length, 1, 'still queued');
}));

test('a resume on desktop waits while the files that steer agents in its folder are new or changed', () => withHome(async () => {
  const checkout = await project();
  const dir = worktree(checkout, 'login-page');
  writeBaseline(P, 'login-page', dir);
  fs.mkdirSync(path.dirname(sessionFile(P, 'login-page')), { recursive: true });
  fs.writeFileSync(sessionFile(P, 'login-page'), `${JSON.stringify({ sessionId: '11111111-2222-4333-8444-555555555555', worktree: dir, at: new Date(T0).toISOString() })}\n`);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Planted.\n');
  const { w } = setUp('desktop', { locate: () => dir, raise: async () => {} });
  await assert.rejects(w.resumeFeature({ work: 'login-page', prompt: 'Carry on.' }), /steer agents/);
  assert.deepEqual(takeWakes(P), []);
}));

// --- A take by the foreman racing the move back to the background ---

test('the watcher ticks while the foreman holds a claim, and the route has changed: the wake is handled once, never lost', () => withHome(async () => {
  await project();
  const { takeWakes: foremanTakes, finishTaken } = await import('../../../scripts/foreman/wait-wake.js');
  const { w, state } = setUp('desktop');
  await w.wakeForeman(foremanWake());
  assert.equal(takeWakes(P).length, 1);
  // The foreman has claimed the wake when the route changes: its own check runs the watcher's tick in between.
  const route = async () => {
    state.route = 'background';
    state.at = T0 + 1000;
    await w.pump();
    assert.equal(state.calls.length, 0, 'the watcher did not run a wake the foreman holds');
    return { route: 'background' };
  };
  const got = await foremanTakes(P, { sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', route, stop: () => ({ on: false }), now: () => new Date(T0) });
  assert.deepEqual(got.lines, ['route changed'], 'the foreman gave it back');
  assert.equal(takeWakes(P).length, 1, 'back in the queue');
  state.at = T0 + 2000;
  await w.pump();
  assert.equal(state.calls.length, 1, 'then the watcher ran it, once');
  assert.deepEqual(takeWakes(P), []);
  assert.equal(await finishTaken(P), 0, 'nothing is left for the foreman to run');
}));

test('a wake the foreman took and kept is not run again by the watcher after the route changes', () => withHome(async () => {
  await project();
  const { takeWakes: foremanTakes, finishTaken } = await import('../../../scripts/foreman/wait-wake.js');
  const { w, state } = setUp('desktop');
  await w.wakeForeman(foremanWake());
  const got = await foremanTakes(P, { sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', route: () => ({ route: 'desktop' }), stop: () => ({ on: false }), now: () => new Date(T0) });
  assert.deepEqual(got.lines, ['WAKE foreman - -']);
  state.route = 'background';
  state.at = T0 + 1000;
  await w.pump();
  await w.pump();
  assert.equal(state.calls.length, 0, 'the foreman has it');
  assert.equal(await finishTaken(P), 1);
  assert.deepEqual(takeWakes(P), []);
}));

test('the watcher moves a wake first and the foreman then finds none: the wake runs once', () => withHome(async () => {
  await project();
  const { takeWakes: foremanTakes } = await import('../../../scripts/foreman/wait-wake.js');
  const { w, state } = setUp('desktop');
  await w.wakeForeman(foremanWake());
  state.route = 'background';
  state.at = T0 + 1000;
  await w.pump();
  assert.equal(state.calls.length, 1);
  const got = await foremanTakes(P, { sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', route: () => ({ route: 'desktop' }), stop: () => ({ on: false }), now: () => new Date(T0) });
  assert.deepEqual(got.lines, []);
  assert.equal(state.calls.length, 1);
}));
