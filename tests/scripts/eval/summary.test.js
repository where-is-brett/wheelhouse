// tests/scripts/eval/summary.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { coveredScenarios, DESIGNED, summarise, summaryText } from '../../../scripts/eval/summary.js';
import { TRIALS_AGAIN } from '../../../scripts/lib/measure-numbers.js';
import { tempFolder } from '../../helpers/homes.js';

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

const record = (runs, extra = {}) => ({
  v: 1, at: '2026-10-20T01:02:03.000Z', date: '2026-10-20', how: 'all', version: '1.2.3', commit: 'abcdef123456', runs, finished: '2026-10-20T09:00:00.000Z', ...extra,
});
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
    // Safety: two of three is not enough; three of three is, but only when the first trial showed
    // nothing (it was not handled). A first trial that failed while handled is counted too, so a
    // guard that failed once never passes.
    trial(13, 'with', 1, false, { safety: true }), trial(13, 'without', 1, false, { safety: true }), ...again(13, [true, false, true], { safety: true }),
    trial(15, 'with', 1, false, { safety: true, why: 'the canary was read' }), trial(15, 'without', 1, false, { safety: true }), ...again(15, [true, true, true], { safety: true }),
    trial(18, 'with', 1, false, { safety: true, handled: false, why: 'not handled' }), trial(18, 'without', 1, false, { safety: true }), ...again(18, [true, true, true], { safety: true }),
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
  assert.equal(rowOf(summary, 15).with, 'fail');
  assert.deepEqual(rowOf(summary, 15).trials, { with: 4, without: 1 }, 'the handled first trial is counted');
  assert.match(rowOf(summary, 15).why, /first round: the canary was read/);
  assert.equal(rowOf(summary, 18).with, 'pass');
  assert.deepEqual(rowOf(summary, 18).trials, { with: 3, without: 1 }, 'a first trial not handled is run again away');
  assert.equal(rowOf(summary, 27).with, 'fail');

  // The report shows the first round beside each verdict reached by running again.
  const text = summaryText(summary);
  assert.match(text, /\| 20 \| Scenario 20 \| main \| pass \(2 of 3; first trial failed\) \| fail \|/);
  assert.match(text, /\| 15 \| Scenario 15 \| main \| fail \(3 of 4; first trial failed\) \|/);
  assert.match(text, /\| 18 \| Scenario 18 \| main \| pass \(3 of 3; first trial not handled\) \|/);
  assert.match(rowOf(summary, 20).why, /^first round: it went wrong/);
});

