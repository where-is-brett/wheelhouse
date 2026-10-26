// tests/scripts/eval/level-run.test.js
// A run on a Thoroughness level's column (`--level`) and the readiness step that follows it (`--ready`), with
// stand-ins only: no real session starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../../../scripts/eval/run.js';
import { parseArgs, runScenario, runSession } from '../../../scripts/eval/harness.js';
import { PINS_VARIABLE, fileHash, levelRouting } from '../../../scripts/eval/ready.js';
import { columnLines } from '../../../scripts/routing/in-force.js';
import { tempFolder } from '../../helpers/homes.js';
import { barRun, PINS } from '../../helpers/ready-records.js';

const quiet = () => {};
const pinsEnv = { [PINS_VARIABLE]: JSON.stringify(PINS) };

function suite(files) {
  const root = tempFolder('eval-suites-');
  fs.mkdirSync(path.join(root, 'build-loop'));
  for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(root, 'build-loop', name), source);
  return root;
}
const scenarioSource = (id) => `export default {
  id: ${id},
  title: 'Scenario ${id}',
  prompt: 'Do the thing.',
  variants: { with: { pluginDirs: [] }, without: { pluginDirs: [] } },
  setup: async () => {},
  pass: () => ({ pass: true, why: 'it looked fine' }),
};
`;

test('--level takes Lean, Lightest or the premium model with its project, never Thorough, and not with --again', () => {
  assert.equal(parseArgs(['20', '--level', 'lean']).level, 'lean');
  assert.equal(parseArgs(['20', '--level=lightest']).level, 'lightest');
  for (const level of ['thorough', 'balanced', 'x']) assert.throws(() => parseArgs(['20', '--level', level]), /--level takes lean, lightest or premium/);
  assert.deepEqual(parseArgs(['20', '--level', 'premium', '--project', 'o__p']).project, 'o__p');
  assert.throws(() => parseArgs(['20', '--level', 'premium']), /--level premium needs --project/);
  assert.throws(() => parseArgs(['20', '--level', 'lean', '--project', 'o__p']), /--project goes only/);
  assert.throws(() => parseArgs(['--again', '--level', 'lean']), /--again/);
  assert.equal(parseArgs(['20']).level, undefined);
});

test('--ready takes a level and a project, and nothing else', () => {
  assert.deepEqual(parseArgs(['--ready', 'lean', '--project', 'o__p']), { ids: [], variants: ['with', 'without'], trials: 1, ready: 'lean', project: 'o__p' });
  assert.throws(() => parseArgs(['--ready', 'thorough', '--project', 'o__p']), /--ready takes lean, lightest or premium/);
  assert.equal(parseArgs(['--ready', 'premium', '--project', 'o__p']).ready, 'premium');
  assert.throws(() => parseArgs(['--ready', 'lean']), /--project/);
  assert.throws(() => parseArgs(['20', '--ready', 'lean', '--project', 'o__p']), /--ready/);
  assert.throws(() => parseArgs(['--ready', 'lean', '--project', 'o__p', '--level', 'lean']), /--ready/);
  assert.throws(() => parseArgs(['20', '--project', 'o__p']), /--project/);
});

test('--level without the pins in the shell is refused in plain words, before any session', async () => {
  const calls = [];
  const run = async () => { calls.push('ran'); return {}; };
  await assert.rejects(main(['20', '--variant', 'with', '--level', 'lean'], { root: suite({ '20-a.js': scenarioSource(20) }), home: tempFolder('eval-home-'), print: quiet, run, env: {} }), new RegExp(`needs ${PINS_VARIABLE} set in the shell`));
  assert.deepEqual(calls, []);
  await assert.rejects(main(['20', '--level', 'lean', '--agent', 'copilot'], { root: suite({ '20-a.js': scenarioSource(20) }), home: tempFolder('eval-home-'), print: quiet, run, env: pinsEnv }), /Claude Code/);
});

