// tests/scripts/engine/routes-task-holds.test.js
// A slice's held task reviews (Archon design, section 7.2): the helper keeps what each run's task reviews last said,
// from the engine's record, so a hold outlives a run cancelled before its close, and the next run's close reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { TICKET_FILE } from '../../../scripts/engine/ticket.js';
import { tempFolder } from '../../helpers/homes.js';

const HELD = JSON.stringify({ verdict: 'FINDINGS', findings: [{ severity: 'HIGH', file: 'a.js', repro: 'x', fix: 'y' }], summary: 's', blocked: false, assumptions: [] });
const CLEAN = JSON.stringify({ verdict: 'CLEAN', findings: [], summary: 's', blocked: false, assumptions: [] });
const BLOCKED = JSON.stringify({ verdict: 'FINDINGS', findings: [], summary: 's', blocked: true, question: 'Which?', assumptions: [] });

function setup() {
  const dir = tempFolder('wh-holds-route-');
  // What the engine's record says of each run: its task reviews, or null for a run it no longer has.
  const reviews = {};
  const asked = [];
  let runs = 0;
  const engine = {
    name: 'archon',
    artefactsOf: (runId) => path.join(dir, 'art', runId),
    start: async () => { runs += 1; return { ok: true, runId: `run-${runs}`, branch: 'wh/card-1' }; },
    act: async () => ({ ok: true }),
    taskReviews: async (runId) => { asked.push(runId); return reviews[runId] ?? null; },
  };
  const made = engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
    engineFor: () => engine,
    ordersDir: () => path.join(dir, 'orders'),
    filesDir: () => path.join(dir, 'engine'),
    write: async () => {},
  });
  const ticket = (runId) => fs.readFileSync(path.join(dir, 'art', runId, TICKET_FILE), 'utf8').trim();
  const holds = (runId, over = {}) => made.routes['/engine/task-holds']({ runId, ticket: ticket(runId), ...over });
  return { made, reviews, asked, holds, verdicts: () => path.join(dir, 'engine', 'verdicts.json') };
}
const orderOf = (lane = 'slice', slice = 1) => ({
  ...workOrder({ work: { id: 'card-1', lane, goal: 'Prices show two decimals', done: [{ command: 'node --test', expect: 0 }] }, config: { testCommand: 'node --test' } }),
  ...(lane === 'slice' ? { slice: { n: slice, of: 2, title: `Slice ${slice}` } } : {}),
});
const start = async (t, order = orderOf()) => (await t.made.start({ project: 'p', order })).runId;

test('a hold from a run cancelled before its close reaches the next run\'s close, even once the engine has forgotten that run', async () => {
  const t = setup();
  const first = await start(t);
  t.reviews[first] = { 1: CLEAN, 2: HELD };
  assert.equal(await t.made.keepTaskReviews('p', first), true, 'kept when the run ended');
  delete t.reviews[first];
  const next = await start(t);
  t.reviews[next] = {};
  assert.deepEqual(await t.holds(next), { ok: true, tasks: ['2'] });
});

test('a later clean review of the task answers the hold, whichever run gave it', async () => {
  const t = setup();
  const first = await start(t);
  t.reviews[first] = { 2: HELD };
  await t.made.keepTaskReviews('p', first);
  const next = await start(t);
  t.reviews[next] = { 2: CLEAN };
  assert.deepEqual(await t.holds(next), { ok: true, tasks: [] });
});

test('the run\'s own review, read at its close, stands over what was kept', async () => {
  const t = setup();
  const only = await start(t);
  t.reviews[only] = { 1: CLEAN };
  await t.made.keepTaskReviews('p', only);
  t.reviews[only] = { 1: HELD };
  assert.deepEqual(await t.holds(only), { ok: true, tasks: ['1'] });
});

test('a run ended without its reviews kept is read from the engine at the next close', async () => {
  const t = setup();
  const first = await start(t);
  t.reviews[first] = { 3: HELD };
  const next = await start(t);
  t.reviews[next] = {};
  assert.deepEqual(await t.holds(next), { ok: true, tasks: ['3'] });
});

test('an earlier run neither kept nor readable is refused, so the close can\'t read it as clear', async () => {
  const t = setup();
  await start(t);
  const next = await start(t);
  t.reviews[next] = {};
  const got = await t.holds(next);
  assert.equal(got.ok, false);
  assert.match(got.refused, /couldn't be read/);
});

test('a run the helper\'s record lost, written over by another write, is still read at its own close and kept at its end', async () => {
  const t = setup();
  const run = await start(t);
  const file = t.verdicts();
  fs.writeFileSync(file, `${JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), taskReviews: {} })}\n`);
  t.reviews[run] = { 1: HELD };
  assert.deepEqual(await t.holds(run), { ok: true, tasks: ['1'] });
  assert.equal(await t.made.keepTaskReviews('p', run), true);
});

test('a slice\'s hold stays with that slice: the next slice\'s task of the same number isn\'t held by it', async () => {
  const t = setup();
  const first = await start(t, orderOf('slice', 1));
  t.reviews[first] = { 2: HELD };
  await t.made.keepTaskReviews('p', first);
  const second = await start(t, orderOf('slice', 2));
  t.reviews[second] = {};
  assert.deepEqual(await t.holds(second), { ok: true, tasks: [] });
});

test('a review that took the blocked exit says nothing either way: its question is the card', async () => {
  const t = setup();
  const first = await start(t);
  t.reviews[first] = { 1: HELD, 2: BLOCKED };
  await t.made.keepTaskReviews('p', first);
  const next = await start(t);
  t.reviews[next] = { 1: BLOCKED };
  assert.deepEqual(await t.holds(next), { ok: true, tasks: ['1'] });
});

test('a lane with no task reviews keeps nothing and asks the engine nothing', async () => {
  const t = setup();
  const run = await start(t, orderOf('small'));
  assert.equal(await t.made.keepTaskReviews('p', run), true);
  assert.deepEqual(await t.holds(run), { ok: true, tasks: [] });
  assert.deepEqual(t.asked, []);
});

test('the route takes only the run\'s own ticket', async () => {
  const t = setup();
  const run = await start(t);
  t.reviews[run] = {};
  const got = await t.holds(run, { ticket: 'f'.repeat(64) });
  assert.equal(got.ok, false);
  assert.match(got.refused, /ticket/);
});
