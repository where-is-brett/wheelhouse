// tests/scripts/setup/notify.test.js
// Step 9, Phone notifications (design section 15, check 4, ruling R39): a card of plain steps
// ending with the screen locked until the phone buzzes, or for three minutes (ruling R65),
// answered Ready or Skip for now (the phone is optional); after Ready, a wait of PUSH_TEST_WAIT_MS, while the session sends one
// test push inside the lock; then a card asking whether it arrived; with that answered, the step
// settles with the result in the journal, which the board reads. A Ready too old for its push to
// have been sent asks the first card again (ruling R66).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { notifyStep, pushTestResult, READY, ARRIVED, READY_ID, ARRIVED_ID, SKIPPED } from '../../../scripts/setup/notify.js';
import { STEPS, firstUnfinished } from '../../../scripts/setup/steps.js';
import { setupRoutes } from '../../../scripts/setup/engine.js';
import { answersFor } from '../../../scripts/setup/clicks.js';
import { findRun, readJournal, startRun, markStep, addChanges, newId } from '../../../scripts/setup/journal.js';
import { noteAsked, copySetupRecords } from '../../../scripts/setup/clicks.js';
import { keepAnswer, keepClick } from '../../../scripts/lib/setup-clicks.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { phonePushResult } from '../../../scripts/lib/setup-run.js';
import { PUSH_TEST_WAIT_MS, PUSH_TEST_LOCK_MS, CLICK_FRESH_MS } from '../../../scripts/lib/setup-numbers.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { setLineOf, setupLine } from '../../../scripts/state/card-lines.js';
import { PHONE_REACHES } from '../../../scripts/lib/calm-words.js';
import { decide } from '../../../scripts/hooks/prompt-record.js';
import { withProject, T0, SLUG } from '../../helpers/setup-answers.js';

// The prompt record keeps an answer as made a minute before T0 (tests/helpers/setup-answers.js).
const ANSWERED = new Date(T0.getTime() - 60 * 1000);
const after = (ms) => new Date(ANSWERED.getTime() + ms);

// The health check done, its board green: setup is finished, and the phone comes after (design section 15.1).
function greenBoard(runId) {
  markStep(runId, 10, 'doneAt', { now: () => T0 });
  addChanges(runId, [{ id: newId('chg'), step: 10, kind: 'answer', target: 'step 10', before: null, after: { green: T0.toISOString() } }]);
}

// The folder's run with the steps step 9 waits for done (step 6, the push options, step 8, Locked,
// and the health check).
function readyFor9(folder) {
  const run = startRun({ folder, now: () => T0 });
  for (const n of [6, 8]) markStep(run.id, n, 'doneAt', { now: () => T0 });
  greenBoard(run.id);
  return run;
}

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
  // Card A says step 6 switched a push option on, and asks for the screen locked, which would
  // cover the password window step 8 opens for Locked: it waits for both (ruling R70). The phone
  // comes last, once the health check's board is green (design section 15.1).
  assert.deepEqual(step.after, [6, 8, 10]);
  assert.equal(step.asksDuring, undefined);
});

