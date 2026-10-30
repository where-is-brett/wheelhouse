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

test("the merge queue starts in the folder the helper gives it, never the project's, and not at all when that folder can't be made (check 81)", async () => {
  for (const [given, want] of [[{ ok: true, folder: '/engine/queues/p' }, '/engine/queues/p'], [{ ok: false, refused: 'no mirror' }, null]]) {
    const dir = tempFolder('wh-dr-');
    const engine = fakeEngine();
    const d = dispatchRun({
      engine, project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => ({ work: {}, runs: {}, questions: {} }),
      config: () => ({ routing: {}, testCommand: 'node --test' }), start: async () => ({ ok: false }),
      readyOf: () => ({ 7: { work: 'card-7', head: 'a'.repeat(40) } }), repoOf: () => ({ host: 'github.com', path: 'o/p' }),
      queueFolder: async () => given, now: () => new Date('2026-10-29T10:00:00.000Z'),
    });
    await d.tick();
    const starts = engine.calls.filter((c) => c.call === 'start' && c.order.lane === 'merge');
    assert.deepEqual(starts.map((c) => c.order.project), want === null ? [] : [want]);
  }
});

test('a ruled merge starts the queue on the first tick after the ruling\'s run ends, not at the next sweep', async () => {
  let status = 'paused';
  const starts = [];
  const dir = tempFolder('wh-due-');
  const at = new Date('2026-10-30T06:00:00Z');
  const run = dispatchRun({
    engine: { inspect: async () => ({ status }), start: async (order) => { starts.push(order); return { ok: true, runId: `queue-${starts.length}` }; } },
    project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => ({ work: {}, runs: {}, reports: {} }),
    settings: () => ({}), now: () => at, start: async () => ({ ok: false }), write: async () => {},
    readyOf: () => ({ 7: { work: 'card-7', head: 'a'.repeat(40) } }), repoOf: () => ({ host: 'github.com', path: 'o/p' }),
    queueFolder: async () => ({ ok: true, folder: dir }),
  });
  await run.tick();
  assert.equal(starts.length, 1, 'the first sweep');
  run.queueDue();
  await run.tick();
  assert.equal(starts.length, 1, 'the answered run hasn\'t ended, so its ruling isn\'t recorded yet');
  status = 'completed';
  await run.tick();
  assert.equal(starts.length, 2, 'started at once, well inside the fifteen minutes');
  await run.tick();
  assert.equal(starts.length, 2, 'once');
});
