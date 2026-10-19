// scripts/setup/engine.js
// What the helper's /setup/* routes do (scripts/host/helper.js). Setup's playbook only talks: every
// change is made here, and only after the director's signed click on a card listing exactly what
// will change, named by the hash of that list (design section 15, the plan's call 2).
//
//   /setup/plan   { folder, step }        -> { ok, changes, hash, card, director }, or
//                                            { ok, ask: { step, id, card } } (a question to ask), or
//                                            { ok, wait, why } (nothing to ask yet), or
//                                            { ok, done: true } (the step settled on its answers)
//   /setup/apply  { folder, step, hash }  -> { ok, started: true } (a short step: done: true too)
//   /setup/status { folder }              -> { ok, lines, next, ask }; a running step's latest
//                                            line for the director (ctx.say, ruling R40) among them
//   /setup/health { folder, lines? }      -> { ok, green, lines, board, trials }, and once green
//                                            { started, briefing } too: step 10's checks joined
//                                            with the session's trial lines (scripts/setup/health.js)
//
// A step may name steps it waits for (`after`, rulings R47 and R54): while they are unfinished, its
// plan still asks its questions, but gives `{ wait, why }` in place of its Go-ahead card, and its
// apply is refused, so step 3's questions are asked while step 2's installers run, and its Go
// ahead is shown once they have finished.
//
// A step's plan gives one of four results (rulings R30 to R32). `{ changes, card, director }`: its
// list, shown on a Go-ahead card. `{ ask: { id, card, typed?, rules?, writes? } }`: a question it
// needs answered first, composed as a `question` card (no set line, no reply code), or, for a card
// of kind `confirm-all`, as setup's card of the rules found, whose line names the hash of `rules`
// (ruling R35), and recorded as asked in setup/asked/ with its `rules`, `writes` (what an answer
// records in the project's state, which the prompt record signs: scripts/lib/setup-writes.js) and
// `found` (what the step found, kept for the rest of its run: ruling R62), none holding a sign-in
// in an address, which the card would show hidden; the
// prompt record keeps the director's answer on that exact card, signed, and every step's plan reads
// every answer of its run in ctx.answers, so the list a Go ahead's hash names already holds the
// choices, and a later answer that changes it makes that Go ahead CHANGED.
// `{ wait: ms, why }`: nothing to ask yet. `{ settled: { record } }`: every answer is in and the
// step changes nothing outside setup's own records, so the record is kept in the journal as an
// `answer` change and the step is done, with no Go ahead.
//
// Every card is cleaned of any sign-in in an address (scripts/lib/clean.js) before it is stored,
// and the cleaned card is the one sent, so the card the director clicks is the card stored (R33).
// The list is hashed as the step gave it.
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
// Every route checks its folder (rulings R16, R34): a full path, placed by its real path, under the
// user's own ~/Projects, in a registered project's folder, the folder of a setup run, or a folder
// whose own Claude settings switch the Wheelhouse plugin on. The product's folder exists from
// step 1, with the plugin installed there, so no step makes it. The user's home folder, and any
// folder holding it, is never one: its .claude/settings.json is Claude Code's user-scope settings,
// where the plugin switched on is on everywhere, and a run there would hold every folder under home.
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
import { hide, cleanDeep } from '../lib/clean.js';
import { pluginOnIn } from '../lib/plugin-on.js';
import { SETUP_QUESTION_ID } from '../lib/setup-clicks.js';
import { readJournal, startRun, markStep, addChanges, newId, applyJsonKey as journalKey, SAY_CHARS } from './journal.js';
import { planHash, firstUnfinished } from './steps.js';
import { noteShown, noteAsked, shownFor, freshClicks, useClick, releaseClick, answersFor } from './clicks.js';
import { healthCheck, finishSetup, removeTrialLeftover } from './health.js';
import { parseTrialLine, MOST_TRIAL_LINES } from '../lib/trial-lines.js';

