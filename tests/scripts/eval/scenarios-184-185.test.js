// tests/scripts/eval/scenarios-184-185.test.js
// The goal's checks (tests/eval/build-loop/184 and 185, unattended goals design, sections 4.1 and 8): each plays on the
// fake engine, through the real helper. Run with
//   node --test --import ./tests/helpers/test-home.js tests/scripts/eval/scenarios-184-185.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScenario } from '../../../scripts/eval/run.js';
import { runEngineScenario } from '../../../scripts/eval/engine-world.js';
import { goalChecked } from '../../eval/build-loop/engine-recordings.js';

for (const id of [184, 185]) {
  test(`scenario ${id} passes on the fake engine`, async () => {
    const got = await runEngineScenario({ scenario: await loadScenario(id) });
    assert.equal(got.pass, true, got.why);
  });
}

test('scenario 185 fails when the run\'s word has the late piece passing', async () => {
  const scenario = await loadScenario(185);
  const [baseline, last] = scenario.engine.recordings['goal-check'];
  const said = JSON.parse(last[1].output).results.map((r) => ({ ...r, ok: true }));
  const got = await runEngineScenario({ scenario: { ...scenario, engine: { ...scenario.engine, recordings: { 'goal-check': [baseline, goalChecked('last', said)] } } } });
  assert.equal(got.pass, false);
});
