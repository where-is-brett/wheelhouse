// tests/scripts/engine/order.test.js
// The work order (Archon design, section 7.4): what one run is given, built from the work and the project's settings,
// and kept by the helper under the run's id so nothing an agent writes changes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workOrder, checkOrder, orderStore, bindingsOf, LANE_CAPS, DECISION_RULES, ANSWER_CHARS, MOST_ANSWERS, DEFAULT_FLAG_FILE } from '../../../scripts/engine/order.js';
import { tempFolder } from '../../helpers/homes.js';

const WORK = {
  id: 'card-12',
  lane: 'quick',
  goal: 'Show the price with its currency on the product page',
  notInScope: ['Changing the checkout'],
  done: [
    { test: 'tests/price.test.js' },
    { command: 'node scripts/check-price.js', expect: 0 },
    { page: '/products/1', mustShow: 'A$12.00' },
  ],
  protectedFiles: ['tests/old-price.test.js'],
  visible: true,
};
const ROUTING = { tiers: { large: 'model-a', medium: 'model-b' }, aliases: { implementer: 'medium' } };

test('the order carries the done checks as the First Mate wrote them', () => {
  const order = workOrder({ work: WORK, rulings: ['Prices show two decimals'], routing: ROUTING, config: { pages: ['/'], styleGuide: 'docs/wheelhouse/style-guide.md' } });
  assert.deepEqual(order.done, WORK.done);
  assert.equal(order.goal, WORK.goal);
  assert.deepEqual(order.notInScope, WORK.notInScope);
  assert.deepEqual(order.rulings, ['Prices show two decimals']);
  assert.deepEqual(order.decisionRules, DECISION_RULES);
  assert.deepEqual(order.caps, { minutes: LANE_CAPS.quick.minutes, tokens: LANE_CAPS.quick.tokens });
  assert.deepEqual(order.protectedFiles, ['tests/old-price.test.js']);
  assert.deepEqual(order.preview, { pages: ['/'], styleGuide: 'docs/wheelhouse/style-guide.md' });
  assert.equal(order.work, 'card-12');
  assert.equal(order.lane, 'quick');
  assert.equal(checkOrder(order), null);
});

test('the order names no model directly, only bindings from the routing table', () => {
  const order = workOrder({ work: WORK, routing: ROUTING, config: {} });
  assert.deepEqual(order.bindings, ROUTING);
  const { bindings, ...rest } = order;
  assert.doesNotMatch(JSON.stringify(rest), /model-a|model-b/);
  assert.throws(() => workOrder({ work: { ...WORK, model: 'model-a' }, routing: ROUTING, config: {} }), /names a model/);
});

test('visible work is shown first unless the work record waives it', () => {
  assert.equal(workOrder({ work: WORK, routing: {}, config: {} }).showFirst, true);
  assert.equal(workOrder({ work: { ...WORK, shownFirst: false }, routing: {}, config: {} }).showFirst, false);
  assert.equal(workOrder({ work: { ...WORK, visible: false }, routing: {}, config: {} }).showFirst, false);
  const order = workOrder({ work: WORK, routing: {}, config: {} });
  assert.match(checkOrder({ ...order, showFirst: 'yes' }), /shown first/);
  const { showFirst, ...older } = order;
  assert.equal(checkOrder(older), null, 'an order written before the flag is read as not shown first');
  for (const work of ['../../x', 'card/1', 'Card-1', '', 'a'.repeat(41)]) {
    assert.match(checkOrder({ ...order, work }), /needs its work/, `${work}: the work names a folder, so it is a plain slug`);
  }
});

test('while tests aren\'t counting an order may have no test command and no done checks', () => {
  const order = workOrder({ work: { ...WORK, done: [] }, routing: {}, config: { testCommand: null, testsNotCounting: true } });
  assert.equal(order.testCommand, null);
  assert.equal(order.testsNotCounting, true);
  assert.deepEqual(order.done, []);
  assert.throws(() => workOrder({ work: { ...WORK, done: [] }, routing: {}, config: { testCommand: null } }), /done check/);
});

test('work with nothing visible has no preview, and a work with no done checks is refused', () => {
  assert.equal(workOrder({ work: { ...WORK, visible: false }, routing: {}, config: {} }).preview, null);
  assert.throws(() => workOrder({ work: { ...WORK, done: [] }, routing: {}, config: {} }), /done check/);
  assert.throws(() => workOrder({ work: { ...WORK, done: [{ shell: 'x' }] }, routing: {}, config: {} }), /done check/);
  assert.throws(() => workOrder({ work: { ...WORK, lane: 'merge' }, routing: {}, config: {} }), /lane/);
});

