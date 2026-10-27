// scripts/setup/engine.js
// What the helper's /setup/* routes do (scripts/host/helper.js). Setup's playbook only talks: every
// change is made here, and only after the director's signed click on a card listing exactly what
// will change, named by the hash of that list (design section 15, the plan's call 2).
//
//   /setup/plan   { folder, step }        -> { ok, changes, hash, card, director }, or
//                                            { ok, ask: { step, id, card } } (a question to ask),
//                                            with `unanswered`, a line for the director saying
//                                            why, when it is asked again because what was typed
//                                            on it was not taken (rulings R125, R132), or
//                                            { ok, wait, why } (nothing to ask yet), with
//                                            `waitsFor`, the step it waits for, when it is that, or
//                                            { ok, done: true } (the step settled on its answers),
//                                            with `said`, a line it said as it settled (R101)
//   /setup/apply  { folder, step, hash }  -> { ok, started: true } (a short step: done: true too)
//   /setup/status { folder }              -> { ok, lines, next, ask, running? }; a running step's latest
//                                            line for the director (ctx.say, ruling R40) among them
//   /setup/health { folder, lines? }      -> { ok, green, lines, board, trials }, and once green
//                                            { started, briefing } too: step 10's checks joined
//                                            with the session's trial lines (scripts/setup/health.js);
//                                            green only once every other step is done too
//
// A step may name steps it waits for (`after`, rulings R47, R54 and R70): while they are
// unfinished, its plan gives `{ wait, why, waitsFor }` in place of its question, its settling and
// its Go-ahead card, and its apply is refused. `waitsFor` names the step it waits for, so the
// playbook never takes the wait for one of the step's own (step 9's "push once it is over"). The
// steps it names in `asksDuring`, among its `after`, are the exception for its questions alone,
// which are asked while those are unfinished: step 3's while step 2's installers run, and its Go
// ahead is shown once they have finished.
//
// A run has its own list of steps (scripts/lib/setup-run.js, stepsFor; ruling R74): every step, or
// for a computer joining a project set up on another, steps 1, 2, 3, 6, 7, 8 and 9. A step not on
// the run's list is neither planned nor applied, status names only the run's steps, a step waiting
// for one the run doesn't have goes ahead, and a run without the health check is finished once its
// own steps are done, with no green mark and no ending (/setup/health refuses it).
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
// choices, and a later answer that changes it makes that Go ahead CHANGED. On a card that takes a
// typed answer, the choice handed back ("you decide", "not sure" and the like) is never an answer,
// and a question (it ends with "?") is not the first time on that question; typed again, any answer
// to it counts (rulings R125, R132, clicks.js answersFor). The step sees it unanswered and asks the
// card again, and the plan says why (`unanswered`, NOT_AN_ANSWER), once, a line the playbook shows
// the director as it is.
// `{ wait: ms, why }`: nothing to ask yet. `{ settled: { record } }`: every answer is in and the
// step changes nothing outside setup's own records, so the record is kept in the journal as an
// `answer` change and the step is done, with no Go ahead. A line the plan said as it settled
// (ctx.say) is kept on that change as `said`, which status shows (ruling R101). A settling that
// finishes the run, as a joining computer's last step does, copies the run's records into the
// project's state (ruling R45), since no apply or health check comes after it.
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
import { caEnv } from '../host/company-ca.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { jobFolder, wheelhouseHome, stateDir } from '../lib/paths.js';
import { projectForFolder } from '../lib/projects.js';
import { LEAN_FOLDER } from '../lean/project.js';
import { CLICK_FRESH_MS, STEP_TIMEOUT_MS } from '../lib/setup-numbers.js';
import { SETUP_TITLES } from '../state/card-lines.js';
import { composeCard } from '../cards/compose.js';
import { hide, cleanDeep } from '../lib/clean.js';
import { pluginOnIn } from '../lib/plugin-on.js';
import { SETUP_QUESTION_ID, keptAnswers } from '../lib/setup-clicks.js';
import { readJournal, startRun, markStep, addChanges, newId, applyJsonKey as journalKey, SAY_CHARS } from './journal.js';
import { planHash, firstUnfinished, stepProgress } from './steps.js';
import {
  noteShown, noteAsked, shownFor, freshClicks, useClick, releaseClick, answersFor, copySetupRecords, typedRefused,
} from './clicks.js';
import { healthCheck, finishSetup, removeTrialLeftover, closeOpenTrial } from './health.js';
import {
  stepDone, healthGreen, stepsFor, onRunList, joinedRepo, runClosed, phoneRetakeable, askingOrder, HEALTH_STEP, PUSH_TEST_STEP,
} from '../lib/setup-run.js';
import { parseTrialLine, MOST_TRIAL_LINES } from '../lib/trial-lines.js';
import {
  ONE_CARD_STEP, CHOICE_STEPS, openChoices, oneCard, setupTime, answersWithConsent, customisingSince, customiseBatch, consentIn, consentHolds,
} from './choices.js';
import { redoCard, choiceList, changeRequests, setUpAgainAsked, stepFourDrift } from './redo.js';
import { productOf } from './host.js';
import { readGitlabHosts } from '../host/gitlab-base.js';
import { readmeDescription, productName } from './questions.js';
import { READY_ID } from './notify.js';

