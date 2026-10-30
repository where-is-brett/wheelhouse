// tests/scripts/eval/scenarios-120-134.test.js
// The build-loop scenarios 20 to 35 rewritten against the pack (tests/eval/build-loop/120 to 134, Archon design section
// 18): each plays on the fake engine and passes; a scenario fails when what it guards gives way; and the old engine's
// sessions keep their own numbers beside them until v0.3.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScenario } from '../../../scripts/eval/run.js';
import { runEngineScenario } from '../../../scripts/eval/engine-world.js';
import { asking, quickRun } from '../../eval/build-loop/engine-recordings.js';

const REWRITES = { 120: 20, 121: 21, 122: 22, 123: 23, 124: 24, 126: 26, 127: 27, 133: 33, 134: 34 };

for (const [id, old] of Object.entries(REWRITES)) {
  test(`scenario ${id}, ${old} on the pack, passes on the fake engine`, async () => {
    const scenario = await loadScenario(Number(id));
    assert.deepEqual(Object.keys(scenario.variants), ['with'], 'without Wheelhouse there is no engine to play on');
    const got = await runEngineScenario({ scenario });
    assert.equal(got.pass, true, got.why);
  });
}

test('the old engine\'s sessions keep their numbers beside the rewrites, and start a session, not an engine play', async () => {
  for (const old of [...new Set(Object.values(REWRITES))]) {
    const scenario = await loadScenario(old);
    assert.equal(scenario.engine, undefined, `scenario ${old} would play on the engine and no longer start its session`);
    assert.ok(scenario.variants.with && scenario.variants.without, `scenario ${old} keeps both its variants`);
  }
});

test('scenario 122 fails when the step\'s question is answered for the director', async () => {
  const scenario = await loadScenario(122);
  const recordings = { 'card-122': asking('card-122', { level: 2, answer: 'a' }) };
  const got = await runEngineScenario({ scenario: { ...scenario, engine: { ...scenario.engine, recordings } } });
  assert.equal(got.pass, false);
  assert.match(got.why, /no card came/);
});

test('scenario 123 fails when a finished run asks the director something', async () => {
  const scenario = await loadScenario(123);
  const recordings = { 'card-123q': asking('card-123q', { level: 3 }) };
  const got = await runEngineScenario({ scenario: { ...scenario, engine: { ...scenario.engine, recordings } } });
  assert.equal(got.pass, false);
  assert.match(got.why, /asked the director something/);
});

test('scenario 126 fails when the next slice never starts after the director\'s click', async () => {
  const scenario = await loadScenario(126);
  const recordings = { 'orders-export': [quickRun('orders-export', { pr: 1261 }).map((e) => (e.type === 'run-started' ? { ...e, lane: 'slice' } : e))] };
  const got = await runEngineScenario({ scenario: { ...scenario, engine: { ...scenario.engine, recordings, host: () => ({ prState: async () => ({ state: 'open' }) }) } } });
  assert.equal(got.pass, false);
});
