// tests/scripts/hooks/card-check.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide, cardProblems } from '../../../scripts/hooks/card-check.js';
import { hookMain } from '../../../scripts/hooks/kit.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { approvalLine, replyCode, replyCodeLine, setLineOf } from '../../../scripts/state/card-lines.js';

const HOOK = fileURLToPath(new URL('../../../scripts/hooks/card-check.js', import.meta.url));
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const DOC = 'fedcba9876543210'.repeat(4);
const NOW = new Date('2026-10-18T05:00:00.000Z');
const RULING = makeEvent({ kind: 'ruling', data: { words: 'Money is shown in dollars' }, now: () => NOW });

const common = {
  why: 'It changes what users see, which is yours to decide at level 3.',
  because: 'the checks passed and the change is small.',
  meanwhile: 'Nothing is released and the agents carry on with other work.',
  level: 3,
};
const says = (label) => ({ label, says: `It ${label.toLowerCase()} and goes ahead.` });
const OWN = [
  { label: 'Comma', says: 'Commas between values; opens in any spreadsheet.' },
  { label: 'Tab', says: 'Tabs between values; safe for text with commas.' },
];
// One composed card of each kind, written the way the front desk would.
const INPUTS = {
  approval: { ...common, kind: 'approval', recommend: 'Approve', what: 'Pull request #13 changes the wording on the sign-in page.', options: [says('Approve')], target: { pr: 13, sha: FULL } },
  confirm: { ...common, kind: 'confirm', recommend: 'Confirm', what: 'A rule you gave: money is shown in dollars.', options: [says('Confirm')], target: { event: RULING } },
  'lift-stop': { ...common, kind: 'lift-stop', recommend: 'Lift STOP', what: 'Every agent is stopped, and nothing moves until you say.', options: [says('Lift STOP')], target: {} },
  'ci-push': { ...common, kind: 'ci-push', recommend: 'Push it', what: 'A change to the automatic checks, on the ci-fix branch, is ready to go out.', options: [says('Push it')], target: { branch: 'ci-fix', sha: FULL } },
  runbook: { ...common, kind: 'runbook', recommend: 'Do it', what: 'The emergency steps say: put the product back to an earlier release.', options: [says('Do it')], target: { step: 3, sha: FULL } },
  'approve-work': { ...common, kind: 'approve-work', recommend: 'Approve', what: 'The plan for exporting a report as a spreadsheet file (export-csv).', options: [says('Approve')], target: { work: 'export-csv', lane: 'feature', hash: DOC } },
  answer: { ...common, kind: 'answer', recommend: 'Comma', what: 'The export needs to know which separator to use.', options: OWN, target: { questionId: 'q-export-csv-1' } },
  amend: { ...common, kind: 'amend', recommend: 'Change it', what: 'A change to the plan you approved for export-csv.', options: [says('Change it')], target: { work: 'export-csv', hash: DOC } },
  'lift-incident': { ...common, kind: 'lift-incident', recommend: 'End it', what: 'Incident bad-total, the wrong totals, has been corrected, so merging can start again.', options: [says('End it')], target: { incident: 'bad-total' } },
  'incident-fix': { ...common, kind: 'incident-fix', recommend: 'Merge the fix', what: 'Pull request #31 corrects the wrong totals in incident bad-total.', options: [says('Merge the fix')], target: { incident: 'bad-total', pr: 31 } },
  question: { ...common, kind: 'question', recommend: 'Comma', what: 'The export needs to know which separator to use.', options: OWN },
};
const cardOf = (kind) => composeCard(INPUTS[kind]).question;
const textOf = (kind) => cardOf(kind).question;

const call = (...questions) => ({
  cwd: '/x', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions },
});
const inProject = { projectOf: () => ({ project: 'owner__name' }) };
const reason = (out) => {
  assert.equal(out?.hookSpecificOutput?.permissionDecision, 'deny');
  return out.hookSpecificOutput.permissionDecisionReason;
};
// A composed approval card's text with one line swapped for another.
const without = (text, start) => text.split('\n').filter((l) => !l.startsWith(start)).join('\n');
const swap = (text, from, to) => text.replace(from, to);

