// tests/scripts/eval/scenarios-38-41.test.js
// The four Copilot scenarios (tests/eval/copilot/, other-agents design section 9; rulings P8-25 to P8-27), retargeted to
// the build engine (Archon design, section 13): each plays on the fake engine and the pack's Copilot twins, with the
// clean home written as setup writes it. Each passes as Wheelhouse is, and fails with the safety it checks taken away.
// How `npm run eval` treats a scenario of one agent's is kept: left out of the default run and its report, run with
// `--agent copilot`, in its own variant only, and counted in that agent's designed set. No real Copilot runs; stand-ins
// for gh, glab and copilot come first on the PATH, and the last test asserts none of them ran (P7-23).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EVAL_ROOT, main } from '../../../scripts/eval/run.js';
import { DESIGNED, summarise } from '../../../scripts/eval/summary.js';
import { runEngineScenario } from '../../../scripts/eval/engine-world.js';
import { safetySubset, subsetPassed } from '../../../adapters/copilot/sessions.js';
import { UNKNOWN_TOOL } from '../../../adapters/copilot/translate.js';
import { adapterFor } from '../../../scripts/agents/index.js';
import safetyLine from '../../../adapters/copilot/safety-line.js';
import scenario38, { judge as judge38 } from '../../eval/copilot/38-guard-hangs.js';
import scenario39, { TOOL, judge as judge39 } from '../../eval/copilot/39-unknown-tool.js';
import scenario40 from '../../eval/copilot/40-agent-filled-answer.js';
import scenario41 from '../../eval/copilot/41-fake-verdict.js';
import { asArchonOnCopilot, builtPack, cleanHomeWorld } from '../../eval/copilot/copilot-engine.js';
import { tempFolder } from '../../helpers/homes.js';
import { standInTools } from '../../helpers/host-stand-ins.js';

const stand = standInTools();
after(() => stand.restore());

const SCENARIOS = [scenario38, scenario39, scenario40, scenario41];

test('each of the four is a safety scenario on Copilot alone, played on the build engine, with a `with` variant only', () => {
  assert.deepEqual(SCENARIOS.map((s) => s.id), [38, 39, 40, 41]);
  for (const s of SCENARIOS) {
    assert.deepEqual(s.agents, ['copilot']);
    assert.equal(s.safety, true);
    assert.deepEqual(Object.keys(s.variants), ['with']);
    assert.equal(typeof s.engine.play, 'function', `${s.id} plays on the engine`);
    assert.equal(s.setup, undefined, `${s.id} runs no session`);
  }
});

test('all four pass on the fake engine as Wheelhouse is', async () => {
  for (const scenario of SCENARIOS) {
    const got = await runEngineScenario({ scenario });
    assert.equal(got.pass, true, `${scenario.id}: ${got.why}`);
  }
});

test('38 fails when a guard waits longer, a twin drops a check, a review may edit, or the board says nothing', () => {
  const pack = builtPack();
  const home = cleanHomeWorld();
  try {
    const lines = [...safetyLine({ tier: 'lean', helper: true }), ...safetyLine({ tier: 'middle' })];
    const base = { registration: home.registration, workflow: pack.workflow, lines };
    assert.equal(judge38(base).pass, true);
    const slow = structuredClone(home.registration);
    slow.hooks.preToolUse[0].timeoutSec = 600;
    assert.match(judge38({ ...base, registration: slow }).why, /time-out of 600/);
    const dropped = (name) => {
      const wf = pack.workflow(name);
      return name === 'wheelhouse-quick-copilot' ? JSON.parse(JSON.stringify(wf).replaceAll('protected-check.js', 'nothing.js')) : wf;
    };
    assert.match(judge38({ ...base, workflow: dropped }).why, /dropped protected-check\.js/);
    const editing = (name) => {
      const wf = pack.workflow(name);
      if (name !== 'wheelhouse-quick-copilot') return wf;
      for (const node of wf.nodes) if (node.denied_tools) node.denied_tools = node.denied_tools.filter((t) => t !== 'apply_patch');
      return wf;
    };
    assert.match(judge38({ ...base, workflow: editing }).why, /may change files: its tool rules let apply_patch through/);
    assert.match(judge38({ ...base, lines: [] }).why, /board has no line/);
  } finally {
    pack.close();
    home.close();
  }
});

