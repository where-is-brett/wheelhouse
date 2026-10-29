// tests/scripts/engine/dispatch-feature.test.js
// The dispatcher's runner and a feature (scripts/engine/dispatch-run.js, feature.js): approved feature work starts its
// first slice; each later slice starts once the slice before has merged; the feature's own run starts once every
// slice has merged, and its merge ends the work. Nothing starts under All stop or an open incident, from a design
// changed since its approval, or past the feature's overall cap without the director's say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { dispatchRun, KEEP_GOING, STOP_HERE } from '../../../scripts/engine/dispatch-run.js';
import { SLICES_FENCE, featureCap, readSlices } from '../../../scripts/engine/feature.js';
import { fakeEngine } from '../../../scripts/engine/fake.js';
import { tempFolder } from '../../helpers/homes.js';

const DESIGN = `# Order history\n\n\`\`\`${SLICES_FENCE}\n${JSON.stringify({
  goal: 'Customers see their past orders', flag: { name: 'order-history' }, demo: 'end',
  slices: [
    { title: 'List the orders', goal: 'A page lists past orders', done: [{ test: 'orders lists' }] },
    { title: 'Filter them', goal: 'The list filters by year', done: [{ test: 'orders filter' }] },
  ],
})}\n\`\`\`\n`;
const AT = '2026-10-29T08:00:00.000Z';
const sha = (c) => c.repeat(40);

function setUp({ design = { text: DESIGN } } = {}) {
  const dir = tempFolder('wh-df-');
  const world = {
    runs: [], merged: new Set(), ready: {}, costs: [], incidents: [], questions: {}, stop: false, reports: {},
    starts: [], written: [], orders: {},
  };
  const views = () => ({
    work: { orders: { work: { id: 'w-1', at: AT, data: { id: 'orders', title: 'Order history', lane: 'feature', visible: false, dependsOn: [] } }, approved: true, since: AT } },
    runs: { orders: world.runs.map((data) => ({ at: '2026-10-29T09:00:00.000Z', data: { work: 'orders', engine: 'archon', ...data } })) },
    costs: { orders: world.costs.map((tokens, i) => ({ at: AT, data: { runId: `c${i}`, work: 'orders', tokens } })) },
    incidents: { open: world.incidents }, questions: world.questions, reports: world.reports,
  });
  const d = dispatchRun({
    engine: fakeEngine(), project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: views,
    settings: () => ({ engineLanes: ['quick', 'feature'] }), stopped: () => world.stop,
    config: () => ({ routing: {}, testCommand: 'npm test --' }),
    start: async (args) => {
      const runId = `run-${world.starts.length + 1}`;
      world.starts.push(args);
      world.orders[runId] = args.order;
      return { ok: true, runId };
    },
    write: async (kind, data) => { world.written.push({ kind, data }); },
    readyOf: () => world.ready,
    prMerged: async (pr) => world.merged.has(pr),
    designOf: () => design,
    orderOf: (runId) => world.orders[runId] ?? null,
    now: () => new Date('2026-10-29T10:00:00.000Z'),
  });
  // The run the last start began, recorded as the helper records it, ended with `pr` or still going.
  const recordLast = ({ pr = null, state = 'ended', outcome = 'completed', branch = `wh/orders-${world.starts.length}` } = {}) => {
    const runId = `run-${world.starts.length}`;
    world.runs.push({ runId, lane: world.starts.at(-1).order.lane, state, branch, ...(state === 'ended' ? { outcome } : {}), ...(pr ? { pr } : {}) });
    if (pr) world.ready[pr] = { work: 'orders', head: sha(String(pr % 10)) };
  };
  return { d, world, recordLast };
}

const notes = (world) => world.written.filter((w) => w.kind === 'note').map((w) => w.data.words);

test('approved feature work starts slice 1 with a slice order behind its flag', async () => {
  const { d, world } = setUp();
  await d.tick();
  assert.equal(world.starts.length, 1);
  const { order } = world.starts[0];
  assert.equal(order.lane, 'slice');
  assert.deepEqual(order.slice, { n: 1, of: 2, title: 'List the orders' });
  assert.equal(order.flag.name, 'order-history');
  assert.deepEqual(order.done, [{ test: 'orders lists' }]);
});

test('slice 2 starts only after slice 1\'s pull request reads merged, with a line on the Logbook', async () => {
  const { d, world, recordLast } = setUp();
  await d.tick();
  recordLast({ pr: 70 });
  await d.tick();
  assert.equal(world.starts.length, 1, 'slice 2 waits for slice 1 to merge');
  world.merged.add(70);
  await d.tick();
  assert.equal(world.starts.length, 2);
  assert.deepEqual(world.starts[1].order.slice, { n: 2, of: 2, title: 'Filter them' });
  assert.ok(notes(world).some((w) => /Slice 1 of 2 of Order history is added, behind its switch/.test(w)));
  await d.tick();
  assert.equal(world.starts.length, 2, 'slice 2 starts once');
});

