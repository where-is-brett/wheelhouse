// tests/scripts/hooks/card-check.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide, decideRepeat, cardProblems, DECIDED_LEAD, PANE_LEAD } from '../../../scripts/hooks/card-check.js';
import { markPane, markHere, readOpen } from '../../../scripts/lib/session-files.js';
import { hookMain } from '../../../scripts/hooks/kit.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { baselineCard } from '../../../scripts/measures/baseline.js';
import { BASELINE_PHRASES } from '../../../scripts/lib/measures-clicks.js';
import { TO_KNOW_MORE, TO_CHANGE_IT } from '../../../scripts/lib/calm-words.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { approvalLine, replyCode, replyCodeLine, setLineOf, chatCopy, LIFT_STOP, LIFT_STOP_EARLIER } from '../../../scripts/state/card-lines.js';
import { withHome } from '../../helpers/homes.js';
import { asQuestion } from '../../../scripts/cards/visit.js';
import { answer } from '../../../adapters/claude-code/answers.js';

const HOOK = fileURLToPath(new URL('../../../scripts/hooks/card-check.js', import.meta.url));
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const DOC = 'fedcba9876543210'.repeat(4);
const NOW = new Date('2026-10-18T05:00:00.000Z');
// Made in a home of its own: an event names its computer, which is kept in the home, so made with
// none it would be kept in the real ~/.wheelhouse.
const RULING = withHome(() => makeEvent({ kind: 'ruling', data: { words: 'Money is shown in dollars' }, now: () => NOW }));

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
  'lift-stop': { ...common, kind: 'lift-stop', recommend: 'Lift All stop', what: 'Every agent is stopped, and nothing moves until you say.', options: [says('Lift All stop')], target: {} },
  'ci-push': { ...common, kind: 'ci-push', recommend: 'Push it', what: 'A change to the automatic checks, on the ci-fix branch, is ready to go out.', options: [says('Push it')], target: { branch: 'ci-fix', sha: FULL } },
  runbook: { ...common, kind: 'runbook', recommend: 'Do it', what: 'The emergency steps say: put the product back to an earlier release.', options: [says('Do it')], target: { step: 3, sha: FULL } },
  'approve-work': { ...common, kind: 'approve-work', recommend: 'Approve', what: 'The plan for exporting a report as a spreadsheet file (export-csv).', options: [says('Approve')], target: { work: 'export-csv', lane: 'feature', hash: DOC } },
  answer: { ...common, kind: 'answer', recommend: 'Comma', what: 'The export needs to know which separator to use.', options: OWN, target: { questionId: 'q-export-csv-1' } },
  amend: { ...common, kind: 'amend', recommend: 'Change it', what: 'A change to the plan you approved for export-csv.', options: [says('Change it')], target: { work: 'export-csv', hash: DOC } },
  'lift-incident': { ...common, kind: 'lift-incident', recommend: 'End it', what: 'Incident bad-total, the wrong totals, has been corrected, so merging can start again.', options: [says('End it')], target: { incident: 'bad-total' } },
  'incident-fix': { ...common, kind: 'incident-fix', recommend: 'Merge the fix', what: 'Pull request #31 corrects the wrong totals in incident bad-total.', options: [says('Merge the fix')], target: { incident: 'bad-total', pr: 31 } },
  setup: { ...common, kind: 'setup', recommend: 'Go ahead', what: 'Setup step 6, Changes to this computer: transcripts are kept 30 days.', options: [says('Go ahead')], target: { step: 6, hash: DOC } },
  'confirm-all': {
    ...common, kind: 'confirm-all', recommend: 'Confirm all', what: 'Setup step 5 found 2 rules: 1) "Money is shown in dollars"; 2) "Never push to main".',
    options: [says('Confirm all'), says('Let me correct some')], target: { count: 2, hash: DOC },
  },
  uninstall: {
    ...common, kind: 'uninstall', recommend: 'Remove it', level: 4, checks: 'The checks no longer guard this project.',
    what: 'Remove Wheelhouse from wh cafe menu: stop its jobs, put back 3 changes on this computer.', options: [says('Remove it')], target: { project: 'wh cafe menu', hash: DOC },
  },
  question: { ...common, kind: 'question', recommend: 'Comma', what: 'The export needs to know which separator to use.', options: OWN },
};
const cardOf = (kind) => composeCard(INPUTS[kind]).question;
const textOf = (kind) => cardOf(kind).question;

const call = (...questions) => ({
  cwd: '/x', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions },
});
const inProject = { projectOf: () => ({ project: 'owner__name' }), stop: () => ({ on: true }) };
const reason = (out) => {
  assert.equal(out?.hookSpecificOutput?.permissionDecision, 'deny');
  return out.hookSpecificOutput.permissionDecisionReason;
};
// A composed card's text with the lines starting so removed, or one line swapped for another.
const without = (text, start) => text.split('\n').filter((l) => !l.startsWith(start)).join('\n');
const swap = (text, from, to) => text.replace(from, to);
// The same text, as the question object AskUserQuestion takes it.
const asked = (kind, over = {}) => ({ ...cardOf(kind), ...over });

