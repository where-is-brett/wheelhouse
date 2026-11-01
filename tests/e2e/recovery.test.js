// tests/e2e/recovery.test.js
// A failed run on the fake engine (unattended goals design, section 9.2), with the runner and the dispatcher's runner joined
// as the helper joins them: resumed at 5, 15 and 30 minutes where its kind allows, and past that, or for any other kind, or
// cancelled in the engine, one card. No piece drops out unseen, nothing runs under All stop, and a later run knows what failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wayBack, quiet, forever, failing, legFails, legFinishes, legGoes, atLimit, asking as asks } from '../helpers/way-back.js';
import { dataHash } from '../../scripts/state/events.js';
import { readRecording } from '../../scripts/engine/fake.js';
import { TRY_AGAIN, STOP_HERE, LEAVE_IT, MERGE_WORK } from '../../scripts/engine/dispatch-run.js';
import { STOP_LABEL } from '../../scripts/engine/runner.js';
import { failedCardWords, limitLateWords, limitLateOverWords, lostCarriedWords, lostCardWords, lostStoppedWords, lostStopLeftWords, lostNotNeededWords } from '../../scripts/engine/words.js';

const MINUTE = 60 * 1000;
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'engine', 'failed-connection.jsonl');
const openCards = (w) => Object.values(w.questions).filter((q) => !q.answer).map((q) => q.question.data);
const labels = (card) => card.options.map((o) => o.label);
const resumes = (w) => w.engine.calls.filter((c) => c.call === 'act' && c.action.resume);
const records = (w, work) => (w.runs[work] ?? []).map((r) => r.data);
const costs = (w) => w.written.filter((x) => x.kind === 'cost');
const fails = (legs = 0, failure = 'connection') => [...failing(failure), ...Array.from({ length: legs }, () => legFails(failure)).flat()];

const engineSays = (w, runId, record) => {
  const inspect = w.engine.inspect.bind(w.engine);
  w.engine.inspect = async (id) => (id === runId ? record : inspect(id));
};

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

test('a run the engine no longer has comes to its card, and is costed', async () => {
  const w = wayBack({ recordings: { a: failing('connection') } });
  w.put('a');
  await w.tick(2);
  const [runId] = w.runsOf('a');
  const read = w.engine.inspect;
  w.engine.inspect = (id) => (id === runId ? { status: 'unknown', steps: [], branch: null, pr: null } : read(id));
  w.engine.act = () => ({ ok: false, refused: 'There is no such run' });
  await w.pass(12 * MINUTE);
  assert.equal(w.cardOf('a').what, failedCardWords('a', 'resume-refused'));
  assert.equal(costs(w).length, 1);
});

test('a resumed run the engine lost is ended by the look at it', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legGoes()] } });
  w.put('a');
  await w.tick(2);
  await w.pass(7 * MINUTE);
  assert.equal(w.stateOf('a'), 'started');
  w.engine.inspect = () => ({ status: 'unknown', steps: [], branch: null, pr: null });
  await w.pass(3 * MINUTE);
  assert.equal(records(w, 'a').at(-1).outcome, 'failed');
});

test('a resume slower than the look at it is taken back: the run stands, with its number and no second place', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legGoes()], b: quiet() }, pace: 1 });
  w.put('a', { place: 0 });
  await w.tick(2);
  await w.pass(5 * MINUTE);
  // The engine takes the resume and goes on reading failed for a while.
  const read = w.engine.inspect;
  let slow = true;
  w.engine.inspect = (id) => (slow ? { ...read(id), status: 'ended', outcome: 'failed', failure: 'connection' } : read(id));
  await w.pass(5 * MINUTE);
  assert.equal(records(w, 'a').at(-1).state, 'ended', 'the look took it for over');
  slow = false;
  await w.tick(2);
  assert.equal(w.stateOf('a'), 'started');
  assert.equal(records(w, 'a').at(-1).resume, 1);
  w.put('b', { place: 1 });
  await w.pass(8 * MINUTE);
  assert.deepEqual(w.runsOf('b'), [], 'it holds its place');
  assert.equal(resumes(w).length, 1);
  assert.equal(costs(w).length, 0);
});

test('a settling look that can\'t read the engine writes no cost, and the next one does', async () => {
  const w = wayBack({ recordings: { a: failing('other') } });
  w.put('a');
  await w.tick(1);
  const read = w.engine.inspect;
  w.engine.inspect = () => ({ status: 'unknown', unread: true, steps: [], branch: null, pr: null });
  await w.tick(3);
  assert.equal(costs(w).length, 0);
  w.engine.inspect = read;
  await w.tick(2);
  assert.equal(costs(w).length, 1);
});

