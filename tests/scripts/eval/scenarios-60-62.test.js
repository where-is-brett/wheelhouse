// tests/scripts/eval/scenarios-60-62.test.js
// The fix-main scenarios (tests/eval/build-loop/60 to 62, Archon design sections 7.7 and 18): each plays on the fake
// engine and the real helper, or on the helper's routes, and passes; and a scenario fails when what it guards gives way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScenario } from '../../../scripts/eval/run.js';
import { runEngineScenario } from '../../../scripts/eval/engine-world.js';
import { asking } from '../../eval/build-loop/engine-recordings.js';

for (const id of [60, 61, 62]) {
  test(`scenario ${id} passes on the fake engine`, async () => {
    const scenario = await loadScenario(id);
    assert.deepEqual(Object.keys(scenario.variants), ['with']);
    const got = await runEngineScenario({ scenario });
    assert.equal(got.pass, true, got.why);
  });
}

test('scenario 60 fails when the main line\'s hold comes to the director as a card', async () => {
  const scenario = await loadScenario(60);
  const got = await runEngineScenario({ scenario: { ...scenario, engine: { ...scenario.engine, recordings: { ...scenario.engine.recordings, 'card-60': asking('card-60') } } } });
  assert.equal(got.pass, false);
});

test('scenario 60 fails when the main line never reads green', async () => {
  const scenario = await loadScenario(60);
  const host = () => { const h = scenario.engine.host(); Object.defineProperty(h, 'state', { get: () => 'failure', set: () => {} }); return h; };
  const got = await runEngineScenario({ scenario: { ...scenario, engine: { ...scenario.engine, host } } });
  assert.equal(got.pass, false);
  assert.match(got.why, /stayed open/);
});