test('a composed card passes', async () => {
  for (const kind of Object.keys(INPUTS)) {
    assert.deepEqual(cardProblems(textOf(kind)), [], kind);
    assert.equal(await decide(call(cardOf(kind)), inProject), undefined, kind);
  }
});

test('a level 4 card, with its checks line, passes', () => {
  const { question } = composeCard({ ...INPUTS.approval, level: 4, checks: 'The release checks stay on and run before it merges.' });
  assert.deepEqual(cardProblems(question.question), []);
});

test('every question of a call is checked, and the refusal names the one at fault', async () => {
  const good = cardOf('lift-stop');
  const bad = { ...cardOf('approval'), question: without(textOf('approval'), 'My recommendation:') };
  const text = reason(await decide(call(good, bad), inProject));
  assert.match(text, /Question 2/);
  assert.match(text, /My recommendation:/);
  assert.doesNotMatch(text, /Question 1/);
});

test('a card missing its recommendation is refused, naming the part', async () => {
  for (const kind of ['approval', 'question']) {
    const q = { ...cardOf(kind), question: without(textOf(kind), 'My recommendation:') };
    const text = reason(await decide(call(q), inProject));
    assert.match(text, /My recommendation:/, kind);
    assert.match(text, /Question 1/, kind);
  }
});

test('each of the five parts is needed, with words after its label', () => {
  for (const label of ['What this is:', "Why it's coming to you:", 'Options:', 'My recommendation:', 'While you decide:']) {
    const missing = cardProblems(without(textOf('question'), label));
    assert.equal(missing.length, 1, label);
    assert.match(missing[0], new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const empty = cardProblems(swap(textOf('question'), new RegExp(`^${label}.*$`, 'm'), label));
    assert.equal(empty.length, 1, `${label} with nothing after it`);
  }
});

test('a plain sentence with none of the parts is refused', async () => {
  const text = reason(await decide(call({ question: 'Which separator do you want?', header: 'Question', options: [], multiSelect: false }), inProject));
  assert.match(text, /What this is:/);
  assert.match(text, /While you decide:/);
});

test('a set line without its reply code, or with another card\'s code, is refused', async () => {
  const card = textOf('approval');
  const code = replyCodeLine(replyCode(setLineOf(card)));
  assert.ok(card.includes(code));
  const noCode = cardProblems(without(card, 'Reply code:'));
  assert.equal(noCode.length, 1);
  assert.match(noCode[0], /reply code/i);

  const other = replyCodeLine(replyCode(approvalLine(14, FULL)));
  assert.notEqual(other, code);
  const wrong = cardProblems(swap(card, code, other));
  assert.equal(wrong.length, 1);
  assert.match(wrong[0], /reply code/i);
  assert.match(wrong[0], new RegExp(replyCode(setLineOf(card))));

  const q = { ...cardOf('approval'), question: without(card, 'Reply code:') };
  assert.match(reason(await decide(call(q), inProject)), /Question 1/);
});

test('a second reply code line, even the right one, is refused', () => {
  const card = textOf('approval');
  const code = replyCodeLine(replyCode(setLineOf(card)));
  assert.equal(cardProblems(`${card}\n${code}`).length, 1);
});

test('two set lines in one question are refused', async () => {
  const card = textOf('approval');
  const twice = `${card}\n${approvalLine(14, FULL)}`;
  const problems = cardProblems(twice);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /one set line/);
  const q = { ...cardOf('approval'), question: twice };
  assert.match(reason(await decide(call(q), inProject)), /one set line/);
});