test('the store keeps one order a run and answers nothing for an unknown run id', () => {
  const dir = tempFolder('wh-orders-');
  const store = orderStore(dir);
  const order = workOrder({ work: WORK, routing: ROUTING, config: {} });
  store.save('run-1', order);
  assert.deepEqual(store.load('run-1'), order);
  assert.equal(store.load('run-2'), null);
  assert.equal(store.load('../run-1'), null);
  assert.throws(() => store.save('run-1', order), /already/);
  assert.throws(() => store.save('a/b', order), /run id/);
  assert.deepEqual(fs.readdirSync(dir), ['run-1.json']);
  assert.equal(fs.statSync(path.join(dir, 'run-1.json')).mode & 0o077, 0);
});

test('the order carries the work\'s decision level, 3 when the work gives none, for the permit\'s level-4 rule', () => {
  const work = { id: 'card-1', lane: 'quick', goal: 'A goal', done: [{ test: 'x' }] };
  assert.equal(workOrder({ work }).level, 3);
  assert.equal(workOrder({ work: { ...work, level: 4 } }).level, 4);
  assert.equal(checkOrder({ ...workOrder({ work }), level: 5 }), 'a work order\'s level is 1, 2, 3 or 4');
});

test('the order takes the project\'s caps in place of the lane\'s', () => {
  const work = { id: 'card-1', lane: 'quick', goal: 'A goal', done: [{ test: 'x' }] };
  assert.deepEqual(workOrder({ work, caps: { minutes: 30, tokens: 1500000 } }).caps, { minutes: 30, tokens: 1500000 });
});

test('the column in force becomes the pack\'s tier bindings: large for critical work, medium for building, small for mechanical work', () => {
  const roles = { builderCritical: { model: 'model-a' }, builder: { model: 'model-b' }, mechanical: { model: 'model-c' }, reviewer: { model: 'model-c' } };
  assert.deepEqual(bindingsOf(roles), { tiers: { large: 'model-a', medium: 'model-b', small: 'model-c' } });
  assert.deepEqual(bindingsOf({ builder: { model: 'model-b' }, mechanical: { model: null } }), { tiers: { medium: 'model-b' } });
  assert.deepEqual(bindingsOf({}), {}, 'no models named: the pack\'s own tiers stand');
  assert.deepEqual(bindingsOf(null), {});
});

test('the order carries the director\'s answers to earlier questions, each capped, the latest kept', () => {
  assert.deepEqual(workOrder({ work: WORK }).answers, []);
  const long = 'x'.repeat(ANSWER_CHARS + 50);
  const answers = Array.from({ length: MOST_ANSWERS + 2 }, (_, i) => ({ question: `Question ${i}?`, answer: `Answer ${i}` }));
  const order = workOrder({ work: WORK, answers: [...answers, { question: long, answer: long }] });
  assert.equal(order.answers.length, MOST_ANSWERS);
  assert.deepEqual(order.answers.at(-1), { question: 'x'.repeat(ANSWER_CHARS), answer: 'x'.repeat(ANSWER_CHARS) });
  assert.equal(order.answers[0].question, 'Question 3?', 'the oldest go first');
  assert.equal(checkOrder(order), null);
  assert.match(checkOrder({ ...order, answers: [{ question: 'Q?' }] }), /answers/);
  assert.match(checkOrder({ ...order, answers: [{ question: 'Q?', answer: long }] }), /answers/);
  assert.throws(() => workOrder({ work: WORK, answers: [{ question: 'Q?', answer: 3 }] }), /answers/);
});

test('only a fix-main order names an incident', async () => {
  const { workOrder: make, checkOrder: check } = await import('../../../scripts/engine/order.js');
  const order = make({ work: { id: 'fix-main-red-main-0123456789', lane: 'fix-main', goal: 'Green again', done: [{ command: 'npm test', expect: 0 }] } });
  assert.equal(check({ ...order, incident: 'red-main-0123456789' }), null);
  assert.match(check({ ...order, incident: 'Has Spaces' }), /incident/);
  assert.match(check({ ...order, lane: 'quick', incident: 'red-main-0123456789' }), /incident/);
});

const SLICE = { ...WORK, id: 'orders', lane: 'slice', goal: 'List the orders' };
const FLAG = { name: 'order-history', file: DEFAULT_FLAG_FILE };

