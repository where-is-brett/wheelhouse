// tests/e2e/recovery.test.js
// A failed run on the fake engine (unattended goals design, section 9.2), with the runner and the dispatcher's runner joined
// as the helper joins them: resumed at 5, 15 and 30 minutes where its kind allows, and past that, or for any other kind, or
// cancelled in the engine, one card. No piece drops out unseen, nothing runs under All stop, and a later run knows what failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wayBack, quiet, forever, failing, legFails, legFinishes, legGoes } from '../helpers/way-back.js';
import { readRecording } from '../../scripts/engine/fake.js';
import { TRY_AGAIN, STOP_HERE } from '../../scripts/engine/dispatch-run.js';
import { failedCardWords } from '../../scripts/engine/words.js';

const MINUTE = 60 * 1000;
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'engine', 'failed-connection.jsonl');
const openCards = (w) => Object.values(w.questions).filter((q) => !q.answer).map((q) => q.question.data);
const labels = (card) => card.options.map((o) => o.label);
const resumes = (w) => w.engine.calls.filter((c) => c.call === 'act' && c.action.resume);
const records = (w, work) => (w.runs[work] ?? []).map((r) => r.data);
const costs = (w) => w.written.filter((x) => x.kind === 'cost');
const fails = (legs = 0, failure = 'connection') => [...failing(failure), ...Array.from({ length: legs }, () => legFails(failure)).flat()];

test('the fixture: a dropped connection, then the leg that finishes', () => {
  const events = readRecording(fs.readFileSync(FIXTURE, 'utf8'));
  assert.equal(events.filter((e) => e.type === 'run-ended').length, 2);
  assert.equal(events.find((e) => e.type === 'run-ended').failure, 'connection');
});

test('a failed quick run is resumed at five minutes and not before', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legFinishes({ pr: 7 })] } });
  w.put('a');
  await w.tick(3);
  assert.equal(w.stateOf('a'), 'ended');
  await w.pass(3 * MINUTE);
  assert.equal(resumes(w).length, 0);
  await w.pass(3 * MINUTE);
  assert.equal(resumes(w).length, 1);
  assert.deepEqual(records(w, 'a').filter((r) => Number.isInteger(r.resume)).map((r) => [r.state, r.resume]), [['started', 1], ['ended', 1]]);
  assert.equal(records(w, 'a').at(-1).outcome, 'completed');
  assert.equal(w.runsOf('a').length, 1, 'the same run, no second');
  assert.equal(openCards(w).length, 0);
});

test('a resumed run that finishes is costed once, at its true end', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legFinishes()] } });
  w.put('a');
  await w.tick(3);
  assert.equal(costs(w).length, 0, 'not while a try is still allowed');
  await w.pass(7 * MINUTE);
  assert.equal(costs(w).length, 1);
  await w.pass(5 * MINUTE);
  assert.equal(costs(w).length, 1);
});

test('a retry waits for its place, and keeps to pace', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legFinishes()], b: forever() }, pace: 1 });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(3);
  assert.equal(w.stateOf('b'), 'started', 'a place given back between tries');
  await w.pass(10 * MINUTE);
  assert.equal(resumes(w).length, 0);
  assert.ok(w.dispatcher.comingBack('a'));
  await w.engine.act(w.runsOf('b')[0], { cancel: {} });
  await w.pass(3 * MINUTE);
  assert.equal(resumes(w).length, 1);
});

test('a retry holds its files', async () => {
  const w = wayBack({ recordings: { a: fails(1), c: quiet() }, pace: 2, branchPaths: async () => ['src/banner.js'] });
  w.put('a', { place: 0, files: ['src/banner.js'] });
  await w.tick(3);
  w.put('c', { place: 1, files: ['src/banner.js'] });
  await w.pass(2 * MINUTE);
  assert.deepEqual(w.dispatcher.reserved().a, ['src/banner.js']);
  assert.deepEqual(w.runsOf('c'), [], 'between tries the files stay the piece\'s');
  await w.pass(7 * MINUTE);
  assert.deepEqual(w.dispatcher.reserved().a, ['src/banner.js'], 'and across a try');
  assert.deepEqual(w.runsOf('c'), []);
});

test('a third failed retry brings one card, and no fourth try', async () => {
  const w = wayBack({ recordings: { a: fails(3) } });
  w.put('a');
  await w.tick(2);
  await w.pass(5 * MINUTE + MINUTE);
  await w.pass(15 * MINUTE + MINUTE);
  assert.equal(resumes(w).length, 2);
  assert.equal(openCards(w).length, 0, 'no card while a try is left');
  await w.pass(30 * MINUTE + 4 * MINUTE);
  assert.equal(resumes(w).length, 3);
  assert.equal(openCards(w).length, 1);
  const card = w.cardOf('a');
  assert.equal(card.what, failedCardWords('a', 'connection'));
  assert.deepEqual(labels(card), [TRY_AGAIN, STOP_HERE]);
  await w.pass(60 * MINUTE);
  assert.equal(resumes(w).length, 3);
  assert.equal(w.cards().length, 1);
  assert.equal(costs(w).length, 1, 'costed once, now that it has truly ended');
});