test('through the helper, card A waits for step 6, then for step 8 while it runs, and is asked once both are done', async () => {
  await withProject(async ({ folder, plan }) => {
    const run = startRun({ folder, now: () => T0 });
    const first = await plan(9);
    assert.equal(first.ok, true, first.refused);
    assert.equal(first.ask, undefined, 'card A is not asked before step 6');
    assert.equal(first.waitsFor, 6);
    assert.match(first.why, /^step 6 \(/);
    markStep(run.id, 6, 'doneAt', { now: () => T0 });
    // Step 8 running: macOS's password window may be open.
    markStep(run.id, 8, 'clickedAt', { now: () => T0 });
    const during = await plan(9);
    assert.equal(during.ask, undefined, 'card A is not asked while step 8 runs');
    assert.equal(during.waitsFor, 8);
    assert.match(during.why, /^step 8 \(.*\) is still running/);
    markStep(run.id, 8, 'doneAt', { now: () => T0 });
    const health = await plan(9);
    assert.equal(health.ask, undefined, 'card A is not asked before the board is green');
    assert.equal(health.waitsFor, 10);
    greenBoard(run.id);
    assert.equal((await plan(9)).ask?.id, READY_ID);
  });
});

test('step 9 does not settle before step 6, even with the answer to whether the test arrived in', async () => {
  await withProject(async ({ folder, user }) => {
    const run = startRun({ folder, now: () => T0 });
    markStep(run.id, 8, 'doneAt', { now: () => T0 });
    greenBoard(run.id);
    // The answer to card B, kept for the run as the prompt record keeps it.
    const card = { question: 'Did the test notification reach your phone?', header: 'Question', options: [ARRIVED.yes, ARRIVED.no].map((l) => ({ label: l, description: l })) };
    noteAsked({ runId: run.id, folder, step: 9, id: ARRIVED_ID, card, now: () => T0 });
    keepAnswer(makeEvent({ kind: 'action', data: { action: 'setup-answer', runId: run.id, step: 9, questionId: ARRIVED_ID, question: card.question, label: ARRIVED.yes, text: null }, now: () => T0 }));
    assert.equal(answersFor(run.id)[`9.${ARRIVED_ID}`].label, ARRIVED.yes);
    const routes = setupRoutes({ now: () => T0, userHome: user });
    const held = await routes['/setup/plan']({ folder, step: 9 });
    assert.equal(held.ok, true, held.refused);
    assert.equal(held.done, undefined, 'not settled before step 6');
    assert.equal(held.waitsFor, 6);
    assert.equal(findRun(folder).steps[9]?.doneAt, undefined);
    assert.equal(phonePushResult(), null);
    markStep(run.id, 6, 'doneAt', { now: () => T0 });
    assert.deepEqual(await routes['/setup/plan']({ folder, step: 9 }), { ok: true, done: true });
    assert.equal(phonePushResult().arrived, true);
  });
});

test('with no answer, step 9 asks the card of plain steps, ending with the screen locked until the phone buzzes', async () => {
  const got = await notifyStep().plan({ answers: {}, now: () => T0 });
  assert.equal(got.ask.id, READY_ID);
  const { card } = got.ask;
  assert.deepEqual(card.options.map((o) => o.label), [READY.ready, READY.skip]);
  assert.equal(card.recommend, READY.ready);
  // The phone is optional: skipping says setup carries on, and where to set it up later.
  assert.match(card.options[1].says, /carries on without your phone/);
  assert.match(card.options[1].says, /First Mate can set it up later/);
  // The plain steps: Remote Control in Desktop, both push options, the phone's own permission for
  // Claude's notifications, then the locked screen.
  assert.match(card.what, /Remote Control/);
  assert.match(card.what, /Claude Desktop/);
  assert.match(card.what, /both push options/);
  assert.match(card.what, /phone/);
  assert.ok(card.what.includes(PHONE_REACHES), 'the card says what reaches the phone');
  assert.match(card.what, /allow/i);
  // Locked past the push (ruling R65): until the phone buzzes, or three minutes, longer than the
  // wait before the push is sent, so it goes out while the screen is still locked.
  assert.ok(PUSH_TEST_LOCK_MS > PUSH_TEST_WAIT_MS);
  assert.equal(PUSH_TEST_LOCK_MS, 3 * 60 * 1000);
  assert.match(card.what, /click Ready and lock your screen until your phone buzzes, or for three minutes\.$/);
  assert.doesNotMatch(card.what, /for two minutes/);
  assert.match(card.options[0].says, /two minutes/);
  // Short, since it opens with the verdict and the first briefing, and its recommended option reads
  // as one clean sentence.
  const composed = composeCard({ ...card, kind: 'question', suggest: false }).question;
  const count = (t) => t.split(/\s+/).filter(Boolean).length;
  assert.ok(count([composed.question, ...composed.options.flatMap((o) => [o.label, o.description])].join(' ')) <= 105, 'about 100 words');
  assert.equal(composed.options[0].description, 'Recommended: Setup sends a test two minutes later and asks if it arrived, because it shows now whether your phone works.');
  // Nor is Skip for now a put-off button the composer would refuse on a question: it is a kept answer.
  assert.deepEqual(composed.options.map((o) => o.label), [READY.ready, READY.skip]);
});

test('through the helper, the card is a question with no set line, and Ready waits out the two minutes', async () => {
  await withProject(async ({ folder, plan, answer, user }) => {
    readyFor9(folder);
    const asked = await plan(9);
    assert.equal(asked.ok, true, asked.refused);
    assert.equal(asked.ask.step, 9);
    assert.equal(asked.ask.id, READY_ID);
    assert.equal(setLineOf(asked.ask.card.question), null);
    assert.ok(asked.ask.card.question.includes('lock your screen until your phone buzzes, or for three minutes'));

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
    readyFor9(folder);
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
      readyFor9(folder);
      await answer((await plan(9)).ask.card, READY.ready);
      const later = setupRoutes({ now: () => after(PUSH_TEST_WAIT_MS), userHome: user });
      const planLater = () => later['/setup/plan']({ folder, step: 9 });
      const b = await planLater();
      assert.equal(b.ok, true, b.refused);
      assert.equal(b.ask.id, ARRIVED_ID);
      assert.deepEqual(b.ask.card.options.map((o) => o.label), [ARRIVED.yes, ARRIVED.no]);
      assert.match(b.ask.card.question, /locked/);
      // A question of fact: the card recommends answering what was seen, not either answer as such.
      assert.match(b.ask.card.options.map((o) => o.description).join(' '), /answer what you saw/);
      assert.equal(setLineOf(b.ask.card.question), null);

      // Suggest a change… is no answer: the card is asked again.
      await answer(b.ask.card, 'Suggest a change…');
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
      assert.deepEqual(phonePushResult(), { arrived, at: run.steps[9].doneAt, run: run.id });
      // Done: not planned again once it arrived; a push that didn't arrive can be tested again later.
      if (arrived) await assert.rejects(planLater(), /already done/);
      else assert.equal((await planLater()).ask.id, `${READY_ID}-2`);
    });
  }
});

