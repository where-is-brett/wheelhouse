// tests/scripts/engine/contract.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEngine, checkEvent, ENGINE_EVENTS, ASK_KINDS, SPEND_SOURCES } from '../../../scripts/engine/contract.js';
import { fakeEngine } from '../../../scripts/engine/fake.js';

const at = '2026-10-29T01:00:00.000Z';

test('checkEngine names a missing method', () => {
  assert.deepEqual(checkEngine(fakeEngine()), []);
  assert.deepEqual(checkEngine({ health() {}, start() {}, watch() {}, act() {}, inspect() {} }), ['stopAll']);
  assert.equal(checkEngine(null).length, 6);
});

test('the lists name what the interface reports', () => {
  assert.deepEqual([...ENGINE_EVENTS], ['run-started', 'step-finished', 'ask', 'ask-resolved', 'run-ended']);
  assert.deepEqual([...ASK_KINDS], ['question', 'approval', 'blocked', 'usage-limit', 'trouble']);
  assert.deepEqual([...SPEND_SOURCES], ['reported', 'estimated', 'unknown']);
});

test('checkEvent accepts a well-formed event and says what is wrong with others', () => {
  assert.equal(checkEvent({ type: 'run-started', runId: 'r', at }), null);
  assert.match(checkEvent({ type: 'nonsense', runId: 'r', at }), /unknown type/);
  assert.match(checkEvent({ type: 'run-started', at }), /run id/);
  assert.match(checkEvent({ type: 'ask', runId: 'r', at, id: 'a', kind: 'weird', options: [] }), /unknown kind/);
  assert.equal(checkEvent({ type: 'ask', runId: 'r', at, id: 'a', kind: 'blocked', options: [] }), null);
});

test('unknown spend is never zero', () => {
  const step = (spend) => ({ type: 'step-finished', runId: 'r', at, step: 's', role: 'implementer', spend });
  assert.equal(checkEvent(step({ tokens: null, dollars: null, source: 'unknown' })), null);
  assert.match(checkEvent(step({ tokens: 0, dollars: 0, source: 'unknown' })), /never zero/);
  assert.equal(checkEvent(step({ tokens: 10, dollars: null, source: 'reported' })), null);
});
