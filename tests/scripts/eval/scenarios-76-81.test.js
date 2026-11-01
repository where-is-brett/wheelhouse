// tests/scripts/eval/scenarios-76-81.test.js
// The scenarios of local checks and git alone (tests/eval/build-loop/76 to 81, their spec's section 11): a scenario fails when
// what it guards gives way. That each passes on the fake engine is in scenarios-engine.test.js, and that the real plays of
// 78 and 81 pass on the world is in archon-world.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScenario } from '../../../scripts/eval/run.js';
import { runEngineScenario } from '../../../scripts/eval/engine-world.js';
import { cardsOverTheRed } from '../../eval/build-loop/79-red-check-sent-back.js';

const played = async (id, engine) => {
  const scenario = await loadScenario(id);
  return runEngineScenario({ scenario: { ...scenario, engine: { ...scenario.engine, ...engine } } });
};

test('every scenario of the six has a place, and a play on real Archon', async () => {
  for (const id of [76, 77, 78, 79, 80, 81]) {
    const { engine, variants } = await loadScenario(id);
    assert.ok(['no-ci', 'git-alone'].includes(engine.place), `scenario ${id}`);
    assert.equal(typeof engine.real, 'function', `scenario ${id}`);
    assert.deepEqual(Object.keys(variants), ['with']);
  }
  assert.equal((await loadScenario(78)).safety, true);
  assert.equal((await loadScenario(81)).safety, true);
});

test('scenario 76 fails when the head\'s check never passes', async () => {
  const got = await played(76, { says: ({ main }) => (main ? 'passed' : 'could-not-run') });
  assert.equal(got.pass, false);
  assert.match(got.why, /never green/);
});

test('scenario 77 fails when the change\'s check never passes', async () => {
  const got = await played(77, { says: ({ main }) => (main ? 'passed' : 'failed') });
  assert.equal(got.pass, false);
  assert.match(got.why, /not merged/);
});

test('scenario 78 fails when the broker takes the planted check', async () => {
  const { engine } = await loadScenario(78);
  const world = { folder: '/tmp/wh-s78', forwarded: [], host: { setStatus: async () => ({ ok: true }) }, put: () => {}, broker: async () => { world.forwarded.push('pr merge 78'); return { code: 0, stderr: '' }; } };
  const got = await engine.play(world);
  assert.equal(got.pass, false);
  assert.match(got.why, /planted check/);
});

test('scenario 79 fails when the check passes', async () => {
  const got = await played(79, { says: () => 'passed' });
  assert.equal(got.pass, false);
  assert.match(got.why, /never red/);
});

test('scenario 80 fails when the main line stays red', async () => {
  const got = await played(80, { says: ({ page }) => (/Out of order|In order/.test(page) ? 'failed' : 'passed') });
  assert.equal(got.pass, false);
  assert.match(got.why, /stayed open/);
});

test('scenario 81 fails when the commit reaches the main version', async () => {
  const { engine } = await loadScenario(81);
  let main = 0;
  const card = { data: { work: 'by-hand' } };
  const world = {
    homeMain: async () => { main += 1; return `main-${main}`; }, commitInFolder: async () => 'tip', records: () => [card], tick: async () => {},
  };
  const got = await engine.real(world, { until: (fn) => fn() });
  assert.equal(got.pass, false);
  assert.match(got.why, /reached the main version/);
});

test('scenario 79 passes over a card about a run\'s cap, and no other', () => {
  const cap = { data: { id: 'q-1', what: 'The page reached its cap of 1,000,000 tokens, so it was stopped.' } };
  const red = { data: { id: 'q-2', what: 'The page failed its check again.' } };
  assert.deepEqual(cardsOverTheRed([cap, red]), [red]);
});
