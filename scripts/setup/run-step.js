// scripts/setup/run-step.js
// A long setup step's own process (ruling R15), started by the helper, detached, once the
// director's click on the step's card has been checked:
//   node run-step.js <steps module> <folder> <step> <hash> <run id> <clicked at> <deadline> <user home>
// It acts only for the attempt it was started for: the step's journal entry must still hold that
// click (<clicked at>, as the helper recorded it) and no finish. It works the step's list out
// again, with the helper's user home and every answer of the run (ruling R31) so the two work out
// the same list, and goes ahead only when the list still has the hash the click named, so nothing
// but that list is ever applied. Its
// progress goes to the journal: each change as the step makes it, then the step done, or failed
// with why, each mark only while the entry is still its attempt's, so a process that outlived its
// time never writes over a newer attempt. It runs on when the helper or Desktop goes.
//
// <deadline> is the click's time plus STEP_TIMEOUT_MS: when the helper stops counting the step as
// running and a fresh click may start it again. It is checked against the wall clock every
// TICK_MS, not by one long timer, since a timer doesn't count the time the computer sleeps: the
// first tick after waking past it marks the step failed (if it is still this attempt) and ends
// the process. Started past it, the process does nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJournal, markStep } from './journal.js';
import { loadSteps, runApply } from './engine.js';
import { planHash } from './steps.js';
import { answersFor } from './clicks.js';
import { stopState } from '../lib/stop.js';
import { STEP_TIMEOUT_MS } from '../lib/setup-numbers.js';

export const TICK_MS = 5 * 1000;

export async function runStep([modulePath, folder, stepText, hash, runId, clickedAt, deadlineText, userHome], {
  now = () => new Date(), exit = (code) => process.exit(code), tickMs = TICK_MS,
} = {}) {
  const n = Number(stepText);
  const clicked = Date.parse(clickedAt);
  const deadline = Date.parse(deadlineText);
  if (!Number.isInteger(n) || !Number.isFinite(clicked) || !Number.isFinite(deadline) || deadline > clicked + STEP_TIMEOUT_MS) return 1;
  if (typeof userHome !== 'string' || !path.isAbsolute(userHome)) return 1;
  const run = readJournal().runs.find((r) => r?.id === runId);
  if (!run || run.folder !== folder) return 1;
  let expired = false;
  // This attempt: the entry still holds the click this process was started for, and no finish.
  const mine = (entry) => !expired && entry?.clickedAt === clickedAt && !entry.doneAt && !entry.failed;
  const past = () => now().getTime() >= deadline;
  if (!mine(run.steps?.[n]) || past()) return 1;
  const fail = (reason) => {
    try {
      markStep(runId, n, 'failed', { now, reason, when: mine });
    } catch { /* the journal could not take it; status says the step is stuck once its time is up */ }
    return 1;
  };
  const ticker = setInterval(() => {
    if (!past()) return;
    fail(`it was still running ${STEP_TIMEOUT_MS / 60000} minutes after the click`);
    expired = true;
    clearInterval(ticker);
    exit(1);
  }, tickMs);
  try {
    const step = (await loadSteps(modulePath)).find((s) => s.n === n);
    if (!step) return fail(`there is no setup step ${n}`);
    if (stopState().on) return fail('STOP is on');
    const ctx = { folder, step: n, runId, now, userHome, platform: process.platform, answers: answersFor(runId), stopped: () => stopState().on };
    const got = await step.plan(ctx);
    if (!Array.isArray(got?.changes) || planHash(got.changes) !== hash) return fail('the list changed before the step began, so nothing was changed');
    if (expired) return 1;
    const done = await runApply({ step, runId, changes: got.changes, ctx, current: mine });
    return done.ok && !expired ? 0 : 1;
  } catch (error) {
    return fail((error instanceof Error ? error.message : '') || 'the step did not finish');
  } finally {
    clearInterval(ticker);
  }
}

// Started as a script: by real paths, as helper-main.js is, since a plugin folder may be reached through a link.
function startedAsScript() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (process.argv[1] && startedAsScript()) {
  let code = 1;
  try {
    code = await runStep(process.argv.slice(2));
  } catch { /* nothing to report to: the journal says what it could */ }
  process.exit(code);
}
