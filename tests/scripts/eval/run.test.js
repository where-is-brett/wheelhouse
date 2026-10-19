// tests/scripts/eval/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findScenario, findScenarioFiles, loadScenario, loadScenarios, main, parseTap,
} from '../../../scripts/eval/run.js';
import { parseArgs, runScenario, runSession, scenarioName, today } from '../../../scripts/eval/harness.js';
import { tempFolder } from '../../helpers/homes.js';

const evalRoot = fileURLToPath(new URL('../../eval/', import.meta.url));
const streamFixture = fileURLToPath(new URL('../../fixtures/eval/stream.jsonl', import.meta.url));

// A scenario module as a suite holds one: it passes whatever happened, so only the runner decides.
function scenarioSource(id, { leg, safety, title = `Scenario ${id}${leg ? ` ${leg}` : ''}` } = {}) {
  return `export default {
  id: ${id},
${leg ? `  leg: '${leg}',\n` : ''}${safety ? '  safety: true,\n' : ''}  title: ${JSON.stringify(title)},
  prompt: 'Do the thing.',
  variants: { with: { pluginDirs: [] }, without: { pluginDirs: [] } },
  setup: async () => {},
  pass: () => ({ pass: true, why: 'it looked fine' }),
};
`;
}

// Fixture suites under a temporary root: { suite: { file: source } }.
function suites(layout) {
  const root = tempFolder('eval-suites-');
  for (const [suite, files] of Object.entries(layout)) {
    fs.mkdirSync(path.join(root, suite), { recursive: true });
    for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(root, suite, name), source);
  }
  return root;
}

const twoSuites = () => suites({
  alpha: {
    '01-one.js': scenarioSource(1),
    '03-three.js': scenarioSource(3, { safety: true }),
    'shared.js': 'export const shared = 1;\n',
  },
  beta: {
    '02-two.js': scenarioSource(2),
    '27-bug.js': scenarioSource(27),
    '27-front-desk.js': scenarioSource(27, { leg: 'route' }),
  },
});

// An end-to-end folder with one test file whose comments say which scenario each test covers.
function e2eFolder() {
  const dir = tempFolder('eval-e2e-');
  fs.writeFileSync(path.join(dir, 'x.test.js'), `// tests/e2e/x.test.js
import { test } from 'node:test';

// scenario 5
test('scenario five holds', () => {});

test('not a scenario', () => {});
`);
  return dir;
}

// A stand-in for one trial: `outcome(name, variant, trial)` says whether it passes.
function standInRun(calls, outcome = () => true) {
  return async ({ scenario, variant, trial, home, date }) => {
    const name = scenarioName(scenario);
    calls.push(`${name} ${variant} ${trial}`);
    const pass = outcome(name, variant, trial);
    return {
      pass,
      handled: true,
      why: pass ? 'stand-in pass' : 'stand-in fail',
      file: path.join(home, '.wheelhouse-evals', date, `${name}-${variant}-${trial}.json`),
      line: `${name} ${variant}: ${pass ? 'pass' : 'fail'}`,
      usage: { input: 100, output: 10 },
    };
  };
}

const quiet = () => {};
const firstNow = () => new Date('2026-10-20T01:02:03.000Z');

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

