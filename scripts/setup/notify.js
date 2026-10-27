// scripts/setup/notify.js
// Step 9, Phone notifications (design sections 13 and 15, check 4, ruling R39). A push reaches the
// director's phone only with Remote Control on in Claude Desktop, Claude's push options on (step 6
// switches on Push when Claude decides, `agentPushNotifEnabled`) and the phone allowing Claude's
// notifications, and Claude skips a push while the director is at the computer, so the test is
// sent with the screen locked. Only a session can push, so the playbook sends it; the engine sees
// only the answers and the wait. The step has no Go ahead (ruling R32). It waits for step 6, which
// switches that push option on, for step 8, whose password window card A's locked screen would
// cover (ruling R70), and for the health check: the phone is offered once setup is finished, after
// the first briefing (`after: [6, 8, 10]`, design section 15.1). Until all three are done, nothing
// is asked or settled. A joining computer has no health check, so it waits for steps 6 and 8 only.
//
//
// 1. With no Ready yet, it asks the card of plain steps, ending with the screen locked until the
//    phone buzzes, or for PUSH_TEST_LOCK_MS if it doesn't (ruling R65): longer than the wait, so the
//    push goes out while the screen is still locked. It is answered Ready or Skip for now. The phone
//    is optional (the director's ruling of 26 October 2026, design section 22): Skip for now settles
//    the step at once on { pushSkipped: true }, recorded as skipped, never as a push that didn't
//    arrive, so the health check and setup's end never wait for a phone. Skip for now is a kept
//    answer, not a put-off button (the question kind refuses Not now as its own option, ruling R50).
//    A run parked on the earlier card, answered Later, is asked this card again, since its words
//    and options changed, and goes on from the director's answer.
// 2. With Ready answered less than PUSH_TEST_WAIT_MS ago, it waits for what is left; the playbook
//    waits, then sends one test push with the session's push tool. The playbook (Task 16) knows
//    this wait by its step, PUSH_TEST_STEP: a wait from step 9's plan that names no step it waits
//    for (`waitsFor`, the engine's wait for steps 6 and 8) means "push once it is over". It never
//    reads that from `why`, which is words for the director's session.
// 3. After that, it asks whether the test arrived: It arrived, or It didn't.
// 4. With that answered, it settles on pushTestResult(label), kept in the journal as the step's
//    `answer` change, however long ago Ready was; the board's health reads it
//    (scripts/lib/setup-run.js, phonePushResult) and, when it didn't arrive, says so with what to do.
//
// A step 9 done on a skip, or on a push that didn't arrive, can be taken again (phoneRetakeable):
// the front desk plans it again when the director asks to set up phone notifications, and the same
// test runs, under ids of its own for that round, so the answers that settled it before don't
// settle it again.
//
// Phone notifications belong to the computer: when an earlier run on it recorded that the test push
// arrived (phonePushResult), the step settles at once with { pushArrived: true, from: <that run> },
// asking nothing and sending no push (ruling R75). One that didn't arrive asks again, as above.
//
// A Ready older than PUSH_TEST_WAIT_MS + CLICK_FRESH_MS, with card B unanswered, is a setup that
// stopped during the wait and resumed later, so no push may have been sent: it asks card A again
// (ruling R66), never card B, so a push never sent is never recorded as not arrived. The card asked
// again keeps its id and words: the old Ready only asks it again, and the director's new Ready is
// then the newest answer under that id, so the wait starts again from it.
import { SETUP_TITLES } from '../state/card-lines.js';
import { PHONE_REACHES } from '../lib/calm-words.js';
import { PUSH_TEST_WAIT_MS, PUSH_TEST_LOCK_MS, CLICK_FRESH_MS } from '../lib/setup-numbers.js';
import { PUSH_TEST_STEP, phonePushResult, phoneResults, readJournal } from '../lib/setup-run.js';

export const READY_ID = 'phone-ready';
export const ARRIVED_ID = 'push-arrived';
export const READY = Object.freeze({ ready: 'Ready', skip: 'Skip for now' });
// What a skip settles on.
export const SKIPPED = Object.freeze({ pushSkipped: true });
export const ARRIVED = Object.freeze({ yes: 'It arrived', no: 'It didn\'t' });
// What the playbook's one test push says.
export const PUSH_TEST_TEXT = 'Wheelhouse test: phone notifications reach you.';

// A number of minutes in words: "two minutes".
const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five'];
const inWords = (ms) => {
  const m = ms / 60000;
  return `${NUMBERS[m] ?? m} minute${m === 1 ? '' : 's'}`;
};
const MINUTES = inWords(PUSH_TEST_WAIT_MS);
const LOCK = `lock your screen until your phone buzzes, or for ${inWords(PUSH_TEST_LOCK_MS)}.`;
// How old a Ready may be before card B is asked rather than card A again (ruling R66).
const READY_STALE_MS = PUSH_TEST_WAIT_MS + CLICK_FRESH_MS;

