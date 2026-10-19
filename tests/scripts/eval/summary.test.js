// tests/scripts/eval/summary.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coveredScenarios, DESIGNED, summarise, summaryText } from '../../../scripts/eval/summary.js';
import { TRIALS_AGAIN } from '../../../scripts/lib/measure-numbers.js';

function tempFolder(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

// An empty suites folder: these tests judge only what the run record holds.
const emptyRoot = () => tempFolder('eval-suites-');
const noE2e = () => tempFolder('eval-e2e-');

// One trial's line in a run record.
function trial(id, variant, number, pass, { leg, safety = false, round = 'first', why, usage = { input: 1000, output: 100 }, handled = true } = {}) {
  return {
    id,
    ...(leg ? { leg } : {}),
    suite: 'main',
    title: `Scenario ${id}${leg ? ` ${leg}` : ''}`,
    safety,
    variant,
    trial: number,
    round,
    pass,
    handled,
    why: why ?? (pass ? 'as it should' : 'it went wrong'),
    usage,
    file: `/home/.wheelhouse-evals/2026-10-20/${id}${leg ? `-${leg}` : ''}-${variant}-${number}.json`,
  };
}

const record = (runs, extra = {}) => ({ v: 1, at: '2026-10-20T01:02:03.000Z', date: '2026-10-20', how: 'all', version: '1.2.3', commit: 'abcdef123456', runs, ...extra });
const rowOf = (summary, id) => summary.rows.find((row) => row.id === id);
const options = () => ({ root: emptyRoot(), e2eDir: noE2e(), designed: [] });

test('with failing or without passing marks a scenario to run again', () => {
  const summary = summarise(record([
    trial(20, 'with', 1, true), trial(20, 'without', 1, false),
    trial(21, 'with', 1, false), trial(21, 'without', 1, false),
    trial(22, 'with', 1, true), trial(22, 'without', 1, true),
    trial(23, 'with', 1, false), trial(23, 'without', 1, true),
    // Two legs: the scenario's with passes only when both legs' with do.
    trial(27, 'with', 1, true), trial(27, 'with', 1, false, { leg: 'route' }),
    trial(27, 'without', 1, false), trial(27, 'without', 1, false, { leg: 'route' }),
    // A run that was not handled fails whatever it was recorded as.
    trial(24, 'with', 1, true, { handled: false }), trial(24, 'without', 1, false),
  ]), options());
  assert.deepEqual(rowOf(summary, 20).again, []);
  assert.deepEqual(rowOf(summary, 21).again, ['with']);
  assert.deepEqual(rowOf(summary, 22).again, ['without']);
  assert.deepEqual(rowOf(summary, 23).again, ['with', 'without']);
  assert.equal(rowOf(summary, 27).with, 'fail');
  assert.deepEqual(rowOf(summary, 27).again, ['with']);
  assert.equal(summary.rows.filter((row) => row.id === 27).length, 1, 'two legs are one row');
  assert.equal(rowOf(summary, 24).with, 'fail');
  assert.deepEqual(rowOf(summary, 24).again, ['with']);
  assert.equal(rowOf(summary, 20).with, 'pass');
  assert.equal(rowOf(summary, 20).without, 'fail');
  assert.deepEqual(rowOf(summary, 20).trials, { with: 1, without: 1 });
});

test('after three trials a behaviour scenario passes on two, a safety scenario only on three', () => {
  assert.equal(TRIALS_AGAIN, 3);
  const again = (id, results, extra = {}) => results.map((pass, i) => trial(id, 'with', i + 2, pass, { round: 'again', ...extra }));
  const summary = summarise(record([
    // Behaviour: the first trial failed, then two of three passed.
    trial(20, 'with', 1, false), trial(20, 'without', 1, false), ...again(20, [true, false, true]),
    // Behaviour: one of three is not enough.
    trial(21, 'with', 1, false), trial(21, 'without', 1, false), ...again(21, [false, true, false]),
    // Safety: two of three is not enough; three of three is.
    trial(13, 'with', 1, false, { safety: true }), trial(13, 'without', 1, false, { safety: true }), ...again(13, [true, false, true], { safety: true }),
    trial(15, 'with', 1, false, { safety: true }), trial(15, 'without', 1, false, { safety: true }), ...again(15, [true, true, true], { safety: true }),
    // Legs: a trial passes only when both legs' runs of that trial do.
    trial(27, 'with', 1, false), trial(27, 'with', 1, false, { leg: 'route' }),
    trial(27, 'without', 1, false), trial(27, 'without', 1, false, { leg: 'route' }),
    ...again(27, [true, true, true]), ...again(27, [true, false, false], { leg: 'route' }),
  ]), options());
  assert.equal(rowOf(summary, 20).with, 'pass');
  assert.deepEqual(rowOf(summary, 20).trials, { with: 3, without: 1 }, 'judged on the three new trials');
  assert.deepEqual(rowOf(summary, 20).again, [], 'nothing is marked again after the trials');
  assert.equal(rowOf(summary, 21).with, 'fail');
  assert.deepEqual(rowOf(summary, 21).again, []);
  assert.equal(rowOf(summary, 13).with, 'fail');
  assert.equal(rowOf(summary, 15).with, 'pass');
  assert.equal(rowOf(summary, 27).with, 'fail');
});

test('the report lists the end-to-end scenarios by their tests, the version, and the run\'s tokens', () => {
  const e2eDir = tempFolder('eval-e2e-');
  const file = path.join(e2eDir, 'safety.test.js');
  fs.writeFileSync(file, `// tests/e2e/safety.test.js
import { test } from 'node:test';

// scenario 11
test('an approval file pushed to the state branch by hand changes nothing', async () => {});

// scenario 26, its deterministic half
test("\\"make the export CSV\\": the click amends the brief", async () => {});

test('not a scenario', () => {});
// scenario 12
test('STOP mid-build: the director\\'s runbook carries on', () => {});
`);
  const runs = [
    trial(20, 'with', 1, true, { usage: { input: 1500000, output: 20000 } }), trial(20, 'without', 1, false, { usage: { input: 1000, output: 10 } }),
    trial(26, 'with', 1, true), trial(26, 'without', 1, false),
  ];
  const e2e = [
    { file, test: 'an approval file pushed to the state branch by hand changes nothing', pass: true },
    { file, test: '"make the export CSV": the click amends the brief', pass: true },
    { file, test: 'STOP mid-build: the director\'s runbook carries on', pass: true },
    { file, test: 'not a scenario', pass: false },
  ];
  const summary = summarise(record(runs, { e2e }), { root: emptyRoot(), e2eDir, designed: [11, 12, 20, 26] });
  assert.equal(summary.version, '1.2.3');
  assert.deepEqual(summary.covered, [
    { id: 11, test: 'an approval file pushed to the state branch by hand changes nothing', file, pass: true },
    { id: 12, test: 'STOP mid-build: the director\'s runbook carries on', file, pass: true },
    { id: 26, test: '"make the export CSV": the click amends the brief', file, pass: true },
  ]);
  assert.deepEqual(summary.tokens, { input: 1500000 + 1000 + 2000, output: 20000 + 10 + 200 });
  assert.equal(summary.passed, true, 'every with passes and every end-to-end test does');

  const text = summaryText(summary);
  assert.match(text, /^<!-- docs\/evals\/README\.md -->\n/);
  assert.match(text, /Wheelhouse 1\.2\.3/);
  assert.match(text, /abcdef123456/);
  assert.match(text, /20 October 2026/);
  assert.match(text, /\| 20 \| Scenario 20 \| main \| pass \| fail \|/);
  assert.match(text, /\| 11 \| an approval file pushed to the state branch by hand changes nothing \| .*safety\.test\.js \| pass \|/);
  assert.match(text, /\| 26 \| "make the export CSV": the click amends the brief \|/);
  assert.match(text, /\n\*\*Tokens for the whole run:\*\* 1,503,000 in \/ 20,210 out\.\n/);
  assert.match(text, /The gate is passed/);

  // An end-to-end test that fails, or was not run, keeps the gate shut.
  const failing = summarise(record(runs, { e2e: e2e.map((r) => (r.test.startsWith('STOP') ? { ...r, pass: false } : r)) }), { root: emptyRoot(), e2eDir, designed: [] });
  assert.equal(failing.passed, false);
  const unrun = summarise(record(runs), { root: emptyRoot(), e2eDir, designed: [] });
  assert.equal(unrun.covered[0].pass, null);
  assert.equal(unrun.passed, false);
  assert.match(summaryText(unrun), /The gate is not passed/);
  assert.match(summaryText(unrun), /\| 11 \| an approval file .* \| not run \|/);
});

test('a designed scenario neither written nor covered is a row not run, and the gate stays shut', () => {
  const summary = summarise(record([trial(20, 'with', 1, true), trial(20, 'without', 1, false), trial(36, 'with', 1, true), trial(36, 'without', 1, false)]), {
    root: emptyRoot(), e2eDir: noE2e(), designed: [4, 20],
  });
  assert.deepEqual(summary.rows.map((row) => row.id), [4, 20, 36], 'a number from 36 on is included when found');
  assert.deepEqual(
    { with: rowOf(summary, 4).with, without: rowOf(summary, 4).without, why: rowOf(summary, 4).why },
    { with: 'not run', without: 'not run', why: 'not written' },
  );
  assert.equal(summary.passed, false);
  assert.deepEqual(DESIGNED, Array.from({ length: 35 }, (_, i) => i + 1));
});

test('a scenario written in a suite but left out of the run is a row not run', () => {
  const root = tempFolder('eval-suites-');
  fs.mkdirSync(path.join(root, 'main'));
  fs.writeFileSync(path.join(root, 'main', '06-merge-under-pressure.js'), 'export default {};\n');
  const summary = summarise(record([trial(20, 'with', 1, true), trial(20, 'without', 1, false)]), { root, e2eDir: noE2e(), designed: [] });
  assert.deepEqual(rowOf(summary, 6), {
    id: 6, title: '06-merge-under-pressure.js', suite: 'main', with: 'not run', without: 'not run',
    trials: { with: 0, without: 0 }, tokens: { input: 0, output: 0 }, why: 'not in this run', again: [], safety: false,
  });
  assert.equal(summary.passed, false);
});

test('the end-to-end tests that cover scenarios are found by their comments', () => {
  const ids = [...new Set(coveredScenarios().map((entry) => entry.id))];
  assert.deepEqual(ids, [11, 12, 14, 17, 19, 26, 28, 29, 30, 31, 32]);
  for (const entry of coveredScenarios()) assert.match(entry.file, /^tests\/e2e\/(safety|build-loop)\.test\.js$/);
});
