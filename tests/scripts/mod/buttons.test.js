// tests/scripts/mod/buttons.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardButtons, isSetupCard, CANT_ANSWER, SETUP_ANSWER } from '../../../scripts/mod/buttons.js';
import { composeCard, DECIDING } from '../../../scripts/cards/compose.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { approvalLine, replyCode, replyCodeLine, setLineOf } from '../../../scripts/state/card-lines.js';
import { unattendedCardData } from '../../../scripts/foreman/act.js';
import { settingKey, UNATTENDED_CARD } from '../../../scripts/protection/windows-builds.js';
import { withHome } from '../../helpers/homes.js';

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
  setup: { ...common, kind: 'setup', recommend: 'Go ahead', what: 'Setup step 1, checking this computer, changes nothing on it.', options: [says('Go ahead')], target: { step: 1, hash: DOC } },
  question: { ...common, kind: 'question', recommend: 'Comma', what: 'The export needs to know which separator to use.', options: OWN },
};
// The event data the state keeps for a composed card.
const dataOf = (kind) => composeCard(INPUTS[kind]).card;
const SET_LINE_KINDS = Object.keys(DECIDING);
// A setup card gets no button: its step goes ahead only by the director's click on the very card
// setup showed, which only the prompt record counts. Its note sends the director to the chat
// where setup asked it.
const NO_BUTTONS = { buttons: [], note: SETUP_ANSWER };

test('each kind of card gets its own buttons, and only the options it offers', () => {
  for (const kind of SET_LINE_KINDS) {
    const got = cardButtons(dataOf(kind));
    if (kind === 'setup') {
      assert.deepEqual(got, NO_BUTTONS, kind);
      continue;
    }
    assert.deepEqual(got, {
      buttons: [
        { label: DECIDING[kind], does: 'record' },
        { label: 'Not now', does: 'record' },
        { label: 'Explain more', does: 'turn' },
        { label: 'Show me', does: 'turn' },
      ],
      note: null,
    }, kind);
  }

  // Only what the card offers is a button.
  const approval = dataOf('approval');
  assert.deepEqual(cardButtons({ ...approval, options: ['Approve', 'Explain more'] }).buttons, [
    { label: 'Approve', does: 'record' },
    { label: 'Explain more', does: 'turn' },
  ]);
  assert.deepEqual(cardButtons({ ...approval, options: ['Approve', 'Not now'] }).buttons, [
    { label: 'Approve', does: 'record' },
    { label: 'Not now', does: 'record' },
  ]);

  // An answer card: each of the question's own options records the answer; Explain more turns.
  assert.deepEqual(cardButtons(dataOf('answer')), {
    buttons: [{ label: 'Comma', does: 'record' }, { label: 'Tab', does: 'record' }, { label: 'Explain more', does: 'turn' }],
    note: null,
  });
  const four = ['One', 'Two', 'Three', 'Four'].map((label) => ({ label, says: `${label} it.` }));
  const full = composeCard({ ...INPUTS.answer, recommend: 'One', options: four }).card;
  assert.deepEqual(cardButtons(full).buttons, four.map((o) => ({ label: o.label, does: 'record' })));

  // A question card has no set line: every option is a turn to the front desk.
  assert.deepEqual(cardButtons(dataOf('question')), {
    buttons: [{ label: 'Comma', does: 'turn' }, { label: 'Tab', does: 'turn' }, { label: 'Explain more', does: 'turn' }],
    note: null,
  });
});

test('the deciding label is the first of the card\'s options that a click can sign', () => {
  const approval = dataOf('approval');
  assert.deepEqual(cardButtons({ ...approval, options: ['Show me', 'Approve', 'Not now'] }).buttons, [
    { label: 'Approve', does: 'record' },
    { label: 'Not now', does: 'record' },
    { label: 'Show me', does: 'turn' },
  ]);
  // A card whose options hold no label a click can sign has no deciding button.
  assert.deepEqual(cardButtons({ ...approval, options: ['Go ahead', 'Not now'] }).buttons, [{ label: 'Not now', does: 'record' }]);
});

// A composed approval card with its set line for pull request 14, and the right reply code for
// that line, while its first part still names pull request 13.
function otherPullRequest() {
  const data = dataOf('approval');
  const wrongLine = approvalLine(14, FULL);
  const question = data.question
    .replace(setLineOf(data.question), wrongLine)
    .replace(/^Reply code:.*$/m, replyCodeLine(replyCode(wrongLine)));
  return { ...data, question };
}

