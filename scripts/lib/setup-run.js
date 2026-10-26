// scripts/lib/setup-run.js
// Where a setup run stands, read without changing anything: setup's journal file and its reader
// (scripts/setup/journal.js holds its writers and says what a journal holds), and the first step
// of a run not yet done. The hooks read these to tell a folder being set up; they live apart from
// scripts/setup/ so the hooks, which the mod's bridge imports, reach nothing there
// (scripts/mod/validate.js, bridgeImports). Nothing here writes a file.
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from './paths.js';
import { SETUP_TITLES } from '../state/card-lines.js';

export function journalFile() {
  return path.join(wheelhouseHome(), 'setup', 'journal.json');
}

// The code on readJournal's refusal of a journal of a later version than this copy reads, which a
// newer Wheelhouse wrote, and on its refusal of any other file that is not a journal it reads.
export const NEWER_JOURNAL = 'WHEELHOUSE_NEWER_JOURNAL';
export const NOT_A_JOURNAL = 'WHEELHOUSE_NOT_A_JOURNAL';

function refuse(why, code) {
  return Object.assign(new Error(`The setup journal ${journalFile()} ${why}; it has been left as it was`), { code });
}

// The journal; the empty one when there is none yet. A file that is not a journal this
// version reads is refused, naming it.
export function readJournal() {
  let text;
  try {
    text = fs.readFileSync(journalFile(), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { v: 1, runs: [] };
    throw error;
  }
  let journal;
  try {
    journal = JSON.parse(text);
  } catch {
    throw refuse('is not JSON', NOT_A_JOURNAL);
  }
  if (!journal || typeof journal !== 'object' || journal.v !== 1 || !Array.isArray(journal.runs)) {
    const newer = Number.isInteger(journal?.v) && journal.v > 1;
    throw refuse('is not a journal this version of Wheelhouse can read', newer ? NEWER_JOURNAL : NOT_A_JOURNAL);
  }
  return journal;
}

// Why setup's journal can't be read, without throwing: null when it can (none at all reads as
// empty), 'newer' when it is a journal of a later version than this copy reads (a newer
// Wheelhouse's: updating Wheelhouse reads it), and 'unreadable' for anything else. While it can't
// be read, whether setup has finished isn't known, so the watcher is held back (ruling R72).
export function journalTrouble() {
  try {
    readJournal();
    return null;
  } catch (error) {
    return error?.code === NEWER_JOURNAL ? 'newer' : 'unreadable';
  }
}

// Setup's steps by number and title, in order: what scripts/setup/steps.js numbers its STEPS by.
export const SETUP_STEPS = Object.freeze(Object.keys(SETUP_TITLES).map(Number).sort((a, b) => a - b)
  .map((n) => Object.freeze({ n, title: SETUP_TITLES[n] })));

// The health check (ruling R67): its apply's finish is the helper's half only; it counts as done
// once the helper's /setup/health route has found the whole board green and recorded so in the
// run, as step 10's `answer` change { green: <time> }.
export const HEALTH_STEP = 10;

// Whether the run's health check has been green: the mark /setup/health records, once.
export function healthGreen(run) {
  return (Array.isArray(run?.changes) ? run.changes : [])
    .some((c) => c?.step === HEALTH_STEP && c.kind === 'answer' && typeof c.after?.green === 'string');
}

// The step whose `answer` change says this computer is joining a project already set up on
// another, and the steps such a run has (design section 15, ruling R74): no rules found or three
// questions, which the project already holds, and no health check, so no green mark and no ending.
export const JOIN_STEP = 3;
export const JOINING_STEPS = Object.freeze(SETUP_STEPS.filter((s) => [1, 2, 3, 6, 7, 8, 9].includes(s.n)));

// The project's repository a run joins, '<owner/name>', as step 3 last recorded it (its `answer`
// change { joined }: the name asked for as its apply starts, then the repository found); null for
// a run setting up a project of its own, including one whose latest record says { joined: null },
// a new product chosen after a joining attempt (ruling R77).
export function joinedRepo(run) {
  const joined = (Array.isArray(run?.changes) ? run.changes : [])
    .filter((c) => c?.step === JOIN_STEP && c.kind === 'answer' && c.after && typeof c.after === 'object' && Object.hasOwn(c.after, 'joined')).at(-1);
  return typeof joined?.after.joined === 'string' && joined.after.joined !== '' ? joined.after.joined : null;
}

// The steps a run has (ruling R74): every step, or for a computer joining a project, JOINING_STEPS.
// A folder with no run yet has every step.
export function stepsFor(run) {
  return joinedRepo(run) === null ? SETUP_STEPS : JOINING_STEPS;
}

// Whether step n is one the run has.
export function onRunList(run, n) {
  return stepsFor(run).some((s) => s.n === n);
}

// Whether step n of a run is done: finished, and for the health check, green as well. A step the
// run doesn't have (stepsFor) is never one it waits for, so it reads as done: a joining computer is
// finished once its own steps are, and a step waiting for one it doesn't have goes ahead.
export function stepDone(run, n) {
  if (!onRunList(run, n)) return true;
  return typeof run?.steps?.[n]?.doneAt === 'string' && (n !== HEALTH_STEP || healthGreen(run));
}

// The lowest of the run's steps not yet done, or null when every step is; 1 when there is no run.
// `steps` narrows the steps looked at; a step not on the run's own list is never unfinished.
// A step that ran after it (a long step's next cards are asked while it runs) doesn't count.
// Setup of a project of its own is finished only once the health check's board has been green
// (ruling R67); a joining computer's once its own steps are done (R74).
export function firstUnfinished(run, steps = stepsFor(run)) {
  return steps.map((s) => s.n).sort((a, b) => a - b).find((n) => !stepDone(run, n)) ?? null;
}

// Whether uninstall has closed the run (its `closedAt`, ruling R89): it is over, and what it set
// up has been put back, so nothing reads it as setup in progress or as this computer's own.
export function runClosed(run) {
  return typeof run?.closedAt === 'string';
}

// The step that tests a push to the director's phone (Phone notifications, ruling R39).
export const PUSH_TEST_STEP = 9;

// Step 9's results in a run, oldest first: each `answer` change it settled on, { pushArrived } or
// { pushSkipped: true } (ruling R39, as the director ruled on 26 October 2026: the phone is optional).
export function phoneResults(run) {
  return (Array.isArray(run?.changes) ? run.changes : [])
    .filter((c) => c?.step === PUSH_TEST_STEP && c.kind === 'answer' && c.after !== null && typeof c.after === 'object')
    .map((c) => c.after);
}

// Whether the run's step 9 is done but can be taken again: its last result is skipped, or a push
// that didn't arrive. The front desk takes it again when the director asks to set up phone
// notifications, with the same test.
export function phoneRetakeable(run) {
  if (typeof run?.steps?.[PUSH_TEST_STEP]?.doneAt !== 'string') return false;
  const last = phoneResults(run).at(-1);
  return last?.pushSkipped === true || last?.pushArrived === false;
}

// Whether the test push reached the director's phone, as this computer's journal last recorded it:
// { arrived, at, run } from the run whose step 9 settled last on the director's answer, or on an
// earlier run's (its `answer` change, { pushArrived }), `at` when it settled and `run` its id; null
// when no run's step 9 has. Phone notifications belong to the computer, so any project's run
// counts, but not a run uninstall has closed (ruling R89): a computer that has left and is set up
// again tests the push again. The board's health reads it, and a later run's step 9 settles on an
// arrival (R75).
export function phonePushResult(journal = readJournal()) {
  let found = null;
  for (const run of Array.isArray(journal?.runs) ? journal.runs : []) {
    if (runClosed(run)) continue;
    const at = run?.steps?.[PUSH_TEST_STEP]?.doneAt;
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) continue;
    // A skip says nothing of whether a push reaches the phone, so an earlier test's result stands.
    const answer = phoneResults(run).filter((r) => typeof r.pushArrived === 'boolean').at(-1);
    if (answer && (found === null || Date.parse(at) > Date.parse(found.at))) found = { arrived: answer.pushArrived, at, run: run.id };
  }
  return found;
}
