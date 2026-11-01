// tests/e2e/recovery.test.js
// A failed run on the fake engine (unattended goals design, section 9.2), with the runner and the dispatcher's runner joined
// as the helper joins them: resumed at 5, 15 and 30 minutes where its kind allows, and past that, or for any other kind, or
// cancelled in the engine, one card. No piece drops out unseen, nothing runs under All stop, and a later run knows what failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wayBack, quiet, forever, failing, legFails, legFinishes, legGoes, atLimit } from '../helpers/way-back.js';
import { readRecording } from '../../scripts/engine/fake.js';
import { TRY_AGAIN, STOP_HERE, LEAVE_IT } from '../../scripts/engine/dispatch-run.js';
import { failedCardWords, limitLateWords } from '../../scripts/engine/words.js';

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
  for (const record of [{ status: 'unknown', unread: true }, { status: 'paused' }, null]) {
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

test('a limit past its reset by half an hour lets other work on, and the Logbook says so once', async () => {
  const w = wayBack({ recordings: { a: atLimit('lim-a', { resetAt: '2026-10-29T10:20:00.000Z' }), b: quiet() } });
  w.put('a', { place: 0 });
  await w.tick(2);
  w.put('b', { place: 1 });
  await w.pass(45 * MINUTE);
  assert.deepEqual(w.runsOf('b'), []);
  await w.pass(10 * MINUTE);
  assert.equal(w.runsOf('b').length, 1);
  assert.equal(w.stateOf('a'), 'paused');
  assert.equal(w.notes().filter((words) => words === limitLateWords('a')).length, 1);
});