test('a cost the record refuses is written again, and once', async () => {
  const w = wayBack({ recordings: { a: quiet() } });
  w.put('a');
  w.refuseWrite = (kind) => kind === 'cost';
  await w.tick(4).catch(() => {});
  assert.equal(costs(w).length, 0);
  w.refuseWrite = null;
  await w.tick(3);
  assert.equal(costs(w).length, 1);
});

test('Give it more landing as a retry starts leaves one live run', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legGoes()] } });
  w.put('a');
  await w.tick(2);
  const [runId] = w.runsOf('a');
  await w.runner.capped({ runId, work: 'a', lane: 'quick', branch: 'wh/a', reached: { cap: 'minutes', limit: 5 } });
  await w.pass(6 * MINUTE);
  w.answer('a', 'Give it more');
  await w.dispatcher.tick();
  await w.tick(6);
  assert.equal(w.runsOf('a').length, 1);
  assert.equal(resumes(w).length, 1);
});

for (const [name, change] of [
  ['closed', (w) => { w.reports.a = { at: w.clock.now.toISOString(), data: { work: 'a', outcome: 'closed' } }; }],
  ['queued again', (w) => { w.work.a.work.at = w.clock.now.toISOString(); }],
]) {
  test(`a retry with its place isn't carried out for work ${name} since`, async () => {
    const w = wayBack({ recordings: { a: [[...failing('connection'), ...legGoes()], forever()] } });
    w.put('a');
    await w.tick(2);
    await w.pass(5 * MINUTE);
    assert.ok(w.dispatcher.admittedTo('a'));
    change(w);
    await w.runner.tick();
    assert.equal(resumes(w).length, 0);
  });
}

test('a failed piece keeps its files in the looks before its card', async () => {
  const w = wayBack({ recordings: { a: failing('other'), c: quiet() }, pace: 2, branchPaths: async () => ['src/banner.js'] });
  w.put('a', { place: 0, files: ['src/banner.js'] });
  await w.tick(1);
  w.put('c', { place: 1, files: ['src/banner.js'] });
  await w.tick(5);
  assert.deepEqual(w.runsOf('c'), []);
  assert.ok(w.cardOf('a'));
});

test('a Leave it on a failed piece stands: no retry and no card, and its spend is settled', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legFinishes()] } });
  w.put('a');
  await w.tick(2);
  w.dispatcher.sentBack('a');
  w.dispatcher.sentBack('a');
  await w.tick(3);
  w.answer('a', LEAVE_IT);
  await w.pass(10 * MINUTE);
  assert.equal(resumes(w).length, 0);
  assert.equal(openCards(w).length, 0);
  assert.equal(costs(w).length, 1);
});

test('a slice cancelled at its cap keeps its Give it more card as the one that speaks', async () => {
  const w = wayBack({ recordings: { a: forever() } });
  w.put('a');
  await w.tick(2);
  const [runId] = w.runsOf('a');
  await w.engine.act(runId, { cancel: {} });
  await w.runner.capped({ runId, work: 'a', lane: 'quick', branch: 'wh/a', reached: { cap: 'minutes', limit: 5 } });
  await w.tick(2);
  w.answer('a', 'Give it more');
  w.refuse = () => 'no room';
  await w.tick(1);
  assert.equal(w.cards().length, 1);
});

test('a retry due during a limit waits, passes the hold by no path, and goes once it lifts', async () => {
  const w = wayBack({ recordings: { a: [...failing('limit'), ...legFinishes()], b: atLimit('lim-b') } });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(2);
  assert.equal(w.stateOf('b'), 'paused');
  await w.pass(10 * MINUTE);
  assert.equal(resumes(w).length, 0);
  assert.ok(!w.dispatcher.admittedTo('a'), 'no place taken while the limit stands');
  assert.equal(openCards(w).length, 0, 'it has a try to come, and needs no card');
  w.lift('b', 'lim-b');
  await w.tick(3);
  assert.equal(resumes(w).length, 1, 'one try, not one for each time that fell due');
});

test('a retry admitted before a limit is not carried out until it lifts', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legFinishes()], b: forever() } });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(2);
  await w.pass(5 * MINUTE);
  assert.ok(w.dispatcher.admittedTo('a'));
  assert.equal(resumes(w).length, 0);
  // The limit comes between the admit and the runner's look, as the host records it.
  const run = w.runs.b.at(-1).data;
  w.asks.b = [{ at: '2026-10-29T10:06:00.000Z', data: { id: 'lim-b', runId: run.runId, work: 'b', kind: 'usage-limit', level: 1, options: [] } }];
  w.runs.b.push({ at: '2026-10-29T10:06:00.000Z', data: { ...run, state: 'paused' } });
  engineSays(w, run.runId, { status: 'paused' });
  await w.pass(3 * MINUTE);
  assert.equal(resumes(w).length, 0);
  assert.ok(w.dispatcher.admittedTo('a'), 'it keeps its place');
  w.runs.b.push({ at: '2026-10-29T10:10:00.000Z', data: { ...run, state: 'started' } });
  await w.tick(2);
  assert.equal(resumes(w).length, 1);
});