test('a composed card of every kind passes, as its text and as its question', async () => {
  for (const kind of Object.keys(INPUTS)) {
    assert.deepEqual(cardProblems(textOf(kind)), [], kind);
    assert.deepEqual(cardProblems(cardOf(kind)), [], `${kind}: with its options`);
    assert.equal(await decide(call(cardOf(kind)), inProject), undefined, kind);
  }
  // A card with four options of its own says a change is typed in place of "To know more, just ask."
  const four = ['A', 'B', 'C', 'D'].map((label) => ({ label, says: `${label} goes ahead.` }));
  const typed = composeCard({ ...INPUTS.answer, options: four, recommend: 'A' }).question;
  assert.ok(typed.question.includes(TO_CHANGE_IT) && !typed.question.includes(TO_KNOW_MORE));
  assert.deepEqual(cardProblems(typed), []);
});

test('the Lift All stop card is in the new words, and one made before in the STOP words still passes', () => {
  const { question } = composeCard(INPUTS['lift-stop']);
  assert.equal(setLineOf(question.question), LIFT_STOP);
  assert.equal(question.options[0].label, 'Lift All stop');
  // The same card as it was asked before the halt switch was called All stop: its set line, reply code and button.
  const earlier = {
    ...question,
    question: question.question.replace(`${LIFT_STOP}\n${replyCodeLine(replyCode(LIFT_STOP))}`, `${LIFT_STOP_EARLIER}\n${replyCodeLine(replyCode(LIFT_STOP_EARLIER))}`),
    options: question.options.map((o) => (o.label === 'Lift All stop' ? { ...o, label: 'Lift STOP' } : o)),
  };
  assert.equal(setLineOf(earlier.question), LIFT_STOP_EARLIER);
  assert.deepEqual(cardProblems(earlier.question), []);
  assert.deepEqual(cardProblems(earlier), []);
});

test('a level 4 card, with its checks line, passes', () => {
  const { question } = composeCard({ ...INPUTS.approval, level: 4, checks: 'The release checks stay on and run before it merges.' });
  assert.deepEqual(cardProblems(question.question), []);
  assert.deepEqual(cardProblems(question), []);
});

test('a card missing "To know more, just ask." is refused', async () => {
  for (const kind of ['approval', 'question', 'answer', 'setup']) {
    const lacking = without(textOf(kind), TO_KNOW_MORE);
    const problems = cardProblems(lacking);
    assert.equal(problems.length, 1, kind);
    assert.equal(problems[0], 'lacks its "To know more, just ask." line', kind);
    const text = reason(await decide(call(asked(kind, { question: lacking })), inProject));
    assert.match(text, /Question 1/, kind);
    assert.match(text, /To know more, just ask\./, kind);
  }
  // The line must close the plain lines: said earlier, with something after it, it doesn't count.
  const lines = textOf('question').split('\n');
  const moved = [lines.at(-1), ...lines.slice(0, -1)].join('\n');
  assert.equal(cardProblems(moved).length, 1);
  // An old card in labelled parts, or a plain sentence, is refused.
  assert.equal(cardProblems('What this is: x\nWhy it\'s coming to you: y\nOptions: z\nMy recommendation: z, because y.\nWhile you decide: w').length, 1);
  assert.equal(cardProblems('Which separator do you want?').length, 1);
  assert.equal(cardProblems('').length, 1);
});

test('a card with fewer than three plain lines before its last is refused', () => {
  // Ask, why and meanwhile are the three a question needs: its what is the ask. A card with a question of its own has four.
  const rows = textOf('question').split('\n');
  assert.equal(rows.length, 4);
  for (const drop of [0, 1, 2]) {
    const short = rows.filter((_, i) => i !== drop).join('\n');
    const problems = cardProblems(short);
    assert.equal(problems.length, 1, `without line ${drop}`);
    assert.match(problems[0], /has 2 plain lines before "To know more, just ask\.", and needs at least 3/);
  }
  assert.match(cardProblems(rows.slice(2).join('\n')).join(' '), /has 1 plain line before/);
  assert.match(cardProblems(TO_KNOW_MORE).join(' '), /has 0 plain lines before/);
  // A blank line is no line, and is refused as one.
  assert.deepEqual(cardProblems(`${rows[0]}\n\n${rows[1]}\n${rows[2]}\n${rows[3]}`), ['has an empty line, and every line before its set line holds words']);
  assert.equal(cardProblems(`\n${rows[0]}\n\n${rows[1]}\n${rows[3]}\n`).length, 2);
  // A card with a set line is held to the same count before its set line.
  const approval = textOf('approval').split('\n');
  assert.deepEqual(cardProblems(approval.filter((_, i) => i !== 2).join('\n')), [], 'a card with a question of its own has four, so three is enough');
  assert.equal(cardProblems(approval.filter((_, i) => i !== 2 && i !== 3).join('\n')).length, 1);
  assert.deepEqual(cardProblems(approval.join('\n')), []);
});

test('every question of a call is checked, and the refusal names the one at fault', async () => {
  const good = cardOf('lift-stop');
  const bad = asked('approval', { question: without(textOf('approval'), TO_KNOW_MORE) });
  const text = reason(await decide(call(good, bad), inProject));
  assert.match(text, /Question 2/);
  assert.match(text, /To know more, just ask\./);
  assert.doesNotMatch(text, /Question 1/);
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

  const q = asked('approval', { question: without(card, 'Reply code:') });
  assert.match(reason(await decide(call(q), inProject)), /Question 1/);
});