test('a scenario is found in its suite; one in two suites is refused', async () => {
  const root = twoSuites();
  assert.equal(findScenario(1, { root }), path.join(root, 'alpha', '01-one.js'));
  assert.equal(findScenario('2', { root }), path.join(root, 'beta', '02-two.js'));
  assert.throws(() => findScenario(4, { root }), /No scenario 4/);
  // shared.js sits in a suite but is not a scenario.
  assert.throws(() => findScenario('shared', { root }), /shared/);

  // Two files of one number in one suite are legs, not two suites.
  assert.equal(findScenario(27, { root }), path.join(root, 'beta', '27-bug.js'));
  assert.equal(findScenario('27-route', { root }), path.join(root, 'beta', '27-front-desk.js'));
  assert.deepEqual(findScenarioFiles(27, { root }), [path.join(root, 'beta', '27-bug.js'), path.join(root, 'beta', '27-front-desk.js')]);
  assert.throws(() => findScenario('27-missing', { root }), /No scenario 27-missing/);
  assert.deepEqual((await loadScenarios(27, { root })).map((s) => s.leg ?? null), [null, 'route']);
  assert.deepEqual((await loadScenarios('27-route', { root })).map((s) => s.leg), ['route']);

  fs.mkdirSync(path.join(root, 'gamma'));
  fs.writeFileSync(path.join(root, 'gamma', '03-other.js'), scenarioSource(3));
  assert.throws(() => findScenario(3, { root }), /Scenario 3 is in two suites: alpha, gamma/);

  // The real suites: the build loop's scenario 24, and both of 27's legs.
  assert.equal(findScenario(24), path.join(evalRoot, 'build-loop', '24-override-wins.js'));
  assert.equal(findScenarioFiles(27).length, 2);
  assert.equal(findScenario('27-route'), path.join(evalRoot, 'build-loop', '27-front-desk-route.js'));
});

test('parseArgs reads --all, --suite and --again, and refuses to mix them with numbers', () => {
  assert.deepEqual(parseArgs(['--all']), { ids: [], variants: ['with', 'without'], trials: 1, all: true });
  assert.deepEqual(parseArgs(['--suite', 'main', '--variant', 'with']), { ids: [], variants: ['with'], trials: 1, suite: 'main' });
  assert.deepEqual(parseArgs(['--suite=main']), { ids: [], variants: ['with', 'without'], trials: 1, suite: 'main' });
  assert.deepEqual(parseArgs(['--again']), { ids: [], variants: ['with', 'without'], trials: 1, again: true });
  assert.throws(() => parseArgs(['--all', '24']), /--all/);
  assert.throws(() => parseArgs(['--all', '--suite', 'main']), /--all/);
  assert.throws(() => parseArgs(['--again', '--trials', '2']), /--again/);
  assert.throws(() => parseArgs(['--again', '--variant', 'with']), /--again/);
  assert.throws(() => parseArgs(['--suite']), /--suite/);
});

test('--all runs every suite in number order', async () => {
  const root = twoSuites();
  const home = tempFolder('eval-home-');
  const e2eDir = e2eFolder();
  const calls = [];
  const ranEndToEnd = [];
  const printed = [];
  const code = await main(['--all'], {
    root,
    home,
    e2eDir,
    now: firstNow,
    version: '1.2.3',
    commit: 'abcdef123456',
    print: (line) => printed.push(line),
    run: standInRun(calls),
    endToEnd: async (files) => {
      ranEndToEnd.push(...files);
      return [{ file: files[0], test: 'scenario five holds', pass: true }];
    },
  });
  assert.deepEqual(calls, [
    '1 with 1', '1 without 1',
    '2 with 1', '2 without 1',
    '3 with 1', '3 without 1',
    '27 with 1', '27 without 1', '27-route with 1', '27-route without 1',
  ]);
  assert.deepEqual(ranEndToEnd, [path.join(e2eDir, 'x.test.js')]);

  // One run record for the whole run, with every trial and the end-to-end results.
  const runsDir = path.join(home, '.wheelhouse-evals', 'runs');
  const records = fs.readdirSync(runsDir).filter((name) => name.endsWith('.json'));
  assert.equal(records.length, 1);
  const record = JSON.parse(fs.readFileSync(path.join(runsDir, records[0]), 'utf8'));
  assert.equal(record.how, 'all');
  assert.equal(record.version, '1.2.3');
  assert.equal(record.runs.length, 10);
  assert.deepEqual(record.runs.find((r) => r.leg === 'route' && r.variant === 'with'), {
    id: 27, leg: 'route', suite: 'beta', title: 'Scenario 27 route', safety: false, variant: 'with', trial: 1, round: 'first',
    pass: true, handled: true, why: 'stand-in pass', usage: { input: 100, output: 10 },
    file: path.join(home, '.wheelhouse-evals', today(firstNow()), '27-route-with-1.json'),
  });
  assert.deepEqual(record.e2e, [{ file: path.join(e2eDir, 'x.test.js'), test: 'scenario five holds', pass: true }]);

  // The report is printed and kept beside the run record. Most of 1 to 35 are not written here,
  // so the gate is not passed.
  const report = fs.readFileSync(path.join(runsDir, records[0].replace(/\.json$/, '.md')), 'utf8');
  assert.ok(printed.includes(report));
  assert.match(report, /Wheelhouse 1\.2\.3/);
  assert.equal(code, 1);
});

