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
import { asQuestion } from '../../../scripts/cards/visit.js';
import { markPane, readOpen } from '../../../scripts/lib/session-files.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setupCardsFor } from '../../../scripts/lib/setup-clicks.js';
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

test('the baseline refusal comes before the swap, even for a card setup showed', () => inSetup(async ({ folder, first }) => {
  const figures = { usd: 4127.35, merges: 37, from: '2026-09-01', to: '2026-09-30', counted: 'Every merged pull request on the first version, counted by hand.' };
  const baseline = baselineCard(figures, DOC);
  assert.equal((await run(call(folder, baseline))).hookSpecificOutput.permissionDecision, 'deny');
  // The same words as a record setup holds for a step: still refused, not swapped for it.
  noteShown({ runId: first.id, folder, step: 7, hash: DOC, card: baseline, now: () => NOW });
  const reworded = { ...baseline, question: `${baseline.question.split('\n')[0]}\nand more words` };
  assert.equal((await run(call(folder, reworded))).hookSpecificOutput.permissionDecision, 'deny');
}));

test('with no run named, the cards are those of the newest run in the folder', () => inSetup(async ({ folder, first }) => {
  const later = startRun({ folder, now: () => new Date(NOW.getTime() + 60000) });
  noteShown({ runId: later.id, folder, step: 6, hash: DOC, card: PLAN, now: () => new Date(NOW.getTime() + 60000) });
  const ids = setupCardsFor(folder).map((c) => c.card.id);
  assert.deepEqual(ids, [`setup:${later.id}-6`]);
  assert.deepEqual(setupCardsFor(folder, first.id).map((c) => c.card.id).sort(), [`setup:${first.id}-4-product-launched`, `setup:${first.id}-6`].sort());
}));

// A project that is also being set up.
const PROJECT = 'owner__name';
const SID = 'sess-setup';
const T0 = Date.UTC(2026, 10, 4, 0, 0, 0);
const inProject = (fn) => inSetup(async (world) => {
  writeProject(PROJECT, { folder: world.folder, remoteUrl: null, host: 'local', repo: `local/${PROJECT}`, connection: { mode: 'none' } });
  return fn(world);
});
const stateCard = composeCard({ ...common, kind: 'question', recommend: 'Comma', what: 'The export needs to know which separator to use.', options: [
  { label: 'Comma', says: 'Commas between values.' }, { label: 'Tab', says: 'Tabs between values.' }] });
const STATE = { card: { id: 'c-1', data: stateCard.card }, decided: null };
const inProjectRun = (input, over = {}) => decide(input, { projectOf: () => ({ project: PROJECT }), now: () => new Date(T0), stop: () => ({ on: true }), role: () => 'front-desk', holdForPane: false, outcomes: () => [STATE], ...over });

test('in a project being set up, the state card wins over a setup card sharing its first line', () => inProject(async ({ folder, first }) => {
  const line = stateCard.question.question.split('\n')[0];
  noteAsked({ runId: first.id, folder, step: 4, id: 'other', card: { ...ASKED, question: `${line}\nOther words entirely.`, options: [{ label: 'Foo', description: 'a' }, { label: 'Bar', description: 'b' }] }, now: () => NOW });
  const q = { question: line, header: 'Question', options: [{ label: 'X', description: 'x' }, { label: 'Y', description: 'y' }], multiSelect: false };
  assert.deepEqual(swappedOf(await inProjectRun({ ...call(folder, q), session_id: SID })), [asQuestion({ data: stateCard.card })]);
}));

test('in a project being set up, a setup card is swapped, never held for the pane, and not noted open', () => inProject(async ({ folder, first }) => {
  // A card in the form a card takes, which a state card of it would hold for a live pane.
  const form = stateCard.question;
  noteAsked({ runId: first.id, folder, step: 4, id: 'form', card: form, now: () => NOW });
  markPane(SID, { at: T0, drawn: T0, surface: 'desktop' });
  const reworded = { ...form, question: form.question.split('\n')[0], options: [{ label: 'Comma', description: 'x' }, { label: 'Tab', description: 'y' }] };
  const out = await inProjectRun({ ...call(folder, reworded), session_id: SID }, { outcomes: () => [], holdForPane: true });
  assert.deepEqual(swappedOf(out), [printedOf(form)]);
  assert.equal(readOpen(SID), null);
}));

test('two state cards sharing a first line are ambiguous: no setup card is swapped in for them', () => inProject(async ({ folder, first }) => {
  const line = stateCard.question.question.split('\n')[0];
  const twin = { card: { id: 'c-2', data: { ...stateCard.card, question: `${line}\nA second card's other words.` } }, decided: null };
  noteAsked({ runId: first.id, folder, step: 4, id: 'other', card: { ...ASKED, question: `${line}\nOther words entirely.`, options: [{ label: 'Foo', description: 'a' }, { label: 'Bar', description: 'b' }] }, now: () => NOW });
  const q = { question: line, header: 'Question', options: [{ label: 'X', description: 'x' }, { label: 'Y', description: 'y' }], multiSelect: false };
  // Matching no card, it is judged as any question that is no card: its form is refused, and nothing is swapped.
  const out = await inProjectRun({ ...call(folder, q), session_id: SID }, { outcomes: () => [STATE, twin] });
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(out.hookSpecificOutput.updatedInput, undefined);
}));