test('a line after the set line other than its reply code line is refused', async () => {
  const card = textOf('approval');
  const rows = card.split('\n');
  const at = rows.indexOf(setLineOf(card));
  const problem = 'has a line after its set line other than its reply code line';
  // Between the set line and the reply code, as "and pull request #43" would extend the line.
  const between = [...rows.slice(0, at + 1), 'and pull request #43', ...rows.slice(at + 1)].join('\n');
  assert.ok(cardProblems(between).includes(problem));
  // After the reply code.
  assert.ok(cardProblems(`${card}\nand pull request #43`).includes(problem));
  assert.ok(cardProblems(`${card}\n\nsome words`).includes(problem));
  const q = asked('approval', { question: between });
  assert.match(reason(await decide(call(q), inProject)), /has a line after its set line other than its reply code line/);
  // A card with no reply code takes nothing after its set line either.
  assert.ok(cardProblems(`${textOf('setup')}\nand step 7`).includes(problem));
  // A trailing line break is no line, and every composed card of every kind still passes.
  assert.deepEqual(cardProblems(`${card}\n`), []);
  for (const kind of Object.keys(INPUTS)) assert.deepEqual(cardProblems(cardOf(kind)), [], kind);
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
  const q = asked('approval', { question: twice });
  assert.match(reason(await decide(call(q), inProject)), /one set line/);
});