test('--suite runs one suite in number order, and an unknown suite names the suites there are', async () => {
  const root = twoSuites();
  const home = tempFolder('eval-home-');
  const calls = [];
  const code = await main(['--suite', 'beta', '--variant', 'with'], { root, home, now: firstNow, version: '0', commit: null, print: quiet, run: standInRun(calls) });
  assert.deepEqual(calls, ['2 with 1', '27 with 1', '27-route with 1']);
  assert.equal(code, 0);
  await assert.rejects(main(['--suite', 'nope'], { root, home, print: quiet, run: standInRun([]) }), /No suite nope: the suites are alpha, beta/);
});

test('a scenario named by its number runs every leg, and a leg id runs that leg alone', async () => {
  const root = twoSuites();
  const home = tempFolder('eval-home-');
  const calls = [];
  await main(['27', '--variant', 'with'], { root, home, now: firstNow, version: '0', commit: null, print: quiet, run: standInRun(calls) });
  await main(['27-route', '--variant', 'without', '--trials', '2'], { root, home, now: firstNow, version: '0', commit: null, print: quiet, run: standInRun(calls) });
  assert.deepEqual(calls, ['27 with 1', '27-route with 1', '27-route without 1', '27-route without 2']);
});

test('--again reruns what the last run marked, only the variant that marked it, after the trials already there', async () => {
  const root = twoSuites();
  const home = tempFolder('eval-home-');
  const e2eDir = e2eFolder();
  const options = {
    root, home, e2eDir, now: firstNow, version: '0', commit: null, print: quiet,
    endToEnd: async (files) => [{ file: files[0], test: 'scenario five holds', pass: true }],
  };
  // First run: 1's with fails, 2's without passes, 3 is clear, and 27's route leg fails with.
  const first = (name, variant) => {
    if (name === '1' && variant === 'with') return false;
    if (name === '2' && variant === 'without') return true;
    if (name === '27-route' && variant === 'with') return false;
    return variant === 'with';
  };
  await main(['--all'], { ...options, run: standInRun([], first) });
  // A trial 2 of 1's with is already there from earlier today: nothing is written over.
  const later = () => new Date('2026-10-20T01:03:03.000Z');
  const day = path.join(home, '.wheelhouse-evals', today(later()));
  fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(path.join(day, '1-with-2.json'), '{}\n');

  const calls = [];
  const printed = [];
  const code = await main(['--again'], {
    ...options, now: later, print: (line) => printed.push(line), run: standInRun(calls, (name, variant) => variant === 'with'),
  });
  assert.deepEqual(calls, [
    '1 with 3', '1 with 4', '1 with 5',
    '2 without 2', '2 without 3', '2 without 4',
    '27 with 2', '27 with 3', '27 with 4', '27-route with 2', '27-route with 3', '27-route with 4',
  ]);
  assert.ok(printed.some((line) => /Running again what .*runs.*\.json marked/.test(line)), 'it says which run record it read');

  const runsDir = path.join(home, '.wheelhouse-evals', 'runs');
  const records = fs.readdirSync(runsDir).filter((name) => name.endsWith('.json')).sort();
  assert.equal(records.length, 2);
  const record = JSON.parse(fs.readFileSync(path.join(runsDir, records[1]), 'utf8'));
  assert.equal(record.how, 'again');
  assert.equal(record.from, path.join(runsDir, records[0]));
  assert.deepEqual(record.carried, { date: today(firstNow()), version: '0', commit: null });
  assert.ok(printed.some((line) => /carried over from the run of/.test(line)), 'the report says what it carries over');
  assert.equal(record.runs.filter((r) => r.round === 'again').length, 12);
  assert.equal(record.runs.filter((r) => r.round === 'first').length, 10, 'the first run\'s trials are carried over');
  assert.deepEqual(record.e2e, [{ file: path.join(e2eDir, 'x.test.js'), test: 'scenario five holds', pass: true }]);
  assert.equal(code, 1, 'most of the designed set is not written in these suites');
});