test('a limit whose ending never reached the record is ended from the engine, on a second look', async () => {
  const w = wayBack({ recordings: { a: atLimit('lim-a'), b: quiet() } });
  w.put('a', { place: 0 });
  await w.tick(2);
  w.put('b', { place: 1 });
  engineSays(w, w.runsOf('a')[0], { status: 'ended', outcome: 'failed', failure: 'other' });
  await w.tick();
  assert.equal(w.stateOf('a'), 'paused', 'one look may be ahead of the stream');
  await w.tick(4);
  assert.equal(w.stateOf('a'), 'ended');
  assert.equal(w.runsOf('b').length, 1, 'the hold has lifted');
  assert.equal(w.cardOf('a').what, failedCardWords('a', 'other'));
  assert.equal(costs(w).filter((c) => c.data.work === 'a').length, 1);
});

test('that ending keeps a resumed run\'s number', async () => {
  const w = wayBack({ recordings: { a: [...failing('connection'), ...legGoes()] } });
  w.put('a');
  await w.tick(2);
  await w.pass(7 * MINUTE);
  assert.equal(resumes(w).length, 1);
  const run = w.runs.a.at(-1).data;
  w.asks.a = [{ at: '2026-10-29T10:09:00.000Z', data: { id: 'lim-a', runId: run.runId, work: 'a', kind: 'usage-limit', level: 1, options: [] } }];
  const { resume, ...plain } = run;
  w.runs.a.push({ at: '2026-10-29T10:09:00.000Z', data: { ...plain, state: 'paused' } });
  engineSays(w, run.runId, { status: 'ended', outcome: 'completed' });
  await w.tick(3);
  assert.deepEqual([w.stateOf('a'), records(w, 'a').at(-1).resume], ['ended', resume]);
});

test('a run going again with its started lost stands as started, so its caps read it and the hold lifts', async () => {
  const w = wayBack({ recordings: { a: atLimit('lim-a'), b: quiet() } });
  w.put('a', { place: 0 });
  await w.tick(2);
  w.put('b', { place: 1 });
  engineSays(w, w.runsOf('a')[0], { status: 'running' });
  await w.tick(4);
  assert.equal(w.stateOf('a'), 'started');
  assert.equal(w.runsOf('b').length, 1);
});

test('a limit the engine can\'t be read for, or still reads as paused, stands', async () => {
  for (const record of [{ status: 'unknown', unread: true }, { status: 'unknown' }, { status: 'paused' }, null]) {
    const w = wayBack({ recordings: { a: atLimit('lim-a'), b: quiet() } });
    w.put('a', { place: 0 });
    await w.tick(2);
    w.put('b', { place: 1 });
    engineSays(w, w.runsOf('a')[0], record);
    await w.tick(4);
    assert.equal(w.stateOf('a'), 'paused');
    assert.deepEqual(w.runsOf('b'), []);
  }
});

const lateLimit = async (options = {}) => {
  const w = wayBack({ recordings: { a: [...atLimit('lim-a', { resetAt: '2026-10-29T10:20:00.000Z' }).slice(0, 3), ...forever().slice(1)], b: quiet() }, pace: 1, ...options });
  w.put('a', { place: 0 });
  await w.tick(2);
  w.put('b', { place: 1 });
  await w.pass(45 * MINUTE);
  assert.deepEqual(w.runsOf('b'), []);
  assert.equal(openCards(w).length, 0);
  await w.pass(10 * MINUTE);
  return w;
};

test('a limit past its reset by half an hour comes to one card, and other work goes on even at a pace of one', async () => {
  const w = await lateLimit();
  assert.equal(w.stateOf('a'), 'paused');
  assert.equal(w.cardOf('a').what, limitLateWords('a'));
  assert.equal(w.runsOf('b').length, 1);
  await w.pass(5 * MINUTE);
  assert.equal(openCards(w).length, 1);
});

test('its Stop ends the run, and its Give it more wakes it', async () => {
  const stopped = await lateLimit();
  stopped.answer('a', labels(stopped.cardOf('a')).at(-1));
  await stopped.tick(2);
  assert.equal(stopped.stateOf('a'), 'ended');
  const more = await lateLimit();
  more.answer('a', labels(more.cardOf('a'))[0]);
  await more.tick(3);
  assert.equal(resumes(more).length, 1);
});