export const STEPS_MODULE = fileURLToPath(new URL('./steps.js', import.meta.url));
export const RUN_STEP = fileURLToPath(new URL('./run-step.js', import.meta.url));

export const OUTSIDE = 'the folder is not under ~/Projects, in a registered project or being set up, so setup does not act on it';
export const NEEDS_CLICK = `this step needs the director's click on its card, from the last ${CLICK_FRESH_MS / 60000} minutes`;
export const CHANGED = 'the list has changed since the card: ask for the plan again and show the new card';
export const HOME_FOLDER = 'the folder is your home folder, or holds it, so setup does not act on it';
export const OWN_LIST = 'the helper works out the list itself: a request names only the folder, the step and the hash on the card';
const APPLY_FIELDS = ['folder', 'step', 'hash'];
const HEALTH_FIELDS = ['folder', 'lines'];
// How long the playbook waits before asking again for a step whose Go ahead waits on another (R54).
export const AFTER_WAIT_MS = 30 * 1000;
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

function realOrNull(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

// Whether a folder is the user's home folder or holds it, by real paths where they can be had.
function atOrAboveHome(folder, userHome) {
  const home = realOrNull(userHome) ?? path.resolve(userHome);
  const real = realOrNull(folder) ?? path.resolve(folder);
  return keyOf(real) === keyOf(home) || within(real, home);
}

// The run setup is doing for this real path: the latest run of the nearest folder that is it or
// holds it (case and accents folded as the system does), as kit.js's beingSetUp places a session,
// so a session in a folder inside the one being set up carries on that run; null when none does.
// A run in a folder above a registered project's folder that holds the path is another product's
// setup, never this one's (ruling R27), so it is passed over, as is a run at the user's home or
// above it, which no route starts. (A run in a folder inside a registered project is carried on
// here, though kit.js's beingSetUp counts only a run in the project's own folder; the playbook runs
// in the project's own folder, so no such run is started.)
function runFor(real, userHome) {
  const project = projectForFolder(real);
  const own = project === null ? null : realOrNull(project.record.folder);
  const holding = readJournal().runs.filter((r) => typeof r?.folder === 'string' && (keyOf(r.folder) === keyOf(real) || within(r.folder, real))
    && !(own !== null && within(r.folder, own)) && !atOrAboveHome(r.folder, userHome));
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
  if (atOrAboveHome(real, userHome)) refuse(HOME_FOLDER);
  let projects = null;
  try {
    projects = fs.realpathSync.native(path.join(userHome, 'Projects'));
  } catch { /* no ~/Projects on this computer */ }
  if (projects !== null && within(projects, real)) return real;
  if (projectForFolder(real) !== null) return real;
  if (runFor(real, userHome) !== null) return real;
  if (pluginOnIn(real)) return real;
  return refuse(OUTSIDE);
}

// The steps a step must wait for before it is applied (ruling R47): its `after`, a list of other
// steps' numbers, or none. Throws for anything else.
export function stepsBefore(step) {
  const after = step?.after;
  if (after === undefined) return [];
  if (!Array.isArray(after) || !after.every((m) => Number.isInteger(m) && Object.hasOwn(SETUP_TITLES, m) && m !== step.n)) {
    throw new Error(`Step ${step?.n}'s steps to wait for must be a list of other steps' numbers`);
  }
  return after;
}

// The steps a module gives, checked: each with its number, title, plan and apply, and any steps it waits for.
export async function loadSteps(modulePath) {
  const steps = (await import(pathToFileURL(modulePath).href)).STEPS;
  const good = Array.isArray(steps) && steps.every((s) => Number.isInteger(s?.n) && Object.hasOwn(SETUP_TITLES, s.n)
    && typeof s.title === 'string' && typeof s.plan === 'function' && typeof s.apply === 'function');
  if (!good) throw new Error('The setup steps could not be read');
  steps.forEach(stepsBefore);
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
// entry is never marked by an older one. The ctx carries `say(line)` too, a line for the director
// while the step runs (ruling R40), kept on the step's entry and shown by status. Each change made is recorded whatever, since it was made.
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
  // A line for the director while the step runs, such as a sign-in code (ruling R40): kept on the
  // step's journal entry for this attempt only, and shown, cleaned, by /setup/status.
  // A line on several lines is put on one, and a long one cut to what the journal keeps, so what a
  // step says never stops it.
  const say = (line) => {
    const one = String(line ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim().slice(0, SAY_CHARS);
    if (one !== '') markStep(runId, step.n, 'say', { now: ctx.now, line: one, when: current });
  };
  try {
    record(await step.apply({ ...ctx, runId, record, applyJsonKey, say }, changes));
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
      // What the running step asks of the director now, such as a sign-in code (ruling R40).
      if (running(n) && typeof entry.say?.line === 'string') lines.push(`  ${hide(entry.say.line, [])}`);
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
// the journal (journal.js's markStep; a test can make it fail). `health` joins step 10's checks with
// the session's trial lines, and `finish` is the last thing setup does once the board is green
// (scripts/setup/health.js's healthCheck and finishSetup; tests give their own).
export function setupRoutes({
  now = () => new Date(), stopped = () => false, stopRefusal = { ok: false, refused: 'STOP is on' },
  stepsModule = STEPS_MODULE, userHome = os.homedir(), platform = process.platform, spawn = nodeSpawn, mark = markStep,
  health = healthCheck, finish = (args) => finishSetup({ ...args, now }),
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

  // Why a step waiting for step m may not go ahead yet (rulings R47, R54): while step m runs, the
  // installers it started, by name (step 2), or that it is running; once it has failed, that it did
  // not finish; otherwise that it is not done.
  function waitingOn(run, m) {
    const entry = run?.steps?.[m];
    if (runningIn(run, m)) {
      const tools = [...new Set((run.changes ?? []).filter((c) => c?.step === m && c.kind === 'process' && typeof c.after?.tool === 'string').map((c) => c.after.tool))];
      return tools.length > 0
        ? `step ${m} is still installing: ${tools.join(', ')}; this step goes ahead once it is done`
        : `step ${m} (${SETUP_TITLES[m]}) is still running; this step goes ahead once it is done`;
    }
    if (entry?.failed) return `step ${m} (${SETUP_TITLES[m]}) did not finish; this step goes ahead once it has been run again`;
    return `step ${m} (${SETUP_TITLES[m]}) is not done yet; this step goes ahead once it is`;
  }
  // The first step this one waits for that is not done, or null.
  const unfinishedBefore = (run, step) => stepsBefore(step).find((m) => !isDone(run, m)) ?? null;

  // A step's ctx: with every answer the director has given to its run's questions (ruling R31).
  const ctxFor = (folder, n, runId) => ({ folder, step: n, runId, now, userHome, platform, answers: answersFor(runId) });

  // A step's plan, checked: its list with the list's hash, or a question, a wait or a settling.
  async function planned(step, ctx) {
    const got = await step.plan(ctx);
    const bad = (what) => new Error(`Step ${step.n}'s plan gave ${what}`);
    if (got?.ask !== undefined) {
      const { id, card, typed, rules, writes, found } = got.ask ?? {};
      if (typeof id !== 'string' || !SETUP_QUESTION_ID.test(id)) throw bad('a question without an id of up to 40 lowercase letters, digits and dashes');
      if (!card || typeof card !== 'object') throw bad('a question without its card');
      if (typed !== undefined && typeof typed !== 'boolean') throw bad('a question whose typed answer is neither allowed nor refused');
      if (writes !== undefined && (writes === null || typeof writes !== 'object' || Array.isArray(writes))) throw bad('a question whose writes are not a record of them');
      if (card.kind === 'confirm-all' && !(Array.isArray(rules) && rules.length > 0)) throw bad('a card of the rules found without its rules');
      if (found !== undefined && !Array.isArray(found)) throw bad('a question whose list found is not a list');
      // What a click on the card records is kept with it, so it must read as the card does: with no
      // sign-in in an address, which the card would show hidden (ruling R33).
      const kept = { rules, writes, found };
      if (JSON.stringify(cleanDeep(kept, [])) !== JSON.stringify(kept)) throw bad('a question whose rules or writes hold a sign-in in an address, which its card would hide');
      return { ask: { id, card, typed: typed === true, rules, writes, found } };
    }
    if (got?.wait !== undefined) {
      if (!Number.isFinite(got.wait) || got.wait < 0 || typeof got.why !== 'string' || got.why === '') throw bad('a wait without its time and why');
      return { wait: got.wait, why: got.why };
    }
    if (got?.settled !== undefined) {
      const given = got.settled?.record;
      if (given !== undefined && (given === null || typeof given !== 'object' || Array.isArray(given))) throw bad('a settling without its record');
      const record = given ?? {};
      return { settled: { record } };
    }
    if (!got || !Array.isArray(got.changes)) throw bad('no list of changes');
    return { ...got, hash: planHash(got.changes) };
  }

  // A step done or running is not planned again: its card's shown time and record stay as they are.
  const showable = (run, n) => {
    if (isDone(run, n)) refuse(`${title(n)} is already done`);
    if (runningIn(run, n)) refuse(`${title(n)} is already running`);
  };

  // Answers under STOP, as status does (ruling R19): it writes only setup's own records (the run
  // when the folder has none, the card's shownAt, the shown or asked card, and a settled step's
  // answer and done mark), never anything a step lists. A step may settle under STOP (ruling R52):
  // its done mark records answers the director already gave, and changes nothing a step lists.
  async function plan(body) {
    const folder = admitFolder(body.folder, { userHome });
    const step = await stepOf(body.step);
    let run = runFor(folder, userHome);
    showable(run, step.n);
    const got = await planned(step, ctxFor(run?.folder ?? folder, step.n, run?.id));
    if (got.wait !== undefined) return { ok: true, wait: got.wait, why: got.why };
    // Its questions are asked whatever, but no Go ahead is shown while a step it waits for is
    // unfinished (ruling R54): apply would refuse it, and the click would go stale.
    const before = got.changes ? unfinishedBefore(run, step) : null;
    if (before !== null) return { ok: true, wait: AFTER_WAIT_MS, why: waitingOn(run, before) };
    // The card as the director will see it: its input cleaned before it is composed, so the
    // composer judges the text that is sent (its length too), and the stored card is the one sent
    // (the helper cleans what it sends again, which changes nothing). The set line holds no address.
    let card = null;
    // A question is composed as a `question` card, with no set line; the card of the rules found as
    // a `confirm-all` card, whose line names how many rules it lists and the hash of that list,
    // worked out here (ruling R35).
    if (got.ask?.card.kind === 'confirm-all') {
      const { rules } = got.ask;
      card = composeCard({ ...cleanDeep(got.ask.card, []), kind: 'confirm-all', target: { count: rules.length, hash: planHash(rules) } }).question;
    } else if (got.ask) card = composeCard({ ...cleanDeep(got.ask.card, []), kind: 'question' }).question;
    else if (got.changes) card = composeCard({ ...cleanDeep(got.card, []), kind: 'setup', target: { step: step.n, hash: got.hash } }).question;
    if (card !== null && JSON.stringify(cleanDeep(card, [])) !== JSON.stringify(card)) throw new Error(`Step ${step.n}'s card could not be cleaned as it is sent`);
    // Read again: the step may have been started while its plan was worked out.
    if (run) showable(runById(run.id), step.n);
    run ??= startRun({ folder, now });
    if (got.ask) {
      noteAsked({ runId: run.id, folder: run.folder, step: step.n, id: got.ask.id, card, typed: got.ask.typed, rules: got.ask.rules, writes: got.ask.writes, found: got.ask.found, now });
      return { ok: true, ask: { step: step.n, id: got.ask.id, card } };
    }
    if (got.settled) {
      // R19 widened (R32): a done mark the director's signed answers earned, with no Go ahead. The
      // step changes nothing outside setup's own records; what it settled on is kept as an
      // `answer` change, which uninstall has nothing to put back for.
      addChanges(run.id, [{ id: newId('chg'), step: step.n, kind: 'answer', target: `step ${step.n}`, before: null, after: got.settled.record }]);
      mark(run.id, step.n, 'doneAt', { now, when: (entry) => !entry.doneAt });
      return { ok: true, done: true };
    }
    noteShown({ runId: run.id, folder: run.folder, step: step.n, hash: got.hash, card, now });
    mark(run.id, step.n, 'shownAt', { now });
    return { ok: true, changes: got.changes, hash: got.hash, card, director: hide(typeof got.director === 'string' ? got.director : '', []) };
  }

  async function apply(body) {
    if (stopped()) return stopRefusal;
    if (Object.keys(body).some((k) => !APPLY_FIELDS.includes(k))) refuse(OWN_LIST);
    const folder = admitFolder(body.folder, { userHome });
    const step = await stepOf(body.step);
    if (typeof body.hash !== 'string' || !FULL_HASH.test(body.hash)) refuse('the hash must be the full hash of the list on the card');
    const run = runFor(folder, userHome);
    if (run === null) refuse('this step\'s card has not been shown: ask for its plan first');
    const startable = (current) => {
      if (isDone(current, step.n)) refuse(`${title(step.n)} is already done`);
      if (runningIn(current, step.n)) refuse(`${title(step.n)} is already running`);
    };
    startable(run);
    // A step that waits for others (ruling R47) is not applied before they are done, and its click
    // is not used, so it still counts once they are; its plan and questions were asked meanwhile.
    const before = unfinishedBefore(run, step);
    if (before !== null) refuse(waitingOn(run, before));
    // The list as it is now, worked out by the helper: the request's hash must name it, and the
    // card this folder was shown for the step must have shown it.
    const ctx = ctxFor(run.folder, step.n, run.id);
    const fresh = await planned(step, ctx);
    // A step that now asks, waits or settles has no list for a Go ahead to name.
    if (!fresh.changes) refuse(CHANGED);
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
    const run = runFor(folder, userHome);
    const all = await steps();
    const running = (n) => runningIn(run, n);
    if (run === null) return { ok: true, lines: ['Setup has not started in this folder.'], next: firstUnfinished(null, all), ask: toAsk(null, all, running) };
    return { ok: true, ...statusLines(run, all, running) };
  }

  // Step 10's board (rulings R41, R44): the helper's checks, recorded by step 10's apply, joined
  // with the trial lines the session ran in its sandbox and hands in, and the board's health lines.
  // It reads, so it answers under STOP, as status does; what it does besides, only when STOP is
  // off: it removes a .env.local the session's trial left behind (holding only the trial's
  // marker), and once the board is green it does the last thing setup does, starting the foreman
  // and giving the first briefing (`finish`).
  async function healthRoute(body) {
    if (Object.keys(body).some((k) => !HEALTH_FIELDS.includes(k))) refuse('the health check takes the folder and the trial lines the session printed, nothing else');
    const folder = admitFolder(body.folder, { userHome });
    const lines = body.lines ?? [];
    if (!Array.isArray(lines) || lines.length > MOST_TRIAL_LINES || !lines.every((l) => parseTrialLine(l) !== null)) {
      refuse(`the lines must be the trial lines trials.js printed, as they are, at most ${MOST_TRIAL_LINES}`);
    }
    const run = runFor(folder, userHome);
    if (run === null) refuse('setup has not started in this folder');
    if (!stopped()) removeTrialLeftover(run.folder);
    const got = await health({ folder: run.folder, run, reported: lines, now });
    const answer = { ok: true, green: got.green, lines: got.lines, board: got.board, trials: got.trials };
    if (!got.green || stopped() || got.project === null) return answer;
    return { ...answer, ...(await finish({ project: got.project })) };
  }

  return { '/setup/plan': plan, '/setup/apply': apply, '/setup/status': status, '/setup/health': healthRoute };
}
