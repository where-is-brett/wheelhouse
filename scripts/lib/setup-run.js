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

function refuse(why) {
  return new Error(`The setup journal ${journalFile()} ${why}; it has been left as it was`);
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
    throw refuse('is not JSON');
  }
  if (!journal || typeof journal !== 'object' || journal.v !== 1 || !Array.isArray(journal.runs)) {
    throw refuse('is not a journal this version of Wheelhouse can read');
  }
  return journal;
}

// Setup's steps by number and title, in order: what scripts/setup/steps.js numbers its STEPS by.
export const SETUP_STEPS = Object.freeze(Object.keys(SETUP_TITLES).map(Number).sort((a, b) => a - b)
  .map((n) => Object.freeze({ n, title: SETUP_TITLES[n] })));

// The lowest step of a run not yet done, or null when every step is; 1 when there is no run.
// A step that ran after it (a long step's next cards are asked while it runs) doesn't count.
export function firstUnfinished(run, steps = SETUP_STEPS) {
  const done = (n) => typeof run?.steps?.[n]?.doneAt === 'string';
  return steps.map((s) => s.n).sort((a, b) => a - b).find((n) => !done(n)) ?? null;
}

// The step that tests a push to the director's phone (Phone notifications, ruling R39).
export const PUSH_TEST_STEP = 9;

// Whether the test push reached the director's phone, as this computer's journal last recorded it:
// { arrived, at } from the run whose step 9 settled last on the director's answer (its `answer`
// change, { pushArrived }), `at` when it settled; null when no run's step 9 has. Phone
// notifications belong to the computer, so any project's run counts. The board's health reads it.
export function phonePushResult(journal = readJournal()) {
  let found = null;
  for (const run of Array.isArray(journal?.runs) ? journal.runs : []) {
    const at = run?.steps?.[PUSH_TEST_STEP]?.doneAt;
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) continue;
    const answer = (Array.isArray(run.changes) ? run.changes : [])
      .filter((c) => c?.step === PUSH_TEST_STEP && c.kind === 'answer' && typeof c.after?.pushArrived === 'boolean').at(-1);
    if (answer && (found === null || Date.parse(at) > Date.parse(found.at))) found = { arrived: answer.after.pushArrived, at };
  }
  return found;
}