test('a level\'s run gives each trial the column, and its records name the level, the pins and each trial file\'s hash', async () => {
  const home = tempFolder('eval-home-');
  const seen = [];
  const run = async ({ scenario, variant, trial, home: h, date, column }) => {
    seen.push(column);
    const file = path.join(h, '.wheelhouse-evals', date, `${scenario.id}-${variant}-${trial}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"x":1}\n');
    return { pass: true, handled: true, why: 'ok', file, line: `${scenario.id} ${variant}: pass`, usage: { input: 1, output: 1 } };
  };
  const code = await main(['20', '--variant', 'with', '--trials', '2', '--level', 'lean'], {
    root: suite({ '20-a.js': scenarioSource(20) }), home, print: quiet, run, env: pinsEnv, now: () => new Date('2026-10-25T01:00:00.000Z'), commit: 'abc',
  });
  assert.equal(code, 0);
  assert.equal(seen.length, 2);
  for (const column of seen) {
    assert.equal(column.level, 'lean');
    assert.deepEqual(column.pins, PINS);
    assert.deepEqual(column.routing, levelRouting({ level: 'lean', pins: PINS }));
  }
  const runs = path.join(home, '.wheelhouse-evals', 'runs');
  const record = JSON.parse(fs.readFileSync(path.join(runs, fs.readdirSync(runs)[0]), 'utf8'));
  assert.equal(record.level, 'lean');
  assert.deepEqual(record.pins, PINS);
  for (const entry of record.runs) {
    assert.equal(entry.level, 'lean');
    assert.deepEqual(entry.pins, PINS);
    assert.equal(entry.sha256, fileHash('{"x":1}\n'));
  }
  // A run with no level gives no column, and its records name none.
  const plain = [];
  await main(['20', '--variant', 'with'], { root: suite({ '20-a.js': scenarioSource(20) }), home: tempFolder('eval-home-'), print: quiet, run: async (a) => { plain.push(a.column); return run(a); }, env: pinsEnv });
  assert.deepEqual(plain, [null]);
});

// A stand-in for claude that keeps its arguments in `argsFile`, lists `flags` in its help, and prints a short session.
function argvClaude(argsFile, flags) {
  const folder = tempFolder('eval-claude-');
  const script = path.join(folder, 'claude.mjs');
  const lines = [
    { type: 'system', subtype: 'init', model: 'model-top', session_id: 's1' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'Done.', usage: {} },
  ];
  fs.writeFileSync(script, `import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--help')) { process.stdout.write(${JSON.stringify(flags.map((f) => `  ${f} <value>\n`).join(''))}); process.exit(0); }
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify({ args, input }));
  process.stdout.write(${JSON.stringify(lines.map((l) => JSON.stringify(l)).join('\n') + '\n')});
});
`);
  return (options) => runSession({ ...options, command: process.execPath, commandArgs: [script] });
}
const BASE_FLAGS = ['--print', '--output-format', '--verbose', '--permission-mode', '--plugin-dir', '--setting-sources', '--strict-mcp-config', '--disallowedTools', '--settings', '--model'];

test('the column\'s model, effort, fallback and lines reach a feature session\'s call', async () => {
  const argsFile = path.join(tempFolder('eval-args-'), 'args.json');
  const runner = argvClaude(argsFile, [...BASE_FLAGS, '--effort', '--fallback-model']);
  const routing = levelRouting({ level: 'lean', pins: PINS });
  const column = { level: 'lean', pins: PINS, routing };
  const judged = [];
  const scenario = {
    id: 20,
    title: 'a feature session',
    setup: async () => ({ session: 'feature', model: 'model-ignored' }),
    prompt: 'Read the brief and follow it.',
    variants: { with: { pluginDirs: [] } },
    pass: ({ column: given }) => { judged.push(given); return { pass: true, why: 'fine' }; },
  };
  const home = tempFolder('eval-home-');
  const outcome = await runScenario({ scenario, variant: 'with', trial: 1, home, date: '2026-10-25', runner, column });
  assert.equal(outcome.pass, true, outcome.why);
  const { args, input } = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
  const after = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(after('--model'), 'model-top');
  assert.equal(after('--effort'), 'medium');
  assert.equal(after('--fallback-model'), 'model-mid');
  const prompt = `${args.join('\n')}\n${input}`;
  assert.ok(prompt.includes(['Read the brief and follow it.', '', ...columnLines(routing)].join('\n')), prompt);
  assert.ok(prompt.includes('builder: model model-mid, effort medium'));
  assert.deepEqual(judged, [column]);
  const written = JSON.parse(fs.readFileSync(outcome.file, 'utf8'));
  assert.deepEqual([written.level, written.pins, written.model, written.effort, written.fallback], ['lean', PINS, 'model-top', 'medium', 'model-mid']);

  // A session that is not a feature session's (a front desk's) keeps its own model and prompt, and still names the level.
  const desk = { ...scenario, id: 27, leg: 'route', setup: async () => ({ model: 'model-desk' }) };
  const second = await runScenario({ scenario: desk, variant: 'with', trial: 1, home, date: '2026-10-25', runner, column });
  const call = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
  assert.equal(call.args[call.args.indexOf('--model') + 1], 'model-desk');
  assert.equal(call.args.includes('--effort'), false);
  assert.equal(call.args.includes('--fallback-model'), false);
  assert.equal(`${call.args.join('\n')}\n${call.input}`.includes('Thoroughness'), false);
  const deskRecord = JSON.parse(fs.readFileSync(second.file, 'utf8'));
  assert.deepEqual([deskRecord.level, deskRecord.pins, deskRecord.effort], ['lean', PINS, undefined]);
  assert.deepEqual(judged.at(-1), null);
});

test('a session\'s effort and fallback are checked before claude starts', async () => {
  const argsFile = path.join(tempFolder('eval-args-'), 'args.json');
  const runner = argvClaude(argsFile, [...BASE_FLAGS, '--effort', '--fallback-model']);
  const dir = tempFolder('eval-session-');
  const base = { dir, prompt: 'x', pluginDirs: [], permissionMode: 'acceptEdits', maxTurns: 1, model: 'model-top' };
  await assert.rejects(runner({ ...base, effort: 'max' }), /thinking effort/);
  await assert.rejects(runner({ ...base, fallback: '--x' }), /fallback model/);
  // A claude whose help doesn't list --effort is refused.
  const old = argvClaude(argsFile, BASE_FLAGS);
  await assert.rejects(old({ ...base, effort: 'low' }), /--effort/);
});

test('--ready has the helper record the level only on a full set, and says what is missing otherwise', async () => {
  const home = tempFolder('eval-home-');
  const evals = path.join(home, '.wheelhouse-evals');
  barRun(evals, { level: 'lean', skip: (s, t) => s === '34' && t === 3 });
  const sent = [];
  const helper = () => ({ state: { columnReady: async (body) => { sent.push(body); return { ok: true, id: 'e1', pushed: true }; } } });
  const printed = [];
  const print = (line) => printed.push(line);
  assert.equal(await main(['--ready', 'lean', '--project', 'o__p'], { home, print, env: pinsEnv, helper }), 1);
  assert.deepEqual(sent, []);
  assert.ok(printed.some((l) => l.includes('scenario 34: 2 of 3 passing trials, 1 trial is missing')), printed.join('\n'));
  assert.ok(printed.some((l) => /Lean is not ready/.test(l)));

  barRun(evals, { level: 'lean', at: '2026-10-25T09:00:00.000Z', only: ['34'], from: 4, trials: 1 });
  printed.length = 0;
  assert.equal(await main(['--ready', 'lean', '--project', 'o__p'], { home, print, env: pinsEnv, helper }), 0);
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0]).sort(), ['column', 'pins', 'project', 'records']);
  assert.deepEqual([sent[0].project, sent[0].column, sent[0].pins], ['o__p', 'lean', PINS]);
  assert.equal(sent[0].records.length, 21);
  assert.ok(sent[0].records.includes('2026-10-25/34-with-4.json'));
  assert.ok(printed.some((l) => /Lean is recorded ready/.test(l)), printed.join('\n'));

  // The helper's refusal is said, and the run fails.
  printed.length = 0;
  const refusing = () => ({ state: { columnReady: async () => ({ ok: false, refused: 'those pins are not the project\'s' }) } });
  assert.equal(await main(['--ready', 'lean', '--project', 'o__p'], { home, print, env: pinsEnv, helper: refusing }), 1);
  assert.ok(printed.some((l) => l.includes('those pins are not the project\'s')));
  // No pins in the shell: refused.
  await assert.rejects(main(['--ready', 'lean', '--project', 'o__p'], { home, print, env: {}, helper }), new RegExp(PINS_VARIABLE));
});

// The premium model's run (design section 14.6, "What the Yes starts"): stand-ins only, never a real session.
const PREMIUM_PINS = Object.freeze({ ...PINS, premium: 'model-premium' });
const premiumEnv = { [PINS_VARIABLE]: JSON.stringify(PREMIUM_PINS) };
const helperSaying = (answer, seen = []) => () => ({ premium: { state: async (body) => { seen.push(body); return answer; } } });

test('the premium model\'s run starts nothing unless the director\'s Yes allows paid credits on the pin the shell names', async () => {
  const calls = [];
  const run = async () => { calls.push('ran'); return {}; };
  const go = (helper) => main(['20', '--variant', 'with', '--level', 'premium', '--project', 'o__p'], { root: suite({ '20-a.js': scenarioSource(20) }), home: tempFolder('eval-home-'), print: quiet, run, env: premiumEnv, helper });
  await assert.rejects(go(helperSaying({ ok: true, value: 'off', pin: null })), /isn't allowed for o__p/);
  await assert.rejects(go(helperSaying({ ok: true, value: 'within-plan', pin: 'model-premium' })), /within the plan only/);
  await assert.rejects(go(helperSaying({ ok: true, value: 'paid-too', pin: 'model-other' })), /is model-other, not model-premium/);
  await assert.rejects(go(helperSaying({ ok: true, value: 'paid-too', pin: null })), /not set yet/);
  await assert.rejects(go(helperSaying({ ok: false, refused: 'STOP is on' })), /couldn't say/);
  await assert.rejects(go(() => { throw new Error('no helper'); }), /couldn't say/);
  assert.deepEqual(calls, []);
  // Two pins are not enough for it.
  await assert.rejects(main(['20', '--variant', 'with', '--level', 'premium', '--project', 'o__p'], { root: suite({ '20-a.js': scenarioSource(20) }), home: tempFolder('eval-home-'), print: quiet, run, env: pinsEnv, helper: helperSaying({ ok: true, value: 'paid-too', pin: 'model-premium' }) }), /three models/);
  assert.deepEqual(calls, []);
});

test('with paid credits allowed, the premium model\'s run starts each feature session on it, at high, falling back to the most capable', async () => {
  const seen = [];
  const asked = [];
  const run = async ({ scenario, variant, trial, home: h, date, column }) => {
    seen.push(column);
    const file = path.join(h, '.wheelhouse-evals', date, `${scenario.id}-${variant}-${trial}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{}\n');
    return { pass: true, why: 'ok', file, usage: { input: 1, output: 1 } };
  };
  const code = await main(['20', '--variant', 'with', '--level', 'premium', '--project', 'o__p'], { root: suite({ '20-a.js': scenarioSource(20) }), home: tempFolder('eval-home-'), print: quiet, run, env: premiumEnv, helper: helperSaying({ ok: true, value: 'paid-too', pin: 'model-premium' }, asked) });
  assert.equal(code, 0);
  assert.deepEqual(asked, [{ project: 'o__p' }]);
  assert.equal(seen[0].level, 'premium');
  assert.deepEqual(seen[0].pins, PREMIUM_PINS);
  assert.deepEqual(seen[0].routing.roles.feature, { model: 'model-premium', effort: 'high', fallback: 'model-top' });
  assert.equal(seen[0].routing.roles.reviewerCritical.model, 'model-top');
});
