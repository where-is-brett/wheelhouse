// scripts/setup/notify.js
// Step 9, Phone notifications (design sections 13 and 15, check 4, ruling R39). A push reaches the
// director's phone only with Remote Control on in Claude Desktop, Claude's push options on (step 6
// switches on Push when Claude decides, `agentPushNotifEnabled`) and the phone allowing Claude's
// notifications, and Claude skips a push while the director is at the computer, so the test is
// sent with the screen locked. Only a session can push, so the playbook sends it; the engine sees
// only the answers and the wait. The step has no Go ahead (ruling R32):
//
// 1. With no Ready yet, it asks the card of plain steps, ending "Lock your screen for two minutes.",
//    answered Ready or Later. Later is a kept answer, not a put-off button (the question kind
//    refuses Not now as its own option, ruling R50), and asks the same card again when the step is
//    next planned.
// 2. With Ready answered less than PUSH_TEST_WAIT_MS ago, it waits for what is left; the playbook
//    waits, then sends one test push with the session's push tool.
// 3. After that, it asks whether the test arrived: It arrived, or It didn't.
// 4. With that answered, it settles on pushTestResult(label), kept in the journal as the step's
//    `answer` change; the board's health reads it (scripts/lib/setup-run.js, phonePushResult) and,
//    when it didn't arrive, says so with what to do.
import { SETUP_TITLES } from '../state/card-lines.js';
import { PUSH_TEST_WAIT_MS } from '../lib/setup-numbers.js';
import { PUSH_TEST_STEP } from '../lib/setup-run.js';

export const READY_ID = 'phone-ready';
export const ARRIVED_ID = 'push-arrived';
export const READY = Object.freeze({ ready: 'Ready', later: 'Later' });
export const ARRIVED = Object.freeze({ yes: 'It arrived', no: 'It didn\'t' });
// What the playbook's one test push says.
export const PUSH_TEST_TEXT = 'Wheelhouse test: phone notifications reach you.';

// The wait in words: "two minutes".
const MINUTES = PUSH_TEST_WAIT_MS === 2 * 60 * 1000 ? 'two minutes' : `${PUSH_TEST_WAIT_MS / 60000} minutes`;
const LOCK = `Lock your screen for ${MINUTES}.`;

// The card of plain steps, asked until the director clicks Ready.
function readyAsk() {
  return {
    id: READY_ID,
    card: {
      level: 2,
      what: `Setup step ${PUSH_TEST_STEP}, phone notifications, so agents can reach you on your phone when they need you. `
        + 'First, in Claude Desktop\'s settings, switch on Remote Control. '
        + 'Then check both push options are on: Push when Claude decides, which setup switched on at step 6, and Push when actions required. '
        + 'On your phone, allow notifications from the Claude app. '
        + `Then click Ready, and setup sends one test notification. Claude doesn't send one while you are at the computer, so once you have clicked: ${LOCK}`,
      why: 'Remote Control alone isn\'t enough: the push options and your phone\'s own permission are needed too.',
      options: [
        { label: READY.ready, says: `Setup waits ${MINUTES}, sends one test notification, and asks whether it arrived.` },
        { label: READY.later, says: 'Setup asks this again when you come back to it; no test is sent.' },
      ],
      recommend: READY.ready,
      because: 'it takes a couple of minutes, and tells you now whether your phone hears from agents',
      meanwhile: 'Setup waits for your click; anything already running carries on.',
    },
  };
}

// The card asking whether the test arrived, once the wait is over and the push is sent.
function arrivedAsk() {
  return {
    id: ARRIVED_ID,
    card: {
      level: 2,
      what: `Setup step ${PUSH_TEST_STEP}: did the test notification reach your phone while your screen was locked?`,
      why: 'Agents use it to tell you when they need you; if it didn\'t come, the board says what to check.',
      options: [
        { label: ARRIVED.yes, says: 'Setup records that notifications reach your phone, and moves on.' },
        { label: ARRIVED.no, says: 'Setup records it and moves on; the board\'s health says what to check.' },
      ],
      recommend: ARRIVED.yes,
      because: 'it is the answer if the notification came; choose It didn\'t if it didn\'t',
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

export function notifyStep() {
  return {
    n: PUSH_TEST_STEP,
    title: SETUP_TITLES[PUSH_TEST_STEP],
    async plan(ctx) {
      const answers = ctx.answers ?? {};
      const ready = answers[`${PUSH_TEST_STEP}.${READY_ID}`];
      if (ready?.label !== READY.ready) return { ask: readyAsk() };
      // From the Ready answer's own time; one that reads as later than now waits the whole time.
      const readyAt = Date.parse(ready.at);
      const since = Number.isFinite(readyAt) ? ctx.now().getTime() - readyAt : 0;
      const left = Math.min(PUSH_TEST_WAIT_MS, PUSH_TEST_WAIT_MS - since);
      if (left > 0) {
        return {
          wait: left,
          why: `the director is locking the screen for ${MINUTES}; once this wait is over, send one test notification with the session's push tool ("${PUSH_TEST_TEXT}"), then ask for step ${PUSH_TEST_STEP}'s plan again`,
        };
      }
      const arrived = answers[`${PUSH_TEST_STEP}.${ARRIVED_ID}`];
      if (!arrived) return { ask: arrivedAsk() };
      return { settled: { record: pushTestResult(arrived.label) } };
    },
    async apply() {
      return [];
    },
  };
}