test('a run that moves on by itself retires its late card, so Stop cancels nothing and its caps read it again', async () => {
  const w = await lateLimit();
  const card = w.cardOf('a');
  w.lift('a', 'lim-a');
  await w.tick(2);
  assert.equal(w.stateOf('a'), 'started');
  assert.ok(w.notes().includes(limitLateOverWords('a')));
  w.answer('a', labels(card).at(-1));
  await w.tick(2);
  assert.deepEqual(w.engine.calls.filter((c) => c.call === 'act' && c.action.cancel), []);
});

test('a limit with no reset on record comes to its card after six hours, and an unknown read ends nothing', async () => {
  const w = wayBack({ recordings: { a: atLimit('lim-a'), b: quiet() }, pace: 1 });
  w.put('a', { place: 0 });
  await w.tick(2);
  engineSays(w, w.runsOf('a')[0], { status: 'unknown' });
  w.put('b', { place: 1 });
  await w.pass(5 * 60 * MINUTE, 10 * MINUTE);
  assert.equal(w.stateOf('a'), 'paused');
  assert.equal(openCards(w).length, 0);
  await w.pass(2 * 60 * MINUTE, 10 * MINUTE);
  assert.equal(w.stateOf('a'), 'paused');
  assert.equal(openCards(w).length, 1);
  assert.equal(w.runsOf('b').length, 1);
});

// --- A run that lost its process (section 9.5) ---

const cancels = (w) => w.engine.calls.filter((c) => c.call === 'act' && c.action.cancel);
const lose = async (w, work, ticks = 3) => {
  w.engine.loseOwner(w.runsOf(work).at(-1));
  await w.tick(ticks);
};

test('a lost run is cancelled and carried on once on its branch', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  await lose(w, 'a', 4);
  assert.equal(cancels(w).length, 1);
  assert.equal(w.engine.inspect(first).outcome, 'cancelled');
  assert.equal(records(w, 'a').filter((r) => r.runId === first).at(-1).state, 'ended');
  const runs = w.runsOf('a');
  assert.equal(runs.length, 2);
  const start = w.starts.at(-1);
  assert.equal(start.carryOn, true);
  assert.equal(start.branch, 'wh/a');
  assert.equal(openCards(w).length, 0);
  assert.ok(w.notes().includes(lostCarriedWords('a')));
  assert.equal(w.written.filter((x) => x.kind === 'note' && x.data.lost === true && x.data.work === 'a').length, 1, 'on the record for a goal\'s report');
  await w.tick(5);
  assert.equal(w.runsOf('a').length, 2, 'once');
});

test('the stale step is ended before the fresh run, in the run\'s own folder', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  w.engine.loseOwner(w.runsOf('a')[0]);
  w.startAs = (args, real) => { assert.deepEqual(w.endedFolders, ['/work/a']); return real(args); };
  await w.tick(4);
  assert.equal(w.runsOf('a').length, 2);
});

test('a step that can\'t be ended brings a card, and starts nothing beside it', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  w.survivors = ['"a step" (process 41)'];
  await lose(w, 'a', 6);
  assert.equal(w.runsOf('a').length, 1);
  assert.equal(w.cardOf('a').what, lostCardWords('a', 'left', w.survivors));
  assert.deepEqual(labels(w.cardOf('a')), [STOP_LABEL, 'Carry on']);
  w.survivors = [];
  w.answer('a', 'Carry on');
  await w.tick(4);
  assert.equal(w.runsOf('a').length, 2);
});

test('the spend before a lost run stays counted', async () => {
  const w = wayBack({ recordings: { a: [[...forever(), ...legGoes()], forever()] } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  await lose(w, 'a', 4);
  const second = w.runsOf('a')[1];
  assert.deepEqual(w.runner.carried(second), { raised: false, runs: [first] });
  assert.equal(costs(w).filter((c) => c.data.runId === first).length, 1, 'and costed once');
});

test('a run whose cap was raised keeps it through a loss', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  w.runner.started(first, { raised: true, runs: ['before'] });
  await lose(w, 'a', 4);
  assert.deepEqual(w.runner.carried(w.runsOf('a')[1]), { raised: true, runs: ['before', first] });
  assert.ok(w.starts[1].order.caps.minutes > w.starts[0].order.caps.minutes);
});

test('a second loss brings a card with Carry on and Stop', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  await lose(w, 'a', 4);
  const second = w.runsOf('a').at(-1);
  await lose(w, 'a', 6);
  assert.equal(w.runsOf('a').length, 2, 'nothing starts by itself');
  assert.equal(w.engine.inspect(second).status, 'ended', 'and nothing of it goes on spending');
  assert.equal(openCards(w).length, 1);
  const card = w.cardOf('a');
  assert.equal(card.what, lostCardWords('a', 'again'));
  assert.deepEqual(labels(card), [STOP_LABEL, 'Carry on']);
  assert.ok(w.dispatcher.waitingWork().has('a'), 'its piece waits on the director, with its run ended');
  w.answer('a', 'Carry on');
  await w.tick(4);
  assert.equal(w.runsOf('a').length, 3);
  assert.equal(w.starts.at(-1).carryOn, true);
  assert.deepEqual(w.runner.carried(w.runsOf('a')[2]).runs, [w.runsOf('a')[0], second]);
});

