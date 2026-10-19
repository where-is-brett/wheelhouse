// scripts/setup/run-step.js
// A long setup step's own process (ruling R15), started by the helper, detached, once the
// director's click on the step's card has been checked:
//   node run-step.js <steps module> <folder> <step> <hash> <run id> <ms left>
// It acts only on a step the helper has marked clicked and not finished, works the step's list
// out again and goes ahead only when the list still has the hash the click named, so nothing but
// that list is ever applied. Its progress goes to the journal: each
// change as the step makes it, then the step done, or failed with why. It runs on when the helper
// or Desktop goes. A step still running STEP_TIMEOUT_MS after its click is marked failed and its
// process ends, at the moment the helper stops counting it as running, so a fresh click can start
// it again and never while this one runs on. <ms left> is that time, from the helper's clock.
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readJournal, markStep } from './journal.js';
import { loadSteps, runApply } from './engine.js';
import { planHash } from './steps.js';
import { stopState } from '../lib/stop.js';
import { STEP_TIMEOUT_MS } from '../lib/setup-numbers.js';

export async function runStep([modulePath, folder, stepText, hash, runId, leftText], { now = () => new Date() } = {}) {
  const n = Number(stepText);
  const left = Number(leftText);
  if (!Number.isInteger(left) || left <= 0 || left > STEP_TIMEOUT_MS) return 1;
  const run = readJournal().runs.find((r) => r?.id === runId);
  if (!run || run.folder !== folder || !Number.isInteger(n)) return 1;
  // Only a step the helper started on a checked click: clicked, and neither done nor failed since.
  const entry = run.steps?.[n];
  if (typeof entry?.clickedAt !== 'string' || entry.doneAt || entry.failed) return 1;
  const fail = (reason) => {
    markStep(runId, n, 'failed', { now, reason });
    return 1;
  };
  try {
    const step = (await loadSteps(modulePath)).find((s) => s.n === n);
    if (!step) return fail(`there is no setup step ${n}`);
    if (stopState().on) return fail('STOP is on');
    const ctx = { folder, step: n, runId, now, userHome: os.homedir(), platform: process.platform, stopped: () => stopState().on };
    const got = await step.plan(ctx);
    if (!Array.isArray(got?.changes) || planHash(got.changes) !== hash) return fail('the list changed before the step began, so nothing was changed');
    // Not unref'd: a step waiting on nothing at all is still marked failed when its time is up.
    const timer = setTimeout(() => {
      try {
        fail(`it was still running ${STEP_TIMEOUT_MS / 60000} minutes after the click`);
      } finally {
        process.exit(1);
      }
    }, left);
    try {
      const done = await runApply({ step, runId, changes: got.changes, ctx });
      return done.ok ? 0 : 1;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return fail((error instanceof Error ? error.message : '') || 'the step did not finish');
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
