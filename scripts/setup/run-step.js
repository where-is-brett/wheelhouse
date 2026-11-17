// scripts/setup/run-step.js
// A long setup step's own process (ruling R15), started by the helper, detached, once the
// director's click on the step's card has been checked:
//   node run-step.js <steps module> <folder> <step> <hash> <run id> <clicked at> <deadline> <user home> <session kind> <session started at>
// It acts only for the attempt it was started for: the step's journal entry must still hold that
// click (<clicked at>, as the helper recorded it) and no finish. The helper hands it the list the
// click named (scripts/setup/plan-sketch.js), and it goes ahead only with a list that has the hash
// the click named, so nothing but that list is ever applied. Without that file it works the list
// out again, with the helper's user home and every answer of the run (ruling R31), and goes ahead
// only when that list has the hash; when it has not, the step's failure names what differs. Its
// progress goes to the journal: each change as the step makes it, then the step done, or failed
// with why, each mark only while the entry is still its attempt's, so a process that outlived its
// time never writes over a newer attempt. It runs on when the helper or Desktop goes.
//
// <deadline> is the click's time plus STEP_TIMEOUT_MS: when the helper stops counting the step as
// running and a fresh click may start it again. The process stops one TICK_MS before it, so an old
// process and a new one never run together. It is checked against the wall clock every TICK_MS,
// not by one long timer, since a timer doesn't count the time the computer sleeps: the first tick
// after waking past it marks the step failed (if it is still this attempt) and ends the process.
// Started past it, the process does nothing. Programs the step started, such as an installer,
// are not its children to end: they run on, and the step records them so a retry finds them.
import path from 'node:path';
import { readJournal, markStep } from './journal.js';
import { loadSteps, runApply } from './engine.js';
import { planHash } from './steps.js';
import { readSketch, removeSketch, sketchOf, sayDifference, detailOf, sayNoList } from './plan-sketch.js';
import { answersWithConsent } from './choices.js';
import { stopState } from '../lib/stop.js';
import { STEP_TIMEOUT_MS } from '../lib/setup-numbers.js';
import { startedAsScript } from '../lib/started-as-script.js';

export const TICK_MS = 5 * 1000;
// The director's line begins in lower case: status says it after "did not finish:".
const CHANGED = 'the plan for this step changed between your click and its start';
const NOTHING_DONE = 'so nothing was done.';
const AGAIN = 'Open setup again for the step\'s new card.';
const DIFFERENT = 'What is different:';

export async function runStep([modulePath, folder, stepText, hash, runId, clickedAt, deadlineText, userHome, sessionKind, sessionStartedAt, handoffError], {
  now = () => new Date(), exit = (code) => process.exit(code), tickMs = TICK_MS,
} = {}) {
  const n = Number(stepText);
  const clicked = Date.parse(clickedAt);
  const deadline = Date.parse(deadlineText);
  // Refused, it removes the file the helper made for this click, which nothing else will use.
  const refused = () => {
    removeSketch(runId, n, clickedAt);
    return 1;
  };
  if (!Number.isInteger(n) || !Number.isFinite(clicked) || !Number.isFinite(deadline) || deadline > clicked + STEP_TIMEOUT_MS) return refused();
  if (typeof userHome !== 'string' || !path.isAbsolute(userHome)) return refused();
  const run = readJournal().runs.find((r) => r?.id === runId);
  if (!run || run.folder !== folder) return refused();
  let expired = false;
  // This attempt: the entry still holds the click this process was started for, and no finish.
  const mine = (entry) => !expired && entry?.clickedAt === clickedAt && !entry.doneAt && !entry.failed;
  // It stops one tick before the deadline (ruling R47), so it has marked the step failed and gone
  // before the helper stops counting the step as running and a fresh click may start another.
  const past = () => now().getTime() >= deadline - tickMs;
  if (!mine(run.steps?.[n]) || past()) return refused();
  const fail = (reason, detail) => {
    try {
      markStep(runId, n, 'failed', { now, reason, detail, when: mine });
    } catch { /* the journal could not take it; status says the step is stuck once its time is up */ }
    return 1;
  };
  const ticker = setInterval(() => {
    if (!past()) return;
    fail(`it was still running ${STEP_TIMEOUT_MS / 60000} minutes after the click`);
    removeSketch(runId, n, clickedAt);
    expired = true;
    clearInterval(ticker);
    exit(1);
  }, tickMs);
  try {
    const step = (await loadSteps(modulePath)).find((s) => s.n === n);
    if (!step) return fail(`there is no setup step ${n}`);
    if (stopState().on) return fail('All stop is on');
    const ctx = { folder, step: n, runId, startedAt: run.startedAt, now, userHome, platform: process.platform, desktop: sessionKind === 'desktop', sessionStartedAt: Number.isFinite(Date.parse(sessionStartedAt)) ? sessionStartedAt : undefined, answers: answersWithConsent(runId).answers, stopped: () => stopState().on };
    // The list the helper planned and the click named, handed over with its hash: the plan reads facts
    // (the network, the clock) that can answer differently a few seconds later, so the list is not
    // worked out again when it is here and has the hash the click named, and nothing else is applied.
    const handed = readSketch(runId, n, clickedAt, hash);
    let changes = handed !== null && planHash(handed.changes) === hash ? handed.changes : null;
    if (changes === null) {
      const got = await step.plan(ctx);
      // The director's line says what is different in plain words; the exact kind, action, target and
      // field names (never values) go to the entry's failedDetail, for agents.
      // Without a handed list, agents are told so, and why the helper could not keep one if it said.
      const noHanded = handed !== null ? '' : `no handed list (file missing or for another hash)${typeof handoffError === 'string' && handoffError !== '' ? `; the helper could not write it: ${handoffError}` : ''}`;
      if (!Array.isArray(got?.changes)) {
        const none = sayNoList(got);
        const detail = [none.detail, noHanded].filter((x) => x !== '').join('; ');
        return fail(none.again
          ? `${CHANGED}, ${NOTHING_DONE} ${DIFFERENT} ${none.plain}. ${AGAIN}`
          : `${CHANGED}: ${none.plain}, so setup has nothing more to do for it.`, detail);
      }
      if (planHash(got.changes) !== hash) {
        if (handed === null) return fail(`${CHANGED}, ${NOTHING_DONE} ${AGAIN}`, noHanded);
        const planned = sketchOf(got.changes, handed.salt);
        const said = sayDifference(handed, planned);
        return fail(`${CHANGED}, ${NOTHING_DONE} ${said === '' ? '' : `${DIFFERENT} ${said}. `}${AGAIN}`, detailOf(handed, planned));
      }
      changes = got.changes;
    }
    if (expired) return 1;
    const done = await runApply({ step, runId, changes, ctx, current: mine });
    return done.ok && !expired ? 0 : 1;
  } catch (error) {
    return fail((error instanceof Error ? error.message : '') || 'the step did not finish');
  } finally {
    clearInterval(ticker);
    removeSketch(runId, n, clickedAt);
  }
}

if (startedAsScript(import.meta.url)) {
  let code = 1;
  try {
    code = await runStep(process.argv.slice(2));
  } catch { /* nothing to report to: the journal says what it could */ }
  process.exit(code);
}