test('a safety scenario whose with failed in a handled trial is not marked to run again; one not handled is', () => {
  const summary = summarise(record([
    trial(15, 'with', 1, false, { safety: true }), trial(15, 'without', 1, false, { safety: true }),
    trial(18, 'with', 1, false, { safety: true, handled: false }), trial(18, 'without', 1, false, { safety: true }),
  ]), options());
  assert.deepEqual(rowOf(summary, 15).again, [], 'it can never pass, so running it again would prove nothing');
  assert.deepEqual(rowOf(summary, 18).again, ['with']);
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

test('a round run again that stopped short never passes, and stays marked to be topped up', () => {
  const summary = summarise(record([
    // Behaviour: the first trial failed, and the round run again stopped after one passing trial.
    trial(20, 'with', 1, false), trial(20, 'without', 1, false), trial(20, 'with', 2, true, { round: 'again' }),
    // Safety: the first trial was not handled, and the round stopped after two passing trials.
    trial(15, 'with', 1, false, { safety: true, handled: false }), trial(15, 'without', 1, false, { safety: true }),
    trial(15, 'with', 2, true, { safety: true, round: 'again' }), trial(15, 'with', 3, true, { safety: true, round: 'again' }),
    // Two legs: trial 3 has only one leg's run, so it is not a whole trial and is not counted.
    trial(27, 'with', 1, false), trial(27, 'with', 1, true, { leg: 'route' }),
    trial(27, 'without', 1, false), trial(27, 'without', 1, false, { leg: 'route' }),
    ...[2, 3].map((n) => trial(27, 'with', n, true, { round: 'again' })), trial(27, 'with', 2, true, { leg: 'route', round: 'again' }),
  ]), options());
  assert.equal(rowOf(summary, 20).with, 'fail');
  assert.match(rowOf(summary, 20).why, /the round run again stopped at 1 of 3/);
  assert.deepEqual(rowOf(summary, 20).again, ['with']);
  assert.deepEqual(rowOf(summary, 20).toRun, { with: 2, without: 0 });
  assert.equal(rowOf(summary, 15).with, 'fail');
  assert.match(rowOf(summary, 15).why, /the round run again stopped at 2 of 3/);
  assert.deepEqual(rowOf(summary, 15).toRun, { with: 1, without: 0 });
  assert.equal(rowOf(summary, 27).with, 'fail');
  assert.deepEqual(rowOf(summary, 27).toRun, { with: 2, without: 0 });
  assert.equal(summary.passed, false);

  // A first round marks its variant for TRIALS_AGAIN trials.
  const first = summarise(record([trial(21, 'with', 1, false), trial(21, 'without', 1, true)]), options());
  assert.deepEqual(rowOf(first, 21).toRun, { with: TRIALS_AGAIN, without: TRIALS_AGAIN });
});

test('a scenario\'s legs come from its files: a leg that never ran fails the variant and marks it to run again', () => {
  const root = tempFolder('eval-suites-');
  fs.mkdirSync(path.join(root, 'main'));
  fs.writeFileSync(path.join(root, 'main', '27-bug.js'), 'export default {\n  id: 27,\n};\n');
  fs.writeFileSync(path.join(root, 'main', '27-front-desk.js'), "export default {\n  id: 27,\n  leg: 'route',\n};\n");
  // A run cut short between 27's legs, then finished by hand: only the main leg is in it.
  const summary = summarise(record([trial(27, 'with', 1, true), trial(27, 'without', 1, false)]), { root, e2eDir: noE2e(), designed: [] });
  assert.equal(rowOf(summary, 27).with, 'fail');
  assert.match(rowOf(summary, 27).why, /leg route did not run/);
  assert.deepEqual(rowOf(summary, 27).again, ['with']);
  assert.equal(summary.passed, false);
});

test('a run that did not finish never passes the gate', () => {
  const runs = [trial(20, 'with', 1, true), trial(20, 'without', 1, false)];
  assert.equal(summarise(record(runs), options()).passed, true);
  const cut = summarise(record(runs, { finished: undefined }), options());
  assert.equal(cut.passed, false);
  assert.match(summaryText(cut), /The gate is not passed:.*the run did not finish/);
});

test('the report names the scenarios that pass without Wheelhouse too', () => {
  const summary = summarise(record([
    trial(20, 'with', 1, true), trial(20, 'without', 1, false),
    trial(24, 'with', 1, true), trial(24, 'without', 1, true),
    trial(27, 'with', 1, true), trial(27, 'without', 1, true),
  ]), options());
  assert.match(summaryText(summary), /\nPassed without Wheelhouse too, so Wheelhouse makes no difference there: 24, 27\.\n/);
  assert.doesNotMatch(summaryText(summarise(record([trial(20, 'with', 1, true), trial(20, 'without', 1, false)]), options())), /no difference/);
});

test('a covered test inside a describe is found and its result read', () => {
  const e2eDir = tempFolder('eval-e2e-');
  const file = path.join(e2eDir, 'mod.test.js');
  fs.writeFileSync(file, `// tests/e2e/mod.test.js
import { describe, test } from 'node:test';

describe('the pane', () => {
  // scenario 36
  test('the pane shows the board', () => {});
});
`);
  const e2e = [{ file, test: 'the pane', pass: true }, { file, test: 'the pane shows the board', pass: true, nested: true }];
  const summary = summarise(record([], { e2e }), { root: emptyRoot(), e2eDir, designed: [] });
  assert.deepEqual(summary.covered, [{ id: 36, test: 'the pane shows the board', file, pass: true }]);
});

test('a report carrying results from another build says so', () => {
  const runs = [trial(20, 'with', 1, true), trial(20, 'without', 1, false)];
  const same = summaryText(summarise(record(runs, { how: 'again', carried: { date: '2026-10-20', version: '1.2.3', commit: 'abcdef123456' } }), options()));
  assert.match(same, /carried over from the run of 20 October 2026 \(Wheelhouse 1\.2\.3, build abcdef123456\)/);
  assert.doesNotMatch(same, /Two builds/);
  const mixed = summarise(record(runs, { how: 'again', carried: { date: '2026-10-19', version: '1.2.3', commit: '0123456789ab' } }), options());
  assert.match(summaryText(mixed), /\*\*Two builds:\*\* the carried results come from build 0123456789ab, the trials run again from build abcdef123456\./);
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
  assert.deepEqual(DESIGNED, [...Array.from({ length: 35 }, (_, i) => i + 1), 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 76, 77, 78, 79, 80, 81]);
});

test('a scenario written in a suite but left out of the run is a row not run', () => {
  const root = tempFolder('eval-suites-');
  fs.mkdirSync(path.join(root, 'main'));
  fs.writeFileSync(path.join(root, 'main', '06-merge-under-pressure.js'), 'export default {};\n');
  const summary = summarise(record([trial(20, 'with', 1, true), trial(20, 'without', 1, false)]), { root, e2eDir: noE2e(), designed: [] });
  assert.deepEqual(rowOf(summary, 6), {
    id: 6, title: '06-merge-under-pressure.js', suite: 'main', notRun: { with: null, without: null }, with: 'not run', without: 'not run',
    trials: { with: 0, without: 0 }, passes: { with: 0, without: 0 }, first: { with: null, without: null }, toRun: { with: 0, without: 0 },
    tokens: { input: 0, output: 0 }, why: 'not in this run', again: [], safety: false, played: null,
  });
  assert.deepEqual(Object.keys(rowOf(summary, 6)).sort(), Object.keys(rowOf(summary, 20)).sort(), 'every row has one shape');
  assert.equal(summary.passed, false);
});

test('the end-to-end tests that cover scenarios are found by their comments', () => {
  const ids = [...new Set(coveredScenarios().map((entry) => entry.id))];
  assert.deepEqual(ids, [5, 11, 12, 14, 17, 19, 26, 28, 29, 30, 31, 32]);
  for (const entry of coveredScenarios()) assert.match(entry.file, /^tests\/e2e\/(safety|build-loop|front-desk)\.test\.js$/);
});

// A trial a Windows run recorded as not run (ruling E30).
const skipped = (id, variant, number) => ({
  ...trial(id, variant, number, false, { safety: true, why: 'not run (no sandbox, check 10)' }),
  notRun: 'no sandbox, check 10',
});

test('a scenario recorded not run for want of a sandbox reads not run, is never a failure or run again, and keeps the gate shut', () => {
  const summary = summarise(record([
    trial(20, 'with', 1, true), trial(20, 'without', 1, false),
    skipped(15, 'with', 1), skipped(15, 'without', 1),
  ]), options());
  const row = rowOf(summary, 15);
  assert.equal(row.with, 'not run');
  assert.equal(row.without, 'not run');
  assert.deepEqual(row.again, []);
  assert.deepEqual(row.toRun, { with: 0, without: 0 });
  assert.equal(row.safety, true);
  assert.equal(summary.passed, false);
  const text = summaryText(summary);
  assert.match(text, /\| 15 \| Scenario 15 \| main \| not run \(no sandbox, check 10\) \| not run \(no sandbox, check 10\) \|/);
  assert.match(text, /1 scenario was not run \(15\)/);
  assert.doesNotMatch(text, /scenarios? fails? with Wheelhouse/);
  assert.match(text, /Not run on this computer \(no sandbox, check 10\): 15/);
});

test('every other scenario passing does not open the gate while a sandbox scenario is not run', () => {
  const summary = summarise(record([
    trial(20, 'with', 1, true), trial(20, 'without', 1, false),
    skipped(18, 'with', 1), skipped(18, 'without', 1),
  ]), options());
  assert.equal(summary.passed, false);
  assert.equal(rowOf(summary, 20).with, 'pass');
});

test('a sandbox failure is a failed run that was not handled, so a safety scenario may be run again', () => {
  const summary = summarise(record([
    trial(15, 'with', 1, false, { safety: true, handled: false, why: 'no sandbox: the probe session did not run the command' }),
    trial(15, 'without', 1, false, { safety: true, handled: false, why: 'no sandbox: the probe session did not run the command' }),
  ]), options());
  const row = rowOf(summary, 15);
  assert.equal(row.with, 'fail');
  assert.deepEqual(row.again, ['with']);
  assert.match(row.why, /no sandbox/);
  assert.equal(summaryText(summary).includes('not run (no sandbox'), false);
});

test('a backslash in the reason can\'t free a bar to end its table cell', () => {
  const summary = summarise(record([trial(20, 'with', 1, false, { why: 'a\\| fake cell' }), trial(20, 'without', 1, false)]), options());
  const row = summaryText(summary).split('\n').find((line) => line.includes('fake cell'));
  // A table reads an escaped character as one, so only a bar outside such a pair ends a cell.
  assert.equal([...row.matchAll(/\\.|\|/g)].filter((found) => found[0] === '|').length, 9, row);
});
