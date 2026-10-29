// tests/scripts/engine/routes-reproduction.test.js
// The bug lane's reproduction routes (Archon design, sections 7.2 and 11): the helper keeps a bug's reproduction once
// for its work, from the engine's own record of the reproduce and red steps, never from a file; and from then on the
// run's work order carries it among its done checks, while the order the helper stored stays as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { ticketedRoutes } from '../../helpers/engine-tickets.js';
import { tempFolder } from '../../helpers/homes.js';

const COMMIT = '6363636a2b3c4d5e6f708192a3b4c5d6e7f80912';
const CHECK = { test: 'formats 65 seconds as 1:05' };
const REPRODUCE = JSON.stringify({ summary: 'Reproduced.', blocked: false, assumptions: [], test: CHECK.test, files: ['test/duration.test.js'] });
const RED = JSON.stringify({ red: true, commit: COMMIT, check: CHECK, line: 'red' });
const bugOrder = (lane = 'bug') => workOrder({
  work: { id: 'video-length', lane, goal: 'A 65-second clip shows as 1:5 on its card', done: [{ command: 'npm test', expect: 0 }] },
  config: { testCommand: 'npm test --' },
});

function setup(given = { reproduce: REPRODUCE, red: RED }) {
  const dir = tempFolder('wh-repro-route-');
  const writes = [];
  const outputs = { ...given };
  let n = 0;
  const engine = {
    name: 'archon',
    artefactsOf: (runId) => path.join(dir, 'art', runId),
    start: async () => { n += 1; return { ok: true, runId: `run-${n}`, branch: 'wh/video-length' }; },
    outputs: async () => ({ ...outputs }),
  };
  const made = engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
    engineFor: () => engine,
    ordersDir: () => path.join(dir, 'orders'),
    filesDir: () => path.join(dir, 'engine'),
    write: async (project, kind, data) => { writes.push({ kind, data }); },
    now: () => new Date('2026-10-30T12:00:00.000Z'),
  });
  const { routes } = ticketedRoutes(made, engine, 'acme/web');
  const start = (order = bugOrder()) => routes['/engine/start']({ project: 'p', order });
  return { routes, writes, outputs, start, orderFile: (runId) => path.join(dir, 'orders', `${runId}.json`) };
}
const kept = (t) => t.writes.filter((w) => w.kind === 'reproduced');

test('the reproduction is kept once, from the engine\'s record, and the order carries it from then on', async () => {
  const t = setup();
  await t.start();
  const stored = fs.readFileSync(t.orderFile('run-1'), 'utf8');
  assert.deepEqual(await t.routes['/engine/reproduction/find']({ runId: 'run-1' }), { ok: true, kept: null, given: { check: CHECK, files: ['test/duration.test.js'] } });
  assert.deepEqual((await t.routes['/engine/order']({ runId: 'run-1' })).order.done, [{ command: 'npm test', expect: 0 }]);

  assert.deepEqual(await t.routes['/engine/reproduction']({ runId: 'run-1' }), { ok: true, check: CHECK, commit: COMMIT });
  assert.deepEqual(kept(t).map((w) => w.data), [{ work: 'video-length', runId: 'run-1', commit: COMMIT, check: CHECK, files: ['test/duration.test.js'] }]);
  assert.deepEqual((await t.routes['/engine/order']({ runId: 'run-1' })).order.done, [{ command: 'npm test', expect: 0 }, CHECK]);
  assert.equal(fs.readFileSync(t.orderFile('run-1'), 'utf8'), stored, 'the stored order never changes');
  assert.deepEqual((await t.routes['/engine/reproduction/find']({ runId: 'run-1' })).kept, { check: CHECK, files: ['test/duration.test.js'], commit: COMMIT });
});

test('a later run of the same work gets the first reproduction back, and nothing is kept twice', async () => {
  const t = setup();
  await t.start();
  await t.routes['/engine/reproduction']({ runId: 'run-1' });
  await t.start();
  t.outputs.reproduce = REPRODUCE.replace(CHECK.test, 'another test');
  t.outputs.red = JSON.stringify({ red: true, commit: 'f'.repeat(40), check: { test: 'another test' } });
  assert.deepEqual(await t.routes['/engine/reproduction']({ runId: 'run-2' }), { ok: true, check: CHECK, commit: COMMIT });
  assert.equal(kept(t).length, 1);
  assert.deepEqual((await t.routes['/engine/order']({ runId: 'run-2' })).order.done.at(-1), CHECK);
});

test('no reproduction is kept without a red step that proved this very check red', async () => {
  for (const [why, given] of [
    ['no red step', { reproduce: REPRODUCE }],
    ['red said no', { reproduce: REPRODUCE, red: JSON.stringify({ red: false, commit: COMMIT, check: CHECK }) }],
    ['red of another check', { reproduce: REPRODUCE, red: JSON.stringify({ red: true, commit: COMMIT, check: { test: 'x' } }) }],
    ['red with no commit', { reproduce: REPRODUCE, red: JSON.stringify({ red: true, commit: 'HEAD', check: CHECK }) }],
    ['no reproduction', { red: RED }],
    ['a blocked reproduce step', { reproduce: JSON.stringify({ summary: 's', blocked: true, assumptions: [], test: CHECK.test, files: ['test/d.test.js'] }), red: RED }],
  ]) {
    const t = setup(given);
    await t.start();
    const got = await t.routes['/engine/reproduction']({ runId: 'run-1' });
    assert.equal(got.ok, false, why);
    assert.equal(kept(t).length, 0, why);
    assert.equal((await t.routes['/engine/order']({ runId: 'run-1' })).order.done.length, 1, why);
  }
});

test('only a bug run keeps a reproduction, and only with its ticket', async () => {
  const t = setup();
  await t.start(bugOrder('quick'));
  assert.equal((await t.routes['/engine/reproduction']({ runId: 'run-1' })).ok, false);
  const plain = setup();
  await plain.start();
  const { routes } = plain;
  assert.equal((await routes['/engine/reproduction']({ runId: 'nobody' })).ok, false);
});