test('a whole fixture run whose with runs and end-to-end tests all pass opens the gate', async () => {
  const root = twoSuites();
  const home = tempFolder('eval-home-');
  const e2eDir = e2eFolder();
  const printed = [];
  const code = await main(['--all'], {
    root, home, e2eDir, now: firstNow, version: '1.2.3', commit: 'abcdef123456', designed: [1, 2, 3, 5, 27],
    print: (line) => printed.push(line),
    run: standInRun([], (name, variant) => variant === 'with'),
    endToEnd: async (files) => [{ file: files[0], test: 'scenario five holds', pass: true }],
  });
  assert.equal(code, 0);
  assert.ok(printed.some((line) => /The gate is passed/.test(line)));
});

test('--again reads the last whole run, passing over a newer run of one scenario, and says so', async () => {
  const root = twoSuites();
  const home = tempFolder('eval-home-');
  const e2eDir = e2eFolder();
  const options = {
    root, home, e2eDir, version: '0', commit: null, print: quiet, designed: [],
    endToEnd: async (files) => [{ file: files[0], test: 'scenario five holds', pass: true }],
  };
  await main(['--all'], { ...options, now: firstNow, run: standInRun([], (name, variant) => (name === '1' ? false : variant === 'with')) });
  // A check of one scenario afterwards writes a record of its own.
  await main(['2', '--variant', 'with'], { ...options, now: () => new Date('2026-10-20T01:03:03.000Z'), run: standInRun([]) });
  const calls = [];
  const printed = [];
  await main(['--again'], { ...options, now: () => new Date('2026-10-20T01:04:03.000Z'), print: (line) => printed.push(line), run: standInRun(calls) });
  const runsDir = path.join(home, '.wheelhouse-evals', 'runs');
  const [whole, single] = fs.readdirSync(runsDir).filter((name) => name.endsWith('.json')).sort();
  assert.ok(printed.includes(`Running again what ${path.join(runsDir, whole)} marked`));
  assert.ok(printed.some((line) => line.includes(path.join(runsDir, single)) && /passed over/.test(line)));
  assert.deepEqual(calls, ['1 with 2', '1 with 3', '1 with 4']);
});

test('--again with nothing marked still prints the report, and exits by the gate', async () => {
  const root = twoSuites();
  const home = tempFolder('eval-home-');
  const e2eDir = e2eFolder();
  const options = {
    root, home, e2eDir, now: firstNow, version: '0', commit: null, designed: [],
    endToEnd: async (files) => [{ file: files[0], test: 'scenario five holds', pass: true }],
  };
  await main(['--all'], { ...options, print: quiet, run: standInRun([], (name, variant) => variant === 'with') });
  const printed = [];
  const calls = [];
  const code = await main(['--again'], { ...options, print: (line) => printed.push(line), run: standInRun(calls) });
  assert.deepEqual(calls, []);
  assert.equal(code, 0);
  assert.ok(printed.some((line) => /The gate is passed/.test(line)), 'the report is printed');

  // A safety scenario whose with failed in a handled trial is not run again, and keeps the gate shut.
  const shut = tempFolder('eval-home-');
  await main(['--all'], { ...options, home: shut, print: quiet, run: standInRun([], (name, variant) => variant === 'with' && name !== '3') });
  const again = [];
  assert.equal(await main(['--again'], { ...options, home: shut, print: (line) => again.push(line), run: standInRun([]) }), 1);
  assert.ok(again.some((line) => /The gate is not passed/.test(line)));
});

