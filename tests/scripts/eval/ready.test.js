// tests/scripts/eval/ready.test.js
// A Thoroughness level's readiness (design section 14.6): the pins from the shell, the column a level's run starts a
// feature session on, and the check of the bar's records that `--ready` and the helper both make.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BAR, BAR_TRIALS, PINS_VARIABLE, fileHash, levelRouting, pinsFrom, readiness } from '../../../scripts/eval/ready.js';
import { tempFolder } from '../../helpers/homes.js';
import { barRun, PINS, trialRecord } from '../../helpers/ready-records.js';

const PREMIUM_PINS = Object.freeze({ ...PINS, premium: 'model-premium' });

test('the pins come from the shell, as two model names and nothing else, and are refused in plain words otherwise', () => {
  assert.deepEqual(pinsFrom({ [PINS_VARIABLE]: JSON.stringify(PINS) }), PINS);
  for (const env of [{}, { [PINS_VARIABLE]: '' }, { [PINS_VARIABLE]: 'not json' }, { [PINS_VARIABLE]: '{"mostCapable":"model-top"}' },
    { [PINS_VARIABLE]: '{"mostCapable":"model-top","midSized":"--flag"}' }, { [PINS_VARIABLE]: JSON.stringify({ ...PINS, premium: 'model-best' }) }]) {
    assert.throws(() => pinsFrom(env), new RegExp(PINS_VARIABLE));
  }
});

test('a level\'s routing is the waker\'s column at that level, ready, for Lean and Lightest only', () => {
  const lean = levelRouting({ level: 'lean', pins: PINS });
  assert.equal(lean.level, 'lean');
  assert.deepEqual(lean.roles.feature, { model: 'model-top', effort: 'medium', fallback: 'model-mid' });
  assert.equal(lean.roles.builder.model, 'model-mid');
  const lightest = levelRouting({ level: 'lightest', pins: PINS });
  assert.deepEqual(lightest.roles.feature, { model: 'model-mid', effort: 'high', fallback: 'model-top' });
  for (const level of ['balanced', 'thorough', undefined]) assert.throws(() => levelRouting({ level, pins: PINS }), /Lean, Lightest or the premium model/);
  // The premium pass: Thorough's column with the premium model for design and critical work, at high.
  assert.throws(() => levelRouting({ level: 'premium', pins: PINS }), /all three/);
  const premium = levelRouting({ level: 'premium', pins: PREMIUM_PINS });
  assert.deepEqual(premium.roles.feature, { model: 'model-premium', effort: 'high', fallback: 'model-top' });
  assert.deepEqual(premium.roles.builderCritical, { model: 'model-premium', effort: 'high', fallback: 'model-top' });
  assert.equal(premium.roles.reviewerCritical.model, 'model-top');
  assert.equal(premium.extra.secondReviewer, true);
});

test('the premium pass takes three pins from the shell, the premium model never another class\'s', () => {
  assert.deepEqual(pinsFrom({ [PINS_VARIABLE]: JSON.stringify(PREMIUM_PINS) }, 'premium'), PREMIUM_PINS);
  for (const pins of [PINS, { ...PINS, premium: 'model-top' }, { ...PREMIUM_PINS, more: 'x' }]) {
    assert.throws(() => pinsFrom({ [PINS_VARIABLE]: JSON.stringify(pins) }, 'premium'), new RegExp(PINS_VARIABLE));
  }
});

