// scripts/setup/engine.js
// What the helper's /setup/* routes do (scripts/host/helper.js). Setup's playbook only talks: every
// change is made here, and only after the director's signed click on a card listing exactly what
// will change, named by the hash of that list (design section 15, the plan's call 2).
//
//   /setup/plan   { folder, step }        -> { ok, changes, hash, card, director }
//   /setup/apply  { folder, step, hash }  -> { ok, started: true } (a short step: done: true too)
//   /setup/status { folder }              -> { ok, lines, next, ask }
//
// The helper works out each step's list itself, from the step's own plan, every time; it never
// reads a list a caller sends, and a request that carries anything but the folder, the step and
// the hash is refused. Apply goes ahead only when a fresh plan gives the hash the request names,
// that list is the one this folder's card showed, and the director's click on it is signed by
// this computer's enrolled key, names this folder's run, this step and this hash, is from the
// last CLICK_FRESH_MS and hasn't been used. A long step runs in a detached child
// (scripts/setup/run-step.js), which works the list out again and records its progress in the
// journal. A short step runs here, counted as running for as long as it takes. Plan and status change
// nothing a step lists: plan starts the folder's run when there is none and records when the card
// was shown, which the timed runs read. Under STOP they answer; apply is refused.
//
// Every route checks its folder (ruling R16): a full path, placed by its real path, under the
// user's own ~/Projects, in a registered project's folder, or the folder of a setup run. A step
// making the folder (step 3 for a new product) widens this in its own task (Task 8).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { wheelhouseHome } from '../lib/paths.js';
import { projectForFolder } from '../lib/projects.js';
import { CLICK_FRESH_MS, STEP_TIMEOUT_MS } from '../lib/setup-numbers.js';
import { SETUP_TITLES } from '../state/card-lines.js';
import { composeCard } from '../cards/compose.js';
import { readJournal, startRun, markStep, addChanges, applyJsonKey as journalKey } from './journal.js';
import { planHash, firstUnfinished } from './steps.js';
import { noteShown, shownFor, freshClicks, useClick, releaseClick } from './clicks.js';

export const STEPS_MODULE = fileURLToPath(new URL('./steps.js', import.meta.url));
export const RUN_STEP = fileURLToPath(new URL('./run-step.js', import.meta.url));

export const OUTSIDE = 'the folder is not under ~/Projects, in a registered project or being set up, so setup does not act on it';
export const NEEDS_CLICK = `this step needs the director's click on its card, from the last ${CLICK_FRESH_MS / 60000} minutes`;
export const CHANGED = 'the list has changed since the card: ask for the plan again and show the new card';
export const OWN_LIST = 'the helper works out the list itself: a request names only the folder, the step and the hash on the card';
const APPLY_FIELDS = ['folder', 'step', 'hash'];
const FULL_HASH = /^[0-9a-f]{64}$/;
const caseBlind = process.platform === 'win32' || process.platform === 'darwin';

export class SetupRefusal extends Error {}
const refuse = (message) => { throw new SetupRefusal(message); };

const keyOf = (p) => {
  const text = p.normalize('NFC');
  return caseBlind ? text.toLowerCase() : text;
};
const within = (base, target) => {
  const b = keyOf(base);
  const t = keyOf(target);
  return t.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
};

// The run setup is doing for this real path: the latest run of the nearest folder that is it or
// holds it (case and accents folded as the system does), as kit.js's beingSetUp places a session,
// so a session in a folder inside the one being set up carries on that run; null when none does.
function runFor(real) {
  const holding = readJournal().runs.filter((r) => typeof r?.folder === 'string' && (keyOf(r.folder) === keyOf(real) || within(r.folder, real)));
  if (holding.length === 0) return null;
  const nearest = Math.max(...holding.map((r) => keyOf(r.folder).length));
  return holding.filter((r) => keyOf(r.folder).length === nearest).at(-1);
}

const runById = (id) => readJournal().runs.find((r) => r?.id === id) ?? null;

