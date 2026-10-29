// tests/scripts/engine/feature.test.js
// A feature on the engine (Archon design, section 7.2): its slices read from the approved design, its progress from
// its runs and the pull requests that merged, what it does next, and the orders of its slice runs and its own run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSlices, demoSlice, progressOf, featureProgress, featureNext, currentStep, sliceOrder, finishOrder, featureCap, SLICES_FENCE } from '../../../scripts/engine/feature.js';
import { DEFAULT_FLAG_FILE, LANE_CAPS } from '../../../scripts/engine/order.js';

const block = (value) => `# Order history\n\nThe design in words.\n\n\`\`\`${SLICES_FENCE}\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
const SLICES = {
  goal: 'Customers see their past orders',
  flag: { name: 'order-history' },
  demo: 'midpoint',
  slices: [
    { title: 'List the orders', goal: 'A page lists past orders', done: [{ test: 'orders lists' }, { page: '/orders', mustShow: 'Your orders' }] },
    { title: 'Filter them', goal: 'The list filters by year', done: [{ test: 'orders filter' }, { page: '/orders', mustShow: 'Your orders' }], notInScope: ['Export'] },
  ],
};
const ENTRY = { work: { key: 'orders', data: { id: 'orders', title: 'Order history', lane: 'feature', visible: true, dependsOn: [] } } };
const CONFIG = { testCommand: 'npm test --', pages: ['/'], routing: {} };
const sha = (c) => c.repeat(40);
const run = (runId, extra) => ({ data: { work: 'orders', engine: 'archon', runId, ...extra } });

test('the slices block is read from the design, with the plain flag file when the project has no way of its own', () => {
  const design = readSlices(block(SLICES));
  assert.equal(design.goal, SLICES.goal);
  assert.deepEqual(design.flag, { name: 'order-history', file: DEFAULT_FLAG_FILE });
  assert.equal(design.demo, 'midpoint');
  assert.equal(design.slices.length, 2);
  assert.deepEqual(design.slices[1].notInScope, ['Export']);
  assert.deepEqual(design.slices[0].protectedFiles, []);
  const how = readSlices(block({ ...SLICES, flag: { name: 'order-history', how: 'Set ORDERS=1 in .env' }, demo: 'end' }));
  assert.deepEqual(how.flag, { name: 'order-history', how: 'Set ORDERS=1 in .env' });
  assert.equal(how.demo, 'end');
});

test('a design with no slices block, a broken one, or a slice with no done check is refused in plain words', () => {
  assert.throws(() => readSlices('# Just words'), /no list of slices/);
  assert.throws(() => readSlices(`\`\`\`${SLICES_FENCE}\n{ not json\n\`\`\``), /can't be read/);
  assert.throws(() => readSlices(block({ ...SLICES, slices: [] })), /at least one slice/);
  assert.throws(() => readSlices(block({ ...SLICES, slices: Array.from({ length: 13 }, () => SLICES.slices[0]) })), /at most 12/);
  assert.throws(() => readSlices(block({ ...SLICES, slices: [{ title: 'x', goal: 'y', done: [] }] })), /done check/);
  assert.throws(() => readSlices(block({ ...SLICES, slices: [{ title: 'x', goal: 'y', done: [{ wish: 'z' }] }] })), /done check/);
  assert.throws(() => readSlices(block({ ...SLICES, demo: 'sometimes' })), /midpoint or end/);
  assert.throws(() => readSlices(block({ ...SLICES, flag: { name: 'Bad' } })), /flag/);
  assert.throws(() => readSlices(block({ ...SLICES, goal: '' })), /goal/);
});

test('the midpoint demo is slice 2 of 3 and slice 1 of 2, and none of 1 or when the director chose the end', () => {
  const of = (n, demo = 'midpoint') => demoSlice({ demo, slices: Array.from({ length: n }, () => ({})) });
  assert.equal(of(3), 2);
  assert.equal(of(2), 1);
  assert.equal(of(4), 2);
  assert.equal(of(1), null);
  assert.equal(of(3, 'end'), null);
});