test('after a goal\'s end the director\'s Carry on starts its piece, and a carry-on nobody answered doesn\'t', async () => {
  const goalOf = (w) => { w.goals.g = { sheet: { until: '2026-10-29T18:00:00.000Z', pieces: [{ work: 'a', hash: dataHash(w.work.a.work.data) }] }, hash: 'signed', startedAt: '2026-10-29T09:00:00.000Z', ended: null, endAsked: null }; };
  const ending = { ending: 'time', at: '2026-10-29T10:00:00.000Z', spent: {} };

  const answered = wayBack({ recordings: { a: [forever(), forever(), forever()] } });
  answered.put('a');
  goalOf(answered);
  await answered.tick(2);
  await lose(answered, 'a', 4);
  await lose(answered, 'a', 6);
  answered.goals.g.ended = ending;
  answered.answer('a', 'Carry on');
  await answered.tick(4);
  assert.equal(answered.runsOf('a').length, 3);

  const alone = wayBack({ recordings: { a: [forever(), forever()] } });
  alone.put('a');
  goalOf(alone);
  await alone.tick(2);
  alone.goals.g.ended = ending;
  await lose(alone, 'a', 4);
  assert.equal(alone.runsOf('a').length, 1, 'the ended goal\'s piece waits for a new sheet');
});

test('the Stop on that card lets the piece go, and it stays stopped', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()] }, branchPaths: async () => ['src/banner.js'] });
  w.put('a', { files: ['src/banner.js'] });
  await w.tick(2);
  await lose(w, 'a', 4);
  await lose(w, 'a', 6);
  assert.deepEqual(w.dispatcher.reserved().a, ['src/banner.js'], 'the card keeps its files');
  w.answer('a', STOP_LABEL);
  await w.tick(8);
  assert.equal(w.dispatcher.reserved().a, undefined);
  assert.equal(w.runsOf('a').length, 2);
  assert.equal(openCards(w).length, 0, 'and no other card asks again');
  assert.ok(w.notes().includes(lostStoppedWords('a')));
});

test('an answer to that card never goes to the engine', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  await lose(w, 'a', 4);
  await lose(w, 'a', 6);
  w.answer('a', 'Carry on');
  await w.tick(3);
  assert.equal(w.answers().length, 0);
});

test('a cancel refused leaves the run on a card, and starts nothing', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  const act = w.engine.act.bind(w.engine);
  w.engine.act = (runId, action) => (action.cancel ? { ok: false, refused: 'its owner is alive' } : act(runId, action));
  await lose(w, 'a', 6);
  assert.equal(w.runsOf('a').length, 1);
  assert.equal(w.dispatcher.comingBack('a'), false, 'its way back is given up');
  assert.deepEqual(w.endedFolders ?? [], [], 'and a process that may be live is left alone');
  assert.equal(w.cardOf('a').what, lostCardWords('a', 'refused'));
  w.engine.act = act;
  w.answer('a', 'Carry on');
  await w.tick(4);
  assert.equal(w.engine.inspect(first).status, 'ended');
  assert.equal(w.runsOf('a').length, 2);
});

test('an engine that gives no reply to the cancel is asked again, then comes to a card', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  const act = w.engine.act.bind(w.engine);
  w.engine.act = (runId, action) => (action.cancel ? { ok: false, unreachable: true } : act(runId, action));
  await lose(w, 'a', 1);
  assert.equal(openCards(w).length, 0);
  await w.tick(5);
  assert.equal(w.runsOf('a').length, 1);
  assert.equal(w.cardOf('a').what, lostCardWords('a', 'refused'));
});

test('a loss that turns out not to be: a run that ended by itself is left to its own ending', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  const inspect = w.engine.inspect.bind(w.engine);
  w.engine.inspect = (id) => (id === first ? { ...inspect(id), status: 'ended', outcome: 'completed' } : inspect(id));
  await lose(w, 'a', 5);
  assert.equal(cancels(w).length, 0);
  assert.equal(w.runsOf('a').length, 1);
  assert.equal(w.dispatcher.comingBack('a'), false);
});