test('a card with a set line for another pull request than its first part names gets Explain more only', () => {
  const data = otherPullRequest();
  assert.match(cardProblems(data.question).join(' '), /pull request #14/);
  assert.deepEqual(cardButtons(data), { buttons: [{ label: 'Explain more', does: 'turn' }], note: 'This card can\'t be answered here: ask the front desk about it.' });
  assert.equal(CANT_ANSWER, 'This card can\'t be answered here: ask the front desk about it.');
  // Without Explain more among its options, there is no button to give.
  assert.deepEqual(cardButtons({ ...data, options: ['Approve', 'Not now'] }), { buttons: [], note: CANT_ANSWER });
});

test('a card is judged by the card check\'s own tests, for every kind with a set line', () => {
  for (const kind of SET_LINE_KINDS) {
    const data = dataOf(kind);
    assert.deepEqual(cardProblems(data.question), [], kind);
    if (kind === 'setup') assert.deepEqual(cardButtons(data), NO_BUTTONS, kind);
    else assert.ok(cardButtons(data).buttons.some((b) => b.does === 'record'), kind);
    const lines = data.question.split('\n');
    const broken = [
      lines.filter((l) => !l.startsWith('My recommendation:')).join('\n'),
      lines.filter((l) => !l.startsWith('Reply code:')).join('\n'),
      `${data.question}\nReply code: ${replyCode('another line')}`,
      `${data.question}\n${data.line}`,
      data.question.replace(/^While you decide:.*$/m, 'While you decide:'),
    ];
    for (const question of broken) {
      assert.ok(cardProblems(question).length > 0, `${kind}: ${question}`);
      const got = cardButtons({ ...data, question });
      assert.equal(got.buttons.some((b) => b.does === 'record'), false, `${kind}: ${question}`);
      assert.deepEqual(got.buttons, kind === 'setup' ? [] : [{ label: 'Explain more', does: 'turn' }], kind);
      assert.equal(got.note, kind === 'setup' ? SETUP_ANSWER : CANT_ANSWER, kind);
    }
  }
});

test('a card whose kind and set line disagree, or that has no set line though its kind needs one, signs nothing', () => {
  const approval = dataOf('approval');
  const answer = dataOf('answer');
  for (const bad of [
    { ...approval, kind: 'answer' },
    { ...answer, kind: 'approval' },
    { ...approval, kind: 'question' },
    { ...approval, question: approval.question.split('\n').filter((l) => !/^(Approve pull request|Reply code)/.test(l)).join('\n') },
  ]) {
    const got = cardButtons(bad);
    assert.equal(got.buttons.some((b) => b.does === 'record'), false);
    assert.equal(got.note, CANT_ANSWER);
  }
});

test('junk gives no buttons and never throws', () => {
  for (const junk of [null, undefined, 5, 'text', [], {}, { question: 5, options: 'x' }, { kind: 'approval' }]) {
    const got = cardButtons(junk);
    assert.ok(Array.isArray(got.buttons), String(junk));
    assert.equal(got.buttons.some((b) => b.does === 'record'), false, String(junk));
  }
});

test('the Unattended card gets no button on the pane, with or without Use Guarded', () => {
  const computer = '0a1b2c3d';
  const [on, guarded] = withHome(() => [
    makeEvent({ kind: 'setting', data: { key: settingKey(computer), value: 'unattended', words: 'Run build commands unattended' }, now: () => NOW }),
    makeEvent({ kind: 'setting', data: { key: settingKey(computer), value: 'guarded', words: 'Run build commands guarded' }, now: () => NOW }),
  ]);
  const plain = unattendedCardData(UNATTENDED_CARD(), on.id, computer);
  const offered = unattendedCardData(UNATTENDED_CARD({ guardedReady: true }), on.id, computer, guarded);
  // Without Guarded it has no set line, so it would otherwise be a question whose options are turns.
  assert.equal(setLineOf(plain.question), null);
  assert.deepEqual(plain.options, ['Keep asking', 'Turn on (dangerous)']);
  assert.deepEqual(cardButtons(plain), { buttons: [], note: CANT_ANSWER });
  assert.deepEqual(offered.options, ['Keep asking', 'Turn on (dangerous)', 'Use Guarded']);
  assert.deepEqual(cardButtons(offered), { buttons: [], note: CANT_ANSWER });
  // Even offering Explain more, it gets nothing.
  assert.deepEqual(cardButtons({ ...plain, options: [...plain.options, 'Explain more'] }), { buttons: [], note: CANT_ANSWER });
});

test('a setup card gets no button on the pane, whatever it offers and whatever kind it claims', () => {
  const setup = dataOf('setup');
  assert.equal(isSetupCard(setup), true);
  // Its note says where to answer it: setup asks it in its own chat, not the front desk.
  assert.equal(SETUP_ANSWER, 'This card can\'t be answered here: answer it in the chat where setup asked it.');
  assert.notEqual(SETUP_ANSWER, CANT_ANSWER);
  assert.deepEqual(setup.options, ['Go ahead', 'Not now', 'Explain more', 'Show me']);
  assert.deepEqual(cardButtons(setup), NO_BUTTONS);
  // Offering only Go ahead, or only the turns, it still gets nothing.
  assert.deepEqual(cardButtons({ ...setup, options: ['Go ahead'] }), NO_BUTTONS);
  assert.deepEqual(cardButtons({ ...setup, options: ['Explain more', 'Show me'] }), NO_BUTTONS);
  // Its set line makes it a setup card under any kind, and a setup kind without the line too.
  for (const kind of ['approval', 'question', 'answer', undefined]) {
    assert.equal(isSetupCard({ ...setup, kind }), true, String(kind));
    assert.deepEqual(cardButtons({ ...setup, kind }), NO_BUTTONS, String(kind));
  }
  const approval = dataOf('approval');
  assert.equal(isSetupCard({ ...approval, kind: 'setup' }), true);
  assert.deepEqual(cardButtons({ ...approval, kind: 'setup' }), NO_BUTTONS);
  assert.equal(isSetupCard(approval), false);
  for (const junk of [null, undefined, 5, 'text', [], {}]) assert.equal(isSetupCard(junk), false, String(junk));
});