export const STEPS_MODULE = fileURLToPath(new URL('./steps.js', import.meta.url));
export const RUN_STEP = fileURLToPath(new URL('./run-step.js', import.meta.url));

export const OUTSIDE = 'the folder is not under ~/Projects, in a registered project or being set up, so setup does not act on it';
export const NEEDS_CLICK = `this step needs the director's click on its card, from the last ${CLICK_FRESH_MS / 60000} minutes`;
export const CHANGED = 'the list has changed since the card: ask for the plan again and show the new card';
export const HOME_FOLDER = 'the folder is your home folder, or holds it, so setup does not act on it';
export const OWN_LIST = 'the helper works out the list itself: a request names only the folder, the step and the hash on the card';
// What status says once setup is finished and the phone, optional, is still to be offered.
export const PHONE_NEXT = 'Setup is finished. Phone notifications come next, and are optional.';
// What the one card's Go ahead never stands for: the director's own decisions, each asked on its card.
export const NOT_COVERED = Object.freeze(['switch', 'own-app-again']);
// Said to the director with a card asked again because what they typed on it was not taken, by why
// (rulings R125, R132); after a question, that whatever they type there next is taken (R135).
export const NOT_AN_ANSWER = Object.freeze({
  question: 'What you typed ends with a question mark, so it was taken as a question, not as your answer. Whatever you type on this card next is taken as your answer, so ask any question in the chat.',
  handedBack: 'What you typed hands the choice back, so it was not taken as your answer: this choice is yours to make.',
});
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
// in the project's own folder, so no such run is started.) A run uninstall has closed (ruling R89) is
// over and never carried on: setting the folder up again starts a new run.
function runFor(real, userHome) {
  const project = projectForFolder(real);
  const own = project === null ? null : realOrNull(project.record.folder);
  const holding = readJournal().runs.filter((r) => typeof r?.folder === 'string' && !runClosed(r) && (keyOf(r.folder) === keyOf(real) || within(r.folder, real))
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
  // A folder in a Lean project has no host's record for setup or uninstall to read (ruling P5-47).
  if (projectForFolder(real)?.lean === true) refuse(LEAN_FOLDER);
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

// The steps a step must wait for before it is asked, settled or applied (rulings R47, R70): its
// `after`, a list of other steps' numbers, or none. Throws for anything else.
export function stepsBefore(step) {
  const after = step?.after;
  if (after === undefined) return [];
  if (!Array.isArray(after) || !after.every((m) => Number.isInteger(m) && Object.hasOwn(SETUP_TITLES, m) && m !== step.n)) {
    throw new Error(`Step ${step?.n}'s steps to wait for must be a list of other steps' numbers`);
  }
  return after;
}

// The steps among those a step waits for while which its questions are still asked (ruling R54):
// its `asksDuring`, or none. Throws for anything but steps it waits for.
export function asksDuring(step) {
  const during = step?.asksDuring;
  if (during === undefined) return [];
  const before = stepsBefore(step);
  if (!Array.isArray(during) || !during.every((m) => Number.isInteger(m) && before.includes(m))) {
    throw new Error(`Step ${step?.n}'s steps to ask during must be among the steps it waits for`);
  }
  return during;
}

// The steps a module gives, checked: each with its number, title, plan and apply, and any steps it waits for.
export async function loadSteps(modulePath) {
  const steps = (await import(pathToFileURL(modulePath).href)).STEPS;
  const good = Array.isArray(steps) && steps.every((s) => Number.isInteger(s?.n) && Object.hasOwn(SETUP_TITLES, s.n)
    && typeof s.title === 'string' && typeof s.plan === 'function' && typeof s.apply === 'function');
  if (!good) throw new Error('The setup steps could not be read');
  steps.forEach(asksDuring);
  return steps;
}

const title = (n) => `step ${n}, ${SETUP_TITLES[n]}`;
// Done: finished, and for the health check, its board green as well (ruling R67), so a red board
// leaves step 10 to be run again by a fresh card. A step the run doesn't have reads as done
// (ruling R74), so a step waiting for it (`after`) counts only the steps on the run's list.
const isDone = (run, n) => stepDone(run, n);

// Why a step the run doesn't have is neither planned nor applied (ruling R74), naming what kind of
// run it is: a computer joining a project set up on another has only some of the steps.
export function notOnList(run, n) {
  const steps = stepsFor(run).map((s) => s.n).join(', ');
  const kind = joinedRepo(run) !== null ? 'a computer joining a project set up on another runs' : 'this run has';
  return `${title(n)} is not one of this run's steps: ${kind} only steps ${steps}`;
}

// A line for the director, as a step says it (ctx.say, ruling R40): on one line, and cut to what
// the journal keeps, so what a step says never stops it; null when it says nothing.
function oneLine(line) {
  const one = String(line ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim().slice(0, SAY_CHARS);
  return one === '' ? null : one;
}

// The steps given that the run has, in their order (ruling R74).
const runSteps = (run, steps) => steps.filter((s) => onRunList(run, s.n));

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
// Once the step is done, the run's clicks and answers are copied into the project's state, when the
// folder is a project whose state is cloned (`copy`, copyRunRecords; ruling R45); a copy that fails
// never fails the step, and the next step's copies what is left.
// Used by the helper for a short step and by scripts/setup/run-step.js for a long one.
export async function runApply({ step, runId, changes, ctx, current, copy = copyRunRecords }) {
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
    const one = oneLine(line);
    if (one !== null) markStep(runId, step.n, 'say', { now: ctx.now, line: one, when: current });
  };
  let again = false;
  try {
    const made = await step.apply({ ...ctx, runId, record, applyJsonKey, say }, changes);
    // `{ again: true, changes }`: a first part of the step's work is done, and the step is planned
    // again from the start, its own list worked out afresh (step 7's switch of the folder).
    again = made?.again === true;
    record(again ? made.changes : made);
    markStep(runId, step.n, again ? 'reset' : 'doneAt', { now: ctx.now, when: current });
  } catch (error) {
    const reason = (error instanceof Error ? error.message : '') || 'the step did not finish';
    try {
      markStep(runId, step.n, 'failed', { now: ctx.now, reason, when: current });
    } catch { /* the journal could not take it; the step reads as running until its time is up */ }
    return { ok: false, reason };
  }
  try {
    await copy(runId, ctx.folder);
  } catch { /* copied by a later step */ }
  return again ? { ok: true, again: true } : { ok: true };
}

// Copies a run's clicks and answers into the state of the project whose folder it is set up in,
// once that project's state is cloned (step 3 on); before then, nothing (ruling R45).
export async function copyRunRecords(runId, folder) {
  const found = projectForFolder(folder);
  if (found === null || !fs.existsSync(path.join(stateDir(found.project), '.git'))) return null;
  return copySetupRecords(runId, found.project);
}

// The first step neither done nor running (`running(n)`), or null.
// The verdict and the first briefing a green board left for the director (`after.briefing` of its
// change), or null. Left to the session to show from the health check's answer, or as a `said`,
// they went unshown in every rehearsal run of 27 October 2026, on Sonnet and on Opus: the phone
// card or the front desk came straight after. A card is what a session passes on word for word, so
// the phone's first card opens with them until it is answered (opensWithBriefing); with no phone
// card left, step 10's plan gives them once as its `said` (pendingBriefing).
const BRIEFING_TARGET = 'step 10 briefing';
const briefingKept = (run) => (run?.changes ?? []).filter((c) => c?.step === HEALTH_STEP && c.kind === 'answer' && c.target === BRIEFING_TARGET);
function briefingOf(run) {
  const text = briefingKept(run).find((c) => typeof c.after?.briefing === 'string' && c.after.briefing !== '')?.after.briefing;
  return text ?? null;
}
const greenAt = (run) => (run?.changes ?? []).find((c) => c?.step === HEALTH_STEP && c.kind === 'answer' && typeof c.after?.green === 'string')?.after.green;
const isReadyCard = (id) => id === READY_ID || id.startsWith(`${READY_ID}-`);
// Whether the director answered the phone's first card since the board went green: the card that
// opened with the briefing, so they have seen it.
const readyAnsweredSinceGreen = (run, answers) => Object.entries(answers)
  .some(([key, a]) => key.startsWith(`${PUSH_TEST_STEP}.`) && isReadyCard(key.slice(key.indexOf('.') + 1)) && Date.parse(a.at) >= Date.parse(greenAt(run)));
// Not yet seen on a phone card, nor given once as step 10's `said`: the text, else null.
function pendingBriefing(run, answers) {
  return briefingKept(run).some((c) => c.after?.said === true) || readyAnsweredSinceGreen(run, answers) ? null : briefingOf(run);
}
// The briefing a phone card opens with: the phone's first card ('phone-ready'), on a green board,
// while the director hasn't answered it since the board went green; else null.
function opensWithBriefing(run, step, id, answers) {
  if (step !== PUSH_TEST_STEP || !isReadyCard(id) || !healthGreen(run) || readyAnsweredSinceGreen(run, answers)) return null;
  return briefingOf(run);
}

function toAsk(run, steps, running) {
  return askingOrder(steps.map((s) => s.n)).find((n) => !isDone(run, n) && !running(n)) ?? null;
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
    if (entry.doneAt && !stepDone(run, n)) lines.push(`${name}: its own checks finished at ${entry.doneAt}; the Logbook isn't green yet`);
    else if (entry.doneAt) {
      lines.push(`${name}: done at ${entry.doneAt}`);
      // What a step said as it settled, such as step 6's settings that weaken Standard (ruling R101).
      const said = (run.changes ?? []).filter((c) => c?.step === n && c.kind === 'answer' && typeof c.said === 'string').at(-1)?.said;
      if (said !== undefined) lines.push(`  ${hide(said, [])}`);
    }
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
  const ask = toAsk(run, steps, running);
  // The phone is offered once setup is finished, and is optional (design section 15.1).
  if (next === null) lines.push(ask === PUSH_TEST_STEP ? PHONE_NEXT : 'Every step is done.');
  else lines.push(`Next: ${title(next)}.`);
  return { lines, next, ask };
}

// The routes' handlers, each taking the request's body and giving its answer. A refusal throws
// SetupRefusal, which the helper sends as { ok: false, refused }. `mark` records a step's time in
// the journal (journal.js's markStep; a test can make it fail). `health` joins step 10's checks with
// the session's trial lines, and `finish` is the last thing setup does once the board is green
// (scripts/setup/health.js's healthCheck and finishSetup; tests give their own); `closeTrial`
// closes the trial pull request step 10 left open (closeOpenTrial); `copy` copies a run's clicks
// and answers into its project's state (copyRunRecords, ruling R45); `writeSurvey(project, data)`
// the helper's own writer of the survey finishSetup takes (scripts/survey/take.js).
export function setupRoutes({
  now = () => new Date(), stopped = () => false, stopRefusal = { ok: false, refused: 'All stop is on' },
  stepsModule = STEPS_MODULE, userHome = os.homedir(), platform = process.platform, spawn = nodeSpawn, mark = markStep,
  writeSurvey, health = healthCheck, finish = (args) => finishSetup({ ...args, now }),
  closeTrial = (args) => closeOpenTrial(args), copy = copyRunRecords,
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

  // The lines that head step n in the chat, from the run as it stands now.
  const progressOf = (run, n, folder) => stepProgress({
    n, run: run ? runById(run.id) ?? run : null, running: (m) => (run ? runningIn(run, m) !== null : false), host: projectForFolder(folder)?.record.host,
  });

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
  // The first step this one waits for that is not done, or null; those in `during` pass over.
  const unfinishedBefore = (run, step, during = []) => stepsBefore(step).find((m) => !during.includes(m) && !isDone(run, m)) ?? null;

  // A step's ctx: with every answer the director has given to its run's questions (ruling R31),
  // and when the run started (step 1 reads the session's first message from then, ruling R76).
  // With a one card's Go ahead that still holds, its choices count as answered (design section 15.1).
  const ctxFor = (folder, n, runId, startedAt) => ({ folder, step: n, runId, startedAt, now, userHome, platform, answers: answersWithConsent(runId).answers });

  // ---- The one card, Customise and changing an answer (design section 15.1) ----

  // Whether the one card's Go ahead holds for this run and covers a step's list: every list but a
  // switch of the folder off a line of the director's unfinished work (A10) and a proposal of their
  // own GitHub App again, which are the director's own to decide, each on its card.
  // The folder's facts the one card rests on before step 3 has run: whether the product is new, and
  // its host and repository as the folder's own git address names them. Read again, they must be the
  // ones the card was shown with, so a remote added to the folder after the Go ahead (by anyone,
  // an agent included) can't redirect step 3 under it: the one card is asked again showing it.
  const folderFacts = (folder) => {
    try {
      const p = productOf(folder, { config: readGitlabHosts(folder) });
      return { isNew: p.isNew, host: p.host, repo: p.repo, base: p.base ?? null };
    } catch (error) {
      return { refused: error instanceof Error ? error.message : 'unread' };
    }
  };
  // The one card's Go ahead while it holds: its choices unchanged and, while step 3 hasn't run, the
  // folder's facts as the card showed them; else null.
  const consentNow = (run) => {
    if (run === null) return null;
    const { consent } = answersWithConsent(run.id);
    if (consent === null) return null;
    if (stepDone(run, 3) || runningIn(run, 3) !== null) return consent;
    return JSON.stringify(consent.facts ?? null) === JSON.stringify(folderFacts(run.folder)) ? consent : null;
  };
  const coveredByConsent = (run, changes) => consentNow(run) !== null && !changes.some((c) => NOT_COVERED.includes(c?.action));

  // A step's plan with a look at the choices only: its questions, taken as answered by `answers`.
  const choicePlan = (run, folder) => (step, answers) => step.plan({
    ...ctxFor(run?.folder ?? folder, step.n, run?.id, run?.startedAt ?? now().toISOString()), answers, choicesOnly: true, say: () => {},
  });

  // The choices still open in the run, read from the answers as the steps read them.
  async function openNow(run, folder) {
    return openChoices({ steps: await steps(), run, answers: run ? answersWithConsent(run.id).answers : {}, planOf: choicePlan(run, folder) });
  }

  // Whether setup is finished: the run's first unfinished step is none (the phone never counts).
  const finished = (run) => run !== null && firstUnfinished(run) === null;

  // Whether the one card is what comes next: setup isn't finished and no Go ahead on it holds.
  const oneCardNext = (run) => !finished(run) && consentNow(run) === null;

  // A question card for a choice or a redo card, composed and recorded as asked under its step, with
  // `unanswered` when what was typed on it was not taken (rulings R125, R132), as a step's ask has.
  function askChoice(run, { step, id, card: input, typed, writes, found }) {
    const card = composeCard({ ...cleanDeep(input, []), kind: 'question', suggest: false }).question;
    if (JSON.stringify(cleanDeep(card, [])) !== JSON.stringify(card)) throw new Error(`Step ${step}'s card could not be cleaned as it is sent`);
    const refused = typedRefused(run.id, step, id);
    noteAsked({ runId: run.id, folder: run.folder, step, id, card, typed: typed === true, writes, found, now });
    return { step, id, card, ...(refused === null ? {} : { unanswered: NOT_AN_ANSWER[refused] }) };
  }

  // /setup/plan with step 0: the one card, or, after Customise, the next of its cards (up to four
  // questions at once, which the playbook asks together); { done: true } when the one card's Go
  // ahead holds or setup is finished.
  async function planOneCard(body) {
    const folder = admitFolder(body.folder, { userHome });
    let run = runFor(folder, userHome);
    if (!oneCardNext(run)) return { ok: true, done: true };
    const own = run ? answersFor(run.id) : {};
    const list = await openNow(run, folder);
    run ??= startRun({ folder, now });
    const since = customisingSince(own);
    const consent = consentIn(run.id, own);
    if (since !== null && !(consent !== null && Date.parse(consent.at) > Date.parse(since))) {
      const batch = customiseBatch(list, since);
      if (batch.length > 0) return { ok: true, asks: batch.map((c) => askChoice(run, c)), progress: ['Setup · your choices', 'Change any of these; nothing runs until you say Go ahead.'] };
    }
    const facts = folderFacts(run.folder);
    const product = facts.refused === undefined ? { ...facts, name: facts.repo?.split('/').at(-1) ?? productName(run.folder) } : null;
    const toRun = [3, 6, 7, HEALTH_STEP].filter((n) => onRunList(run, n) && !stepDone(run, n));
    const { id, card, choices, writes } = oneCard({ folder: run.folder, list, product, platform, toRun, count: keptAnswers(run.id).length, facts });
    if (JSON.stringify(cleanDeep(card, [])) !== JSON.stringify(card)) throw new Error('The one card could not be cleaned as it is sent');
    noteAsked({ runId: run.id, folder: run.folder, step: ONE_CARD_STEP, id, card, writes, choices, facts, now });
    return { ok: true, ask: { step: ONE_CARD_STEP, id, card }, progress: [`Setup · ${setupTime(toRun, list)}`, 'One card: the plan for this project.'] };
  }

  // Whether step n of a run has run or is running.
  const ranOrRunning = (run, n) => run !== null && (stepDone(run, n) || runningIn(run, n) !== null);

  // /setup/choices: every choice of the run, for the director to name one to change.
  async function choicesRoute(body) {
    const folder = admitFolder(body.folder, { userHome });
    const run = runFor(folder, userHome);
    const open = await openNow(run, folder);
    return { ok: true, choices: choiceList({ open, answers: run ? answersWithConsent(run.id).answers : {}, doneOrRunning: (n) => ranOrRunning(run, n) }) };
  }

  // /setup/change { folder, key }: the card that changes one choice: its own card while its step
  // hasn't used it, else a redo card offering what changing it takes (scripts/setup/redo.js).
  async function changeRoute(body) {
    if (Object.keys(body).some((k) => !['folder', 'key'].includes(k))) refuse('a change names the folder and the choice\'s key, nothing else');
    const folder = admitFolder(body.folder, { userHome });
    const run = runFor(folder, userHome);
    if (run === null) refuse('setup has not started in this folder: ask for the one card first');
    if (finished(run)) refuse('setup is finished: the First Mate changes settings from here');
    const key = String(body.key ?? '');
    const own = answersWithConsent(run.id).answers;
    const open = (await openNow(run, folder)).find((c) => c.key === key);
    // An answered description is changed by a redo card, which records its words afresh.
    if (open && !(key.startsWith('4.product-') && own[key])) return { ok: true, asks: [askChoice(run, open)] };
    if (!Object.hasOwn(own, key)) refuse(`there is no choice ${key} in this run: run choices to see them`);
    const record = projectForFolder(run.folder)?.record ?? null;
    const redo = redoCard({
      key, answers: answersWithConsent(run.id).answers, name: record?.repo?.split('/').at(-1) ?? productName(run.folder), record,
      described: readmeDescription(run.folder), count: keptAnswers(run.id).length, stepRan: (n) => ranOrRunning(run, n),
    });
    if (redo === null) {
      const step = Number(key.slice(0, key.indexOf('.')));
      const asked = (await openNow({ ...run, steps: { ...run.steps, [step]: {} } }, folder)).find((c) => c.key === key);
      if (!asked) refuse(`${key} can't be asked again now`);
      return { ok: true, asks: [askChoice(run, asked)] };
    }
    return { ok: true, asks: [askChoice(run, { step: ONE_CARD_STEP, ...redo })] };
  }

  // Step 4 settled on live data or Apple signing that the answers now say differently, and step 7
  // hasn't used them yet: step 4 is to settle again (design section 15.1).
  function settleStepFourAgain(run) {
    if (run === null || !stepDone(run, 4) || ranOrRunning(run, 7)) return;
    const settled = (run.changes ?? []).filter((c) => c?.step === 4 && c.kind === 'answer').at(-1)?.after;
    if (stepFourDrift(settled, answersWithConsent(run.id).answers)) mark(run.id, 4, 'reset', { now });
  }

  // A step's plan, checked: its list with the list's hash, or a question, a wait or a settling. A
  // plan may say a line for the director (ctx.say), kept only with a settling, as `said` (R101).
  async function planned(step, ctx) {
    let said = null;
    const got = await step.plan({ ...ctx, say: (line) => { said = oneLine(line) ?? said; } });
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
      return { settled: { record, said } };
    }
    if (!got || !Array.isArray(got.changes)) throw bad('no list of changes');
    return { ...got, hash: planHash(got.changes) };
  }

  // A step done or running is not planned again: its card's shown time and record stay as they are.
  // Nor is a step the run doesn't have (ruling R74). Phone notifications skipped, or tested without
  // the push arriving, are the exception: the front desk plans step 9 again when the director asks
  // to set them up (the director's ruling of 26 October 2026).
  const retake = (run, n) => n === PUSH_TEST_STEP && phoneRetakeable(run);
  const showable = (run, n) => {
    if (!onRunList(run, n)) refuse(notOnList(run, n));
    if (isDone(run, n) && !retake(run, n)) refuse(`${title(n)} is already done`);
    if (runningIn(run, n)) refuse(`${title(n)} is already running`);
  };

  // Answers under STOP, as status does (ruling R19): it writes only setup's own records (the run
  // when the folder has none, the card's shownAt, the shown or asked card, and a settled step's
  // answer and done mark), never anything a step lists. A step may settle under STOP (ruling R52):
  // its done mark records answers the director already gave, and changes nothing a step lists.
  async function plan(body) {
    if (body.step === ONE_CARD_STEP) return planOneCard(body);
    const folder = admitFolder(body.folder, { userHome });
    const step = await stepOf(body.step);
    let run = runFor(folder, userHome);
    // Step 10 done on a green board: its plan gives the verdict and the first briefing, once.
    const briefing = step.n === HEALTH_STEP && run !== null && healthGreen(run) ? pendingBriefing(run, answersFor(run.id)) : null;
    if (briefing !== null) {
      addChanges(run.id, [{ id: newId('chg'), step: HEALTH_STEP, kind: 'answer', target: BRIEFING_TARGET, before: null, after: { said: true } }]);
      return { ok: true, done: true, said: hide(briefing, []) };
    }
    showable(run, step.n);
    // A run started by this plan starts when the plan does, so the step reads the time its run has.
    const startedAt = run?.startedAt ?? now().toISOString();
    const got = await planned(step, ctxFor(run?.folder ?? folder, step.n, run?.id, startedAt));
    if (got.wait !== undefined) return { ok: true, wait: got.wait, why: got.why };
    // Nothing is asked, settled or shown for a Go ahead while a step it waits for is unfinished
    // (rulings R54, R70): apply would refuse the Go ahead, and the click would go stale; a settling
    // would mark it done out of its order; and a question may speak of what that step does (step
    // 9's card A of step 6's push option) or come while it needs the director (step 8's password
    // window). Its questions alone are asked during the steps it names in `asksDuring`.
    const before = unfinishedBefore(run, step, got.ask ? asksDuring(step) : []);
    if (before !== null) return { ok: true, wait: AFTER_WAIT_MS, why: waitingOn(run, before), waitsFor: before };
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
    } else if (got.ask) card = composeCard({ ...cleanDeep(got.ask.card, []), kind: 'question', suggest: false }).question;
    else if (got.changes) card = composeCard({ ...cleanDeep(got.card, []), kind: 'setup', target: { step: step.n, hash: got.hash } }).question;
    if (card !== null && JSON.stringify(cleanDeep(card, [])) !== JSON.stringify(card)) throw new Error(`Step ${step.n}'s card could not be cleaned as it is sent`);
    // Read again: the step may have been started while its plan was worked out.
    if (run) showable(runById(run.id), step.n);
    run ??= startRun({ folder, now: () => new Date(startedAt) });
    if (got.ask) {
      // The first card after a green board opens with the verdict and the first briefing, so the
      // director sees them as the card is asked, word for word, and the card recorded is the one sent.
      const briefing = opensWithBriefing(run, step.n, got.ask.id, answersFor(run.id));
      if (briefing !== null) card = cleanDeep({ ...card, question: [...briefing.split('\n').filter((l) => l.trim() !== ''), card.question].join('\n') }, []);
      // What was typed on this card since it was last asked was not taken: said why, before it is asked again.
      const refused = typedRefused(run.id, step.n, got.ask.id);
      noteAsked({ runId: run.id, folder: run.folder, step: step.n, id: got.ask.id, card, typed: got.ask.typed, rules: got.ask.rules, writes: got.ask.writes, found: got.ask.found, now });
      return { ok: true, ask: { step: step.n, id: got.ask.id, card }, progress: progressOf(run, step.n, folder), ...(refused === null ? {} : { unanswered: NOT_AN_ANSWER[refused] }) };
    }
    if (got.settled) {
      // R19 widened (R32): a done mark the director's signed answers earned, with no Go ahead. The
      // step changes nothing outside setup's own records; what it settled on is kept as an
      // `answer` change, which uninstall has nothing to put back for.
      // What the step said as it settled is kept with it, for status to show (ruling R101).
      const { record, said } = got.settled;
      // Step 9 taken again keeps its new result's time, which the board reads.
      const again = isDone(runById(run.id), step.n);
      addChanges(run.id, [{ id: newId('chg'), step: step.n, kind: 'answer', target: `step ${step.n}`, before: null, after: record, ...(said === null ? {} : { said }) }]);
      mark(run.id, step.n, 'doneAt', { now, when: (entry) => again || !entry.doneAt });
      // A settling that finishes the run (a joining computer's, which has no health check to end
      // it, ruling R74) copies the run's last clicks and answers into the project's state, as an
      // apply does after each step (ruling R45); a copy that fails never fails the step.
      if (firstUnfinished(runById(run.id)) === null) {
        try {
          await copy(run.id, run.folder);
        } catch { /* the records stay in setup's own folder */ }
      }
      return { ok: true, done: true, ...(said === null ? {} : { said: hide(said, []) }) };
    }
    noteShown({ runId: run.id, folder: run.folder, step: step.n, hash: got.hash, card, now });
    mark(run.id, step.n, 'shownAt', { now });
    // Covered by the one card's Go ahead (design section 15.1): the playbook applies it with no card.
    const covered = coveredByConsent(run, got.changes);
    return {
      ok: true, changes: got.changes, hash: got.hash, card, progress: progressOf(run, step.n, folder), director: hide(typeof got.director === 'string' ? got.director : '', []),
      ...(covered ? { covered: true } : {}),
    };
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
      if (!onRunList(current, step.n)) refuse(notOnList(current, step.n));
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
    const ctx = ctxFor(run.folder, step.n, run.id, run.startedAt);
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
    // A click on this step's card, or else the one card's Go ahead while it holds and covers the list
    // (design section 15.1), which is not used up: it stands for each step's Go ahead in turn.
    const click = freshClicks({ runId: run.id, step: step.n, hash: fresh.hash, now }).find((e) => useClick(e, now))
      ?? (coveredByConsent(run, fresh.changes) ? { consent: true, at: now().toISOString() } : null);
    if (!click) refuse(NEEDS_CLICK);
    const clickedAt = new Date(click.at).toISOString();
    try {
      mark(run.id, step.n, 'clickedAt', { now: () => new Date(clickedAt) });
    } catch (error) {
      if (!click.consent) releaseClick(click);
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
    if (!done.ok) return { ok: false, refused: `${title(step.n)} did not finish: ${done.reason}` };
    // What the step said as it finished, for the director (step 6's settings of theirs that weaken Standard).
    const said = runById(run.id)?.steps?.[step.n]?.say?.line;
    return { ok: true, started: true, done: true, ...(typeof said === 'string' ? { said: hide(said, []) } : {}) };
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
        cwd: jobFolder(), detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...caEnv(wheelhouseHome()) },
      });
      child?.on?.('error', failed);
      child?.unref?.();
    } catch {
      failed();
    }
  }

  // `oneCard` says the one card comes next (design section 15.1); `setUpAgain` that the director
  // asked to set up again, on a redo card, so the playbook takes them through uninstall first.
  async function status(body) {
    const folder = admitFolder(body.folder, { userHome });
    const found = runFor(folder, userHome);
    settleStepFourAgain(found);
    const run = found === null ? null : runById(found.id);
    // Only the steps the run has (ruling R74).
    const all = runSteps(run, await steps());
    const running = (n) => runningIn(run, n);
    if (run === null) return { ok: true, lines: ['Setup has not started in this folder.'], next: firstUnfinished(null, all), ask: toAsk(null, all, running), oneCard: true };
    const again = setUpAgainAsked(answersFor(run.id)) && stepDone(run, 3);
    const listed = statusLines(run, all, running);
    // A green board's briefing not yet given, and no card left to open with it (the phone's, see
    // plan): step 10 is planned once more, to give it as its `said`.
    const briefing = listed.ask === null && healthGreen(run) && pendingBriefing(run, answersFor(run.id)) !== null;
    // The steps running now, for `cli.js wait`: a running step's plan is refused, so the wait reads them here.
    const runningNow = all.map((s) => s.n).filter((n) => running(n) !== null);
    return { ok: true, ...listed, ...(runningNow.length > 0 ? { running: runningNow } : {}), ...(briefing ? { ask: HEALTH_STEP } : {}), ...(oneCardNext(run) ? { oneCard: true } : {}), ...(again ? { setUpAgain: true } : {}) };
  }

  // Step 10's board (rulings R41, R44, R67, R68): the helper's checks, recorded by step 10's apply,
  // joined with the trial lines the session ran in its sandbox and hands in, and the board's health
  // lines. It reads, so it answers under STOP, as status does. Only when STOP is off, and only until
  // the run's board has been green, does it do more: it removes a .env.local the session's trial
  // left behind (holding only the trial's marker); once the session's lines are in, it closes the
  // trial pull request and deletes its branch, recorded in the run; and the first time the board is
  // green it records that in the run, which finishes setup (setup-run.js, healthGreen), copies the
  // run's last clicks and answers into the project's state (`copy`, ruling R45: a copy that failed
  // at step 10's apply has no later step to retry it), and does the last thing setup does,
  // starting the foreman and giving the first briefing (`finish`). After that mark it only reads,
  // so no caller can run setup's ending again, or move what it wrote. Setup's ending is the last
  // thing it does (ruling R70): while any other step of the run but the phone is not done (a step 10
  // card asked out of order waits only for steps 7 and 8), the board is not green, nothing is marked or
  // finished, and the trial pull request is left open, so the same lines can be handed in again
  // once that step is done. One run's requests are taken one at a time, so two can't both finish it.
  const healthQueue = new Map();
  async function healthRoute(body) {
    if (Object.keys(body).some((k) => !HEALTH_FIELDS.includes(k))) refuse('the health check takes the folder and the trial lines the session printed, nothing else');
    const folder = admitFolder(body.folder, { userHome });
    const lines = body.lines ?? [];
    if (!Array.isArray(lines) || lines.length > MOST_TRIAL_LINES || !lines.every((l) => parseTrialLine(l) !== null)) {
      refuse(`the lines must be the trial lines trials.js printed, as they are, at most ${MOST_TRIAL_LINES}`);
    }
    const found = runFor(folder, userHome);
    if (found === null) refuse('setup has not started in this folder');
    // A joining computer has no health check (ruling R74): nothing here marks it green or ends it.
    if (!onRunList(found, HEALTH_STEP)) refuse(notOnList(found, HEALTH_STEP));
    const before = healthQueue.get(found.id) ?? Promise.resolve();
    const turn = before.catch(() => {}).then(async () => {
      const read = (run) => health({ folder: run.folder, run, reported: lines, now });
      const answerOf = (got) => ({ ok: true, green: got.green, lines: got.lines, board: got.board, trials: got.trials });
      let run = runById(found.id);
      if (healthGreen(run) || stopped()) return answerOf(await read(run));
      removeTrialLeftover(run.folder);
      const before = stepsFor(run).find((s) => s.n !== HEALTH_STEP && s.n !== PUSH_TEST_STEP && !stepDone(run, s.n));
      if (before !== undefined) {
        const got = await read(run);
        return {
          ...answerOf(got),
          green: false,
          lines: [`Not yet: step ${before.n} (${before.title}) isn't done, so setup can't finish. Run it, then hand in the same trial lines again.`, ...got.lines],
        };
      }
      if (lines.length > 0) {
        await closeTrial({ setupRun: run, record: (c) => addChanges(run.id, [{ ...c, step: HEALTH_STEP }]) });
        run = runById(found.id);
      }
      const got = await read(run);
      if (!got.green || got.project === null || stopped()) return answerOf(got);
      addChanges(run.id, [{ id: newId('chg'), step: HEALTH_STEP, kind: 'answer', target: `step ${HEALTH_STEP}`, before: null, after: { green: now().toISOString() } }]);
      try {
        await copy(run.id, run.folder);
      } catch { /* the records stay in setup's own folder; the ending goes on */ }
      // Changes the director asked for after setup (design section 15.1), for the front desk to start.
      const requests = changeRequests(run.id, answersFor(run.id));
      const ending = await finish({ project: got.project, ...(writeSurvey ? { writeSurvey } : {}) });
      // The verdict and the first briefing, kept for the next card to open with (pendingBriefing).
      const show = [got.verdict, ending.briefing].filter((part) => typeof part === 'string' && part !== '').join('\n\n');
      addChanges(run.id, [{ id: newId('chg'), step: HEALTH_STEP, kind: 'answer', target: BRIEFING_TARGET, before: null, after: { briefing: show } }]);
      return { ...answerOf(got), ...ending, ...(requests.length > 0 ? { requests } : {}) };
    });
    healthQueue.set(found.id, turn);
    try {
      return await turn;
    } finally {
      if (healthQueue.get(found.id) === turn) healthQueue.delete(found.id);
    }
  }

  return {
    '/setup/plan': plan, '/setup/apply': apply, '/setup/status': status, '/setup/health': healthRoute, '/setup/choices': choicesRoute, '/setup/change': changeRoute,
  };
}
