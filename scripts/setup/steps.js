// scripts/setup/steps.js
// Setup's steps (design section 15), in the order setup runs them, numbered 1 to 10. The
// project's files, pins and protection are step 7: they go up before protection is switched on,
// and before Locked, whose hook refuses commands in a Locked project until its settings switch
// the sandbox on, which would refuse the playbook's own command too.
//
//   Step = {
//     n: number, title: string,
//     plan(ctx) -> Promise<{ changes: PlannedChange[], card: CardInput, director: string }
//                        | { ask: { id, card: CardInput, typed?: boolean, rules?, writes? } }
//                        | { wait: ms, why: string } | { settled: { record } }>,
//     apply(ctx, changes) -> Promise<Change[]>,
//     long?: boolean,        runs in a detached child (scripts/setup/run-step.js)
//     after?: number[],      steps that must be done before this one is asked, settled or applied
//                            (rulings R47, R70); its plan gives a wait naming the step meanwhile
//     asksDuring?: number[], steps among `after` while which its questions are still asked (R54)
//   }
//   ctx = { folder, step, runId, startedAt, now, userHome, platform, answers, say }, where a plan's
//         say(line) is kept only when it settles, shown by status beside the step (ruling R101);
//         and for apply also
//         applyJsonKey({ file, key, value, project? }), the journal's key edit, which records the
//           change in the journal before it writes the file, and gives the change back;
//         record(change or changes), to put a change of any other kind in the journal;
//         say(line), one line for the director while the step runs, such as a sign-in code
//           (ruling R40), kept on the step's journal entry and shown, cleaned, by /setup/status;
//         stopped(), whether STOP has come on meanwhile.
//
// `plan` changes nothing. Its list is what the card shows and what its hash names, so it must be
// the same list each time for the same world: no ids, no times. `card` is the composer's input
// (scripts/cards/compose.js) of kind `setup`, without its target: the engine gives it this step
// and the list's hash, which make its set line. `director` is what the director does, in plain words.
// `apply` gets the list the helper has just worked out again, never one a caller sent.
//
// A plan may give, in place of its list (rulings R30 to R32): `ask`, a question it needs answered
// first, while ctx.answers lacks it (`id` of up to 40 lowercase letters, digits and dashes; `card`
// the composer's input without its kind, which is `question`, or of kind `confirm-all` for step 5's
// card of the rules found, whose line the engine makes from `rules`; `typed` when a typed answer
// counts; `writes`, what each answer records in the project's state, which the prompt record signs
// from the click: scripts/lib/setup-writes.js); `wait`, nothing to ask for that many milliseconds; or `settled`, every answer is in and
// the step changes nothing outside setup's own records, which marks it done with `record` kept in
// the journal and no Go ahead. ctx.answers holds every answer of the run, from every step, as
// { '<step>.<id>': { label, text, at } }: `label` the option clicked, or `text` typed, the other
// null. An answer is part of the world the list is worked out from, so a later answer that changes
// the list makes the Go ahead on the old one CHANGED.
//
// The step contract: `apply` records each change as it is made, never only at the end. A key in a
// JSON file goes through ctx.applyJsonKey; any other change is passed to ctx.record just before
// it is made (or, where its value before can only be read as it is made, at once after), with its
// value before. A step that fails part-way then leaves every change it made in the journal, so
// uninstall can put them back, and a retry, which reads setup's own value as the value before,
// never loses the director's. `apply` may also return the changes it made; one already recorded
// is not recorded twice. A throw marks the step failed with its message; a fresh card and click
// run it again, so apply must be safe to repeat.
//
// A run has its own list of steps (scripts/lib/setup-run.js, stepsFor; ruling R74): a computer
// joining a project set up on another runs steps 1, 2, 3, 6, 7, 8 and 9 only.
//
// Step 1, the install, is the director's own (the README's line, Task 16): it settles at once with
// when the session's first message came (scripts/setup/install-step.js, ruling R76).
// Step 2, the tools, is scripts/setup/tools.js; step 3, the host and the connection, is
// scripts/setup/host.js; step 4, the three questions, is scripts/setup/questions.js; step 5, the
// rules found, is scripts/setup/rules.js; step 6, the changes to this computer, and step 8, Locked,
// are scripts/setup/computer.js; step 7, the project's files, pins and protection, is
// scripts/setup/project-files.js; step 9, phone notifications, is scripts/setup/notify.js; step 10,
// the health check, is scripts/setup/health.js.
import { listHash } from '../lib/setup-writes.js';
import { SETUP_TITLES } from '../state/card-lines.js';
import {
  SETUP_DOING, SETUP_DONE, SETUP_GOING, PHONE_TESTED_EARLIER, PHONE_TEST_MISSED, PHONE_SKIPPED, connectingTo, setupStepLine, setupMeanwhile, toolsInstalling,
} from '../lib/calm-words.js';
import { PUSH_TEST_STEP, stepsFor } from '../lib/setup-run.js';
import { installStep } from './install-step.js';
import { toolsStep } from './tools.js';
import { hostStep } from './host.js';
import { questionsStep } from './questions.js';
import { rulesStep } from './rules.js';
import { computerStep, lockedStep } from './computer.js';
import { projectFilesStep } from './project-files.js';
import { notifyStep } from './notify.js';
import { healthStep } from './health.js';