test('a fresh run the lock turned away is a start that didn\'t happen', async () => {
  const w = wayBack({ recordings: { a: [forever(), [forever()[0], { ...quiet()[1], outcome: 'cancelled' }], forever()] } });
  w.put('a');
  await w.tick(2);
  await lose(w, 'a', 5);
  assert.equal(openCards(w).length, 0, 'not a stop, and no card for it');
  await w.tick(3);
  assert.equal(w.runsOf('a').length, 3);
  assert.equal(w.engine.inspect(w.runsOf('a')[2]).status, 'running');
});

test('a fresh run turned away twice brings one card, not a third start', async () => {
  const w = wayBack({ recordings: { a: [forever(), [forever()[0], { ...quiet()[1], outcome: 'cancelled' }]] } });
  w.put('a');
  await w.tick(2);
  await lose(w, 'a', 9);
  assert.equal(w.runsOf('a').length, 3);
  assert.equal(openCards(w).length, 1);
  assert.deepEqual(labels(w.cardOf('a')), [TRY_AGAIN, STOP_HERE]);
});

test('All stop finds a lost run and ends it', async () => {
  const w = wayBack({ recordings: { a: forever() } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  w.stop = true;
  w.engine.loseOwner(first);
  await w.tick(2);
  assert.equal(cancels(w).length, 0, 'nothing of the helper\'s own under All stop');
  await w.engine.stopAll('All stop');
  w.stoppedIds = [first];
  await w.tick(2);
  assert.equal(w.engine.inspect(first).outcome, 'cancelled');
  w.stop = false;
  await w.tick(5);
  assert.equal(w.runsOf('a').length, 1, 'All stop\'s cancels wait for a Carry on');
  assert.equal(openCards(w).length, 0);
});

test('All stop past the mark: the carry-on it overtook doesn\'t start after the lift', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  const act = w.engine.act.bind(w.engine);
  w.engine.act = (runId, action) => (action.cancel ? { ok: false, unreachable: true } : act(runId, action));
  await lose(w, 'a', 1);
  w.engine.act = act;
  w.stop = true;
  await w.engine.stopAll('All stop');
  w.stoppedIds = [first];
  await w.tick(2);
  w.stop = false;
  await w.tick(5);
  assert.equal(w.runsOf('a').length, 1);
  assert.equal(w.dispatcher.comingBack('a'), false);
});

test('a crash between the mark and the cancel is taken forward', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  const act = w.engine.act.bind(w.engine);
  w.engine.act = (runId, action) => { if (action.cancel) throw new Error('the helper stopped here'); return act(runId, action); };
  w.engine.loseOwner(w.runsOf('a')[0]);
  await w.pump();
  w.restart();
  w.engine.act = act;
  await w.tick(4);
  assert.equal(cancels(w).length, 1, 'the cancel that never went, now gone');
  assert.equal(w.runsOf('a').length, 2);
});

test('an ask the record has and the router never heard of is taken up', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  (w.asks.a ??= []).push({ at: 't', data: { id: `${first}:owner-lost`, runId: first, work: 'a', kind: 'trouble', level: 3, options: [] } });
  (w.runs.a).push({ at: new Date(w.clock.now).toISOString(), data: { ...w.runs.a.at(-1).data, state: 'paused' } });
  await w.tick(4);
  assert.equal(w.runsOf('a').length, 2);
});

test('a lost run\'s ending is written if the stream never brings it', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  w.engine.loseOwner(first);
  await w.pump();
  // The stream stops here, so the cancel's ending never reaches the record.
  await w.runner.tick();
  await w.runner.tick();
  await w.runner.tick();
  assert.equal(records(w, 'a').filter((r) => r.runId === first).at(-1).outcome, 'cancelled');
});

test('a carry-on waits for its place, and keeps to pace', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()], b: forever(), c: forever() }, pace: 1 });
  w.put('a', { place: 0 });
  await w.tick(2);
  w.put('b', { place: 1 });
  await lose(w, 'a', 4);
  assert.deepEqual([w.runsOf('a').length, w.runsOf('b').length], [2, 0], 'the piece coming back goes ahead of new work');
});

test('a carry-on waits out a limit and an incident', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()], l: atLimit('l-1', { resetAt: '2026-10-29T12:00:00.000Z' }) } });
  w.put('a');
  w.put('l');
  await w.tick(2);
  await lose(w, 'a', 4);
  assert.equal(w.runsOf('a').length, 1);
  assert.ok(w.dispatcher.comingBack('a'));
  w.lift('l', 'l-1');
  w.incidents.open = [{ id: 'held', what: 'held' }];
  await w.tick(4);
  assert.equal(w.runsOf('a').length, 1);
  w.incidents.open = [];
  await w.tick(4);
  assert.equal(w.runsOf('a').length, 2);
});

