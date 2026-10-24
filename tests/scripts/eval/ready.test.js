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
  for (const level of ['balanced', 'thorough', 'premium', undefined]) assert.throws(() => levelRouting({ level, pins: PINS }), /Lean or Lightest/);
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