// The ids of the round's two cards: the first round's as they always were, a later round's (the
// test taken again from the front desk) with its number.
const idsFor = (round) => (round === 0 ? { ready: READY_ID, arrived: ARRIVED_ID } : { ready: `${READY_ID}-${round + 1}`, arrived: `${ARRIVED_ID}-${round + 1}` });

// The card of plain steps, asked until the director clicks Ready or Skip for now.
function readyAsk(id) {
  return {
    id,
    card: {
      level: 2,
      // Kept short (about 100 words with its options), since it opens with the health check's
      // verdict and the first briefing. A push isn't sent while the director is at the computer,
      // hence the locked screen.
      what: `Setup step ${PUSH_TEST_STEP}, your phone. ${PHONE_REACHES} `
        + 'In Claude Desktop\'s settings, switch on Remote Control and both push options, '
        + 'and allow Claude\'s notifications on your phone. '
        + `Then click Ready and ${LOCK}`,
      why: 'Only you can do these.',
      options: [
        { label: READY.ready, says: `Setup sends a test ${MINUTES} later and asks if it arrived.` },
        { label: READY.skip, says: 'Setup carries on without your phone; the front desk can set it up later.' },
      ],
      recommend: READY.ready,
      because: 'it shows now whether your phone works',
      meanwhile: 'Setup waits for your click.',
    },
  };
}

// The card asking whether the test arrived, once the wait is over and the push is sent.
function arrivedAsk(id) {
  return {
    id,
    card: {
      level: 2,
      what: `Setup step ${PUSH_TEST_STEP}: did the test notification reach your phone while your screen was locked?`,
      why: 'Agents use it to tell you when they need you; if it didn\'t come, the board says what to check.',
      options: [
        { label: ARRIVED.yes, says: 'Setup records that notifications reach your phone, and moves on.' },
        { label: ARRIVED.no, says: 'Setup records it and moves on; the board\'s health says what to check.' },
      ],
      // The composer needs a recommendation among the card's options; on a question of fact it
      // only asks the director to answer what they saw.
      recommend: ARRIVED.yes,
      because: 'it is right only if the notification came: answer what you saw',
      meanwhile: 'Setup waits for your answer; anything already running carries on.',
    },
  };
}

// What step 9 settles on, from the answer to whether the test arrived: { pushArrived }, kept in
// the journal as the step's `answer` change. Throws for any other label.
export function pushTestResult(label) {
  if (label === ARRIVED.yes) return { pushArrived: true };
  if (label === ARRIVED.no) return { pushArrived: false };
  throw new Error(`The push test's answer must be ${ARRIVED.yes} or ${ARRIVED.no}`);
}

// Step 9. `pushResult` reads what this computer's journal last recorded of the test push, and
// `settledBefore(runId)` how many times this run's step 9 has settled (for tests).
const settledIn = (runId) => phoneResults(readJournal().runs.find((r) => r?.id === runId)).length;
export function notifyStep({ pushResult = () => phonePushResult(), settledBefore = settledIn } = {}) {
  return {
    n: PUSH_TEST_STEP,
    title: SETUP_TITLES[PUSH_TEST_STEP],
    after: [6, 8, 10],
    async plan(ctx) {
      const answers = ctx.answers ?? {};
      const ids = idsFor(typeof ctx.runId === 'string' ? settledBefore(ctx.runId) : 0);
      // An answer to card B settles, however old the Ready before it (ruling R66).
      const arrived = answers[`${PUSH_TEST_STEP}.${ids.arrived}`];
      if (arrived) return { settled: { record: pushTestResult(arrived.label) } };
      // The push already reached the phone in an earlier run on this computer (ruling R75).
      const earlier = pushResult();
      if (earlier?.arrived === true && earlier.run !== ctx.runId) return { settled: { record: { pushArrived: true, from: earlier.run } } };
      const ready = answers[`${PUSH_TEST_STEP}.${ids.ready}`];
      if (ready?.label === READY.skip) return { settled: { record: { ...SKIPPED } } };
      if (ready?.label !== READY.ready) return { ask: readyAsk(ids.ready) };
      // From the Ready answer's own time; one that reads as later than now waits the whole time.
      const readyAt = Date.parse(ready.at);
      const since = Number.isFinite(readyAt) ? ctx.now().getTime() - readyAt : 0;
      if (since > READY_STALE_MS) return { ask: readyAsk(ids.ready) };
      const left = Math.min(PUSH_TEST_WAIT_MS, PUSH_TEST_WAIT_MS - since);
      if (left > 0) {
        return {
          wait: left,
          why: `the director's screen is locked until their phone buzzes; once this wait is over, send one test notification with the session's push tool ("${PUSH_TEST_TEXT}"), then ask for step ${PUSH_TEST_STEP}'s plan again`,
        };
      }
      return { ask: arrivedAsk(ids.arrived) };
    },
    async apply() {
      return [];
    },
  };
}
