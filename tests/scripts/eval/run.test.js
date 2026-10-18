// tests/scripts/eval/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScenario, main } from '../../../scripts/eval/run.js';

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
