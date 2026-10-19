// tests/scripts/setup/notify.test.js
// Step 9, Phone notifications (design section 15, check 4, ruling R39): a card of plain steps
// ending with the screen locked until the phone buzzes, or for three minutes (ruling R65),
// answered Ready or Later; after Ready, a wait of PUSH_TEST_WAIT_MS, while the session sends one
// test push inside the lock; then a card asking whether it arrived; with that answered, the step
// settles with the result in the journal, which the board reads. A Ready too old for its push to
// have been sent asks the first card again (ruling R66).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { notifyStep, pushTestResult, READY, ARRIVED, READY_ID, ARRIVED_ID } from '../../../scripts/setup/notify.js';
import { STEPS } from '../../../scripts/setup/steps.js';
import { setupRoutes } from '../../../scripts/setup/engine.js';
import { answersFor } from '../../../scripts/setup/clicks.js';
import { findRun, readJournal } from '../../../scripts/setup/journal.js';
import { phonePushResult } from '../../../scripts/lib/setup-run.js';
import { PUSH_TEST_WAIT_MS, PUSH_TEST_LOCK_MS, CLICK_FRESH_MS } from '../../../scripts/lib/setup-numbers.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { setLineOf } from '../../../scripts/state/card-lines.js';
import { decide } from '../../../scripts/hooks/prompt-record.js';
import { withProject, T0 } from '../../helpers/setup-answers.js';

// The prompt record keeps an answer as made a minute before T0 (tests/helpers/setup-answers.js).
const ANSWERED = new Date(T0.getTime() - 60 * 1000);
const after = (ms) => new Date(ANSWERED.getTime() + ms);

// The director's click on a card at `at`, as the prompt record sees it (step 9's answers record
// nothing in the project's state, so no helper is asked).
const answerAt = (folder, card, label, at) => decide({
  cwd: folder, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
  tool_input: { questions: [card], answers: { [card.question]: label } },
  tool_response: { answers: { [card.question]: label } },
}, { client: {}, now: () => at });

test('step 9 is filled by notify.js, keeping its number and title', () => {
  const step = STEPS.find((s) => s.n === 9);
  assert.equal(step.title, 'Phone notifications');
  assert.equal(step.title, notifyStep().title);
  assert.equal(step.long, undefined);
});

