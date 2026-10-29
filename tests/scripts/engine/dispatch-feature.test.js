// tests/scripts/engine/dispatch-feature.test.js
// The dispatcher's runner and a feature (scripts/engine/dispatch-run.js, feature.js): approved feature work starts its
// first slice; each later slice starts once the slice before has merged; the feature's own run starts once every
// slice has merged, and its merge ends the work. Nothing starts under All stop or an open incident, from a design
// changed since its approval, or past the feature's overall cap without the director's say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { dispatchRun, KEEP_GOING, STOP_HERE, BUILD_AGAIN } from '../../../scripts/engine/dispatch-run.js';
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
    starts: [], written: [], orders: {}, closed: new Set(), asked: [], stoppedRuns: [],
  };
  const views = () => ({
    work: { orders: { work: { id: 'w-1', at: world.requeued ?? AT, data: { id: 'orders', title: 'Order history', lane: 'feature', visible: false, dependsOn: [] } }, approved: true, since: AT } },
    runs: { orders: world.runs.map(({ at = '2026-10-29T09:00:00.000Z', ...data }) => ({ at, data: { work: 'orders', engine: 'archon', ...data } })) },
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
    prState: async (pr) => {
      world.asked.push(pr);
      return world.merged.has(pr) ? 'merged' : world.closed.has(pr) ? 'closed' : 'open';
    },
    stoppedRuns: () => world.stoppedRuns,
    designOf: () => design,
    orderOf: (runId) => world.orders[runId] ?? null,
    now: () => new Date('2026-10-29T10:00:00.000Z'),
  });
  // The run the last start began, recorded as the helper records it, ended with `pr` or still going.
  const recordLast = ({ pr = null, state = 'ended', outcome = 'completed', branch = `wh/orders-${world.starts.length}`, at } = {}) => {
    const runId = `run-${world.starts.length}`;
    world.runs.push({ ...(at ? { at } : {}), runId, lane: world.starts.at(-1).order.lane, state, branch, ...(state === 'ended' ? { outcome } : {}), ...(pr ? { pr } : {}) });
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

test('a slice whose pull request never came holds the feature', async () => {
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

test('the First Mate\'s Carry on, queueing the feature again, skips the slice that merged and carries on the other from its branch', async () => {
  const { d, world, recordLast } = setUp();
  await d.tick();
  recordLast({ pr: 70 });
  world.merged.add(70);
  await d.tick();
  recordLast({ outcome: 'cancelled', branch: 'wh/orders-2' });
  // The work recorded again, after its runs: the dispatcher sees it as queued.
  const queued = '2026-10-29T09:30:00.000Z';
  world.requeued = queued;
  await d.tick();
  assert.equal(world.starts.length, 3);
  assert.deepEqual(world.starts[2].order.slice, { n: 2, of: 2, title: 'Filter them' });
  assert.equal(world.starts[2].branch, 'wh/orders-2');
  assert.equal(world.starts[2].carryOn, true);
});

test('a feature queued again goes on past its carried-on slice to its own run and its report', async () => {
  const { d, world, recordLast } = setUp();
  await d.tick();
  recordLast({ pr: 70 });
  world.merged.add(70);
  await d.tick();
  recordLast({ outcome: 'cancelled', branch: 'wh/orders-2' });
  world.requeued = '2026-10-29T09:30:00.000Z';
  await d.tick();
  assert.equal(world.starts.length, 3);
  recordLast({ pr: 71, at: '2026-10-29T09:40:00.000Z' });
  world.merged.add(71);
  await d.tick();
  assert.equal(world.starts.length, 4, 'the feature\'s own run starts once the carried-on slice merged');
  assert.equal(world.starts[3].order.lane, 'feature');
  recordLast({ pr: 72, at: '2026-10-29T09:50:00.000Z' });
  world.merged.add(72);
  await d.tick();
  assert.equal(world.written.filter((w) => w.kind === 'report').length, 1);
});

test('a feature queued again after Stop here at its cap asks again, and a raised cap spent says the feature has stopped', async () => {
  const { d, world, recordLast } = setUp();
  const cap = featureCap(readSlices(DESIGN), {});
  await d.tick();
  world.costs.push(cap);
  recordLast({ pr: 70 });
  world.merged.add(70);
  await d.tick();
  const asked = () => world.written.filter((w) => w.kind === 'question');
  assert.equal(asked().length, 1);
  world.questions[asked()[0].data.id] = { answer: { label: STOP_HERE } };
  await d.tick();
  world.requeued = '2026-10-29T09:30:00.000Z';
  await d.tick();
  assert.equal(asked().length, 2, 'the feature queued again asks again');
  world.questions[asked()[1].data.id] = { answer: { label: KEEP_GOING } };
  world.costs.push(cap);
  await d.tick();
  assert.equal(world.starts.length, 1);
  assert.ok(notes(world).some((w) => /stopped/.test(w) && /raised/.test(w)), notes(world).join(' | '));
  await d.tick();
  assert.equal(notes(world).filter((w) => /stopped/.test(w) && /raised/.test(w)).length, 1);
});

const asked = (world) => world.written.filter((w) => w.kind === 'question').map((w) => w.data);
const closedReports = (world) => world.written.filter((w) => w.kind === 'report' && w.data.outcome === 'closed').map((w) => w.data);

test('a slice\'s pull request closed unmerged brings one card, and the host isn\'t asked about it again', async () => {
  const { d, world, recordLast } = setUp();
  await d.tick();
  recordLast({ pr: 70 });
  world.closed.add(70);
  await d.tick();
  await d.tick();
  const cards = asked(world);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].level, 3);
  assert.match(cards[0].what, /Pull request #70/);
  assert.match(cards[0].what, /closed/);
  assert.deepEqual(cards[0].options.map((o) => o.label), [BUILD_AGAIN, STOP_HERE]);
  assert.equal(cards[0].recommendation, STOP_HERE);
  assert.match(cards[0].what, /Nothing more of it starts/);
  assert.equal(world.asked.filter((pr) => pr === 70).length, 1, 'a closed pull request is asked about once');
  assert.equal(world.starts.length, 1);
});

test('Build it again on the closed card carries the slice on from its branch, once', async () => {
  const { d, world, recordLast } = setUp();
  await d.tick();
  recordLast({ pr: 70, branch: 'wh/orders-1' });
  world.closed.add(70);
  await d.tick();
  world.questions[asked(world)[0].id] = { answer: { label: BUILD_AGAIN } };
  await d.tick();
  assert.equal(world.starts.length, 2);
  assert.deepEqual(world.starts[1].order.slice, { n: 1, of: 2, title: 'List the orders' });
  assert.equal(world.starts[1].branch, 'wh/orders-1');
  assert.equal(world.starts[1].carryOn, true);
  await d.tick();
  assert.equal(world.starts.length, 2, 'started once');
  assert.equal(asked(world).length, 1);
});

test('Stop here on the closed card ends the feature with a closed report and a Logbook line, so the lane is free', async () => {
  const { d, world, recordLast } = setUp();
  await d.tick();
  recordLast({ pr: 70 });
  world.closed.add(70);
  await d.tick();
  world.questions[asked(world)[0].id] = { answer: { label: STOP_HERE } };
  await d.tick();
  await d.tick();
  assert.equal(closedReports(world).length, 1);
  assert.equal(closedReports(world)[0].work, 'orders');
  assert.ok(notes(world).some((w) => /Order history stops here/.test(w)), notes(world).join(' | '));
  assert.equal(world.starts.length, 1);
});

test('Stop here on the cap card ends the feature with a closed report and a Logbook line, and asks nothing more', async () => {
  const { d, world, recordLast } = setUp();
  await d.tick();
  recordLast({ pr: 70 });
  world.merged.add(70);
  world.costs.push(featureCap(readSlices(DESIGN), {}));
  await d.tick();
  world.questions[asked(world)[0].id] = { answer: { label: STOP_HERE } };
  await d.tick();
  await d.tick();
  assert.equal(closedReports(world).length, 1);
  assert.ok(notes(world).some((w) => /Order history stops here, as you chose/.test(w)), notes(world).join(' | '));
  assert.equal(asked(world).length, 1);
  assert.equal(world.starts.length, 1);
});

test('a raised cap spent too ends the feature with a closed report', async () => {
  const { d, world, recordLast } = setUp();
  const cap = featureCap(readSlices(DESIGN), {});
  await d.tick();
  recordLast({ pr: 70 });
  world.merged.add(70);
  world.costs.push(cap);
  await d.tick();
  world.questions[asked(world)[0].id] = { answer: { label: KEEP_GOING } };
  world.costs.push(cap);
  await d.tick();
  await d.tick();
  assert.equal(closedReports(world).length, 1);
});

test('a midpoint demo the director rejected brings one card that names the demo and recommends building it again', async () => {
  const demo = DESIGN.replace('"demo":"end"', '"demo":"midpoint"');
  const { d, world, recordLast } = setUp({ design: { text: demo } });
  await d.tick();
  recordLast({ pr: 70, outcome: 'cancelled' });
  await d.tick();
  await d.tick();
  const cards = asked(world);
  assert.equal(cards.length, 1);
  assert.match(cards[0].what, /demo/);
  assert.equal(cards[0].recommendation, BUILD_AGAIN);
  assert.equal(world.starts.length, 1);
});

test('a switch-on the director rejected brings one card that names the switch-on', async () => {
  const { d, world, recordLast } = setUp();
  await d.tick();
  recordLast({ pr: 70 });
  world.merged.add(70);
  await d.tick();
  recordLast({ pr: 71 });
  world.merged.add(71);
  await d.tick();
  recordLast({ pr: 72, outcome: 'cancelled' });
  await d.tick();
  const cards = asked(world);
  assert.equal(cards.length, 1);
  assert.match(cards[0].what, /switch/);
});

test('a run cancelled by All stop, or one a card already names (its cap), brings no card of the feature\'s', async () => {
  const stopped = setUp();
  await stopped.d.tick();
  stopped.recordLast({ outcome: 'cancelled' });
  stopped.world.stoppedRuns.push('run-1');
  await stopped.d.tick();
  assert.equal(asked(stopped.world).length, 0);

  const capped = setUp();
  await capped.d.tick();
  capped.recordLast({ outcome: 'cancelled' });
  capped.world.questions['q-orders-90001'] = { question: { data: { id: 'q-orders-90001', engine: { runId: 'run-1', ask: 'cap:run-1', options: {} } } } };
  await capped.d.tick();
  assert.equal(asked(capped.world).length, 0);
});

test('the feature\'s merged report is tried again when its write fails', async () => {
  const { d, world, recordLast } = setUp();
  await d.tick();
  recordLast({ pr: 70 });
  world.merged.add(70);
  await d.tick();
  recordLast({ pr: 71 });
  world.merged.add(71);
  await d.tick();
  recordLast({ pr: 72 });
  world.merged.add(72);
  const write = world.written.push.bind(world.written);
  let fail = true;
  world.written.push = (item) => {
    if (fail && item.kind === 'report') { fail = false; throw new Error('the record could not be written'); }
    return write(item);
  };
  await d.tick().catch(() => {});
  await d.tick();
  assert.equal(world.written.filter((w) => w.kind === 'report' && w.data.outcome === 'merged').length, 1);
});