test('the feature\'s own run starts once every slice merged, and its merge ends the work with a report', async () => {
  const { d, world, recordLast } = setUp();
  await d.tick();
  recordLast({ pr: 70 });
  world.merged.add(70);
  await d.tick();
  recordLast({ pr: 71 });
  world.merged.add(71);
  await d.tick();
  assert.equal(world.starts.length, 3);
  const { order } = world.starts[2];
  assert.equal(order.lane, 'feature');
  assert.deepEqual(order.feature.slices.map((s) => [s.n, s.pr, s.head]), [[1, 70, sha('0')], [2, 71, sha('1')]]);
  assert.equal(order.showFirst, true);
  recordLast({ pr: 72 });
  world.merged.add(72);
  await d.tick();
  const report = world.written.find((w) => w.kind === 'report');
  assert.deepEqual(report?.data, { work: 'orders', outcome: 'merged', pr: 72, summary: 'Switched on, with every slice added.', rulings: [] });
  world.reports.orders = { at: '2026-10-29T10:00:00.000Z', data: report.data };
  await d.tick();
  assert.equal(world.written.filter((w) => w.kind === 'report').length, 1);
  assert.equal(world.starts.length, 3);
});

test('nothing starts between slices under All stop or an open incident', async () => {
  for (const hold of ['stop', 'incident']) {
    const { d, world, recordLast } = setUp();
    await d.tick();
    recordLast({ pr: 70 });
    world.merged.add(70);
    if (hold === 'stop') world.stop = true; else world.incidents.push({ id: 'i-1' });
    await d.tick();
    assert.equal(world.starts.length, 1, hold);
    world.stop = false;
    world.incidents.length = 0;
    await d.tick();
    assert.equal(world.starts.length, 2, hold);
  }
});

test('a slice whose pull request closed unmerged, or never came, holds the feature', async () => {
  const { d, world, recordLast } = setUp();
  await d.tick();
  recordLast({ outcome: 'cancelled' });
  await d.tick();
  assert.equal(world.starts.length, 1);
});

test('a design changed since approval starts nothing, and the Logbook says so once', async () => {
  const { d, world } = setUp({ design: { problem: 'is not the one approved: it has changed since' } });
  await d.tick();
  await d.tick();
  assert.equal(world.starts.length, 0);
  const said = notes(world).filter((w) => /Order history waits: its approved design is not the one approved/.test(w));
  assert.equal(said.length, 1);
  const none = setUp({ design: { text: '# Just words' } });
  await none.d.tick();
  assert.equal(none.world.starts.length, 0);
  assert.ok(notes(none.world).some((w) => /no list of slices/.test(w)));
});

test('past the feature\'s overall cap, one card; Keep going raises it once, and Stop here starts nothing', async () => {
  for (const label of [KEEP_GOING, STOP_HERE]) {
    const { d, world, recordLast } = setUp();
    await d.tick();
    recordLast({ pr: 70 });
    world.merged.add(70);
    world.costs.push(featureCap(readSlices(DESIGN), {}));
    await d.tick();
    await d.tick();
    assert.equal(world.starts.length, 1, label);
    const cards = world.written.filter((w) => w.kind === 'question');
    assert.equal(cards.length, 1, label);
    assert.equal(cards[0].data.level, 3);
    assert.deepEqual(cards[0].data.options.map((o) => o.label), [KEEP_GOING, STOP_HERE]);
    world.questions[cards[0].data.id] = { answer: { label } };
    await d.tick();
    assert.equal(world.starts.length, label === KEEP_GOING ? 2 : 1, label);
  }
});

test('a carry-on of a cancelled slice 2 starts slice 2 again on its branch, not slice 1', async () => {
  const { d, world, recordLast } = setUp();
  await d.tick();
  recordLast({ pr: 70 });
  world.merged.add(70);
  await d.tick();
  recordLast({ outcome: 'cancelled', branch: 'wh/orders-2' });
  const got = await d.startAgain({ work: 'orders', lane: 'slice', branch: 'wh/orders-2', carryOn: true });
  assert.equal(got.ok, true);
  assert.equal(world.starts.length, 3);
  assert.deepEqual(world.starts[2].order.slice, { n: 2, of: 2, title: 'Filter them' });
  assert.equal(world.starts[2].branch, 'wh/orders-2');
  assert.equal(world.starts[2].carryOn, true);
});