test('with no answer, step 9 asks the card of plain steps, ending with the screen locked until the phone buzzes', async () => {
  const got = await notifyStep().plan({ answers: {}, now: () => T0 });
  assert.equal(got.ask.id, READY_ID);
  const { card } = got.ask;
  assert.deepEqual(card.options.map((o) => o.label), [READY.ready, READY.later]);
  assert.equal(card.recommend, READY.ready);
  // The plain steps: Remote Control in Desktop, both push options (step 6), the phone's own
  // permission for Claude's notifications, then the locked screen.
  assert.match(card.what, /Remote Control/);
  assert.match(card.what, /Claude Desktop/);
  assert.match(card.what, /Push when Claude decides/);
  assert.match(card.what, /Push when actions required/);
  assert.match(card.what, /step 6/);
  assert.match(card.what, /phone/);
  assert.match(card.what, /allow/i);
  // Locked past the push (ruling R65): until the phone buzzes, or three minutes, longer than the
  // wait before the push is sent, so it goes out while the screen is still locked.
  assert.ok(PUSH_TEST_LOCK_MS > PUSH_TEST_WAIT_MS);
  assert.equal(PUSH_TEST_LOCK_MS, 3 * 60 * 1000);
  assert.match(card.what, /Lock your screen, and leave it locked until your phone buzzes, or for three minutes if it doesn't\.$/);
  assert.doesNotMatch(card.what, /for two minutes/);
  assert.match(card.options[0].says, /two minutes/);
  // Nor is Later a put-off button the composer would refuse on a question: it is a kept answer.
  const composed = composeCard({ ...card, kind: 'question' }).question;
  assert.deepEqual(composed.options.map((o) => o.label), [READY.ready, READY.later, 'Explain more']);
});

test('through the helper, the card is a question with no set line, and Ready waits out the two minutes', async () => {
  await withProject(async ({ folder, plan, answer, user }) => {
    const asked = await plan(9);
    assert.equal(asked.ok, true, asked.refused);
    assert.equal(asked.ask.step, 9);
    assert.equal(asked.ask.id, READY_ID);
    assert.equal(setLineOf(asked.ask.card.question), null);
    assert.ok(asked.ask.card.question.includes('leave it locked until your phone buzzes, or for three minutes'));

    // Ready, kept signed; a minute later, a minute is left.
    await answer(asked.ask.card, READY.ready);
    const runId = findRun(folder).id;
    assert.equal(answersFor(runId)[`9.${READY_ID}`].label, READY.ready);
    const waiting = await plan(9);
    assert.equal(waiting.ok, true);
    assert.equal(waiting.wait, PUSH_TEST_WAIT_MS - 60 * 1000);
    assert.match(waiting.why, /test notification/);
    assert.equal(waiting.ask, undefined);

    // Just before the two minutes are up, still a wait, of what is left.
    const nearly = setupRoutes({ now: () => after(PUSH_TEST_WAIT_MS - 1500), userHome: user });
    assert.equal((await nearly['/setup/plan']({ folder, step: 9 })).wait, 1500);
  });
});

test('the wait counts from the Ready answer\'s own time, and never more than the two minutes', async () => {
  const step = notifyStep();
  const ready = (at) => ({ [`9.${READY_ID}`]: { label: READY.ready, text: null, at: at.toISOString() } });
  assert.equal((await step.plan({ answers: ready(T0), now: () => T0 })).wait, PUSH_TEST_WAIT_MS);
  assert.equal((await step.plan({ answers: ready(T0), now: () => new Date(T0.getTime() + 30 * 1000) })).wait, PUSH_TEST_WAIT_MS - 30 * 1000);
  // A Ready that reads as later than now (a clock put back) waits the two minutes, no more.
  assert.equal((await step.plan({ answers: ready(new Date(T0.getTime() + 5 * 60 * 1000)), now: () => T0 })).wait, PUSH_TEST_WAIT_MS);
  // Once the two minutes are up: the card asking whether it arrived.
  const asked = await step.plan({ answers: ready(T0), now: () => new Date(T0.getTime() + PUSH_TEST_WAIT_MS) });
  assert.equal(asked.ask.id, ARRIVED_ID);
});

test('a Ready too old for its push to have been sent asks the first card again, and a fresh Ready restarts the wait', async () => {
  const step = notifyStep();
  const ready = { [`9.${READY_ID}`]: { label: READY.ready, text: null, at: T0.toISOString() } };
  const at = (ms) => () => new Date(T0.getTime() + ms);
  const STALE = PUSH_TEST_WAIT_MS + CLICK_FRESH_MS;
  // Up to the wait plus the time a click stays good: card B, which the playbook asks once the wait ends.
  assert.equal((await step.plan({ answers: ready, now: at(STALE) })).ask.id, ARRIVED_ID);
  // Older than that: a session resumed long after Ready, with no push sent, gets card A.
  const again = await step.plan({ answers: ready, now: at(STALE + 1) });
  assert.equal(again.ask.id, READY_ID);
  assert.equal(again.ask.card.what, (await step.plan({ answers: {}, now: at(0) })).ask.card.what);
  // An answer to card B settles, however old the Ready before it.
  for (const [label, arrived] of [[ARRIVED.yes, true], [ARRIVED.no, false]]) {
    const answered = { ...ready, [`9.${ARRIVED_ID}`]: { label, text: null, at: T0.toISOString() } };
    assert.deepEqual(await step.plan({ answers: answered, now: at(24 * 60 * 60 * 1000) }), { settled: { record: { pushArrived: arrived } } });
  }

  // Through the helper and the prompt record: Ready, then setup resumed an hour later.
  await withProject(async ({ folder, plan, answer, user }) => {
    await answer((await plan(9)).ask.card, READY.ready);
    const hourLater = new Date(ANSWERED.getTime() + 60 * 60 * 1000);
    const resumed = setupRoutes({ now: () => hourLater, userHome: user });
    const a = await resumed['/setup/plan']({ folder, step: 9 });
    assert.equal(a.ask.id, READY_ID, 'card A, not card B');
    // Ready on it now is the newest answer, so the wait starts again from it.
    await answerAt(folder, a.ask.card, READY.ready, hourLater);
    assert.equal((await resumed['/setup/plan']({ folder, step: 9 })).wait, PUSH_TEST_WAIT_MS);
    const afterWait = setupRoutes({ now: () => new Date(hourLater.getTime() + PUSH_TEST_WAIT_MS), userHome: user });
    const b = await afterWait['/setup/plan']({ folder, step: 9 });
    assert.equal(b.ask.id, ARRIVED_ID);
    // Answered long after: it still settles.
    await answerAt(folder, b.ask.card, ARRIVED.yes, new Date(hourLater.getTime() + 60 * 60 * 1000));
    const dayLater = setupRoutes({ now: () => new Date(hourLater.getTime() + 24 * 60 * 60 * 1000), userHome: user });
    assert.deepEqual(await dayLater['/setup/plan']({ folder, step: 9 }), { ok: true, done: true });
    assert.equal(phonePushResult().arrived, true);
  });
});

test('after the wait, step 9 asks whether the test arrived, and either answer settles it in the journal', async () => {
  for (const [label, arrived] of [[ARRIVED.yes, true], [ARRIVED.no, false]]) {
    await withProject(async ({ folder, plan, answer, user, home }) => {
      await answer((await plan(9)).ask.card, READY.ready);
      const later = setupRoutes({ now: () => after(PUSH_TEST_WAIT_MS), userHome: user });
      const planLater = () => later['/setup/plan']({ folder, step: 9 });
      const b = await planLater();
      assert.equal(b.ok, true, b.refused);
      assert.equal(b.ask.id, ARRIVED_ID);
      assert.deepEqual(b.ask.card.options.map((o) => o.label), [ARRIVED.yes, ARRIVED.no, 'Explain more']);
      assert.match(b.ask.card.question, /locked/);
      // A question of fact: the card recommends answering what was seen, not either answer as such.
      assert.match(b.ask.card.question, /answer what you saw/);
      assert.equal(setLineOf(b.ask.card.question), null);

      // Explain more is no answer: the card is asked again.
      await answer(b.ask.card, 'Explain more');
      assert.equal((await planLater()).ask.id, ARRIVED_ID);

      await answer(b.ask.card, label);
      const done = await planLater();
      assert.deepEqual(done, { ok: true, done: true });
      const run = readJournal().runs.find((r) => r.id === findRun(folder).id);
      assert.equal(typeof run.steps[9].doneAt, 'string');
      const changes = run.changes.filter((c) => c.step === 9);
      assert.deepEqual(changes.map((c) => [c.kind, c.target, c.before, c.after]), [['answer', 'step 9', null, pushTestResult(label)]]);
      assert.equal(fs.existsSync(path.join(home, 'setup', 'shown')), false, 'no Go-ahead card');
      // What the board reads from the journal.
      assert.deepEqual(phonePushResult(), { arrived, at: run.steps[9].doneAt });
      // Done: not planned again.
      await assert.rejects(planLater(), /already done/);
    });
  }
});

test('the push test\'s result names whether it arrived, and only for one of the card\'s two answers', () => {
  assert.deepEqual(pushTestResult(ARRIVED.yes), { pushArrived: true });
  assert.deepEqual(pushTestResult(ARRIVED.no), { pushArrived: false });
  for (const other of [READY.ready, 'Explain more', '', null, undefined]) assert.throws(() => pushTestResult(other), /It arrived/);
});

test('Later asks the card of plain steps again; Ready on it then starts the wait', async () => {
  await withProject(async ({ folder, plan, answer }) => {
    const first = await plan(9);
    await answer(first.ask.card, READY.later);
    // Later is kept as the director's answer (not a put-off), and the step asks the same card again.
    const runId = findRun(folder).id;
    assert.equal(answersFor(runId)[`9.${READY_ID}`].label, READY.later);
    const again = await plan(9);
    assert.equal(again.ask.id, READY_ID);
    assert.equal(again.ask.card.question, first.ask.card.question);
    assert.equal(readJournal().runs[0].steps?.[9]?.doneAt, undefined);

    // Ready, clicked later on the card asked again: the newest answer counts.
    await answerAt(folder, again.ask.card, READY.ready, T0);
    assert.equal(answersFor(runId)[`9.${READY_ID}`].label, READY.ready);
    assert.equal((await plan(9)).wait, PUSH_TEST_WAIT_MS);
  });
  // Directly: Later, however long ago, is no Ready.
  const later = { [`9.${READY_ID}`]: { label: READY.later, text: null, at: T0.toISOString() } };
  const got = await notifyStep().plan({ answers: later, now: () => new Date(T0.getTime() + 60 * 60 * 1000) });
  assert.equal(got.ask.id, READY_ID);
});

test('the board reads the latest settled push test of this computer\'s journal, and nothing before step 9 settles', async () => {
  await withProject(async ({ folder, plan, answer, user }) => {
    assert.equal(phonePushResult(), null, 'no journal yet');
    await answer((await plan(9)).ask.card, READY.ready);
    assert.equal(phonePushResult(), null, 'not settled');
    const later = setupRoutes({ now: () => after(PUSH_TEST_WAIT_MS), userHome: user });
    await answer((await later['/setup/plan']({ folder, step: 9 })).ask.card, ARRIVED.no);
    await later['/setup/plan']({ folder, step: 9 });
    assert.equal(phonePushResult().arrived, false);
  });
  // A journal of several runs: the step 9 settled last counts; an answer of another step, or a
  // record that names no result, doesn't.
  const journal = { v: 1, runs: [
    { id: 'r1', folder: '/a', startedAt: 'x', steps: { 9: { doneAt: '2026-10-20T05:00:00.000Z' } }, changes: [{ id: 'c1', step: 9, kind: 'answer', target: 'step 9', before: null, after: { pushArrived: true } }] },
    { id: 'r2', folder: '/b', startedAt: 'x', steps: { 9: { doneAt: '2026-10-20T04:00:00.000Z' } }, changes: [{ id: 'c2', step: 9, kind: 'answer', target: 'step 9', before: null, after: { pushArrived: false } }] },
    { id: 'r3', folder: '/c', startedAt: 'x', steps: { 4: { doneAt: '2026-10-20T06:00:00.000Z' }, 9: { doneAt: '2026-10-20T07:00:00.000Z' } }, changes: [
      { id: 'c3', step: 4, kind: 'answer', target: 'step 4', before: null, after: { pushArrived: false } },
      { id: 'c4', step: 9, kind: 'answer', target: 'step 9', before: null, after: {} },
    ] },
  ] };
  assert.deepEqual(phonePushResult(journal), { arrived: true, at: '2026-10-20T05:00:00.000Z' });
  assert.equal(phonePushResult({ v: 1, runs: [] }), null);
});