test('39 fails when the guard lets the unknown tool through or refuses it another way, or a rule names an unknown tool', () => {
  const refused = { code: 2, answer: { permissionDecision: 'deny', permissionDecisionReason: UNKNOWN_TOOL(TOOL) } };
  assert.equal(judge39({ refused, ruled: ['apply_patch'] }).pass, true);
  assert.match(judge39({ refused: { code: 0, answer: null }, ruled: [] }).why, /let multi_tool_use\.parallel through/);
  assert.match(judge39({ refused: { code: 2, answer: { permissionDecision: 'deny', permissionDecisionReason: 'something else' } }, ruled: [] }).why, /not as a tool it doesn't know/);
  assert.match(judge39({ refused, ruled: ['teleport'] }).why, /teleport/);
});

test('40 fails when its run isn\'t on Copilot\'s twin, or when the agent\'s unsigned answer reaches the engine', async () => {
  // An engine that starts the lane's own workflow, whatever the bindings.
  const own = { ...scenario40, engine: { ...scenario40.engine, adapt: (e) => { asArchonOnCopilot(e); const start = e.start; e.start = async (o) => { const got = await start(o); e.workflows[e.workflows.length - 1] = 'wheelhouse-quick'; return got; }; return e; } } };
  assert.match((await runEngineScenario({ scenario: own })).why, /not the quick lane's Copilot twin/);
  // A world in which an unsigned record counts as the director's: the engine is answered from it.
  const unsigned = { ...scenario40, engine: { ...scenario40.engine, play: async (world) => {
    const original = world.put;
    world.put = (kind, data, opts = {}) => original(kind, data, { ...opts, unsigned: false });
    return scenario40.engine.play(world);
  } } };
  assert.match((await runEngineScenario({ scenario: unsigned })).why, /answered from the agent's unsigned answer/);
});

test('41 plays on the engine\'s routes and signs only the review step', async () => {
  const got = await runEngineScenario({ scenario: scenario41 });
  assert.equal(got.pass, true, got.why);
  assert.match(got.why, /refused as no review step/);
});

// A stand-in for runScenario: notes each trial and the runner it was given, and passes.
function standInRun(ran) {
  return async ({ scenario, variant, trial, runner }) => {
    ran.push({ id: scenario.id, leg: scenario.leg ?? null, variant, trial, runner });
    return { pass: true, handled: true, why: 'stand-in', file: null, usage: { input: 0, output: 0 }, line: '' };
  };
}

test('without --agent, the run leaves the Copilot scenarios out, with no row in its report, and starts every other session as it always has', async () => {
  const ran = [];
  const home = tempFolder('wh-s38-all-');
  const code = await main(['--all', '--variant', 'with'], { home, run: standInRun(ran), endToEnd: async () => [], print: () => {}, commit: null, version: null });
  assert.equal(typeof code, 'number');
  assert.ok(ran.length > 0);
  assert.ok(ran.every((r) => r.id < 38 || r.id > 41));
  assert.ok(ran.every((r) => r.runner === undefined), 'runScenario keeps its own runner, runSession');
  const record = JSON.parse(fs.readFileSync(path.join(home, '.wheelhouse-evals', 'runs', fs.readdirSync(path.join(home, '.wheelhouse-evals', 'runs')).find((n) => n.endsWith('.json'))), 'utf8'));
  assert.equal(record.agent, undefined);
  assert.equal(record.leftOut, undefined);
  assert.equal(record.own, undefined);
  const rows = summarise(record, { designed: DESIGNED }).rows.map((row) => row.id);
  assert.ok(![38, 39, 40, 41].some((id) => rows.includes(id)));

  const named = [];
  const said = [];
  assert.equal(await main(['38'], { home: tempFolder('wh-s38-one-'), run: standInRun(named), print: (line) => said.push(line), commit: null, version: null }), 1);
  assert.deepEqual(named, []);
  assert.ok(said.includes('38: not run (it does not run on claude-code)'));
});

test('with --agent copilot, the run plays the four on the fake engine, in their with variant alone, and counts them in its designed set (P8-26)', async () => {
  const ran = [];
  const played = [];
  const home = tempFolder('wh-s38-agent-');
  const engineRun = async ({ scenario, variant, trial, engine }) => {
    played.push([scenario.id, variant, trial, engine]);
    return { pass: true, why: 'stand-in' };
  };
  const code = await main(['38', '39', '40', '41', '--agent', 'copilot'], { home, run: standInRun(ran), engineRun, print: () => {}, commit: null, version: null });
  assert.equal(code, 0);
  assert.deepEqual(played, [[38, 'with', 1, 'fake'], [39, 'with', 1, 'fake'], [40, 'with', 1, 'fake'], [41, 'with', 1, 'fake']]);
  assert.deepEqual(ran, [], 'no session runs for them');
  const runs = path.join(home, '.wheelhouse-evals', 'runs');
  const record = JSON.parse(fs.readFileSync(path.join(runs, fs.readdirSync(runs).find((n) => n.endsWith('.json'))), 'utf8'));
  assert.equal(record.agent, 'copilot');
  assert.ok([38, 39, 40, 41].every((id) => summarise(record, { designed: DESIGNED }).rows.some((row) => row.id === id)));

  // The whole run on Copilot: 1 to 37 and 38 to 41, each through Copilot's runner, and a report naming the agent.
  const all = [];
  const allHome = tempFolder('wh-s38-agent-all-');
  const allPlayed = [];
  await main(['--all', '--variant', 'with', '--agent', 'copilot'], { home: allHome, run: standInRun(all), engineRun: async ({ scenario }) => { allPlayed.push(scenario.id); return { pass: true, why: 'stand-in' }; }, endToEnd: async () => [], print: () => {}, commit: null, version: null });
  const ids = [...new Set([...all.map((r) => r.id), ...allPlayed])];
  for (const id of [4, 6, 13, 38, 39, 40, 41]) assert.ok(ids.includes(id), `scenario ${id}`);
  assert.ok(all.every((r) => r.runner === adapterFor('copilot').evalRunner.run), 'a session still runs through Copilot\'s runner');
  const allRuns = path.join(allHome, '.wheelhouse-evals', 'runs');
  const report = fs.readFileSync(path.join(allRuns, fs.readdirSync(allRuns).find((n) => n.endsWith('.md'))), 'utf8');
  assert.match(report, /sessions of the copilot agent/);
  const allRecord = JSON.parse(fs.readFileSync(path.join(allRuns, fs.readdirSync(allRuns).find((n) => n.endsWith('.json'))), 'utf8'));
  assert.equal(allRecord.agent, 'copilot');
  assert.ok(EVAL_ROOT.endsWith(path.join('tests', 'eval')));
});

// A suite root of its own: scenario files from `{ 'suite/NN-name.js': text }`.
function suiteRoot(files) {
  const root = tempFolder('wh-s38-root-');
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}
const scenarioText = (id, { agents = null, variants = ['with', 'without'], throws = false } = {}) => `${throws ? "throw new Error('imported');\n" : ''}export default {
  id: ${id},
  title: 'Scenario ${id}',
${agents === null ? '' : `  agents: ${JSON.stringify(agents).replaceAll('"', "'")},\n`}  variants: { ${variants.map((v) => `${v}: { pluginDirs: [] }`).join(', ')} },
  setup: () => ({}),
  prompt: 'x',
  pass: () => ({ pass: true, why: 'x' }),
};
`;

test('without --agent, a scenario of another agent\'s is never imported, and the run record is as it always was (Minor 6)', async () => {
  const root = suiteRoot({
    'a/01-plain.js': scenarioText(1),
    'b/38-other.js': scenarioText(38, { agents: ['copilot'], variants: ['with'], throws: true }),
  });
  const ran = [];
  const home = tempFolder('wh-s38-plain-');
  const code = await main(['--all', '--variant', 'with'], { root, home, run: standInRun(ran), endToEnd: async () => [], e2eDir: tempFolder('wh-s38-e2e-'), designed: [1], print: () => {}, commit: null, version: null });
  assert.equal(code, 0);
  assert.deepEqual(ran.map((r) => r.id), [1]);
  const runs = path.join(home, '.wheelhouse-evals', 'runs');
  const record = JSON.parse(fs.readFileSync(path.join(runs, fs.readdirSync(runs).find((n) => n.endsWith('.json'))), 'utf8'));
  assert.deepEqual(Object.keys(record).sort(), ['at', 'commit', 'date', 'e2e', 'finished', 'how', 'runs', 'v', 'version']);
  assert.deepEqual(summarise(record, { root, e2eDir: tempFolder('wh-s38-e2e-'), designed: [1] }).rows.map((r) => r.id), [1]);
  // A file whose agents can't be read from its text is refused when it is loaded.
  const odd = suiteRoot({ 'a/02-odd.js': `const OWN = ['copilot'];\n${scenarioText(2).replace("  title: 'Scenario 2',", "  title: 'Scenario 2',\n  agents: OWN,")}` });
  await assert.rejects(main(['2', '--variant', 'with', '--agent', 'copilot'], { root: odd, home: tempFolder('wh-s38-odd-'), run: standInRun([]), print: () => {}, commit: null, version: null }), /declares its agents in a form that can't be read from its text/);
});

test('a run of named scenarios fails when one of them is left out by its agents or lacks the variant asked for, the rest passing, and the subset fails with it (Important 1)', async () => {
  const root = suiteRoot({
    'main/06-claude-only.js': scenarioText(6, { agents: ['claude-code'] }),
    'copilot/38-a.js': scenarioText(38, { agents: ['copilot'], variants: ['with'] }),
    'copilot/39-b.js': scenarioText(39, { agents: ['copilot'], variants: ['with'] }),
    'copilot/40-c.js': scenarioText(40, { agents: ['copilot'], variants: ['without'] }),
    'copilot/41-d.js': scenarioText(41, { agents: ['copilot'], variants: ['with'] }),
  });
  const ran = [];
  const home = tempFolder('wh-s38-mixed-');
  const said = [];
  const code = await main(['6', '38', '39', '40', '41', '--variant', 'with', '--agent', 'copilot'], { root, home, run: standInRun(ran), print: (line) => said.push(line), commit: null, version: null });
  assert.equal(code, 1);
  assert.deepEqual(ran.map((r) => r.id), [38, 39, 41]);
  assert.ok(said.includes('6: not run (it does not run on copilot)'));
  assert.ok(said.includes('40: not run in with (it has no such variant)'));
  const line = said.find((l) => /run record: /.test(l));
  const record = JSON.parse(fs.readFileSync(line.replace(/^\s*run record: /, ''), 'utf8'));
  assert.equal(subsetPassed(record), false);
  // Exit 0 is never enough: the subset reads the record the command names.
  const stdout = `${line}\n`;
  assert.equal((await safetySubset({ run: async () => ({ code: 0, stdout, stderr: '' }) })).ok, false);
  // A record with a passing with trial of each of the five passes it.
  const full = { ...record, runs: [6, 38, 39, 40, 41].map((id) => ({ id, variant: 'with', trial: 1, pass: true, handled: true })) };
  const fullFile = path.join(tempFolder('wh-s38-full-'), 'record.json');
  fs.writeFileSync(fullFile, JSON.stringify(full));
  assert.equal(subsetPassed(full), true);
  assert.equal((await safetySubset({ run: async () => ({ code: 0, stdout: `  run record: ${fullFile}\n`, stderr: '' }) })).ok, true);
  assert.equal((await safetySubset({ run: async () => ({ code: 1, stdout: `  run record: ${fullFile}\n`, stderr: '' }) })).ok, false);
  assert.equal((await safetySubset({ run: async () => ({ code: 0, stdout: '', stderr: '' }) })).ok, false, 'no record named');
  assert.equal(subsetPassed({ ...full, agent: 'claude-code' }), false);
  assert.equal(subsetPassed({ ...full, finished: undefined }), false);
  assert.equal(subsetPassed({ ...full, runs: full.runs.map((r) => (r.id === 40 ? { ...r, pass: false } : r)) }), false);
  assert.equal(subsetPassed({ ...full, runs: full.runs.map((r) => (r.id === 39 ? { ...r, handled: false } : r)) }), false);
});

test('no real gh, glab or copilot ran in this file (P7-23)', () => {
  assert.deepEqual(stand.calls(), []);
});
