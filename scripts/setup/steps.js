// scripts/setup/steps.js
// Setup's steps (design section 15), in the order setup runs them, numbered 1 to 10. The
// project's files, pins and protection are step 7: they go up before protection is switched on,
// and before Locked, whose hook refuses commands in a Locked project until its settings switch
// the sandbox on, which would refuse the playbook's own command too.
//
//   Step = {
//     n: number, title: string,
//     plan(ctx) -> Promise<{ changes: PlannedChange[], card: CardInput, director: string }
//                        | { ask: { id, card: CardInput, typed?: boolean, rules? } }
//                        | { wait: ms, why: string } | { settled: { record } }>,
//     apply(ctx, changes) -> Promise<Change[]>,
//     long?: boolean,        runs in a detached child (scripts/setup/run-step.js)
//     after?: number[],      steps that must be done before this one is applied (ruling R47);
//                            its plan and questions are asked meanwhile
//   }
//   ctx = { folder, step, runId, now, userHome, platform, answers }, and for apply also
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
// the composer's input without its kind, which is `question`; `typed` when a typed answer
// counts); `wait`, nothing to ask for that many milliseconds; or `settled`, every answer is in and
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
// Until each step's task (Tasks 7 to 13) fills it in, the step lists no changes (ruling R14).
// Step 1, the install, is the director's own (the README's line, Task 16), so it lists none.
// Step 2, the tools, is scripts/setup/tools.js; step 3, the host and the connection, is
// scripts/setup/host.js.
import crypto from 'node:crypto';
import { canonicalJson } from '../lib/canonical.js';
import { SETUP_TITLES, SETUP_LABEL } from '../state/card-lines.js';
import { toolsStep } from './tools.js';
import { hostStep } from './host.js';

// The first step of a run not yet done is in scripts/lib/setup-run.js, which the hooks read
// without reaching this file; it numbers the steps as STEPS does.
export { firstUnfinished } from '../lib/setup-run.js';

// The SHA-256 of a list of changes in canonical JSON: what a setup card's line names.
export function planHash(changes) {
  return crypto.createHash('sha256').update(canonicalJson(changes)).digest('hex');
}

// The card of a step that changes nothing yet.
function placeholderCard(n) {
  return {
    kind: 'setup',
    level: 3,
    what: `Setup step ${n}, ${SETUP_TITLES[n]}: this step has nothing to change on this computer yet.`,
    why: 'Setup changes nothing without your click on the list of what it will change.',
    options: [
      { label: SETUP_LABEL, says: 'Setup marks this step done and moves on.' },
      { label: 'Not now', says: 'Setup waits at this step; nothing changes.' },
    ],
    recommend: SETUP_LABEL,
    because: 'the list is empty, so nothing changes',
    meanwhile: 'Setup waits at this step; nothing changes.',
  };
}

function placeholder(n) {
  return {
    n,
    title: SETUP_TITLES[n],
    async plan() {
      return { changes: [], card: placeholderCard(n), director: 'One click' };
    },
    async apply() {
      return [];
    },
  };
}

const FILLED = { 2: toolsStep, 3: hostStep };

export const STEPS = Object.freeze(Object.keys(SETUP_TITLES).map(Number).sort((a, b) => a - b).map((n) => (FILLED[n] ? FILLED[n]() : placeholder(n))));
