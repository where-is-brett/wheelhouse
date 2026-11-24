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
import { P, T0, config as projectConfig, project } from '../../helpers/foreman.js';

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