test('a feature\'s progress groups its runs by slice from their orders, a carried-on slice keeping its number', () => {
  const orders = { r1: { slice: { n: 1 } }, r2: { slice: { n: 2 } }, r3: { slice: { n: 2 } }, r4: { lane: 'feature' } };
  const runs = [
    run('r1', { lane: 'slice', state: 'started' }), run('r1', { lane: 'slice', state: 'ended', outcome: 'completed', pr: 70 }),
    run('r2', { lane: 'slice', state: 'ended', outcome: 'cancelled', branch: 'wh/orders-2' }),
    run('r3', { lane: 'slice', state: 'started', branch: 'wh/orders-2' }),
  ];
  const got = progressOf({ runs, orderOf: (id) => orders[id] ?? null, merged: new Set([70]) });
  assert.deepEqual(got.slices[1].runs.map((r) => r.runId), ['r1']);
  assert.equal(got.slices[1].pr, 70);
  assert.equal(got.slices[1].merged, true);
  assert.deepEqual(got.slices[2].runs.map((r) => r.runId), ['r2', 'r3']);
  assert.equal(got.slices[2].merged, false);
  assert.equal(got.finish.runs.length, 0);
});

test('the next step is slice 1, then slice 2 once slice 1 merged, then the feature\'s own run, then done', () => {
  const design = readSlices(block(SLICES));
  const empty = { slices: {}, finish: { runs: [], pr: null, merged: false } };
  assert.deepEqual(featureNext({ design, progress: empty, live: false }), { act: 'start', slice: 1 });
  const ended = (n, pr, merged) => ({ runs: [{ runId: `r${n}`, state: 'ended', outcome: 'completed', pr }], pr, head: null, merged });
  assert.deepEqual(featureNext({ design, progress: { ...empty, slices: { 1: ended(1, 70, true) } }, live: false }), { act: 'start', slice: 2 });
  const both = { 1: ended(1, 70, true), 2: ended(2, 71, true) };
  assert.deepEqual(featureNext({ design, progress: { ...empty, slices: both }, live: false }), { act: 'start', finish: true });
  const finish = { runs: [{ runId: 'r9', state: 'ended', outcome: 'completed', pr: 72 }], pr: 72, merged: true };
  assert.deepEqual(featureNext({ design, progress: { slices: both, finish }, live: false }), { act: 'done', pr: 72 });
  assert.deepEqual(featureNext({ design, progress: { ...empty, slices: { 1: ended(1, 70, true) } }, live: true }), { act: 'wait' });
});

test('a slice whose pull request hasn\'t merged waits, and one whose run ended with none waits too', () => {
  const design = readSlices(block(SLICES));
  const finish = { runs: [], pr: null, merged: false };
  const open = { 1: { runs: [{ runId: 'r1', state: 'ended', outcome: 'completed', pr: 70 }], pr: 70, merged: false } };
  assert.deepEqual(featureNext({ design, progress: { slices: open, finish }, live: false }), { act: 'wait' });
  const none = { 1: { runs: [{ runId: 'r1', state: 'ended', outcome: 'cancelled' }], pr: null, merged: false } };
  assert.deepEqual(featureNext({ design, progress: { slices: none, finish }, live: false }), { act: 'wait' });
});