// Phone notifications belong to the computer (ruling R75): a push that arrived in an earlier run
// settles step 9 at once; one that didn't asks again.
test('step 9 settles at once when an earlier run on this computer recorded the push arrived, and asks when it didn\'t', async () => {
  for (const arrived of [true, false]) {
    await withProject(async ({ folder, user, home }) => {
      const other = path.join(user, 'Projects', 'Earlier');
      fs.mkdirSync(other, { recursive: true });
      const earlier = startRun({ folder: other, now: () => T0 });
      addChanges(earlier.id, [{ id: newId('chg'), step: 9, kind: 'answer', target: 'step 9', before: null, after: { pushArrived: arrived } }]);
      markStep(earlier.id, 9, 'doneAt', { now: () => new Date(T0.getTime() - 60 * 60 * 1000) });
      const run = readyFor9(folder);
      const routes = setupRoutes({ now: () => T0, userHome: user });
      const got = await routes['/setup/plan']({ folder, step: 9 });
      if (!arrived) {
        assert.equal(got.ask?.id, READY_ID, 'a push that didn\'t arrive is tested again');
        return;
      }
      assert.deepEqual(got, { ok: true, done: true });
      const mine = readJournal().runs.find((r) => r.id === run.id);
      assert.deepEqual(mine.changes.filter((c) => c.step === 9).map((c) => [c.kind, c.after]), [['answer', { pushArrived: true, from: earlier.id }]]);
      assert.equal(fs.existsSync(path.join(home, 'setup', 'asked')), false, 'nothing asked');
      // The board reads this run's result now, still arrived.
      assert.deepEqual(phonePushResult(), { arrived: true, at: mine.steps[9].doneAt, run: run.id });
    });
  }
  // Directly: only another run's arrival counts, and this run's own answer comes first.
  const result = { arrived: true, at: T0.toISOString(), run: 'run-0000000001' };
  const step = notifyStep({ pushResult: () => result });
  assert.deepEqual(await step.plan({ runId: 'run-0000000002', answers: {}, now: () => T0 }), { settled: { record: { pushArrived: true, from: 'run-0000000001' } } });
  assert.equal((await step.plan({ runId: 'run-0000000001', answers: {}, now: () => T0 })).ask.id, READY_ID);
  assert.equal((await notifyStep({ pushResult: () => null }).plan({ runId: 'run-0000000002', answers: {}, now: () => T0 })).ask.id, READY_ID);
  const own = { [`9.${ARRIVED_ID}`]: { label: ARRIVED.no, text: null, at: T0.toISOString() } };
  assert.deepEqual(await step.plan({ runId: 'run-0000000002', answers: own, now: () => T0 }), { settled: { record: { pushArrived: false } } });
});