test('a card naming another pull request in any plain line is refused', async () => {
  const card = textOf('approval');
  // The question, what, why or meanwhile line, each in turn.
  for (const [from, to] of [
    ['Put pull request #13 live?', 'Put pull request #12 live?'],
    ['Pull request #13', 'Pull request #12'],
    ['It changes what users see', 'It follows pull request #12, which changes what users see'],
    ['Nothing is released', 'Pull request #12 stays as it is, and nothing is released'],
  ]) {
    const wrong = swap(card, from, to);
    assert.notEqual(wrong, card, from);
    const problems = cardProblems(wrong);
    assert.equal(problems.length, 1, from);
    assert.match(problems[0], /^has words that must name pull request #13, and no other/, from);
    assert.match(reason(await decide(call(asked('approval', { question: wrong })), inProject)), /Question 1/);
  }
  // Naming both, or neither, is refused too.
  assert.ok(cardProblems(swap(card, 'Pull request #13', 'Pull request #13 and #12')).length >= 1);
  const neither = card.split('\n').map((l) => l.replace(/#13/g, 'it')).join('\n');
  assert.ok(cardProblems(neither.replace(approvalLine(13, FULL), approvalLine(13, FULL))).length >= 1);
});

test('a card naming another commit in its question line is refused', () => {
  const card = textOf('approval');
  const wrong = swap(card, 'Put pull request #13 live?', 'Put pull request #13 live, at commit 0123456789ab?');
  assert.match(cardProblems(wrong).join('\n'), /^has words that names commit 0123456789ab/);
  // Naming the set line\'s own commit, short or in full, is fine.
  assert.deepEqual(cardProblems(swap(card, 'Put pull request #13 live?', `Put pull request #13 live, at ${FULL.slice(0, 7)}?`)), []);
  assert.deepEqual(cardProblems(swap(card, 'Put pull request #13 live?', `Put pull request #13 live, at ${FULL}?`)), []);
  // So is another commit in any other plain line.
  assert.match(cardProblems(swap(card, 'changes the wording', 'at 0123456789ab changes the wording')).join('\n'), /commit/);
});

test('the plain lines must name, between them, what each kind\'s set line names', () => {
  const cases = {
    'incident-fix': ['incident bad-total', 'incident other-one'],
    'approve-work': ['(export-csv)', '(import-csv)'],
    amend: ['export-csv', 'import-csv'],
    'lift-incident': ['Incident bad-total', 'Incident other-one'],
    runbook: ['put the product back to an earlier release', 'cut the access'],
    'ci-push': ['ci-fix branch', 'main branch'],
    confirm: ['money is shown in dollars', 'money is shown in euros'],
    setup: ['step 6,', 'step 16,'],
  };
  for (const [kind, [right, wrong]] of Object.entries(cases)) {
    const card = textOf(kind);
    assert.ok(card.includes(right), `${kind} sample holds ${right}`);
    assert.deepEqual(cardProblems(card), [], kind);
    // Wherever the plain lines say it, as the question line may too.
    const changed = card.replace(new RegExp(right.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), wrong);
    assert.ok(cardProblems(changed).length >= 1, `${kind}: ${wrong}`);
  }
});

test('words that name the set line\'s subject in any plain line are enough', () => {
  // The question line may be the one to name it, and the what line another thing.
  const card = textOf('approval');
  const moved = card.split('\n');
  moved[1] = moved[1].replace('Pull request #13', 'This');
  assert.deepEqual(cardProblems(moved.join('\n')), [], 'the question line names pull request #13');
});

test('a question with no set line needs only its plain lines', () => {
  assert.deepEqual(cardProblems(textOf('question')), []);
  // Its words may mention a pull request: nothing there is a set line to match.
  assert.deepEqual(cardProblems(swap(textOf('question'), 'The export', 'Pull request #12 and the export')), []);
});

test('a card with no option recommended, or two, is refused', async () => {
  const card = cardOf('approval');
  const plain = (o) => ({ ...o, description: o.description.replace(/^Recommended: /, '') });
  const none = { ...card, options: card.options.map(plain) };
  assert.deepEqual(cardProblems(none), ['names no recommended option']);
  const two = { ...card, options: card.options.map((o, i) => (i === 1 ? { ...o, description: `Recommended: ${o.description}` } : o)) };
  assert.deepEqual(cardProblems(two), ['names two recommended options']);
  const three = { ...card, options: card.options.map((o) => ({ ...o, description: `Recommended: ${plain(o).description}` })) };
  assert.deepEqual(cardProblems(three), ['names 4 recommended options']);
  assert.match(reason(await decide(call(none), inProject)), /Question 1 \("Approval"\) names no recommended option\./);
  assert.match(reason(await decide(call(two), inProject)), /names two recommended options/);
  // The text alone has no options to judge.
  assert.deepEqual(cardProblems(card.question), []);
});

test('a card offering Explain more is refused', async () => {
  const card = cardOf('approval');
  const offering = { ...card, options: [...card.options.slice(0, 3), { label: 'Explain more', description: 'I explain it in plainer words.' }] };
  assert.deepEqual(cardProblems(offering), ["offers Explain more, which is not one of a card's options"]);
  assert.match(reason(await decide(call(offering), inProject)), /offers Explain more/);
  // Options given as plain labels are read too.
  assert.deepEqual(cardProblems({ question: card.question, options: ['Explain more'] }), ['names no recommended option', "offers Explain more, which is not one of a card's options", 'offers 1 option, and a card offers 2 to 4']);
});

test('a card offering fewer than two options or more than four is refused', async () => {
  // AskUserQuestion shows such a question to no one, and whatever waits on it stalls.
  const card = cardOf('approval');
  const one = { ...card, options: card.options.filter((o) => o.description.startsWith('Recommended:')) };
  assert.deepEqual(cardProblems(one), ['offers 1 option, and a card offers 2 to 4']);
  assert.match(reason(await decide(call(one), inProject)), /offers 1 option, and a card offers 2 to 4/);
  assert.equal(card.options.length, 4);
  const five = { ...card, options: [...card.options, { label: 'Another', description: 'Something else.' }] };
  assert.deepEqual(cardProblems(five), ['offers 5 options, and a card offers 2 to 4']);
});

test('the reply-code rules hold as before', () => {
  const card = textOf('approval');
  assert.deepEqual(cardProblems(card), []);
  assert.match(cardProblems(without(card, 'Reply code:'))[0], /set line without its reply code line, "Reply code: [A-Z0-9]{4}"/);
  assert.match(cardProblems(`${card}\nReply code: AAAA`)[0], /carries the wrong reply code line/);
  assert.match(cardProblems(`${card}\n${card.split('\n').at(-1)}`)[0], /more than once/);
});

test('the baseline card is still judged as before', async () => {
  const figures = { usd: 4127.35, merges: 37, from: '2026-09-01', to: '2026-09-30', counted: 'Every merged pull request on the first version, counted by hand.' };
  const question = baselineCard(figures, DOC);
  assert.deepEqual(cardProblems(question), [], 'its words are in the form');
  // A card that was not the helper\'s own is refused in a project, whatever its form, as before.
  const text = reason(await decide(call(question), inProject));
  assert.match(text, /The director has not seen this card\. Question 1 reads as the baseline card but is not the card the helper composed/);
  // A card holding the baseline\'s words that is not the baseline card is refused by the composer.
  assert.throws(() => composeCard({ ...INPUTS.question, what: `${BASELINE_PHRASES.what}: US$100.00 for 4 merged pull requests.` }), /baseline card's words/);
  assert.throws(() => composeCard({ ...INPUTS.question, options: [{ label: 'Comma', says: `${BASELINE_PHRASES.record}.` }, OWN[1]] }), /baseline card's words/);
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
  const q = asked('approval', { question: without(textOf('approval'), 'Reply code:') });
  assert.match(reason(await decide(call(q), inProject)), /cli\.js card/);
});

test('the card check hook and cardProblems agree on every composed card', async () => {
  for (const kind of Object.keys(INPUTS)) {
    const card = cardOf(kind);
    const lines = card.question.split('\n');
    const variants = [
      card.question,
      lines.filter((l) => l !== TO_KNOW_MORE).join('\n'),
      lines.filter((l) => !l.startsWith('Reply code:')).join('\n'),
      `${card.question}\n${lines.at(-1)}`,
      lines.slice(1).join('\n'),
      card.question.replace(/#\d+/g, '#99'),
    ];
    for (const question of variants) {
      const problems = cardProblems(question);
      const out = await decide(call({ ...card, question }), inProject);
      if (problems.length === 0) {
        assert.equal(out, undefined, `${kind}: ${question}`);
      } else {
        const text = reason(out);
        for (const problem of problems) assert.ok(text.includes(`Question 1 ("${card.header}") ${problem}.`), `${kind}: ${problem}`);
      }
    }
  }
});

test('setup\'s card of the rules found needs no reply code, refuses one, and must name how many rules its line does', () => {
  const card = textOf('confirm-all');
  assert.deepEqual(cardProblems(card), []);
  const line = setLineOf(card);
  assert.match(cardProblems(`${card}\n${replyCodeLine(replyCode(line))}`).join(' '), /reply code line, and a confirm-all card has none/);
  assert.match(cardProblems(card.replace('found 2 rules', 'found 3 rules')).join(' '), /how many rules it lists, 2/);
});

test('uninstall\'s card needs no reply code, refuses one, and must name the project its line names (ruling R90)', () => {
  const card = textOf('uninstall');
  assert.deepEqual(cardProblems(card), []);
  const line = setLineOf(card);
  assert.equal(line, 'Remove Wheelhouse from wh cafe menu as listed, fedcba987654');
  assert.match(cardProblems(`${card}\n${replyCodeLine(replyCode(line))}`).join(' '), /reply code line, and an uninstall card has none/);
  assert.match(cardProblems(card.replace('from wh cafe menu:', 'from another folder:')).join(' '), /must name the project wh cafe menu/);
  assert.match(cardProblems(card.replace('stop its jobs', 'stop its jobs at abcdef123456')).join(' '), /names commit abcdef123456/);
});

// --- One card, one answer: the two denies (decided card, live pane) ---

const SID = 'sess-one';
const T0 = Date.UTC(2026, 10, 4, 0, 0, 0);
const at = (ms) => new Date(T0 + ms);
const question = (what, extra = {}) => composeCard({ ...INPUTS.question, what, ...extra });
const outcome = (id, made, decided = null) => ({ card: { id, data: made.card }, decided });
const quick = { projectOf: () => ({ project: 'owner__name' }), now: () => at(0) };
const withSession = (q, over = {}) => ({ ...call(...q), session_id: SID, ...over });
const whenLocal = new Date(2026, 10, 4, 10, 34, 0).toISOString();
const later = () => new Date(2026, 10, 4, 11, 0, 0);

const separator = question('The export needs to know which separator to use.');
const colour = question('The report needs a colour scheme.', { recommend: 'Blue', options: [{ label: 'Blue', says: 'Blue is used.' }, { label: 'Green', says: 'Green is used.' }] });
const SEPARATOR = outcome('c-1', separator);
const COLOUR = outcome('c-2', colour);
const PLAIN = question('Which folder should the report go in?', { recommend: 'Shared', options: [{ label: 'Shared', says: 'Goes in the shared folder.' }, { label: 'Private', says: 'Goes in your folder.' }] }).question;

const live = () => markPane(SID, { at: T0, drawn: T0, surface: 'desktop' });
const run = (input, over = {}) => decide(input, { ...quick, role: () => 'front-desk', ...over });

test('a decided card is refused, naming what counted and where', () => withHome(async () => {
  const decided = outcome('c-1', separator, { at: whenLocal, label: 'Comma', where: 'panel' });
  const out = reason(await run(withSession([separator.question]), { outcomes: () => [decided], now: later }));
  assert.ok(out.startsWith(DECIDED_LEAD));
  assert.ok(out.includes('answered Comma in the panel at 10:34'), out);
  assert.ok(out.includes('The export needs to know which separator to use.'));
  assert.ok(!out.includes('c-1'));
}));

test('the repeat check alone refuses a decided card, with no form or pane check', () => withHome(async () => {
  const decided = outcome('c-1', separator, { at: whenLocal, label: 'Comma', where: 'panel' });
  const input = withSession([{ question: separator.question.question }]);
  live();
  const out = reason(await decideRepeat(input, { ...quick, outcomes: () => [decided], now: later }));
  assert.ok(out.startsWith(DECIDED_LEAD));
  assert.ok(out.includes('answered Comma in the panel at 10:34'), out);
  // A waiting card, a card of a wrong form and a live pane do not refuse it.
  assert.equal(await decideRepeat(input, { ...quick, outcomes: () => [SEPARATOR] }), undefined);
  assert.equal(await decideRepeat({ ...input, tool_input: { questions: [{ question: 'bare' }] } }, { ...quick, outcomes: () => [decided] }), undefined);
}));

test('a mixed call names the decided card and asks only the waiting one', () => withHome(async () => {
  const decided = outcome('c-1', separator, { at: whenLocal, label: 'Comma', where: 'chat' });
  const out = reason(await run(withSession([separator.question, colour.question]), { outcomes: () => [decided, COLOUR], now: later }));
  assert.ok(out.includes('The export needs to know which separator to use.'));
  assert.ok(!out.includes('colour scheme'));
  assert.match(out, /again <n>/);
}));

test('a question matching no card passes', () => withHome(async () => {
  assert.equal(await run(withSession([colour.question]), { outcomes: () => [SEPARATOR] }), undefined);
}));

test('a live pane holds back a card with buttons', () => withHome(async () => {
  live();
  const out = reason(await run(withSession([separator.question]), { outcomes: () => [SEPARATOR] }));
  assert.ok(out.startsWith(PANE_LEAD));
  assert.match(out, /1 card waits in the panel/);
  assert.ok(!out.includes('separator') && !out.includes('c-1'));
}));

test('a live pane with other questions in the call says to ask only the others', () => withHome(async () => {
  live();
  const out = reason(await run(withSession([separator.question, colour.question, PLAIN]), { outcomes: () => [SEPARATOR, COLOUR] }));
  assert.match(out, /2 cards wait in the panel/);
  assert.match(out, /Ask only the others\./);
}));

test('a stale pane lets it through, and open.json holds the ids', () => withHome(async () => {
  markPane(SID, { at: T0 - 46000, drawn: T0 - 46000, surface: 'desktop' });
  assert.equal(await run(withSession([separator.question]), { outcomes: () => [SEPARATOR] }), undefined);
  assert.deepEqual(readOpen(SID).cards, ['c-1']);
}));

test('a setup card goes through with a live pane', () => withHome(async () => {
  live();
  const setup = composeCard(INPUTS.setup);
  assert.equal(await run(withSession([setup.question]), { outcomes: () => [outcome('c-3', setup)] }), undefined);
}));

test('a plain question with no card goes through with a live pane', () => withHome(async () => {
  live();
  assert.equal(await run(withSession([PLAIN]), { outcomes: () => [SEPARATOR] }), undefined);
}));

test('a feature session\'s card goes through with a live pane', () => withHome(async () => {
  live();
  assert.equal(await run(withSession([separator.question]), { outcomes: () => [SEPARATOR], role: () => 'feature' }), undefined);
}));

test('here lets them through once, and the second call at once is denied', () => withHome(async () => {
  live();
  markHere(SID, ['c-1'], T0);
  assert.equal(await run(withSession([separator.question]), { outcomes: () => [SEPARATOR] }), undefined);
  assert.ok(reason(await run(withSession([separator.question]), { outcomes: () => [SEPARATOR] })).startsWith(PANE_LEAD));
}));

test('HOLD_FOR_PANE off lets cards through', () => withHome(async () => {
  live();
  assert.equal(await run(withSession([separator.question]), { outcomes: () => [SEPARATOR], holdForPane: false }), undefined);
}));

test('a state that cannot be read lets the call through', () => withHome(async () => {
  live();
  const broken = () => { throw new Error('unreadable'); };
  assert.equal(await run(withSession([separator.question]), { outcomes: broken }), undefined);
}));

test('a card with a form fault is still refused when no card matches', () => withHome(async () => {
  const bad = { ...separator.question, question: 'Short' };
  assert.match(reason(await run(withSession([bad]), { outcomes: () => [] })), /not in the form/);
}));

// --- The Lift All stop question: refused when STOP is off, held for a live pane ---

const LIFT = cardOf('lift-stop');
const STOP_ON = () => ({ on: true });
const STOP_OFF = () => ({ on: false });

test('a Lift All stop question is refused when STOP is already off', () => withHome(async () => {
  const out = reason(await run(withSession([LIFT]), { outcomes: () => [], stop: STOP_OFF }));
  assert.match(out, /All stop is already lifted/);
  assert.match(out, /one plain line/);
  // The earlier wording of the same card is read the same way.
  const earlier = { ...LIFT, question: LIFT.question.replace(LIFT_STOP, LIFT_STOP_EARLIER) };
  assert.match(reason(await run(withSession([earlier]), { outcomes: () => [], stop: STOP_OFF })), /already lifted/);
  // It is refused with a live pane too, and says to ask only the others when others are in the call.
  live();
  assert.match(reason(await run(withSession([LIFT, colour.question]), { outcomes: () => [COLOUR], stop: STOP_OFF })), /Ask only the others\./);
}));

test('a Lift All stop question goes through while STOP is on and no pane is live', () => withHome(async () => {
  assert.equal(await run(withSession([LIFT]), { outcomes: () => [], stop: STOP_ON }), undefined);
}));

test('a Lift All stop question asked without its last two lines gets them back while STOP is on', () => withHome(async () => {
  const lines = LIFT.question.split('\n');
  const bare = { ...LIFT, question: lines.slice(0, -2).join('\n') };
  assert.ok(!bare.question.includes(LIFT_STOP));
  const out = await run(withSession([bare]), { outcomes: () => [], stop: STOP_ON });
  assert.equal(swapped(out)[0].question, LIFT.question);
  // While STOP is off nothing is added: the copy signs nothing either way.
  const off = await run(withSession([bare]), { outcomes: () => [], stop: STOP_OFF });
  assert.ok(off === undefined || !JSON.stringify(off).includes(LIFT_STOP));
  // A question without the Lift All stop option is left as it is.
  assert.equal(await run(withSession([PLAIN]), { outcomes: () => [], stop: STOP_ON }), undefined);
}));

test('a live pane holds back the Lift All stop question, and here lets it through once', () => withHome(async () => {
  live();
  const out = reason(await run(withSession([LIFT]), { outcomes: () => [], stop: STOP_ON }));
  assert.ok(out.startsWith(PANE_LEAD));
  assert.match(out, /1 card waits in the panel/);
  assert.ok(!out.includes('Lift All stop'));
  markHere(SID, ['lift-stop'], T0);
  assert.equal(await run(withSession([LIFT]), { outcomes: () => [], stop: STOP_ON }), undefined);
  assert.ok(reason(await run(withSession([LIFT]), { outcomes: () => [], stop: STOP_ON })).startsWith(PANE_LEAD));
}));

test('a held Lift All stop question counts beside a held card and names the others', () => withHome(async () => {
  live();
  const out = reason(await run(withSession([LIFT, separator.question, PLAIN]), { outcomes: () => [SEPARATOR], stop: STOP_ON }));
  assert.match(out, /2 cards wait in the panel/);
  assert.match(out, /Ask only the others\./);
}));

test('the Lift All stop question is not held for a feature session or with HOLD_FOR_PANE off', () => withHome(async () => {
  live();
  assert.equal(await run(withSession([LIFT]), { outcomes: () => [], stop: STOP_ON, role: () => 'feature' }), undefined);
  assert.equal(await run(withSession([LIFT]), { outcomes: () => [], stop: STOP_ON, holdForPane: false }), undefined);
}));

test('the mark for every card (the update\'s --here) lets a held card through once, and expires', () => withHome(async () => {
  live();
  markHere(SID, ['*'], T0);
  assert.equal(await run(withSession([separator.question]), { outcomes: () => [SEPARATOR] }), undefined);
  assert.ok(reason(await run(withSession([separator.question]), { outcomes: () => [SEPARATOR] })).startsWith(PANE_LEAD), 'taken once');
  markHere(SID, ['*'], T0 - 121000);
  assert.ok(reason(await run(withSession([separator.question]), { outcomes: () => [SEPARATOR] })).startsWith(PANE_LEAD), 'expired');
}));

// --- A pending card is asked exactly as `cards` printed it ---

const FOUR = [
  { label: 'Approve', says: 'It goes ahead.' },
  { label: 'Not yet', says: 'It waits.' },
  { label: 'Drop it', says: 'It is dropped.' },
];
const four = composeCard({ ...INPUTS.question, what: 'The report needs a footer.', recommend: 'Approve', options: FOUR });
const FOUR_WAITING = outcome('c-4', four);
const exactly = (q) => ({ ...q, options: q.options.map((o) => ({ ...o })) });
const PRINTED = asQuestion({ data: four.card });
const swapped = (out) => out.hookSpecificOutput.updatedInput.questions;
const isSwap = (out, questions) => {
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined);
  assert.deepEqual(swapped(out), questions);
};
const waitingRun = (questions, over = {}) => run(withSession(questions), { outcomes: () => [FOUR_WAITING], holdForPane: false, ...over });

test('a waiting card asked exactly as printed passes', () => withHome(async () => {
  assert.equal(await run(withSession([exactly(four.question)]), { outcomes: () => [FOUR_WAITING], holdForPane: false }), undefined);
}));

test('a waiting card with an option left out is swapped for the stored card', () => withHome(async () => {
  const trimmed = { ...four.question, options: four.question.options.slice(0, 3) };
  isSwap(await waitingRun([trimmed]), [PRINTED]);
}));

test('a waiting card with its options reordered is swapped for the stored card', () => withHome(async () => {
  const [a, b, ...rest] = four.question.options;
  const swapped3 = { ...four.question, options: [b, a, ...rest] };
  isSwap(await waitingRun([swapped3]), [PRINTED]);
}));

test('a waiting card with a changed label or header is swapped for the stored card', () => withHome(async () => {
  const relabelled = { ...four.question, options: four.question.options.map((o, i) => (i === 1 ? { ...o, label: 'Later' } : o)) };
  isSwap(await waitingRun([relabelled]), [PRINTED]);
  const reheaded = { ...four.question, header: 'Other' };
  isSwap(await waitingRun([reheaded]), [PRINTED]);
}));

test('a question matching no card is not held to a card\'s options', () => withHome(async () => {
  assert.equal(await run(withSession([colour.question]), { outcomes: () => [FOUR_WAITING], holdForPane: false }), undefined);
}));

const reworded = { ...four.question, question: 'Shall we add a footer to the report?' };
// Another first line over the same rest of the card, so the question is still in the form cards take.
const REST = four.question.question.split('\n').slice(1).join('\n');
const rewordedWell = { ...four.question, question: `Shall we add a footer to the report?\n${REST}` };

test('a waiting card with its question reworded but its labels kept is swapped for the stored card', () => withHome(async () => {
  isSwap(await waitingRun([reworded]), [PRINTED]);
}));

test('a reworded question with the card\'s header and one label is swapped; a decided card is not matched', () => withHome(async () => {
  const headed = { ...colour.question, header: four.question.header, options: [four.question.options[0], { label: 'Else', description: 'x' }] };
  isSwap(await waitingRun([headed]), [PRINTED]);
  const decidedFour = outcome('c-4', four, { at: whenLocal, label: 'Approve', where: 'chat' });
  const out = reason(await run(withSession([{ ...four.question, question: 'Other words' }]), { outcomes: () => [decidedFour], now: later, holdForPane: false }).then((o) => o ?? { hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'none' } }));
  assert.ok(!/reworded/.test(out));
}));

test('a plain question sharing neither header nor two labels still passes with a card waiting', () => withHome(async () => {
  const plain = { ...PLAIN, options: [...PLAIN.options.slice(0, 1), { label: 'Elsewhere', description: 'x' }] };
  assert.equal(await run(withSession([plain]), { outcomes: () => [FOUR_WAITING], holdForPane: false }), undefined);
}));

test('answer.update wraps a tool input and sets no decision', () => withHome(async () => {
  assert.deepEqual(answer.update({ questions: [] }), { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { questions: [] } } });
}));

test('the stored card is what cards prints', () => withHome(async () => {
  assert.deepEqual(PRINTED, four.question);
}));

test('a "(Recommended)" label with a trimmed description is swapped', () => withHome(async () => {
  const options = four.question.options.map((o, i) => (i === 0 ? { label: 'Approve (Recommended)', description: 'It goes.' } : o));
  isSwap(await waitingRun([{ ...four.question, options }]), [PRINTED]);
}));

test('only a description that differs is swapped; identical descriptions are not', () => withHome(async () => {
  const options = four.question.options.map((o, i) => (i === 1 ? { ...o, description: 'x' } : { ...o }));
  isSwap(await waitingRun([{ ...four.question, options }]), [PRINTED]);
  assert.equal(await waitingRun([exactly(four.question)]), undefined);
}));

test('a card with a set line is found by that line when every other word is changed', () => withHome(async () => {
  const setup = composeCard(INPUTS.setup);
  const asked3 = { ...setup.question, question: `Go ahead?\n${setLineOf(setup.question.question)}` };
  isSwap(await run(withSession([asked3]), { outcomes: () => [outcome('c-3', setup)], holdForPane: false }), [asQuestion({ data: setup.card })]);
}));

test('a card is found by its first question line when the rest is cut', () => withHome(async () => {
  const cut = {
    ...four.question,
    question: four.question.question.split('\n').slice(0, 2).join('\n'),
    options: [{ label: 'Yes', description: 'x' }, { label: 'No', description: 'y' }],
  };
  isSwap(await waitingRun([cut]), [PRINTED]);
  // A first line two waiting cards share picks neither; the question is in the form cards take, so it is let be.
  const lines = four.question.question.split('\n');
  const withSecond = (words) => ({ ...four.card, question: [lines[0], `${lines[1]} ${words}`, ...lines.slice(2)].join('\n') });
  const twoCards = [outcome('c-7', { card: withSecond('One.') }), outcome('c-8', { card: withSecond('Two.') })];
  const alike = { ...cut, question: withSecond('Three.').question, options: [{ label: 'Yes', description: 'Recommended: x' }, { label: 'No', description: 'y' }] };
  assert.equal(await waitingRun([alike], { outcomes: () => twoCards }), undefined);
}));

test('mixed call', () => withHome(async () => {
  const input = withSession([reworded, colour.question, PLAIN]);
  input.tool_input.metadata = { source: 'x' };
  const out = await run(input, { outcomes: () => [FOUR_WAITING], holdForPane: false });
  assert.equal(swapped(out).length, 3);
  assert.deepEqual(swapped(out)[0], PRINTED);
  assert.deepEqual(swapped(out)[1], colour.question);
  assert.deepEqual(swapped(out)[2], PLAIN);
  assert.deepEqual(out.hookSpecificOutput.updatedInput.metadata, { source: 'x' });
}));

test('twice', () => withHome(async () => {
  isSwap(await waitingRun([exactly(four.question), reworded]), [PRINTED]);
  isSwap(await waitingRun([reworded, reworded]), [PRINTED]);
}));

test('a swapped card\'s form faults are moot', () => withHome(async () => {
  isSwap(await waitingRun([{ ...four.question, question: 'Short' }]), [PRINTED]);
  assert.match(reason(await waitingRun([reworded, { ...separator.question, question: 'Short' }])), /not in the form/);
}));

test('decided beside reworded', () => withHome(async () => {
  const decidedSep = outcome('c-1', separator, { at: whenLocal, label: 'Comma', where: 'chat' });
  const out = await run(withSession([separator.question, reworded]), { outcomes: () => [decidedSep, FOUR_WAITING], now: later, holdForPane: false });
  assert.ok(reason(out).startsWith(DECIDED_LEAD));
  assert.equal(out.hookSpecificOutput.updatedInput, undefined);
  const decidedFour = outcome('c-4', four, { at: whenLocal, label: 'Approve', where: 'chat' });
  // The other waiting card shares one label with the asked question (and not its header), the nearest a card comes to matching without being it.
  const other = { ...four.question, question: `Other words\n${REST}`, header: 'Other', options: [{ label: 'Comma', description: 'Recommended: y' }, { label: 'z', description: 'w' }] };
  assert.equal(await run(withSession([other]), { outcomes: () => [decidedFour, SEPARATOR], now: later, holdForPane: false }), undefined);
}));

test('a fault is numbered as the call numbers the question, after a duplicate is dropped', () => withHome(async () => {
  const out = await waitingRun([exactly(four.question), reworded, { ...separator.question, question: 'Short' }]);
  assert.match(reason(out), /Question 3 /);
  assert.ok(!/Question 2 /.test(reason(out)));
}));

test('chat copy', () => withHome(async () => {
  const approval = composeCard(INPUTS.approval);
  const outcomes = () => [outcome('c-6', approval)];
  const copy = { ...approval.question, question: chatCopy(approval.question.question) };
  assert.equal(await run(withSession([copy]), { outcomes, holdForPane: false }), undefined);
  const cut = { ...copy, options: copy.options.map((o) => ({ ...o, description: 'Go.' })) };
  const out = await run(withSession([cut]), { outcomes, holdForPane: false });
  isSwap(out, [asQuestion({ data: approval.card })]);
  assert.equal(swapped(out)[0].question, approval.question.question);
}));

test('pane', () => withHome(async () => {
  live();
  assert.ok(reason(await run(withSession([reworded]), { outcomes: () => [FOUR_WAITING] })).startsWith(PANE_LEAD));
  markPane(SID, { at: T0 - 46000, drawn: T0 - 46000, surface: 'desktop' });
  isSwap(await waitingRun([reworded]), [PRINTED]);
  assert.deepEqual(readOpen(SID).cards, ['c-4']);
}));

test('state that cannot be read lets a reworded card through', () => withHome(async () => {
  const broken = () => { throw new Error('unreadable'); };
  assert.equal(await waitingRun([rewordedWell], { outcomes: broken }), undefined);
}));

test('the hook writes the swap as one JSON line', () => withHome(async () => {
  const out = [];
  await hookMain(decide, { failClosed: false, event: 'PreToolUse' }, {
    stdin: Readable.from([JSON.stringify(withSession([reworded]))]),
    write: (text) => out.push(text),
    deps: { ...quick, role: () => 'feature', outcomes: () => [FOUR_WAITING], holdForPane: false },
    projectOf: () => null,
  });
  assert.equal(out.length, 1);
  const parsed = JSON.parse(out[0]);
  assert.deepEqual(parsed.hookSpecificOutput.updatedInput.questions, [PRINTED]);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, undefined);
}));