// The folder's real path, when setup may act on it; otherwise a refusal naming why.
export function admitFolder(folder, { userHome = os.homedir() } = {}) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) refuse('the folder must be a full path');
  let real;
  try {
    real = fs.realpathSync.native(folder);
  } catch {
    refuse('the folder was not found');
  }
  if (!fs.statSync(real).isDirectory()) refuse('the folder given is not a folder');
  let projects = null;
  try {
    projects = fs.realpathSync.native(path.join(userHome, 'Projects'));
  } catch { /* no ~/Projects on this computer */ }
  if (projects !== null && within(projects, real)) return real;
  if (projectForFolder(real) !== null) return real;
  if (runFor(real) !== null) return real;
  return refuse(OUTSIDE);
}

// The steps a module gives, checked: each with its number, title, plan and apply.
export async function loadSteps(modulePath) {
  const steps = (await import(pathToFileURL(modulePath).href)).STEPS;
  const good = Array.isArray(steps) && steps.every((s) => Number.isInteger(s?.n) && Object.hasOwn(SETUP_TITLES, s.n)
    && typeof s.title === 'string' && typeof s.plan === 'function' && typeof s.apply === 'function');
  if (!good) throw new Error('The setup steps could not be read');
  return steps;
}

const title = (n) => `step ${n}, ${SETUP_TITLES[n]}`;
const isDone = (run, n) => typeof run?.steps?.[n]?.doneAt === 'string';

// Running: clicked, not done, not failed, and not past the time a step may take.
function runningSince(entry, now) {
  if (!entry?.clickedAt || entry.doneAt || entry.failed) return null;
  return now().getTime() - Date.parse(entry.clickedAt) < STEP_TIMEOUT_MS ? entry.clickedAt : null;
}

// Runs a step's apply on the list worked out for it, records each change in the journal as the
// step makes it, and marks the step done, or failed with why. The step's ctx carries
// `applyJsonKey(args)`, the journal's key edit with the change recorded before the file is
// written, and `record(change or changes)`, which the step calls before or as it makes each change
// of any other kind. So a step that fails part-way leaves every change it made in the journal, for
// uninstall to put back, and a retry never takes setup's own value for the director's. Changes
// apply returns are recorded too, each once: one already recorded through ctx is not doubled.
// `current`, a test of the step's journal entry, keeps the mark to this attempt: a newer attempt's
// entry is never marked by an older one. Each change made is recorded whatever, since it was made.
// Used by the helper for a short step and by scripts/setup/run-step.js for a long one.
export async function runApply({ step, runId, changes, ctx, current }) {
  const recorded = new Set();
  const record = (made) => {
    const given = Array.isArray(made) ? made : (made === undefined || made === null ? [] : [made]);
    const list = given.filter((c) => !recorded.has(c?.id)).map((c) => ({ ...c, step: step.n }));
    if (list.length === 0) return;
    addChanges(runId, list);
    for (const c of list) recorded.add(c.id);
  };
  const applyJsonKey = (args) => journalKey({ ...args, step: step.n, record });
  try {
    record(await step.apply({ ...ctx, runId, record, applyJsonKey }, changes));
    markStep(runId, step.n, 'doneAt', { now: ctx.now, when: current });
    return { ok: true };
  } catch (error) {
    const reason = (error instanceof Error ? error.message : '') || 'the step did not finish';
    try {
      markStep(runId, step.n, 'failed', { now: ctx.now, reason, when: current });
    } catch { /* the journal could not take it; the step reads as running until its time is up */ }
    return { ok: false, reason };
  }
}

// The first step neither done nor running (`running(n)`), or null.
function toAsk(run, steps, running) {
  return [...steps].map((s) => s.n).sort((a, b) => a - b).find((n) => !isDone(run, n) && !running(n)) ?? null;
}