test('the premium pass is ready on a full set of its own trials, on all three pins, and a level\'s trials never count for it', () => {
  const evals = tempFolder('eval-ready-');
  barRun(evals, { level: 'premium', pins: PREMIUM_PINS, yes: 'yes-1' });
  // Only the runs made under the director's Yes count.
  assert.equal(readiness({ evals, level: 'premium', pins: PREMIUM_PINS }).ok, false);
  assert.equal(readiness({ evals, level: 'premium', pins: PREMIUM_PINS, yes: 'yes-2' }).ok, false);
  const ready = readiness({ evals, level: 'premium', pins: PREMIUM_PINS, yes: 'yes-1' });
  assert.equal(ready.ok, true, ready.gaps.join('; '));
  assert.equal(readiness({ evals, level: 'premium', pins: { ...PREMIUM_PINS, premium: 'model-other' }, yes: 'yes-1' }).ok, false);
  assert.equal(readiness({ evals, level: 'lean', pins: PINS }).ok, false);
  const leanOnly = tempFolder('eval-ready-');
  barRun(leanOnly, { level: 'lean' });
  assert.equal(readiness({ evals: leanOnly, level: 'premium', pins: PREMIUM_PINS, yes: 'yes-1' }).ok, false);
  // A Lean trial naming the premium model still fails Lean's bar.
  const named = tempFolder('eval-ready-');
  barRun(named, { level: 'lean', record: (r) => ({ ...r, models: [...r.models, 'model-premium'] }) });
  assert.match(readiness({ evals: named, level: 'lean', pins: PINS, premium: 'model-premium' }).gaps.join('; '), /names the premium model/);
});

test('the bar is the feature-session scenarios, three trials each', () => {
  assert.deepEqual(BAR, ['20', '21', '22', '23', '27', '33', '34']);
  assert.equal(BAR_TRIALS, 3);
});

test('a full set of passing trials makes the level ready, naming each record', () => {
  const evals = tempFolder('eval-ready-');
  barRun(evals, { level: 'lean' });
  const ready = readiness({ evals, level: 'lean', pins: PINS });
  assert.equal(ready.ok, true, ready.gaps.join('; '));
  assert.equal(ready.commit, 'abc123def456');
  assert.equal(ready.records.length, BAR.length * BAR_TRIALS);
  assert.ok(ready.records.includes('2026-10-25/27-with-3.json'));
  // The helper's check of the same names passes too.
  assert.equal(readiness({ evals, level: 'lean', pins: PINS, given: ready.records }).ok, true);
  // Lightest has run nothing.
  const lightest = readiness({ evals, level: 'lightest', pins: PINS });
  assert.equal(lightest.ok, false);
  assert.ok(lightest.gaps.includes('scenario 20: 0 of 3 passing trials, 3 trials are missing'));
});

test('a failed trial keeps the level not ready, however many passed beside it', () => {
  const evals = tempFolder('eval-ready-');
  barRun(evals, { level: 'lean', fail: (scenario, trial) => scenario === '21' && trial === 2 });
  barRun(evals, { level: 'lean', at: '2026-10-25T09:00:00.000Z', only: ['21'], from: 4 });
  const ready = readiness({ evals, level: 'lean', pins: PINS });
  assert.equal(ready.ok, false);
  assert.deepEqual(ready.records, []);
  assert.ok(ready.gaps.some((g) => /^scenario 21 trial 2 failed \(stand-in fail\)$/.test(g)), ready.gaps.join('; '));
});

test('one counted run is one commit: trials of two commits never add up, and an older commit\'s failure doesn\'t block a later full pass', () => {
  const evals = tempFolder('eval-ready-');
  // Commit one: a failure and gaps. Commit two: only half the bar.
  barRun(evals, { level: 'lean', commit: 'aaaaaaa11111', fail: (s, t) => s === '20' && t === 1, only: ['20', '21', '22', '23'] });
  barRun(evals, { level: 'lean', commit: 'bbbbbbb22222', at: '2026-10-25T09:00:00.000Z', only: ['27', '33', '34'], from: 4 });
  const split = readiness({ evals, level: 'lean', pins: PINS });
  assert.equal(split.ok, false, 'two commits\' halves are not one pass');
  assert.ok(split.gaps.includes('scenario 20: 0 of 3 passing trials, 3 trials are missing'), split.gaps.join('; '));
  // Commit two then runs the rest of the bar: ready on commit two, though commit one failed.
  barRun(evals, { level: 'lean', commit: 'bbbbbbb22222', at: '2026-10-25T10:00:00.000Z', only: ['20', '21', '22', '23'], from: 4 });
  const ready = readiness({ evals, level: 'lean', pins: PINS });
  assert.equal(ready.ok, true, ready.gaps.join('; '));
  assert.equal(ready.commit, 'bbbbbbb22222');
  assert.ok(ready.records.every((n) => /-with-[4-6]\.json$/.test(n)));
  // A failure at commit two blocks commit two.
  barRun(evals, { level: 'lean', commit: 'bbbbbbb22222', at: '2026-10-25T11:00:00.000Z', only: ['33'], from: 7, trials: 1, fail: () => true });
  const blocked = readiness({ evals, level: 'lean', pins: PINS });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.gaps.some((g) => /^scenario 33 trial 7 failed/.test(g)), blocked.gaps.join('; '));
  // Names from two commits given together are refused.
  const mixed = readiness({ evals, level: 'lean', pins: PINS, given: [...ready.records.filter((n) => !n.startsWith('2026-10-25/20-')), '2026-10-25/20-with-2.json', '2026-10-25/20-with-3.json', '2026-10-25/20-with-4.json'] });
  assert.equal(mixed.ok, false);
});