test('a first part naming pull request #12 over a set line for #13 is refused', async () => {
  const card = textOf('approval');
  const wrong = swap(card, 'Pull request #13', 'Pull request #12');
  const problems = cardProblems(wrong);
  assert.ok(problems.length >= 1);
  assert.match(problems.join('\n'), /#13/);
  const q = { ...cardOf('approval'), question: wrong };
  assert.match(reason(await decide(call(q), inProject)), /Question 1/);
  // Naming both, or neither, is refused too.
  assert.ok(cardProblems(swap(card, 'Pull request #13', 'Pull request #13 and #12')).length >= 1);
  assert.ok(cardProblems(swap(card, 'Pull request #13', 'A pull request')).length >= 1);
});

test('a first part naming a commit other than its set line\'s is refused', () => {
  const card = textOf('approval');
  const wrong = swap(card, 'changes the wording', 'at 0123456789ab changes the wording');
  assert.match(cardProblems(wrong).join('\n'), /commit/);
  // Naming the set line\'s own commit, short or in full, is fine.
  assert.deepEqual(cardProblems(swap(card, 'changes the wording', `at ${FULL.slice(0, 7)} changes the wording`)), []);
  assert.deepEqual(cardProblems(swap(card, 'changes the wording', `at ${FULL} changes the wording`)), []);
});

test('the first part must name what each kind\'s set line names', () => {
  const cases = {
    'incident-fix': ['incident bad-total', 'incident other-one'],
    'approve-work': ['(export-csv)', '(import-csv)'],
    amend: ['export-csv', 'import-csv'],
    'lift-incident': ['Incident bad-total', 'Incident other-one'],
    runbook: ['put the product back to an earlier release', 'cut the access'],
    'ci-push': ['ci-fix branch', 'main branch'],
    confirm: ['money is shown in dollars', 'money is shown in euros'],
  };
  for (const [kind, [right, wrong]] of Object.entries(cases)) {
    const card = textOf(kind);
    assert.ok(card.includes(right), `${kind} sample holds ${right}`);
    assert.deepEqual(cardProblems(card), [], kind);
    assert.ok(cardProblems(swap(card, right, wrong)).length >= 1, `${kind}: ${wrong}`);
  }
});

test('only the first part is held to the set line\'s subject', () => {
  const card = textOf('approval');
  const aside = swap(card, 'Nothing is released', 'Pull request #12 stays as it is, and nothing is released');
  assert.deepEqual(cardProblems(aside), []);
});

test('a first part that runs over several lines is read to its end', () => {
  const card = textOf('approval').replace('\nWhy it\'s coming to you:', '\nIt also touches pull request #12.\nWhy it\'s coming to you:');
  assert.ok(cardProblems(card).length >= 1);
});

test('a question with no set line needs only the five parts', () => {
  assert.deepEqual(cardProblems(textOf('question')), []);
  // Its words may mention a pull request: nothing there is a set line to match.
  assert.deepEqual(cardProblems(swap(textOf('question'), 'The export', 'Pull request #12 and the export')), []);
});

test('only an AskUserQuestion call in a Wheelhouse project is checked', async () => {
  const bad = { question: 'Which?', header: 'Question', options: [], multiSelect: false };
  assert.equal(await decide(call(bad), { projectOf: () => null }), undefined);
  assert.equal(await decide({ ...call(bad), tool_name: 'Bash' }, inProject), undefined);
  assert.ok(await decide(call(bad), inProject));
});

test('a hook failure lets the card through', async () => {
  const bad = { question: 'Which?', header: 'Question', options: [], multiSelect: false };
  // Input the check can't read: no questions, or questions that are not cards.
  assert.equal(await decide({ ...call(bad), tool_input: {} }, inProject), undefined);
  assert.equal(await decide({ ...call(bad), tool_input: { questions: 'x' } }, inProject), undefined);
  assert.equal(await decide(call(null, 5, {}), inProject), undefined);
  // A throw inside the check prints nothing: the hook runs without the fail-closed setting.
  const out = [];
  await hookMain(decide, { failClosed: false, event: 'PreToolUse' }, {
    stdin: Readable.from([JSON.stringify(call(bad))]),
    write: (text) => out.push(text),
    deps: { projectOf: () => { throw new Error('the project could not be read'); } },
    projectOf: () => null,
  });
  assert.deepEqual(out, []);
  // And as a process, input it cannot read prints nothing and exits 0.
  for (const input of ['not json', '[]']) {
    const result = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  }
});

test('hooks.json runs it on AskUserQuestion before the director sees the card, without the fail-closed setting', () => {
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const group = file.hooks.PreToolUse.find((g) => g.matcher === 'AskUserQuestion');
  assert.ok(group);
  assert.equal(group.hooks.length, 1);
  assert.match(group.hooks[0].command, /scripts\/hooks\/card-check\.js"$/);
  assert.equal(group.hooks[0].onFailure, undefined);
});

test('the refusal tells the front desk where a right card comes from', async () => {
  const q = { ...cardOf('approval'), question: without(textOf('approval'), 'Reply code:') };
  assert.match(reason(await decide(call(q), inProject)), /cli\.js card/);
});