test('a slice order carries its slice, flag and demo, and is shown first only when the core says so', () => {
  const order = workOrder({ work: SLICE, extra: { slice: { n: 1, of: 2, title: 'List' }, flag: FLAG, demo: false, showFirst: false } });
  assert.deepEqual(order.slice, { n: 1, of: 2, title: 'List' });
  assert.deepEqual(order.flag, FLAG);
  assert.equal(order.demo, false);
  assert.equal(order.showFirst, false, 'a slice of visible work waits only at its demo');
  assert.equal(DEFAULT_FLAG_FILE, 'config/feature-flags.json');
  const how = workOrder({ work: SLICE, extra: { slice: { n: 2, of: 2, title: 'Filter' }, flag: { name: 'order-history', how: 'Set ORDERS_V2=1 in .env' }, demo: true, showFirst: true } });
  assert.equal(how.showFirst, true);
  assert.equal(checkOrder(how), null);
});

test('a feature order lists its merged slices', () => {
  const head = 'a'.repeat(40);
  const order = workOrder({ work: { ...SLICE, lane: 'feature' }, extra: { flag: FLAG, feature: { slices: [{ n: 1, title: 'List', pr: 70, head }] }, showFirst: true } });
  assert.deepEqual(order.feature, { slices: [{ n: 1, title: 'List', pr: 70, head }] });
  assert.equal(order.showFirst, true);
});

test('a feature field on the wrong lane, or out of shape, is refused', () => {
  assert.throws(() => workOrder({ work: WORK, extra: { slice: { n: 1, of: 1, title: 'x' } } }), /only a slice order/i);
  assert.throws(() => workOrder({ work: SLICE, extra: { feature: { slices: [] } } }), /only a feature order/i);
  assert.throws(() => workOrder({ work: WORK, extra: { flag: FLAG } }), /only a slice or feature order/i);
  assert.throws(() => workOrder({ work: WORK, extra: { demo: true } }), /only a slice order/i);
  assert.throws(() => workOrder({ work: SLICE, extra: { slice: { n: 3, of: 2, title: 'x' } } }), /slice/i);
  assert.throws(() => workOrder({ work: SLICE, extra: { slice: { n: 1, of: 13, title: 'x' } } }), /slice/i);
  assert.throws(() => workOrder({ work: SLICE, extra: { flag: { name: 'x', file: '../x.json' } } }), /flag/i);
  assert.throws(() => workOrder({ work: SLICE, extra: { flag: { name: 'x', file: '/etc/x.json' } } }), /flag/i);
  assert.throws(() => workOrder({ work: SLICE, extra: { flag: { name: 'x', file: 'flags.yaml' } } }), /flag/i);
  assert.throws(() => workOrder({ work: SLICE, extra: { flag: { name: 'Bad Name', file: DEFAULT_FLAG_FILE } } }), /flag/i);
  assert.throws(() => workOrder({ work: SLICE, extra: { flag: { name: 'x', how: 'y'.repeat(501) } } }), /flag/i);
  assert.throws(() => workOrder({ work: { ...SLICE, lane: 'feature' }, extra: { feature: { slices: [{ n: 1, title: 'x', pr: 0, head: 'a'.repeat(40) }] } } }), /feature/i);
});

test('a test check on a project with no command is refused, in words', () => {
  const config = { testCommand: null, testsNotCounting: true };
  assert.throws(() => workOrder({ work: { ...WORK, done: [{ test: 'prices' }] }, routing: {}, config }), /test check needs the project's test command/);
});

test('a tried list goes in the order, and a badly made one is refused', () => {
  const tried = [{ run: 'r1', step: 'implement', failure: 'other', checks: ['the banner shows'] }, { run: 'r2', step: null, failure: 'host', checks: [] }];
  const base = { work: { id: 'card-1', lane: 'quick', goal: 'A banner', done: [{ test: 'banner' }] }, config: { testCommand: 'npm test' } };
  const order = workOrder({ ...base, extra: { tried } });
  assert.deepEqual(order.tried, tried);
  assert.equal(workOrder(base).tried, undefined);
  assert.equal(checkOrder(order), null);
  for (const bad of ['r1', [{ run: 'r1' }], [{ ...tried[0], words: 'do this' }], [{ ...tried[0], step: 'x'.repeat(201) }], Array.from({ length: 6 }, () => tried[0])]) {
    assert.match(checkOrder({ ...order, tried: bad }), /tried list/);
  }
});