// One line for each step of a run, then its changes, and what is next: `next`, the first step not
// done (null when every step is), and `ask`, the first step neither done nor running, whose card
// is asked next (a long step's later cards are asked while it runs; null when there is none).
// `running(n)` gives when step n was clicked while it runs, or null.
function statusLines(run, steps, running) {
  const lines = [`Setup of ${run.folder}, started ${run.startedAt}.`];
  for (const { n } of [...steps].sort((a, b) => a.n - b.n)) {
    const entry = run.steps?.[n] ?? {};
    const name = `Step ${n}, ${SETUP_TITLES[n]}`;
    if (entry.doneAt) lines.push(`${name}: done at ${entry.doneAt}`);
    else if (entry.failed) lines.push(`${name}: did not finish: ${entry.failed}`);
    else if (entry.clickedAt) {
      lines.push(running(n)
        ? `${name}: running since ${entry.clickedAt}`
        : `${name}: stuck: running since ${entry.clickedAt}, more than ${STEP_TIMEOUT_MS / 60000} minutes`);
    } else if (entry.shownAt) lines.push(`${name}: card shown at ${entry.shownAt}, not clicked yet`);
    else lines.push(`${name}: not started`);
    for (const c of (run.changes ?? []).filter((x) => x.step === n)) {
      lines.push(`  changed: ${c.kind} ${c.target}${Array.isArray(c.key) ? ` (${c.key.join('.')})` : ''}`);
    }
  }
  const next = firstUnfinished(run, steps);
  lines.push(next === null ? 'Every step is done.' : `Next: ${title(next)}.`);
  return { lines, next, ask: toAsk(run, steps, running) };
}

