// tests/scripts/foreman/wait-wake.test.js
// What the Desktop foreman keeps running in the background (builders and settings design, sections 7.2, 11 and 12A.6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { waitForWake, takeWakes as takeForForeman, finishTaken, main, WAIT_MAX_MS, HEARTBEAT_MS } from '../../../scripts/foreman/wait-wake.js';
import { checkInAge, checkIn } from '../../../scripts/foreman/check-in.js';
import { queueWake, takeWakes } from '../../../scripts/watcher/desktop-queue.js';
import { writeWake } from '../../../scripts/watcher/waker.js';
import { holdFile } from '../../../scripts/crew/hold.js';
import { withHome } from '../../helpers/homes.js';
import { P, T0, project } from '../../helpers/foreman.js';

const S = 'aaaaaaaa-1111-2222-3333-444444444444';
const bundle = (work) => writeWake(P, work === undefined ? { to: 'foreman', events: [], digest: [], dropped: 0 } : { to: 'feature', work, events: [], digest: [], dropped: 0 }, { now: () => new Date(T0) });

// A clock the waiting advances by sleeping, and what to do at each second.
function clock(plan = {}) {
  const c = { ms: T0, beats: 0, now: () => new Date(c.ms) };
  c.sleep = async (ms) => {
    c.ms += ms;
    const s = Math.round((c.ms - T0) / 1000);
    for (const [at, fn] of Object.entries(plan)) if (Number(at) <= s && !fn.done) { fn.done = true; fn.run(); }
  };
  return c;
}
const act = (run) => ({ run });
const desktop = () => ({ route: 'desktop' });
const calm = () => ({ on: false });
const wait = (c, over = {}) => waitForWake(P, { sessionId: S, now: c.now, sleep: c.sleep, route: desktop, stop: calm, poll: 2000, ...over });

test('it exits at once when a wake is queued, printing how many', () => withHome(async () => {
  await project();
  queueWake(P, { kind: 'foreman', file: bundle(), now: () => new Date(T0) });
  queueWake(P, { kind: 'feature-wake', work: 'alpha', file: bundle('alpha'), now: () => new Date(T0) });
  const c = clock();
  assert.deepEqual(await wait(c), { exit: 'wakes', text: 'wakes: 2' });
  assert.equal(c.ms, T0, 'no waiting first');
}));

test('with no wake it heartbeats every 60 seconds and exits "no wake" after 50 minutes', () => withHome(async () => {
  await project();
  const ages = [];
  const c = clock();
  const sleep = c.sleep;
  c.sleep = async (ms) => {
    await sleep(ms);
    if (Math.round((c.ms - T0) / 1000) % 60 === 0) ages.push(checkInAge(P, { now: c.now }));
  };
  const got = await wait(c, { poll: 10000 });
  assert.deepEqual(got, { exit: 'no wake', text: 'no wake' });
  assert.equal(HEARTBEAT_MS, 60000);
  assert.equal(WAIT_MAX_MS, 50 * 60 * 1000);
  assert.ok(c.ms - T0 >= WAIT_MAX_MS && c.ms - T0 < WAIT_MAX_MS + 10000);
  assert.ok(ages.length >= 49 && ages.every((a) => a <= HEARTBEAT_MS), `check-in never older than a beat: ${ages.slice(0, 3)}`);
}));

test('a wake queued while it waits ends the wait on the next poll', () => withHome(async () => {
  await project();
  const c = clock({ 30: act(() => queueWake(P, { kind: 'feature-wake', work: 'alpha', file: bundle('alpha'), now: c.now })) });
  const got = await wait(c);
  assert.equal(got.exit, 'wakes');
  assert.ok(c.ms - T0 <= 32000);
}));

test('it exits with "route changed" when the route becomes background, at the next heartbeat, and gives up its check-in', () => withHome(async () => {
  await project();
  let route = 'desktop';
  const c = clock({ 100: act(() => { route = 'background'; }) });
  const got = await wait(c, { route: () => ({ route }), poll: 10000 });
  assert.deepEqual(got, { exit: 'route changed', text: 'route changed' });
  assert.ok(c.ms - T0 <= 100000 + HEARTBEAT_MS);
  assert.equal(checkInAge(P, { now: c.now }), null);
}));

test('no route chosen, or a damaged route setting, is not desktop: it exits "route changed"', () => withHome(async () => {
  await project();
  for (const got of [{ route: null, from: 'unset' }, { route: null, from: 'fault' }]) {
    const out = await wait(clock(), { route: () => got });
    assert.equal(out.exit, 'route changed');
  }
}));

