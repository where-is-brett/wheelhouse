// tests/scripts/eval/scenarios-70-75.test.js
// The feature scenarios (tests/eval/build-loop/70 to 75, Archon design sections 7.2 and 18): a scenario fails when what
// it guards gives way. That each passes on the fake engine is in scenarios-engine.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScenario } from '../../../scripts/eval/run.js';
import { runEngineScenario } from '../../../scripts/eval/engine-world.js';
import { mergingHost, sliceRun } from '../../eval/build-loop/engine-recordings.js';

test('scenario 70 fails when the code host never reads a slice merged', async () => {
  const scenario = await loadScenario(70);
  const got = await runEngineScenario({ scenario: { ...scenario, engine: { ...scenario.engine, host: () => ({ prState: async () => ({ state: 'open' }) }) } } });
  assert.equal(got.pass, false);
  assert.match(got.why, /slice 2 didn't start/);
});

test('scenario 72 fails when the slice All stop cancelled had already merged and so isn\'t carried on', async () => {
  const scenario = await loadScenario(72);
  const merged = new Set([721, 722]);
  const recordings = { 'card-72': [sliceRun('card-72', { pr: 721 }), sliceRun('card-72', { pr: 722 }), sliceRun('card-72')] };
  const got = await runEngineScenario({ scenario: { ...scenario, engine: { ...scenario.engine, recordings, host: () => mergingHost(merged) } } });
  assert.equal(got.pass, false);
});