// The first step of a run not yet done is in scripts/lib/setup-run.js, which the hooks read
// without reaching this file; it numbers the steps as STEPS does.
export { firstUnfinished } from '../lib/setup-run.js';

// The SHA-256 of a list of changes in canonical JSON: what a setup card's line names. The prompt
// record works out the hash of the rules on step 5's card the same way (scripts/lib/setup-writes.js).
export const planHash = (changes) => listHash(changes);

const STEP_OF = {
  1: installStep, 2: toolsStep, 3: hostStep, 4: questionsStep, 5: rulesStep, 6: computerStep, 7: projectFilesStep, 8: lockedStep, 9: notifyStep, 10: healthStep,
};

export const STEPS = Object.freeze(Object.keys(SETUP_TITLES).map(Number).sort((a, b) => a - b).map((n) => STEP_OF[n]()));

// About how many minutes each step takes the director (design section 15's table; a range there is
// its middle here).
export const STEP_MINUTES = Object.freeze({
  1: 2, 2: 3, 3: 2, 4: 2, 5: 1, 6: 1, 7: 1, 8: 1, 9: 3, 10: 1,
});

// What has happened, said for step n once it is done. Step 9 says what its test settled on, by its
// `answer` change: arrived now, arrived in an earlier setup, didn't arrive, or skipped.
function doneLine(run, n) {
  if (n !== PUSH_TEST_STEP) return SETUP_DONE[n];
  const answer = (Array.isArray(run?.changes) ? run.changes : []).filter((c) => c?.step === n && c.kind === 'answer').at(-1)?.after;
  if (answer?.pushSkipped === true) return PHONE_SKIPPED;
  if (answer?.pushArrived === false) return PHONE_TEST_MISSED;
  return typeof answer?.from === 'string' ? PHONE_TESTED_EARLIER : SETUP_DONE[n];
}

// The lines that head a step in the chat (design section 23.8): its place and time, what it is, one
// line of what has happened (the step done last before it), and, where something runs meanwhile,
// what carries on. `run` is the folder's run or null; `running(m)` whether step m runs now; `host`
// the project's host once it is known.
export function stepProgress({ n, run, running = () => false, host }) {
  const list = stepsFor(run).map((s) => s.n);
  const lines = [setupStepLine(Math.max(1, list.indexOf(n) + 1), list.length, STEP_MINUTES[n]), n === 3 ? connectingTo(host) : SETUP_DOING[n]];
  const done = list.filter((m) => m !== n && typeof run?.steps?.[m]?.doneAt === 'string')
    .sort((a, b) => Date.parse(run.steps[b].doneAt) - Date.parse(run.steps[a].doneAt))[0];
  lines.push(done === undefined ? 'Setup has just started.' : doneLine(run, done));
  const going = list.find((m) => m !== n && SETUP_GOING[m] !== undefined && running(m));
  if (going !== undefined) {
    const tools = going === 2
      ? [...new Set((run?.changes ?? []).filter((c) => c?.step === 2 && c.kind === 'process' && typeof c.after?.tool === 'string').map((c) => c.after.tool))]
      : [];
    lines.push(setupMeanwhile(tools.length > 0 ? toolsInstalling(tools) : SETUP_GOING[going]));
  }
  return lines;
}