// The routes' handlers, each taking the request's body and giving its answer. A refusal throws
// SetupRefusal, which the helper sends as { ok: false, refused }. `mark` records a step's time in
// the journal (journal.js's markStep; a test can make it fail).
export function setupRoutes({
  now = () => new Date(), stopped = () => false, stopRefusal = { ok: false, refused: 'STOP is on' },
  stepsModule = STEPS_MODULE, userHome = os.homedir(), platform = process.platform, spawn = nodeSpawn, mark = markStep,
} = {}) {
  let loaded = null;
  const steps = () => (loaded ??= loadSteps(stepsModule).catch((error) => { loaded = null; throw error; }));
  // The short steps this helper is running now, as `<run id>:<step>`. A short step has no time
  // limit of its own, so one still working past STEP_TIMEOUT_MS is still running: it is neither
  // started again nor shown again while it is here.
  const inHelper = new Set();
  // When step n of a run was clicked, while it runs: in this helper, or clicked less than
  // STEP_TIMEOUT_MS ago and not finished. Null when it isn't running.
  const runningIn = (run, n) => {
    const entry = run?.steps?.[n];
    if (run && inHelper.has(`${run.id}:${n}`)) return entry?.clickedAt ?? 'now';
    return runningSince(entry, now);
  };

  async function stepOf(n) {
    if (!Number.isInteger(n)) refuse(`the step must be a number from 1 to ${Object.keys(SETUP_TITLES).length}`);
    const step = (await steps()).find((s) => s.n === n);
    if (!step) refuse(`there is no setup step ${n}`);
    return step;
  }

  const ctxFor = (folder, n, runId) => ({ folder, step: n, runId, now, userHome, platform });

  // A step's plan with its hash and its card, composed with the setup line.
  async function planned(step, ctx) {
    const got = await step.plan(ctx);
    if (!got || !Array.isArray(got.changes)) throw new Error(`Step ${step.n}'s plan gave no list of changes`);
    const hash = planHash(got.changes);
    return { ...got, hash };
  }

  // A step done or running is not planned again: its card's shown time and record stay as they are.
  const showable = (run, n) => {
    if (isDone(run, n)) refuse(`${title(n)} is already done`);
    if (runningIn(run, n)) refuse(`${title(n)} is already running`);
  };

  // Answers under STOP, as status does (ruling R19): it writes only setup's own records (the run
  // when the folder has none, the card's shownAt, the shown card), never anything a step lists.
  async function plan(body) {
    const folder = admitFolder(body.folder, { userHome });
    const step = await stepOf(body.step);
    let run = runFor(folder);
    showable(run, step.n);
    const got = await planned(step, ctxFor(run?.folder ?? folder, step.n, run?.id));
    const { question } = composeCard({ ...got.card, kind: 'setup', target: { step: step.n, hash: got.hash } });
    // Read again: the step may have been started while its plan was worked out.
    if (run) showable(runById(run.id), step.n);
    run ??= startRun({ folder, now });
    noteShown({ runId: run.id, folder: run.folder, step: step.n, hash: got.hash, card: question, now });
    mark(run.id, step.n, 'shownAt', { now });
    return { ok: true, changes: got.changes, hash: got.hash, card: question, director: typeof got.director === 'string' ? got.director : '' };
  }

  async function apply(body) {
    if (stopped()) return stopRefusal;
    if (Object.keys(body).some((k) => !APPLY_FIELDS.includes(k))) refuse(OWN_LIST);
    const folder = admitFolder(body.folder, { userHome });
    const step = await stepOf(body.step);
    if (typeof body.hash !== 'string' || !FULL_HASH.test(body.hash)) refuse('the hash must be the full hash of the list on the card');
    const run = runFor(folder);
    if (run === null) refuse('this step\'s card has not been shown: ask for its plan first');
    const startable = (current) => {
      if (isDone(current, step.n)) refuse(`${title(step.n)} is already done`);
      if (runningIn(current, step.n)) refuse(`${title(step.n)} is already running`);
    };
    startable(run);
    // The list as it is now, worked out by the helper: the request's hash must name it, and the
    // card this folder was shown for the step must have shown it.
    const ctx = ctxFor(run.folder, step.n, run.id);
    const fresh = await planned(step, ctx);
    // Nothing is awaited from here until the step is marked clicked, so of two requests in flight
    // together (two Go aheads on one card) only one starts the step: the journal is read again
    // here, and the other finds the step running, or done.
    startable(runById(run.id));
    if (fresh.hash !== body.hash || shownFor(run.id, step.n)?.hash !== fresh.hash) refuse(CHANGED);
    // STOP is read again at the last moment, before the click is used.
    if (stopped()) return stopRefusal;
    const click = freshClicks({ runId: run.id, step: step.n, hash: fresh.hash, now }).find((e) => useClick(e, now));
    if (!click) refuse(NEEDS_CLICK);
    const clickedAt = new Date(click.at).toISOString();
    try {
      mark(run.id, step.n, 'clickedAt', { now: () => new Date(clickedAt) });
    } catch (error) {
      releaseClick(click);
      refuse(`${title(step.n)} could not be recorded as started, so it did not start and the click can be used again: ${error instanceof Error ? error.message : 'the journal could not be written'}`);
    }
    // This attempt: its click still the step's, and not finished.
    const current = (entry) => entry?.clickedAt === clickedAt && !entry.doneAt && !entry.failed;
    if (step.long) {
      // It may run until the helper stops counting it as running: STEP_TIMEOUT_MS from the click.
      startChild({ step, run, hash: fresh.hash, clickedAt, deadline: new Date(Date.parse(clickedAt) + STEP_TIMEOUT_MS).toISOString() });
      return { ok: true, started: true };
    }
    // Counted running in this helper from its click until it finishes, however long that takes.
    const key = `${run.id}:${step.n}`;
    inHelper.add(key);
    let done;
    try {
      done = await runApply({ step, runId: run.id, changes: fresh.changes, ctx: { ...ctx, stopped }, current });
    } finally {
      inHelper.delete(key);
    }
    return done.ok ? { ok: true, started: true, done: true } : { ok: false, refused: `${title(step.n)} did not finish: ${done.reason}` };
  }

  // The long step's own process, detached and hidden, started in Wheelhouse's folder, so it runs
  // on when the helper or Desktop goes. It works the list out again, with this helper's user home,
  // and checks it has this hash; it acts for this click only, and stops at the deadline by the wall
  // clock, which is when this helper stops counting it as running.
  function startChild({ step, run, hash, clickedAt, deadline }) {
    const failed = () => {
      try {
        mark(run.id, step.n, 'failed', { now, reason: 'its process could not be started', when: (e) => e?.clickedAt === clickedAt && !e.doneAt });
      } catch { /* status then says it is stuck once its time is up */ }
    };
    try {
      const child = spawn(process.execPath, [RUN_STEP, stepsModule, run.folder, String(step.n), hash, run.id, clickedAt, deadline, userHome], {
        cwd: wheelhouseHome(), detached: true, stdio: 'ignore', windowsHide: true, env: process.env,
      });
      child?.on?.('error', failed);
      child?.unref?.();
    } catch {
      failed();
    }
  }

  async function status(body) {
    const folder = admitFolder(body.folder, { userHome });
    const run = runFor(folder);
    const all = await steps();
    const running = (n) => runningIn(run, n);
    if (run === null) return { ok: true, lines: ['Setup has not started in this folder.'], next: firstUnfinished(null, all), ask: toAsk(null, all, running) };
    return { ok: true, ...statusLines(run, all, running) };
  }

  return { '/setup/plan': plan, '/setup/apply': apply, '/setup/status': status };
}
