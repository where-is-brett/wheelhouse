// tests/scripts/eval/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScenario, loadScenarios, main } from '../../../scripts/eval/run.js';

test('loadScenario finds a scenario by its number', async () => {
  const scenario = await loadScenario(24);
  assert.equal(scenario.id, 24);
});

test('loadScenario names a scenario that does not exist', async () => {
  await assert.rejects(loadScenario(999), /No scenario 999/);
});

test('main refuses to run with no scenario named, before starting any session', async () => {
  await assert.rejects(main([]), /scenario/);
});

test('loadScenarios finds the front desk\'s scenarios in tests/eval/front-desk/, by number, beside the build loop\'s', async () => {
  for (const id of [1, 2, 3, 5, 7, 8, 9, 10, 16]) {
    const found = await loadScenarios(id);
    assert.deepEqual(found.map((s) => s.id), [id], `scenario ${id}`);
  }
  // A build loop number finds only its own: 20 is not 2, nor 2 the 20s.
  assert.deepEqual((await loadScenarios(20)).map((s) => s.id), [20]);
  assert.deepEqual((await loadScenarios('27-route')).map((s) => s.leg), ['route']);
  await assert.rejects(loadScenarios(4), /No scenario 4/);
});