// A joining computer's run (ruling R74) ends on step 9's settling, with no health check after it:
// that settling copies what no apply copied, step 9's answer and a Locked step 8's click among
// them, into the project's state (ruling R45).
test('on a joining run, step 9\'s settling copies its answer and step 8\'s click into the project\'s state', async () => {
  await withProject(async ({ folder, user }) => {
    const run = startRun({ folder, now: () => T0 });
    addChanges(run.id, [{ id: newId('chg'), step: 3, kind: 'answer', target: 'step 3', before: null, after: { joined: 'o/Cafe-Menu' } }]);
    for (const n of [1, 2, 3, 6, 7, 8]) markStep(run.id, n, 'doneAt', { now: () => T0 });
    const hash = 'c'.repeat(64);
    const locked = makeEvent({ kind: 'action', data: { action: 'setup', runId: run.id, step: 8, hash, question: setupLine(8, hash), label: 'Go ahead' }, now: () => T0 });
    keepClick(locked);
    const card = { question: 'Did the test notification reach your phone?', header: 'Question', options: [ARRIVED.yes, ARRIVED.no].map((l) => ({ label: l, description: l })) };
    noteAsked({ runId: run.id, folder, step: 9, id: ARRIVED_ID, card, now: () => T0 });
    const arrived = makeEvent({ kind: 'action', data: { action: 'setup-answer', runId: run.id, step: 9, questionId: ARRIVED_ID, question: card.question, label: ARRIVED.yes, text: null }, now: () => T0 });
    keepAnswer(arrived);
    const sent = [];
    const record = async ({ project, event }) => { sent.push([project, event.id]); return { ok: true, id: event.id }; };
    const routes = setupRoutes({ now: () => T0, userHome: user, copy: (runId) => copySetupRecords(runId, SLUG, { record }) });
    assert.deepEqual(await routes['/setup/plan']({ folder, step: 9 }), { ok: true, done: true });
    assert.deepEqual(sent.sort(), [[SLUG, locked.id], [SLUG, arrived.id]].sort());
  });
});

test('the push test\'s result names whether it arrived, and only for one of the card\'s two answers', () => {
  assert.deepEqual(pushTestResult(ARRIVED.yes), { pushArrived: true });
  assert.deepEqual(pushTestResult(ARRIVED.no), { pushArrived: false });
  for (const other of [READY.ready, 'Explain more', '', null, undefined]) assert.throws(() => pushTestResult(other), /It arrived/);
});

// The phone is optional (the director's ruling of 26 October 2026): Skip for now settles step 9 as
// skipped, the health check and setup's end go on, and the front desk takes the test later.
test('Skip for now settles step 9 as skipped, not failed, and setup is finished without a phone', async () => {
  await withProject(async ({ folder, plan, answer }) => {
    const run = readyFor9(folder);
    for (const n of [1, 2, 3, 4, 5, 7]) markStep(run.id, n, 'doneAt', { now: () => T0 });
    await answer((await plan(9)).ask.card, READY.skip);
    assert.deepEqual(await plan(9), { ok: true, done: true });
    const mine = readJournal().runs.find((r) => r.id === run.id);
    assert.deepEqual(mine.changes.filter((c) => c.step === 9).map((c) => [c.kind, c.after]), [['answer', SKIPPED]]);
    assert.equal(phonePushResult(), null, 'a skip is no push that didn\'t arrive');
    // Setup is finished: the phone came after the health check, and holds nothing up.
    assert.equal(firstUnfinished(mine), null);
  });
  // Directly: a skip settles at once, however long ago.
  const skipped = { [`9.${READY_ID}`]: { label: READY.skip, text: null, at: T0.toISOString() } };
  assert.deepEqual(await notifyStep({ settledBefore: () => 0 }).plan({ answers: skipped, now: () => new Date(T0.getTime() + 60 * 60 * 1000) }), { settled: { record: SKIPPED } });
});

