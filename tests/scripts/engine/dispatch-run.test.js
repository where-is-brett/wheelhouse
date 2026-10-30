// tests/scripts/engine/dispatch-run.test.js
// The dispatcher's runner (scripts/engine/dispatch-run.js): the order each piece starts with carries the project's
// model bindings and test command; work for a project whose tests Wheelhouse can't run waits, said once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { dispatchRun } from '../../../scripts/engine/dispatch-run.js';
import { fakeEngine } from '../../../scripts/engine/fake.js';
import { tempFolder } from '../../helpers/homes.js';

const views = () => ({
  work: { 'card-1': { work: { id: 'w-1', at: '2026-10-29T08:00:00.000Z', data: { id: 'card-1', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [] } }, approved: false, since: '2026-10-29T08:00:00.000Z' } },
  runs: {}, questions: {},
});

function setUp(config) {
  const dir = tempFolder('wh-dr-');
  const starts = [];
  const written = [];
  const d = dispatchRun({
    engine: fakeEngine(), project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: views, config: () => config,
    start: async (args) => { starts.push(args); return { ok: true, runId: `run-${starts.length}` }; },
    write: async (kind, data) => { written.push({ kind, data }); },
    now: () => new Date('2026-10-29T10:00:00.000Z'),
  });
  return { d, starts, written };
}

test('the order carries the project\'s model bindings and its test command', async () => {
  const t = setUp({ routing: { tiers: { large: 'model-a', medium: 'model-b' } }, testCommand: 'node --test' });
  await t.d.tick();
  assert.equal(t.starts.length, 1);
  const { order } = t.starts[0];
  assert.deepEqual(order.bindings, { tiers: { large: 'model-a', medium: 'model-b' } });
  assert.equal(order.testCommand, 'node --test');
  assert.deepEqual(order.done, [{ command: 'node --test', expect: 0 }]);
});

test('with no test command Wheelhouse can run, no work starts, and the Logbook says why once', async () => {
  for (const config of [{ routing: {} }, null]) {
    const t = setUp(config);
    await t.d.tick();
    await t.d.tick();
    assert.equal(t.starts.length, 0, JSON.stringify(config));
    const said = t.written.filter((w) => w.kind === 'note');
    assert.equal(said.length, 1);
    assert.match(said[0].data.words, /waits/);
  }
});

test('work started again carries the director\'s answers in its order, and no others', async () => {
  const t = setUp({ routing: {}, testCommand: 'node --test' });
  const answers = [{ question: 'Task 2, Show refunds: Should a part refund show as its own line?', answer: 'Its own line' }];
  assert.equal((await t.d.startAgain({ work: 'card-1', lane: 'quick', branch: 'wh/card-1', carryOn: true, answers })).ok, true);
  assert.deepEqual(t.starts[0].order.answers, answers);
  assert.equal(t.starts[0].carryOn, true);
  await t.d.startAgain({ work: 'card-1', lane: 'quick', branch: 'wh/card-1', carryOn: true });
  assert.deepEqual(t.starts[1].order.answers, []);
});

test('work routed to a provider that counts requests waits while the count the cap reads, given in its own time, is at the cap', async () => {
  const dir = tempFolder('wh-dr-');
  const starts = [];
  const engine = { ...fakeEngine(), countsRequests: () => true, requestsConfirmed: true };
  let used = 0;
  const d = dispatchRun({
    engine, project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: views,
    config: () => ({ routing: { tiers: { medium: 'counted/model' } }, testCommand: 'node --test' }),
    settings: () => ({ capRequests: 5 }),
    // The provider's own figure is read in its own time, so the count may come as a promise.
    spentThisMonth: async () => used,
    start: async (args) => { starts.push(args); return { ok: true, runId: `run-${starts.length}` }; },
    now: () => new Date('2026-10-29T10:00:00.000Z'),
  });
  used = 5;
  await d.tick();
  assert.equal(starts.length, 0, 'at the cap');
  used = 4;
  await d.tick();
  assert.equal(starts.length, 1);
});