test('under STOP it exits "all stop" at once, and a wake waiting does not change that', () => withHome(async () => {
  await project();
  queueWake(P, { kind: 'foreman', file: bundle(), now: () => new Date(T0) });
  const out = await wait(clock(), { stop: () => ({ on: true }) });
  assert.deepEqual(out, { exit: 'all stop', text: 'all stop' });
  assert.equal(takeWakes(P).length, 1, 'the wake is still queued for when it is lifted');
}));

test('a second foreman for the project exits at once and leaves the first check-in alone (review focus 4)', () => withHome(async () => {
  await project();
  checkIn(P, { sessionId: 'bbbbbbbb-1111-2222-3333-444444444444', now: () => new Date(T0) });
  const out = await wait(clock());
  assert.equal(out.exit, 'another foreman');
  assert.equal(checkInAge(P, { now: () => new Date(T0) }), 0);
}));

test('a foreman that lost its check-in to another session ends at its next heartbeat', () => withHome(async () => {
  await project();
  const c = clock({ 90: act(() => { checkIn(P, { sessionId: 'cccccccc-1111-2222-3333-444444444444', now: () => new Date(T0 + 400 * 1000) }); }) });
  // The other session checked in "later", so this one's beat at 120 s finds it held by another.
  const out = await wait(c, { poll: 10000 });
  assert.equal(out.exit, 'another foreman');
}));

test('taking wakes runs the checks again: under STOP or a changed route they are given back, none lost', () => withHome(async () => {
  await project();
  queueWake(P, { kind: 'feature-wake', work: 'alpha', file: bundle('alpha'), now: () => new Date(T0) });
  const stopped = await takeForForeman(P, { sessionId: S, route: desktop, stop: () => ({ on: true }), now: () => new Date(T0) });
  assert.deepEqual(stopped.lines, ['all stop']);
  assert.equal(takeWakes(P).length, 1);
  const moved = await takeForForeman(P, { sessionId: S, route: () => ({ route: 'background' }), stop: calm, now: () => new Date(T0) });
  assert.deepEqual(moved.lines, ['route changed']);
  assert.equal(takeWakes(P).length, 1);
}));

test('taking wakes prints one line each, drops a wake for a piece at the director\'s helm, and finish drops what was taken', () => withHome(async () => {
  await project();
  fs.mkdirSync(holdFile(P, 'beta').replace(/[^/\\]+$/, ''), { recursive: true });
  fs.writeFileSync(holdFile(P, 'beta'), '{}\n');
  queueWake(P, { kind: 'feature-wake', work: 'alpha', file: bundle('alpha'), sessionId: '0f0e0d0c-aaaa-bbbb-cccc-111122223333', now: () => new Date(T0) });
  queueWake(P, { kind: 'feature-wake', work: 'beta', file: bundle('beta'), now: () => new Date(T0 + 1) });
  queueWake(P, { kind: 'feature-start', work: 'gamma', file: bundle('gamma'), now: () => new Date(T0 + 2) });
  queueWake(P, { kind: 'foreman', file: bundle(), now: () => new Date(T0 + 3) });
  const got = await takeForForeman(P, { sessionId: S, route: desktop, stop: calm, now: () => new Date(T0 + 5) });
  assert.deepEqual(got.lines, [
    'WAKE feature-wake alpha 0f0e0d0c-aaaa-bbbb-cccc-111122223333',
    'held beta',
    'WAKE feature-start gamma -',
    'WAKE foreman - -',
  ]);
  assert.equal(takeWakes(P).length, 0);
  assert.equal(await finishTaken(P), 3);
  assert.equal(await finishTaken(P), 0);
}));

test('the command line: --take and --finish, a project name that is not one is refused, and no free text is printed', () => withHome(async () => {
  await project();
  queueWake(P, { kind: 'feature-wake', work: 'alpha', file: bundle('alpha'), now: () => new Date(T0) });
  let out = '';
  assert.equal(await main(['--project', P, '--session', S, '--take'], { out: (t) => { out += t; }, route: desktop, stop: calm }), 0);
  assert.equal(out, 'WAKE feature-wake alpha -\n');
  out = '';
  assert.equal(await main(['--project', P, '--finish'], { out: (t) => { out += t; } }), 0);
  assert.equal(out, 'finished: 1\n');
  let err = '';
  assert.equal(await main(['--project', '../x', '--session', S], { err: (t) => { err += t; } }), 1);
  assert.match(err, /project/);
  assert.equal(await main(['--project', P, '--session', 'a b'], { err: () => {} }), 1);
}));