test('a run record that names no commit counts for nothing', () => {
  const evals = tempFolder('eval-ready-');
  barRun(evals, { level: 'lean', commit: null });
  const ready = readiness({ evals, level: 'lean', pins: PINS });
  assert.equal(ready.ok, false);
  assert.ok(ready.gaps.includes('scenario 20: 0 of 3 passing trials, 3 trials are missing'));
});

test('a missing trial keeps the level not ready, and says which scenario', () => {
  const evals = tempFolder('eval-ready-');
  barRun(evals, { level: 'lean', skip: (scenario, trial) => scenario === '33' && trial === 3 });
  const ready = readiness({ evals, level: 'lean', pins: PINS });
  assert.equal(ready.ok, false);
  assert.deepEqual(ready.gaps, ['scenario 33: 2 of 3 passing trials, 1 trial is missing']);
});

test('a trial that was not handled is neither a pass nor a failure: it may be run again', () => {
  const evals = tempFolder('eval-ready-');
  barRun(evals, { level: 'lean', unhandled: (scenario, trial) => scenario === '22' && trial === 1 });
  assert.deepEqual(readiness({ evals, level: 'lean', pins: PINS }).gaps, ['scenario 22: 2 of 3 passing trials, 1 trial is missing']);
  barRun(evals, { level: 'lean', at: '2026-10-25T09:00:00.000Z', only: ['22'], from: 4, trials: 1 });
  assert.equal(readiness({ evals, level: 'lean', pins: PINS }).ok, true);
});

test('another level\'s records, and records on other pins, count for nothing', () => {
  const evals = tempFolder('eval-ready-');
  barRun(evals, { level: 'lightest' });
  barRun(evals, { level: 'lean', at: '2026-10-25T09:00:00.000Z', pins: { mostCapable: 'model-top', midSized: 'model-other' } });
  const ready = readiness({ evals, level: 'lean', pins: PINS });
  assert.equal(ready.ok, false);
  assert.ok(ready.gaps.includes('scenario 34: 0 of 3 passing trials, 3 trials are missing'));
  // A trial record that says another level, under a run record that says Lean.
  const mixed = tempFolder('eval-ready-');
  barRun(mixed, { level: 'lean', record: (r, scenario, trial) => (scenario === '20' && trial === 1 ? { ...r, level: 'lightest' } : r) });
  assert.ok(readiness({ evals: mixed, level: 'lean', pins: PINS }).gaps.includes("scenario 20 trial 1 doesn't stand: its record ran at lightest, not lean"));
});