test('a lost piece keeps its files until its next run is going', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()], c: quiet() }, pace: 2, branchPaths: async () => ['src/banner.js'] });
  w.put('a', { place: 0, files: ['src/banner.js'] });
  await w.tick(2);
  w.refuse = () => 'not yet';
  w.engine.loseOwner(w.runsOf('a')[0]);
  w.put('c', { place: 1, files: ['src/banner.js'] });
  await w.tick(3);
  assert.deepEqual(w.runsOf('c'), [], 'the files stay the piece\'s across its loss');
});

test('a lost run parked at a limit is carried on once, and the limit\'s look writes nothing of its own', async () => {
  const w = wayBack({ recordings: { a: [atLimit('l-1', { resetAt: '2026-10-29T12:00:00.000Z' }), forever()], b: quiet() } });
  w.put('a');
  await w.tick(2);
  assert.equal(w.dispatcher.comingBack('b'), false);
  const [first] = w.runsOf('a');
  w.engine.loseOwner(first);
  await w.tick(5);
  assert.equal(w.runsOf('a').length, 2);
  const endings = records(w, 'a').filter((r) => r.runId === first && r.state === 'ended');
  assert.equal(endings.length, 1, 'one ending, the cancel\'s');
  assert.equal(endings[0].outcome, 'cancelled');
  assert.equal(cancels(w).length, 1);
  assert.equal(records(w, 'a').filter((r) => r.runId === first && r.state === 'started').length, 1, 'no plain started from the look at the limit');
});

test('a run held at a late limit that loses its process waits for the director\'s word on its cap', async () => {
  const w = wayBack({ recordings: { a: [atLimit('l-1'), forever()] } });
  w.put('a');
  await w.tick(2);
  await w.pass(7 * 60 * MINUTE, 30 * MINUTE);
  assert.ok(w.cardOf('a'));
  const late = w.cardOf('a').id;
  w.engine.loseOwner(w.runsOf('a')[0]);
  await w.tick(4);
  assert.equal(w.runsOf('a').length, 2, 'a run that moved on retires that card, and the loss goes its own way');
  assert.equal(w.written.filter((x) => x.kind === 'question' && x.data.id !== late).length, 0);
});

test('a lost merge-queue run is cancelled, and the next sweep is its try', async () => {
  const w = wayBack({ recordings: { merge: forever() }, reads: { workOf: () => ({ work: MERGE_WORK, lane: 'merge', branch: null }) } });
  const { runId } = w.engine.start({ recording: 'merge', lane: 'merge' });
  w.engine.loseOwner(runId);
  await w.runner.onAsk(w.engine.watch('0').events.find((e) => e.type === 'ask'));
  await w.tick(3);
  assert.equal(w.engine.inspect(runId).status, 'ended');
  assert.equal(openCards(w).length, 0);
});

test('a run stopped at its cap and then lost is ended, and its cap card alone decides', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  await w.runner.capped({ runId: first, work: 'a', lane: 'quick', branch: 'wh/a', reached: { cap: 'minutes', limit: 45 } });
  await lose(w, 'a', 4);
  assert.equal(w.engine.inspect(first).status, 'ended');
  assert.equal(w.dispatcher.comingBack('a'), false);
  w.answer('a', STOP_LABEL);
  await w.tick(5);
  assert.equal(w.runsOf('a').length, 1);
});

test('an answer\'s rework and a loss start one run', async () => {
  const blocked = [{ id: 'carry', label: 'Send it back' }, { id: 'stop', label: 'Stop' }];
  const w = wayBack({ recordings: { a: [[...asks('b-1', { kind: 'blocked', options: blocked }).slice(0, 3), ...forever().slice(1), ...legGoes()], forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  w.answer('a', 'Send it back');
  await w.tick(3);
  const [first] = w.runsOf('a');
  assert.equal(w.engine.inspect(first).status, 'running');
  await lose(w, 'a', 8);
  assert.equal(w.runsOf('a').length, 2);
  assert.equal(w.starts.at(-1).carryOn, true);
});

test('a run of an earlier queueing that is lost is ended, and starts nothing beside the new one', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  w.clock.now = new Date(w.clock.now.getTime() + 60000);
  w.work.a.work.at = w.clock.now.toISOString();
  await w.tick(3);
  const now = w.runsOf('a').length;
  w.engine.loseOwner(first);
  await w.tick(5);
  assert.equal(w.runsOf('a').length, now);
  assert.equal(w.engine.inspect(first).status, 'ended');
  assert.equal(openCards(w).length, 0);
});

test('a carry-on still waiting for a place doesn\'t start by itself after All stop\'s lift', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()], l: atLimit('l-1', { resetAt: '2026-10-29T12:00:00.000Z' }) } });
  w.put('a');
  w.put('l');
  await w.tick(2);
  await lose(w, 'a', 4);
  assert.ok(w.dispatcher.comingBack('a'));
  w.stop = true;
  await w.tick(2);
  w.lift('l', 'l-1');
  w.stop = false;
  await w.tick(6);
  assert.equal(w.runsOf('a').length, 1);
  assert.deepEqual(labels(w.cardOf('a')), [TRY_AGAIN, STOP_HERE], 'its card speaks for it');
});