test('the slice order names its flag and slice, and only the demo slice is shown first', () => {
  const design = readSlices(block(SLICES));
  const first = sliceOrder({ entry: ENTRY, design, n: 1, config: CONFIG });
  assert.equal(first.lane, 'slice');
  assert.equal(first.work, 'orders');
  assert.equal(first.goal, 'A page lists past orders');
  assert.deepEqual(first.slice, { n: 1, of: 2, title: 'List the orders' });
  assert.deepEqual(first.flag, { name: 'order-history', file: DEFAULT_FLAG_FILE });
  assert.equal(first.demo, true, 'slice 1 of 2 is the midpoint');
  assert.equal(first.showFirst, true);
  assert.deepEqual(first.caps, { ...LANE_CAPS.slice });
  assert.deepEqual(first.preview, { pages: ['/'], styleGuide: null });
  const second = sliceOrder({ entry: ENTRY, design, n: 2, config: CONFIG });
  assert.equal(second.demo, false);
  assert.equal(second.showFirst, false);
  assert.deepEqual(second.notInScope, ['Export']);
});

test('the feature\'s own order lists the merged slices, every done check once, and is shown first', () => {
  const design = readSlices(block(SLICES));
  const progress = { slices: { 1: { runs: [], pr: 70, head: sha('a'), merged: true }, 2: { runs: [], pr: 71, head: sha('b'), merged: true } }, finish: { runs: [], pr: null, merged: false } };
  const order = finishOrder({ entry: ENTRY, design, progress, config: CONFIG });
  assert.equal(order.lane, 'feature');
  assert.equal(order.goal, 'Switch on: Customers see their past orders');
  assert.deepEqual(order.feature.slices, [{ n: 1, title: 'List the orders', pr: 70, head: sha('a') }, { n: 2, title: 'Filter them', pr: 71, head: sha('b') }]);
  assert.deepEqual(order.done, [{ test: 'orders lists' }, { page: '/orders', mustShow: 'Your orders' }, { test: 'orders filter' }]);
  assert.equal(order.showFirst, true);
  assert.deepEqual(order.flag, design.flag);
});

test('a feature\'s overall cap is a slice\'s tokens for each slice and one more', () => {
  const design = readSlices(block(SLICES));
  assert.equal(featureCap(design, {}), 3 * LANE_CAPS.slice.tokens);
  assert.equal(featureCap(design, { capTokens: { slice: 1000 } }), 3000);
});

test('a carry-on takes up the first slice that hasn\'t merged, or the feature\'s own run', () => {
  const design = readSlices(block(SLICES));
  const finish = { runs: [], pr: null, merged: false };
  assert.deepEqual(currentStep({ design, progress: { slices: {}, finish } }), { slice: 1 });
  assert.deepEqual(currentStep({ design, progress: { slices: { 1: { runs: [], merged: true } }, finish } }), { slice: 2 });
  assert.deepEqual(currentStep({ design, progress: { slices: { 1: { merged: true }, 2: { merged: true } }, finish } }), { finish: true });
});

test('a feature queued again keeps the slices that merged before, by their titles, and carries on the one that hadn\'t', () => {
  const design = readSlices(block(SLICES));
  const orders = { r1: { slice: { n: 1, title: 'List the orders' } }, r2: { slice: { n: 2, title: 'Filter them' } }, r0: { slice: { n: 1, title: 'An older slice 1' } } };
  const before = [
    run('r0', { lane: 'slice', state: 'ended', outcome: 'completed', pr: 60 }),
    run('r1', { lane: 'slice', state: 'ended', outcome: 'completed', pr: 70 }),
    run('r2', { lane: 'slice', state: 'ended', outcome: 'cancelled', branch: 'wh/orders-2' }),
  ];
  const got = featureProgress({ design, all: before, now: [], orderOf: (id) => orders[id] ?? null, merged: new Map([[60, null], [70, sha('a')]]) });
  assert.equal(got.slices[1].merged, true);
  assert.equal(got.slices[1].head, sha('a'));
  assert.equal(got.slices[1].pr, 70, 'a slice from another design isn\'t this one');
  assert.deepEqual(got.slices[2].runs, [], 'no run of slice 2 since it was queued again');
  assert.equal(got.slices[2].branch, 'wh/orders-2');
  assert.deepEqual(featureNext({ design, progress: got, live: false }), { act: 'start', slice: 2 });
});