test('a forged record is caught: an edited file, a record that never passed, a session on another model, the premium model', () => {
  const cases = [
    // Its text changed after its run saved it.
    [(evals) => {
      const file = path.join(evals, '2026-10-25', '23-with-1.json');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"pass": true', '"pass": true '));
    }, "scenario 23 trial 1 doesn't stand: its record is not the one its run saved"],
    // A record whose run said it passed, though the record itself and its events say otherwise.
    [{ record: (r, s, t) => (s === '20' && t === 2 ? { ...r, pass: false } : r) }, "scenario 20 trial 2 doesn't stand: its record does not say it passed"],
    [{ record: (r, s, t) => (s === '20' && t === 2 ? { ...r, events: r.events.map((e) => (e.type === 'result' ? { ...e, subtype: 'error_max_turns', is_error: true } : e)) } : r) }, "scenario 20 trial 2 doesn't stand: its session did not finish"],
    [{ record: (r, s, t) => (s === '34' && t === 3 ? { ...r, model: 'model-mid' } : r) }, "scenario 34 trial 3 doesn't stand: its session was not started on Lean's feature model, effort and fallback"],
    [{ record: (r, s, t) => (s === '34' && t === 3 ? { ...r, events: r.events.map((e) => (e.subtype === 'init' ? { ...e, model: 'model-else' } : e)) } : r) }, "scenario 34 trial 3 doesn't stand: its session ran on model-else, not model-top"],
    [{ record: (r, s, t) => (s === '21' && t === 1 ? { ...r, subagents: [{ type: 'wheelhouse:builder', model: 'model-best' }] } : r) }, "scenario 21 trial 1 doesn't stand: it names the premium model"],
  ];
  for (const [how, gap] of cases) {
    const evals = tempFolder('eval-ready-');
    if (typeof how === 'function') {
      barRun(evals, { level: 'lean' });
      how(evals);
    } else barRun(evals, { level: 'lean', ...how });
    const ready = readiness({ evals, level: 'lean', pins: PINS, premium: 'model-best' });
    assert.equal(ready.ok, false, gap);
    assert.ok(ready.gaps.includes(gap), `${gap}\n  got: ${ready.gaps.join('\n  ')}`);
  }
});

test('the names a caller gives must each be a saved trial of the bar, and only those count', () => {
  const evals = tempFolder('eval-ready-');
  barRun(evals, { level: 'lean' });
  const { records } = readiness({ evals, level: 'lean', pins: PINS });
  // A passing trial of the bar beyond the three is fine, and is recorded; a trial that stood not is refused, not recorded.
  barRun(evals, { level: 'lean', at: '2026-10-25T09:00:00.000Z', only: ['21'], from: 4, trials: 2, unhandled: (s, t) => t === 5 });
  const more = readiness({ evals, level: 'lean', pins: PINS, given: [...records, '2026-10-25/21-with-4.json'] });
  assert.equal(more.ok, true, more.gaps.join('; '));
  assert.ok(more.records.includes('2026-10-25/21-with-4.json'));
  const unhandled = readiness({ evals, level: 'lean', pins: PINS, given: [...records, '2026-10-25/21-with-5.json'] });
  assert.equal(unhandled.ok, false);
  assert.ok(unhandled.gaps.includes('2026-10-25/21-with-5.json is not a passing trial of the bar'), unhandled.gaps.join('; '));
  // One left out.
  const short = readiness({ evals, level: 'lean', pins: PINS, given: records.filter((n) => n !== '2026-10-25/21-with-2.json') });
  assert.deepEqual(short.gaps, ['scenario 21: 2 of 3 passing trials, 1 trial is missing']);
  // One no run saved, written by hand beside the rest.
  const planted = '2026-10-25/21-with-9.json';
  fs.writeFileSync(path.join(evals, ...planted.split('/')), JSON.stringify(trialRecord({ id: 21, trial: 9, level: 'lean' })));
  const forged = readiness({ evals, level: 'lean', pins: PINS, given: [...records.filter((n) => !n.startsWith('2026-10-25/21-')), planted] });
  assert.ok(forged.gaps.includes(`${planted} is not a trial any run at Lean on these pins saved`));
  // A path outside the evaluations folder.
  assert.ok(readiness({ evals, level: 'lean', pins: PINS, given: ['../x.json'] }).gaps.includes('../x.json is not a trial any run at Lean on these pins saved'));
  assert.equal(fileHash('a'), 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
});