test('a Carry on clicked under All stop isn\'t used after the lift', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  await lose(w, 'a', 4);
  await lose(w, 'a', 6);
  w.stop = true;
  w.answer('a', 'Carry on');
  await w.tick(2);
  w.stop = false;
  await w.tick(6);
  assert.equal(w.runsOf('a').length, 2);
  assert.ok(w.cardOf('a'), 'and a card asks again');
});

test('a young carry-on that All stop cancelled isn\'t read as turned away', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  await lose(w, 'a', 4);
  w.stop = true;
  await w.engine.stopAll('All stop');
  await w.tick(2);
  w.stop = false;
  await w.tick(4);
  assert.equal(w.runsOf('a').length, 2);
});

test('Stop on a refused card ends the run the hard way, and says so if it can\'t', async () => {
  let ended = 0;
  const w = wayBack({ recordings: { a: forever() }, reads: { endRun: async () => { ended += 1; return { ended: [], survivors: [] }; } } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  const act = w.engine.act.bind(w.engine);
  w.engine.act = (runId, action) => (action.cancel ? { ok: false, refused: 'its owner is alive' } : act(runId, action));
  await lose(w, 'a', 5);
  w.answer('a', STOP_LABEL);
  await w.tick(3);
  assert.equal(ended, 1);
  assert.equal(w.engine.inspect(first).status, 'running');
  assert.ok(w.notes().includes(lostStopLeftWords('a')));
});

test('a run that finished by itself isn\'t carried on, by a stale line or a late Carry on', async () => {
  const w = wayBack({ recordings: { a: forever() } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  const inspect = w.engine.inspect.bind(w.engine);
  const act = w.engine.act.bind(w.engine);
  w.engine.act = (runId, action) => (action.cancel ? { ok: false, refused: 'its owner is alive' } : act(runId, action));
  await lose(w, 'a', 5);
  w.engine.inspect = (id) => (id === first ? { ...inspect(id), status: 'ended', outcome: 'completed', pr: 7 } : inspect(id));
  w.answer('a', 'Carry on');
  await w.tick(4);
  assert.equal(w.runsOf('a').length, 1);
  assert.ok(w.notes().includes(lostNotNeededWords('a')));
});

test('one unread look doesn\'t turn a run that completed into a carry-on', async () => {
  const w = wayBack({ recordings: { a: forever() } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  const inspect = w.engine.inspect.bind(w.engine);
  let looks = 0;
  w.engine.inspect = (id) => {
    if (id !== first) return inspect(id);
    looks += 1;
    return looks === 1 ? { status: 'unknown', unread: true, steps: [] } : { ...inspect(id), status: 'ended', outcome: 'completed' };
  };
  await lose(w, 'a', 5);
  assert.equal(w.runsOf('a').length, 1);
  assert.equal(cancels(w).length, 0);
});

test('a run with no branch on record is ended first, and starts afresh', async () => {
  const w = wayBack({ recordings: { a: [forever(), forever()] } });
  w.put('a');
  await w.tick(2);
  const [first] = w.runsOf('a');
  for (const r of w.runs.a) delete r.data.branch;
  const inspect = w.engine.inspect.bind(w.engine);
  w.engine.inspect = (id) => ({ ...inspect(id), branch: null });
  await lose(w, 'a', 5);
  assert.equal(w.engine.inspect(first).status, 'ended');
  assert.equal(w.runsOf('a').length, 2);
  assert.equal(w.starts.at(-1).carryOn, false);
});

test('a lost fix: carried on once, then one card, whose Carry on starts it', async () => {
  const fix = 'fix-main-red-main-0123456789';
  const w = wayBack({ recordings: { [fix]: [forever(), forever(), forever()] } });
  w.incidents.open = [{ id: 'red-main-0123456789', what: 'The main line\'s checks are red.', kind: 'red-main', suspect: 12, work: fix, at: '2026-10-29T09:00:00.000Z', fixes: [] }];
  w.green = false;
  await w.tick(2);
  await lose(w, fix, 6);
  assert.equal(w.runsOf(fix).length, 2);
  assert.equal(w.starts.at(-1).carryOn, true);
  await lose(w, fix, 6);
  assert.equal(w.runsOf(fix).length, 2);
  assert.equal(openCards(w).length, 1, 'the lost card alone');
  w.answer(fix, 'Carry on');
  await w.tick(6);
  assert.equal(w.runsOf(fix).length, 3);
  assert.equal(openCards(w).length, 0);
});