for (const lane of ['quick', 'small', 'bug']) {
  for (const [name, recording, kind] of [
    ['fails with no pull request', failing('other'), 'other'],
    ['fails with its pull request open', failing('other', { pr: 7 }), 'other'],
    ['is cancelled in the engine', (() => { const run = quiet(); run[1] = { ...run[1], outcome: 'cancelled' }; return run; })(), 'cancelled'],
  ]) {
    test(`a failed piece never drops out unseen: ${lane} work that ${name}, alone`, async () => {
      const w = wayBack({ recordings: { a: recording }, settings: { engineLanes: ['quick', 'small', 'bug', 'feature'] } });
      w.put('a', { lane });
      await w.tick(6);
      assert.equal(openCards(w).length, 1);
      assert.equal(w.cardOf('a').what, failedCardWords('a', kind));
      assert.deepEqual(labels(w.cardOf('a')), [TRY_AGAIN, STOP_HERE]);
      assert.equal(resumes(w).length, 0, 'not a kind that is tried again');
      await w.tick(6);
      assert.equal(w.cards().length, 1, 'one card');
    });
  }
}

test('a run All stop cancelled, or one the director stopped, has no such card', async () => {
  const w = wayBack({ recordings: { a: forever() } });
  w.put('a');
  await w.tick(2);
  w.stoppedIds = w.runsOf('a');
  await w.engine.act(w.runsOf('a')[0], { cancel: {} });
  await w.tick(6);
  assert.equal(openCards(w).length, 0);
});

test('a failed run whose pull request the merge queue has is left to it', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection', { pr: 7 }), ...legFinishes()] } });
  w.put('a');
  await w.tick(2);
  w.ready[7] = { work: 'a', head: 'abc' };
  await w.pass(10 * MINUTE);
  assert.equal(resumes(w).length, 0);
  assert.equal(openCards(w).length, 0);
  assert.equal(costs(w).length, 0, 'held until it is merged or left');
  w.seenPr[7] = 'merged';
  await w.tick(3);
  assert.equal(w.reports.a.data.outcome, 'merged');
  assert.equal(costs(w).length, 1, 'nothing will try it now, so its spend is settled');
});

test('a card\'s Try again enters a fresh run on the branch with what was tried', async () => {
  const w = wayBack({ recordings: { a: [failing('other', { failedAt: 'implement' }), quiet()] } });
  w.put('a');
  await w.tick(6);
  const before = w.runsOf('a');
  w.answer('a', TRY_AGAIN);
  await w.tick(3);
  assert.equal(w.runsOf('a').length, 2);
  const start = w.starts.at(-1);
  assert.equal(start.carryOn, true);
  assert.equal(start.branch, 'wh/a');
  assert.deepEqual(start.order.tried.map((t) => [t.run, t.step, t.failure]), [[before[0], 'implement', 'other']]);
  assert.deepEqual(start.order.tried[0].checks, ['node --test']);
});

test('a first start has no tried list', async () => {
  const w = wayBack({ recordings: { a: quiet() } });
  w.put('a');
  await w.tick(2);
  assert.equal(w.starts[0].order.tried, undefined);
});

test('Stop here releases: a closed report, and the files are free', async () => {
  const w = wayBack({ recordings: { a: failing('other', { pr: 7 }) }, branchPaths: async () => ['src/banner.js'] });
  w.put('a', { files: ['src/banner.js'] });
  await w.tick(6);
  assert.ok(w.cardOf('a'));
  assert.deepEqual(w.dispatcher.reserved().a, ['src/banner.js']);
  w.answer('a', STOP_HERE);
  await w.tick(3);
  assert.equal(w.reports.a.data.outcome, 'closed');
  assert.equal(w.dispatcher.reserved().a, undefined);
  assert.equal(openCards(w).length, 0);
});

test('a retry the engine refuses goes to its card, named, with no second number spent on it', async () => {
  const w = wayBack({ recordings: { a: failing('connection') } });
  w.put('a');
  await w.tick(2);
  await w.pass(7 * MINUTE);
  const latest = records(w, 'a').at(-1);
  assert.equal(latest.failure, 'resume-refused');
  await w.tick(3);
  assert.equal(w.cardOf('a').what, failedCardWords('a', 'resume-refused'));
  await w.pass(60 * MINUTE);
  assert.equal(resumes(w).length, 1);
  assert.equal(w.cards().length, 1);
});

test('a retry under All stop waits, and looks at the run after the lift', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legFinishes()] } });
  w.put('a');
  await w.tick(2);
  w.stop = true;
  await w.pass(20 * MINUTE);
  assert.equal(resumes(w).length, 0);
  w.stop = false;
  await w.tick(3);
  assert.equal(resumes(w).length, 1);
  const seen = w.engine.calls.findIndex((c) => c.call === 'act' && c.action.resume);
  assert.ok(seen >= 0);
});