test('--again with no run before it says so', async () => {
  await assert.rejects(main(['--again'], { root: twoSuites(), home: tempFolder('eval-home-'), print: quiet, run: standInRun([]) }), /No run to run again/);
});

// A stand-in for claude: answers --help with the flags the harness checks, and otherwise prints
// `lines` and exits with `code`.
function standInClaude(lines, code = 0) {
  const folder = tempFolder('eval-claude-');
  const script = path.join(folder, 'claude.mjs');
  const flags = ['--print', '--output-format', '--verbose', '--permission-mode', '--plugin-dir', '--setting-sources'];
  fs.writeFileSync(script, `
const args = process.argv.slice(2);
if (args.includes('--help')) {
  process.stdout.write(${JSON.stringify(flags.map((flag) => `  ${flag} <value>\n`).join(''))});
  process.exit(0);
}
process.stdout.write(${JSON.stringify(lines.map((line) => JSON.stringify(line)).join('\n') + '\n')});
process.exit(${code});
`);
  return (options) => runSession({ ...options, command: process.execPath, commandArgs: [script] });
}

test('a session that made no tool call is a failed run whatever pass says', async () => {
  const home = tempFolder('eval-home-');
  const scenario = {
    id: 94,
    title: 'a stand-in',
    setup: async () => {},
    prompt: 'x',
    variants: { with: { pluginDirs: [] }, without: { pluginDirs: [] } },
    pass: () => ({ pass: true, why: 'nothing bad happened' }),
  };
  const init = { type: 'system', subtype: 'init' };
  // No tool call and no text, though the result says it went well.
  const silent = standInClaude([init, { type: 'result', subtype: 'success', is_error: false, result: '', usage: {} }]);
  const session = await silent({ dir: tempFolder('eval-session-'), prompt: 'x', pluginDirs: [], permissionMode: 'dontAsk', maxTurns: 1 });
  assert.equal(session.handled, false);
  const outcome = await runScenario({ scenario, variant: 'with', trial: 1, home, date: '2026-10-20', runner: silent });
  assert.equal(outcome.pass, false);
  assert.equal(outcome.handled, false);
  assert.match(outcome.line, /^94 with: fail \(not handled\)/);
  const written = JSON.parse(fs.readFileSync(outcome.file, 'utf8'));
  assert.equal(written.pass, false);
  assert.equal(written.handled, false);
  assert.deepEqual(written.judged, { pass: true, why: 'nothing bad happened' });

  // A non-zero exit before the first assistant turn.
  const crashed = standInClaude([init], 1);
  const second = await runScenario({ scenario, variant: 'with', trial: 2, home, date: '2026-10-20', runner: crashed });
  assert.equal(second.pass, false);
  assert.match(second.line, /^94 with: fail \(not handled; claude exited 1\)/);

  // A session that did work is handled, and its pass stands.
  const worked = standInClaude(fs.readFileSync(streamFixture, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)));
  const third = await runScenario({ scenario, variant: 'with', trial: 3, home, date: '2026-10-20', runner: worked });
  assert.equal(third.handled, true);
  assert.equal(third.pass, true);
});

test('parseTap reads each top-level test\'s name and result, Windows line ends too, and a skipped test is no pass', () => {
  const tap = [
    'TAP version 13',
    'ok 1 - the director\'s \\# one',
    '  ---',
    '  duration_ms: 1',
    '  ...',
    'not ok 2 - "two" fails',
    '    ok 1 - inner',
    'ok 3 - skipped # SKIP not here',
    'ok 4 - a back\\\\slash',
    '1..4',
  ].join('\r\n');
  assert.deepEqual(parseTap(tap), [
    { test: 'the director\'s # one', pass: true },
    { test: '"two" fails', pass: false },
    { test: 'skipped', pass: false, skipped: true },
    { test: 'a back\\slash', pass: true },
  ]);
});
