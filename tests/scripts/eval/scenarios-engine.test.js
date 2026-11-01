// tests/scripts/eval/scenarios-engine.test.js
// The engine's scenarios (tests/eval/build-loop/42 to 55, Archon design section 18): each plays on the fake engine and
// the real helper, in a world of its own, and passes; a scenario fails when what it guards gives way; and how
// `npm run eval` runs them: `--engine fake` plays only the scenarios that have an engine play, and starts no session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, loadScenario } from '../../../scripts/eval/run.js';
import { parseArgs } from '../../../scripts/eval/harness.js';
import { runEngineScenario } from '../../../scripts/eval/engine-world.js';
import { asking, bugBlocked, smallBlocked } from '../../eval/build-loop/engine-recordings.js';
import { tempFolder } from '../../helpers/homes.js';
import fs from 'node:fs';
import path from 'node:path';

// The fix-main scenarios (60 to 62) play in the same suite; they are tested in scenarios-60-62.test.js. So do the bug
// lane's (63 to 69). The feature scenarios (70 to 75) are tested in scenarios-70-75.test.js too.
const ENGINE_SCENARIOS = [42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 90, 91, 92, 93, 94];

test('--engine takes the fake or real Archon, and goes with scenario numbers, --all or --suite alone', () => {
  assert.equal(parseArgs(['42', '--engine', 'fake']).engine, 'fake');
  assert.equal(parseArgs(['--suite', 'build-loop', '--engine=fake']).engine, 'fake');
  assert.equal(parseArgs(['42']).engine, undefined);
  assert.equal(parseArgs(['--suite', 'build-loop', '--engine', 'archon']).engine, 'archon');
  assert.throws(() => parseArgs(['42', '--engine', 'orchestrator']), /--engine takes fake or archon, not orchestrator/);
  assert.throws(() => parseArgs(['--again', '--engine', 'fake']), /give it no --ready, --again, --agent or --level/);
  assert.throws(() => parseArgs(['42', '--engine', 'fake', '--agent', 'copilot']), /give it no/);
});

for (const id of ENGINE_SCENARIOS) {
  test(`scenario ${id} passes on the fake engine`, async () => {
    const scenario = await loadScenario(id);
    assert.deepEqual(Object.keys(scenario.variants), ['with'], 'without Wheelhouse there is no engine to play on');
    const got = await runEngineScenario({ scenario });
    assert.equal(got.pass, true, got.why);
  });
}

test('scenario 49 fails when the main line\'s hold comes to the director as a card', async () => {
  const scenario = await loadScenario(49);
  const got = await runEngineScenario({ scenario: { ...scenario, engine: { ...scenario.engine, recordings: { 'card-49': asking('card-49') } } } });
  assert.equal(got.pass, false);
});

test('scenario 52 fails when the task\'s question is answered for the director with no card', async () => {
  const scenario = await loadScenario(52);
  const recording = smallBlocked('card-52').map((e) => (e.type === 'ask' ? { ...e, level: 1, card: false, answer: 'rework', line: 'Sent back.' } : e));
  const got = await runEngineScenario({ scenario: { ...scenario, engine: { ...scenario.engine, recordings: { 'card-52': recording } } } });
  assert.equal(got.pass, false);
});

test('scenario 67 fails when the engine\'s record says the planted reproduction went red', async () => {
  const scenario = await loadScenario(67);
  const got = await runEngineScenario({ scenario: { ...scenario, engine: { ...scenario.engine, red: { red: true } } } });
  assert.equal(got.pass, false);
});

test('scenario 65 fails when the bug lane starts the work again after the director moved it up', async () => {
  const scenario = await loadScenario(65);
  const recording = bugBlocked('card-65', 'no-reproduction', 'Not reproduced.');
  const got = await runEngineScenario({ scenario: { ...scenario, engine: { ...scenario.engine, recordings: { 'card-65': recording } } } });
  assert.equal(got.pass, false);
});

test('--engine fake plays only the engine\'s scenarios, and starts no session', async () => {
  const sessions = [];
  const played = [];
  const said = [];
  const code = await main(['42', '20', '--engine', 'fake'], {
    home: tempFolder('wh-s42-'), print: (line) => said.push(line), commit: null, version: null,
    run: async ({ scenario }) => { sessions.push(scenario.id); return { pass: true, handled: true, why: 'stand-in', file: null, usage: { input: 0, output: 0 }, line: '' }; },
    engineRun: async ({ scenario, engine }) => { played.push([scenario.id, engine]); return { pass: true, why: 'played' }; },
  });
  assert.deepEqual(sessions, []);
  assert.deepEqual(played, [[42, 'fake']]);
  assert.ok(said.includes('20: not run (it doesn\'t play on the build engine)'));
  assert.ok(said.includes('42 with: pass (played)'));
  assert.equal(code, 1, 'a scenario named and not run is no pass');
});

test("an engine scenario's run record carries the tokens its play spent, so a real run's spend is in the report", async () => {
  const home = tempFolder('wh-s42-spend-');
  await main(['42', '--engine', 'archon'], {
    home, print: () => {}, commit: null, version: null,
    run: async () => { throw new Error('no session starts'); },
    engineRun: async () => ({ pass: true, why: 'played', played: 'real', usage: { input: 125000, output: 900 } }),
  });
  const dir = path.join(home, '.wheelhouse-evals', 'runs');
  const record = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'));
  assert.deepEqual(record.runs.map((r) => r.usage), [{ input: 125000, output: 900 }]);
});

test('the build-loop suite on the fake engine is the engine scenarios, in their with variant', async () => {
  const played = [];
  const code = await main(['--suite', 'build-loop', '--engine', 'fake'], {
    home: tempFolder('wh-s42-suite-'), print: () => {}, commit: null, version: null,
    run: async () => { throw new Error('no session starts'); },
    engineRun: async ({ scenario, variant }) => { played.push([scenario.id, variant]); return { pass: true, why: 'played' }; },
  });
  // With 20 to 35 rewritten against the pack (120 to 134, tested in scenarios-120-134.test.js).
  assert.deepEqual(played, [...ENGINE_SCENARIOS, 120, 121, 122, 123, 124, 126, 127, 133, 134].map((id) => [id, 'with']));
  assert.equal(code, 0);
});
