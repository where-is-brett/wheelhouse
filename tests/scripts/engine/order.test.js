// tests/scripts/engine/order.test.js
// The work order (Archon design, section 7.4): what one run is given, built from the work and the project's settings,
// and kept by the helper under the run's id so nothing an agent writes changes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workOrder, checkOrder, orderStore, LANE_CAPS, DECISION_RULES } from '../../../scripts/engine/order.js';
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