// A run parked at step 9 before this release: card A answered Later, which then asked it again
// for ever. After the update, its plan asks the new card, and Skip for now settles it.
test('a run parked on the earlier card, answered Later, is asked the new card and carries on with Skip for now', async () => {
  await withProject(async ({ folder, plan, answer }) => {
    const run = readyFor9(folder);
    for (const n of [1, 2, 3, 4, 5, 7]) markStep(run.id, n, 'doneAt', { now: () => T0 });
    // The earlier release's card A, asked and answered Later, kept signed.
    const old = {
      question: 'Setup step 9, phone notifications, so agents can reach you when they need you. Then click Ready for one test notification.',
      header: 'Question',
      options: [{ label: 'Ready', description: 'Recommended: setup sends one test notification.' }, { label: 'Later', description: 'Setup asks this again later; no test is sent.' }],
    };
    noteAsked({ runId: run.id, folder, step: 9, id: READY_ID, card: old, now: () => T0 });
    keepAnswer(makeEvent({ kind: 'action', data: { action: 'setup-answer', runId: run.id, step: 9, questionId: READY_ID, question: old.question, label: 'Later', text: null }, now: () => ANSWERED }));
    assert.equal(answersFor(run.id)[`9.${READY_ID}`].label, 'Later');
    const asked = await plan(9);
    assert.equal(asked.ok, true, asked.refused);
    assert.equal(asked.ask.id, READY_ID);
    assert.deepEqual(asked.ask.card.options.map((o) => o.label), [READY.ready, READY.skip]);
    // The old Later no longer counts: the card asked now has other words.
    assert.equal(answersFor(run.id)[`9.${READY_ID}`], undefined);
    await answer(asked.ask.card, READY.skip);
    assert.deepEqual(await plan(9), { ok: true, done: true });
    assert.equal(firstUnfinished(readJournal().runs.find((r) => r.id === run.id)), null);
  });
});

test('a skipped phone test, or one that didn\'t arrive, is taken again later with the same test, and one that arrived is not', async () => {
  for (const first of [READY.skip, ARRIVED.no]) {
    await withProject(async ({ folder, plan, answer, user }) => {
      const run = readyFor9(folder);
      if (first === READY.skip) await answer((await plan(9)).ask.card, READY.skip);
      else {
        await answer((await plan(9)).ask.card, READY.ready);
        const b = setupRoutes({ now: () => after(PUSH_TEST_WAIT_MS), userHome: user });
        await answer((await b['/setup/plan']({ folder, step: 9 })).ask.card, ARRIVED.no);
      }
      const routes = setupRoutes({ now: () => after(PUSH_TEST_WAIT_MS), userHome: user });
      const planAt = (ms) => setupRoutes({ now: () => after(ms), userHome: user })['/setup/plan']({ folder, step: 9 });
      assert.deepEqual(await routes['/setup/plan']({ folder, step: 9 }), { ok: true, done: true });
      // Asked from the front desk later, the step is planned again: card A, under the round's own id.
      const day = 24 * 60 * 60 * 1000;
      const a = await planAt(day);
      assert.equal(a.ok, true, a.refused);
      assert.equal(a.ask.id, `${READY_ID}-2`);
      assert.deepEqual(a.ask.card.options.map((o) => o.label), [READY.ready, READY.skip]);
      await answerAt(folder, a.ask.card, READY.ready, after(day));
      assert.equal((await planAt(day)).wait, PUSH_TEST_WAIT_MS);
      const b = await planAt(day + PUSH_TEST_WAIT_MS);
      assert.equal(b.ask.id, `${ARRIVED_ID}-2`);
      await answerAt(folder, b.ask.card, ARRIVED.yes, after(day + PUSH_TEST_WAIT_MS));
      assert.deepEqual(await planAt(day + PUSH_TEST_WAIT_MS), { ok: true, done: true });
      const mine = readJournal().runs.find((r) => r.id === run.id);
      assert.deepEqual(mine.changes.filter((c) => c.step === 9).map((c) => c.after), [first === READY.skip ? SKIPPED : { pushArrived: false }, { pushArrived: true }]);
      // The board reads the new result, dated when it settled.
      assert.deepEqual(phonePushResult(), { arrived: true, at: after(day + PUSH_TEST_WAIT_MS).toISOString(), run: run.id });
      // Arrived: not taken again.
      await assert.rejects(planAt(2 * day), /already done/);
    });
  }
});

test('the board reads the latest settled push test of this computer\'s journal, and nothing before step 9 settles', async () => {
  await withProject(async ({ folder, plan, answer, user }) => {
    assert.equal(phonePushResult(), null, 'no journal yet');
    readyFor9(folder);
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
  assert.deepEqual(phonePushResult(journal), { arrived: true, at: '2026-10-20T05:00:00.000Z', run: 'r1' });
  assert.equal(phonePushResult({ v: 1, runs: [] }), null);
});
