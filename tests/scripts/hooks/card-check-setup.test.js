// tests/scripts/hooks/card-check-setup.test.js
// In a folder being set up, a card reworded from the one setup showed (its plan card) or asked (one of its
// own questions) is swapped for that stored card, as a waiting card in a project is; a card asked exactly as
// stored, one that is no setup card, and a folder with no run in it are left as they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decide } from '../../../scripts/hooks/card-check.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { baselineCard } from '../../../scripts/measures/baseline.js';
import { setLineOf } from '../../../scripts/state/card-lines.js';
import { startRun } from '../../../scripts/setup/journal.js';
import { noteShown, noteAsked } from '../../../scripts/setup/clicks.js';

const NOW = new Date('2026-11-03T00:00:00.000Z');
const DOC = 'fedcba9876543210'.repeat(4);
const common = {
  why: 'It changes what users see, which is yours to decide at level 3.',
  because: 'the checks passed and the change is small.',
  meanwhile: 'Nothing is released and the agents carry on with other work.',
  level: 3,
};
const PLAN = composeCard({
  ...common, kind: 'setup', recommend: 'Go ahead', what: 'Setup step 6, Changes to this computer: transcripts are kept 30 days.',
  options: [{ label: 'Go ahead', says: 'It go ahead and goes ahead.' }], target: { step: 6, hash: DOC },
}).question;
const ASKED = {
  question: 'In a sentence, what is example_tool, and who uses it? Choose the README\'s words, or type your own as your answer.\n'
    + 'Wheelhouse explains its work to you in terms of your product; it is recorded as launched.\nNothing runs until your Go ahead on the plan.\nTo know more, just ask.',
  header: 'Question',
  options: [
    { label: 'The README\'s words', description: 'Recommended: "A stock tool for shift leads.", because it is how the project already describes itself.' },
    { label: 'Describe it later', description: 'Setup records no description of it yet; you can give one to the First Mate later.' },
  ],
};
const printedOf = (card) => ({
  question: card.question, header: card.header, options: card.options.map(({ label, description }) => ({ label, description })), multiSelect: false,
});
const call = (cwd, ...questions) => ({ cwd, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions } });
const run = (input) => decide(input, { projectOf: () => null, now: () => NOW });
const swappedOf = (out) => {
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined);
  return out.hookSpecificOutput.updatedInput.questions;
};

async function inSetup(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-cc-setup-'));
  const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-cc-setup-tool-')));
  const other = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-cc-setup-other-')));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const first = startRun({ folder, now: () => NOW });
    noteShown({ runId: first.id, folder, step: 6, hash: DOC, card: PLAN, now: () => NOW });
    noteAsked({ runId: first.id, folder, step: 4, id: 'product-launched', card: ASKED, typed: true, now: () => NOW });
    return await fn({ home, folder, other, first });
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    for (const d of [home, folder, other]) fs.rmSync(d, { recursive: true, force: true });
  }
}

const rewordedPlan = () => ({
  ...PLAN, question: `Go ahead with step 6?\n${setLineOf(PLAN.question)}`,
  options: [{ label: 'Go ahead (Recommended)', description: 'Goes.' }],
});

test('a setup plan card reworded is swapped for the card setup showed', () => inSetup(async ({ folder }) => {
  assert.deepEqual(swappedOf(await run(call(folder, rewordedPlan()))), [printedOf(PLAN)]);
}));

test('a setup plan card with its set line dropped is swapped by its first line', () => inSetup(async ({ folder }) => {
  const first = PLAN.question.split('\n')[0];
  const cut = { ...PLAN, question: first, options: [{ label: 'Go ahead', description: 'x' }] };
  assert.deepEqual(swappedOf(await run(call(folder, cut))), [printedOf(PLAN)]);
}));

test('a setup question asked reworded is swapped for the card setup asked', () => inSetup(async ({ folder }) => {
  const cut = { ...ASKED, question: ASKED.question.split('\n')[0], options: [{ label: 'The README\'s words', description: 'x' }, { label: 'Describe it later', description: 'y' }] };
  assert.deepEqual(swappedOf(await run(call(folder, cut))), [printedOf(ASKED)]);
}));

test('a card asked exactly as setup showed it passes with nothing changed', () => inSetup(async ({ folder }) => {
  assert.equal(await run(call(folder, printedOf(PLAN))), undefined);
  assert.equal(await run(call(folder, printedOf(ASKED))), undefined);
}));

test('a question that is not a setup card passes, and a subfolder is swapped', () => inSetup(async ({ folder }) => {
  const plain = { question: 'Which folder should the report go in?', header: 'Folder', options: [{ label: 'Shared', description: 'a' }, { label: 'Private', description: 'b' }], multiSelect: false };
  assert.equal(await run(call(folder, plain)), undefined);
  const sub = path.join(folder, 'inner');
  fs.mkdirSync(sub);
  assert.deepEqual(swappedOf(await run(call(sub, rewordedPlan()))), [printedOf(PLAN)]);
}));

test('a folder that is neither a project nor being set up is left alone', () => inSetup(async ({ other }) => {
  assert.equal(await run(call(other, rewordedPlan())), undefined);
}));

test('a record of another run is not used', () => inSetup(async ({ folder }) => {
  startRun({ folder, now: () => new Date(NOW.getTime() + 60000) });
  assert.equal(await run(call(folder, rewordedPlan())), undefined);
}));

test('the baseline refusal and the set-up swap do not mix up', () => inSetup(async ({ folder }) => {
  const figures = { usd: 4127.35, merges: 37, from: '2026-09-01', to: '2026-09-30', counted: 'Every merged pull request on the first version, counted by hand.' };
  const out = await run(call(folder, baselineCard(figures, DOC)));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
}));