test('a retry admitted before All stop stays held, and a run the engine moved on from is not resumed after the lift', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legFinishes()] } });
  w.put('a');
  await w.tick(2);
  await w.pass(5 * MINUTE);
  assert.ok(w.dispatcher.admittedTo('a'));
  w.stop = true;
  await w.pass(2 * MINUTE);
  assert.equal(resumes(w).length, 0);
  // The engine no longer reads it as failed: All stop's cancel reached it.
  const read = w.engine.inspect;
  w.engine.inspect = (runId) => ({ ...read(runId), status: 'ended', outcome: 'cancelled' });
  w.stop = false;
  await w.tick(4);
  assert.equal(resumes(w).length, 0, 'the look comes first');
  assert.equal(records(w, 'a').at(-1).outcome, 'cancelled');
  assert.equal(w.dispatcher.admittedTo('a'), false);
});

test('All stop in a resume\'s first moments ends the run it would have missed', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legGoes()] } });
  w.put('a');
  await w.tick(2);
  await w.pass(6 * MINUTE);
  const [runId] = w.runsOf('a');
  assert.equal(resumes(w).length, 1);
  assert.equal(w.engine.inspect(runId).status, 'running');
  // The list All stop reads had it as failed, so it was neither cancelled nor listed.
  w.stop = true;
  await w.tick(2);
  assert.equal(w.engine.inspect(runId).status, 'ended');
  assert.equal(w.engine.inspect(runId).outcome, 'cancelled');
});

test('no retry under an open incident', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legFinishes()] } });
  w.put('a');
  await w.tick(2);
  w.incidents.open = [{ id: 'mine', kind: 'director', what: 'Held' }];
  await w.pass(10 * MINUTE);
  assert.equal(resumes(w).length, 0);
  w.incidents.open = [];
  await w.tick(3);
  assert.equal(resumes(w).length, 1);
});

test('a restart between a retry\'s admit and its run keeps one resume', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legGoes()] } });
  w.put('a');
  await w.tick(2);
  await w.pass(5 * MINUTE);
  assert.ok(w.dispatcher.admittedTo('a'));
  assert.equal(resumes(w).length, 0);
  // Cut between the record and the act: the started is written, the engine never told.
  await w.tick(0);
  const [runId] = w.runsOf('a');
  const records0 = w.runs.a;
  records0.push({ at: w.clock.now.toISOString(), data: { ...records0.at(-1).data, state: 'started', resume: 1, outcome: undefined, failure: undefined } });
  w.restart();
  await w.tick(2);
  assert.equal(resumes(w).length, 0, 'a moment ago, so the engine may not have moved yet');
  await w.pass(4 * MINUTE);
  assert.equal(resumes(w).length, 1);
  assert.equal(w.engine.inspect(runId).status, 'running');
  assert.equal(records(w, 'a').filter((r) => r.state === 'started' && r.resume === 1).length, 1);
  w.restart();
  await w.pass(10 * MINUTE);
  assert.equal(resumes(w).length, 1, 'and a restart after it resumes nothing');
});

test('a piece fails after Give it more, and it is not left unseen', async () => {
  const w = wayBack({ recordings: { a: fails(1, 'other') } });
  w.put('a');
  await w.tick(2);
  const [runId] = w.runsOf('a');
  await w.runner.capped({ runId, work: 'a', lane: 'quick', branch: 'wh/a', reached: { cap: 'minutes', limit: 5 } });
  await w.tick(2);
  assert.equal(w.cards().length, 1, 'the cap card speaks for it');
  w.answer('a', 'Give it more');
  await w.tick(6);
  assert.equal(resumes(w).length, 1);
  assert.equal(records(w, 'a').at(-1).outcome, 'failed');
  assert.equal(w.cards().length, 2);
  assert.equal(w.cardOf('a').what, failedCardWords('a', 'other'));
});

test('a run with a cap card isn\'t retried', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legFinishes()] } });
  w.put('a');
  await w.tick(2);
  const [runId] = w.runsOf('a');
  await w.runner.capped({ runId, work: 'a', lane: 'quick', branch: 'wh/a', reached: { cap: 'minutes', limit: 5 } });
  await w.pass(20 * MINUTE);
  assert.equal(resumes(w).length, 0);
  assert.equal(w.cards().length, 1);
  assert.equal(costs(w).length, 0, 'the card waits');
  w.answer('a', 'Stop');
  await w.pass(20 * MINUTE);
  assert.equal(resumes(w).length, 0, 'the director stopped it');
  assert.equal(costs(w).length, 1, 'and its spend is settled');
  assert.equal(w.cards().length, 1);
});

test('work queued again leaves its failed run unretried, and costed', async () => {
  const w = wayBack({ recordings: { a: [[...failing('connection'), ...legFinishes()], forever()] } });
  w.put('a');
  await w.tick(2);
  await w.pass(2 * MINUTE);
  w.work.a.work.at = w.clock.now.toISOString();
  w.work.a.since = w.work.a.work.at;
  await w.pass(10 * MINUTE);
  assert.equal(resumes(w).length, 0);
  assert.equal(w.runsOf('a').length, 2);
  assert.equal(costs(w).length, 1);
});
