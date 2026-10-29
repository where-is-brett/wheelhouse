// tests/scripts/mod/buttons.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardButtons, isSetupCard, isTrustCard, isUninstallCard, CANT_ANSWER, SETUP_ANSWER, TRUST_ANSWER, UNINSTALL_ANSWER } from '../../../scripts/mod/buttons.js';
import { composeCard, DECIDING, textOf } from '../../../scripts/cards/compose.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';
import { TO_KNOW_MORE } from '../../../scripts/lib/calm-words.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { approvalLine, replyCode, replyCodeLine, setLineOf, trustLine, takeOverLine, uninstallLine } from '../../../scripts/state/card-lines.js';
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
  'lift-stop': { ...common, kind: 'lift-stop', recommend: 'Lift All stop', what: 'Every agent is stopped, and nothing moves until you say.', options: [says('Lift All stop')], target: {} },
  'ci-push': { ...common, kind: 'ci-push', recommend: 'Push it', what: 'A change to the automatic checks, on the ci-fix branch, is ready to go out.', options: [says('Push it')], target: { branch: 'ci-fix', sha: FULL } },
  runbook: { ...common, kind: 'runbook', recommend: 'Do it', what: 'The emergency steps say: put the product back to an earlier release.', options: [says('Do it')], target: { step: 3, sha: FULL } },
  'approve-work': { ...common, kind: 'approve-work', recommend: 'Approve', what: 'The plan for exporting a report as a spreadsheet file (export-csv).', options: [says('Approve')], target: { work: 'export-csv', lane: 'feature', hash: DOC } },
  answer: { ...common, kind: 'answer', recommend: 'Comma', what: 'The export needs to know which separator to use.', options: OWN, target: { questionId: 'q-export-csv-1' } },
  amend: { ...common, kind: 'amend', recommend: 'Change it', what: 'A change to the plan you approved for export-csv.', options: [says('Change it')], target: { work: 'export-csv', hash: DOC } },
  'lift-incident': { ...common, kind: 'lift-incident', recommend: 'End it', what: 'Incident bad-total, the wrong totals, has been corrected, so merging can start again.', options: [says('End it')], target: { incident: 'bad-total' } },
  'incident-fix': { ...common, kind: 'incident-fix', recommend: 'Merge the fix', what: 'Pull request #31 corrects the wrong totals in incident bad-total.', options: [says('Merge the fix')], target: { incident: 'bad-total', pr: 31 } },
  setup: { ...common, kind: 'setup', recommend: 'Go ahead', what: 'Setup step 1, checking this computer, changes nothing on it.', options: [says('Go ahead')], target: { step: 1, hash: DOC } },
  'confirm-all': {
    ...common, kind: 'confirm-all', recommend: 'Confirm all', what: 'Setup step 5 found 2 rules: 1) "Money is shown in dollars"; 2) "Never push to main".',
    options: [says('Confirm all'), says('Let me correct some')], target: { count: 2, hash: DOC },
  },
  baseline: { ...common, kind: 'baseline', recommend: 'Record these', what: 'The first version\'s figures from your note: US$100.00 for 4 merged pull requests.', options: [says('Record these')], target: { hash: DOC } },
  trust: {
    ...common, kind: 'trust', recommend: 'Trust it', what: 'Your computer 0a1b2c3d put its key in your profile.',
    options: [says('Trust it')], target: { computer: '0a1b2c3d', at: '2026-10-19T22:30:00.000Z', fingerprint: 'abcdef012345' },
  },
  'take-over': {
    ...common, kind: 'take-over', recommend: 'Take over here', what: 'Your computer 0a1b2c3d has the front desk.',
    options: [says('Take over here'), { label: 'Leave it there', says: 'This computer only shows the board.' }], target: { holder: '0a1b2c3d', counter: 4 },
  },
  uninstall: {
    ...common, kind: 'uninstall', recommend: 'Remove it', level: 4, checks: 'The checks no longer guard this project.',
    what: 'Remove Wheelhouse from cafe menu: stop its jobs, put back 3 changes on this computer.', options: [says('Remove it')], target: { project: 'cafe menu', hash: DOC },
  },
  pair: {
    ...common, kind: 'pair', recommend: 'Pair it',
    what: 'The app phone-app asks to read Wheelhouse and decide through it, with its key abcdef012345.', options: [says('Pair it')], target: { client: 'phone-app', fingerprint: 'abcdef012345' },
  },
  question: { ...common, kind: 'question', recommend: 'Comma', what: 'The export needs to know which separator to use.', options: OWN },
  'keep-control-files': {
    ...common, kind: 'keep-control-files', recommend: 'Confirm', what: 'The export-csv feature\'s folder has a new or changed file that steers agents.',
    options: [says('Confirm')], target: { work: 'export-csv', hash: DOC },
  },
};
// The event data the state keeps for a composed card.
const dataOf = (kind) => composeCard(INPUTS[kind]).card;
const SET_LINE_KINDS = Object.keys(DECIDING);
// A setup card, and setup's card of the rules found, get no button: the step goes ahead only by the
// director's click on the very card setup showed, which only the prompt record counts. Its note
// sends the director to the chat where setup asked it. Nor does the baseline card, for that
// reason; its note is the plain one. Nor does a trust card (ruling R80): another computer is trusted
// only by the click on the card itself, in the chat where it was asked. Nor does uninstall's card
// (ruling R90), for the same reason.
const SETUP_KINDS = ['setup', 'confirm-all'];
const NO_BUTTON_KINDS = [...SETUP_KINDS, 'baseline', 'trust', 'take-over', 'pair', 'uninstall'];
const NO_BUTTONS = { buttons: [], note: SETUP_ANSWER };
const noButtonsFor = (kind) => {
  if (SETUP_KINDS.includes(kind)) return NO_BUTTONS;
  return { buttons: [], note: { trust: TRUST_ANSWER, 'take-over': TRUST_ANSWER, pair: TRUST_ANSWER, uninstall: UNINSTALL_ANSWER }[kind] ?? CANT_ANSWER };
};

const FILLED = (label) => ({ label, does: 'record', shape: 'filled' });
const SUGGEST_BUTTON = { label: 'Suggest a change…', does: 'suggest', shape: 'outlined' };
const NOT_NOW_BUTTON = { label: 'Not now', does: 'record', shape: 'small', corner: true };
const WHY_BUTTON = { label: 'Why?', does: 'why', shape: 'small' };
const SHOW_ME_BUTTON = { label: 'Show me', does: 'turn', shape: 'small' };
// What a card that fails the check gets: the front desk is asked.
const FAILED_WHY = { label: 'Why?', does: 'turn', shape: 'small' };

test('a card that decides something gets its deciding answer filled, Suggest a change… outlined, Not now small in the corner, Why? small and Show me', () => {
  for (const kind of SET_LINE_KINDS) {
    const got = cardButtons(dataOf(kind));
    if (NO_BUTTON_KINDS.includes(kind)) {
      assert.deepEqual(got, noButtonsFor(kind), kind);
      continue;
    }
    // STOP is lifted or it isn't, and files are kept as they are or they aren't, so those cards offer no Suggest a change….
    assert.deepEqual(got, {
      buttons: [
        FILLED(DECIDING[kind]),
        ...(['lift-stop', 'keep-control-files'].includes(kind) ? [] : [SUGGEST_BUTTON]),
        NOT_NOW_BUTTON,
        WHY_BUTTON,
        SHOW_ME_BUTTON,
      ],
      note: null,
    }, kind);
  }

  // Only what the card offers is a button; Why? is always there.
  const approval = dataOf('approval');
  assert.deepEqual(cardButtons({ ...approval, options: ['Approve', 'Show me'] }).buttons, [FILLED('Approve'), WHY_BUTTON, SHOW_ME_BUTTON]);
  assert.deepEqual(cardButtons({ ...approval, options: ['Approve', 'Not now'] }).buttons, [FILLED('Approve'), NOT_NOW_BUTTON, WHY_BUTTON]);
});

test('Show me is a link with the preview address when there is one, else a small button that turns', () => {
  const approval = dataOf('approval');
  const shown = cardButtons(approval, { preview: 'https://preview.example.test/13' }).buttons.find((b) => b.label === 'Show me');
  assert.deepEqual(shown, { label: 'Show me', does: 'turn', shape: 'link', href: 'https://preview.example.test/13' });
  assert.deepEqual(cardButtons(approval, { preview: null }).buttons.find((b) => b.label === 'Show me'), SHOW_ME_BUTTON);
  assert.deepEqual(cardButtons(approval, { preview: '' }).buttons.find((b) => b.label === 'Show me'), SHOW_ME_BUTTON);
  // A card that offers no Show me gets no link either.
  assert.equal(cardButtons({ ...approval, options: ['Approve'] }, { preview: 'https://preview.example.test/13' }).buttons.some((b) => b.label === 'Show me'), false);
});

test('a proposal\'s Keep as is is outlined and records the plain answer', () => {
  const approval = dataOf('approval');
  assert.deepEqual(cardButtons({ ...approval, options: ['Approve', 'Keep as is'] }).buttons, [
    FILLED('Approve'), WHY_BUTTON, { label: 'Keep as is', does: 'record', shape: 'outlined' },
  ]);
});

test('an answer card\'s recommended option is filled and the others outlined', () => {
  const got = cardButtons(dataOf('answer'));
  assert.deepEqual(got, {
    buttons: [
      { label: 'Comma', does: 'record', shape: 'filled' },
      { label: 'Tab', does: 'record', shape: 'outlined' },
      SUGGEST_BUTTON,
      WHY_BUTTON,
    ],
    note: null,
  });
  const four = ['One', 'Two', 'Three', 'Four'].map((label) => ({ label, says: `${label} it.` }));
  const full = composeCard({ ...INPUTS.answer, recommend: 'Two', options: four }).card;
  assert.deepEqual(cardButtons(full).buttons, [
    { label: 'One', does: 'record', shape: 'outlined' },
    { label: 'Two', does: 'record', shape: 'filled' },
    { label: 'Three', does: 'record', shape: 'outlined' },
    { label: 'Four', does: 'record', shape: 'outlined' },
    WHY_BUTTON,
  ]);
  // A build-command question's own Not now is small, in the corner, and records.
  const withNotNow = { ...dataOf('answer'), options: ['Comma', 'Tab', 'Not now'], descriptions: [...dataOf('answer').descriptions, 'Leave it for now.'] };
  assert.deepEqual(cardButtons(withNotNow).buttons.at(-1), NOT_NOW_BUTTON);
});

test('a question with no set line has each option turn, the recommended one filled and the rest outlined', () => {
  assert.deepEqual(cardButtons(dataOf('question')), {
    buttons: [
      { label: 'Comma', does: 'turn', shape: 'filled' },
      { label: 'Tab', does: 'turn', shape: 'outlined' },
      SUGGEST_BUTTON,
      WHY_BUTTON,
    ],
    note: null,
  });
  // An old question with no parts has no reasons to open, and no Why?.
  const { parts, ...old } = dataOf('question');
  assert.deepEqual(cardButtons(old).buttons.map((b) => b.label), ['Comma', 'Tab', 'Suggest a change…']);
});

test('the deciding label is the first of the card\'s options that a click can sign', () => {
  const approval = dataOf('approval');
  assert.deepEqual(cardButtons({ ...approval, options: ['Show me', 'Approve', 'Not now'] }).buttons, [FILLED('Approve'), NOT_NOW_BUTTON, WHY_BUTTON, SHOW_ME_BUTTON]);
  // A card whose options hold no label a click can sign has no deciding button.
  assert.deepEqual(cardButtons({ ...approval, options: ['Go ahead', 'Not now'] }).buttons, [NOT_NOW_BUTTON, WHY_BUTTON]);
});

test('a card without parts keeps its buttons, and Why? asks the front desk', () => {
  const { parts, ...old } = dataOf('approval');
  assert.deepEqual(cardButtons(old).buttons.find((b) => b.label === 'Why?'), { label: 'Why?', does: 'turn', shape: 'small' });
  assert.ok(cardButtons(old).buttons.some((b) => b.does === 'record'));
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

test('a card with a set line for another pull request than its plain lines name gets no button that records anything', () => {
  const data = otherPullRequest();
  assert.match(cardProblems(data.question).join(' '), /pull request #14/);
  // Only Why?, which asks the front desk: its parts can't be trusted to show.
  assert.deepEqual(cardButtons(data), { buttons: [FAILED_WHY], note: 'This card can\'t be answered here: ask the First Mate about it.' });
  assert.equal(CANT_ANSWER, 'This card can\'t be answered here: ask the First Mate about it.');
  assert.deepEqual(cardButtons({ ...data, options: ['Approve', 'Not now'] }), { buttons: [FAILED_WHY], note: CANT_ANSWER });
});

test('a card is judged by the card check\'s own tests, for every kind with a set line', () => {
  for (const kind of SET_LINE_KINDS) {
    const data = dataOf(kind);
    assert.deepEqual(cardProblems(data.question), [], kind);
    if (NO_BUTTON_KINDS.includes(kind)) assert.deepEqual(cardButtons(data), noButtonsFor(kind), kind);
    else assert.ok(cardButtons(data).buttons.some((b) => b.does === 'record'), kind);
    const lines = data.question.split('\n');
    const broken = [
      lines.filter((l) => l !== TO_KNOW_MORE).join('\n'),
      // A setup card, a trust card, uninstall's and a Keep card have no reply code line to take away (rulings R36,
      // R80, R90, P7-31).
      ...([...SETUP_KINDS, 'trust', 'take-over', 'pair', 'uninstall', 'keep-control-files'].includes(kind) ? [] : [lines.filter((l) => !l.startsWith('Reply code:')).join('\n')]),
      `${data.question}\nReply code: ${replyCode('another line')}`,
      `${data.question}\n${data.line}`,
      // Without its reason and its meanwhile, a card has too few plain lines.
      lines.filter((l) => l !== INPUTS[kind].why && l !== INPUTS[kind].meanwhile).join('\n'),
    ];
    for (const question of broken) {
      assert.ok(cardProblems(question).length > 0, `${kind}: ${question}`);
      const got = cardButtons({ ...data, question });
      assert.equal(got.buttons.some((b) => b.does === 'record'), false, `${kind}: ${question}`);
      assert.deepEqual(got.buttons, NO_BUTTON_KINDS.includes(kind) ? [] : [FAILED_WHY], kind);
      assert.equal(got.note, NO_BUTTON_KINDS.includes(kind) ? noButtonsFor(kind).note : CANT_ANSWER, kind);
    }
  }
});

test('a trust card gets no button on the pane, by its kind or by its set line alone (ruling R80)', () => {
  const data = dataOf('trust');
  assert.equal(isTrustCard(data), true);
  assert.equal(isSetupCard(data), false);
  assert.deepEqual(cardButtons(data), { buttons: [], note: TRUST_ANSWER });
  // Carried as another kind, or as a question, its set line still gives it no button.
  for (const kind of ['approval', 'question', undefined]) {
    assert.deepEqual(cardButtons({ ...data, kind }), { buttons: [], note: TRUST_ANSWER }, String(kind));
  }
  const line = trustLine('0a1b2c3d', '2026-10-19T22:30:00.000Z', 'abcdef012345');
  assert.equal(setLineOf(data.question), line);
  assert.equal(isTrustCard({ question: `Trust it?\n${line}`, options: ['Trust it'] }), true);
  assert.equal(isTrustCard(dataOf('approval')), false);
});

test('uninstall\'s card gets no button on the pane, by its kind or by its set line alone (ruling R90)', () => {
  const data = dataOf('uninstall');
  assert.equal(isUninstallCard(data), true);
  assert.equal(isSetupCard(data), false);
  assert.equal(isTrustCard(data), false);
  assert.deepEqual(cardButtons(data), { buttons: [], note: UNINSTALL_ANSWER });
  for (const kind of ['approval', 'question', undefined]) {
    assert.deepEqual(cardButtons({ ...data, kind }), { buttons: [], note: UNINSTALL_ANSWER }, String(kind));
  }
  const line = uninstallLine('cafe menu', DOC);
  assert.equal(setLineOf(data.question), line);
  assert.equal(isUninstallCard({ question: `Remove it?\n${line}`, options: ['Remove it'] }), true);
  assert.equal(isUninstallCard(dataOf('approval')), false);
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

test('a card whose parts do not build its text gets only Why?, which turns', () => {
  const data = dataOf('approval');
  // The parts say more than the text the prompt record would sign.
  const changed = { ...data, parts: { ...data.parts, meanwhile: 'Everything is released at once.' } };
  assert.notEqual(textOf(changed.parts), changed.question);
  assert.deepEqual(cardProblems({ question: changed.question, header: changed.header, options: changed.options.map((label, i) => ({ label, description: changed.descriptions[i] })) }), []);
  assert.deepEqual(cardButtons(changed), { buttons: [FAILED_WHY], note: CANT_ANSWER });
  // Parts that can't build any text at all.
  assert.deepEqual(cardButtons({ ...data, parts: { kind: 'approval' } }), { buttons: [FAILED_WHY], note: CANT_ANSWER });
  assert.deepEqual(cardButtons({ ...data, parts: 'text' }), { buttons: [FAILED_WHY], note: CANT_ANSWER });
});

test('a card failing the check gets only Why?, which turns, however its options read', () => {
  const data = dataOf('approval');
  // No recommended option among the descriptions fails the check on the whole question.
  const unrecommended = { ...data, descriptions: data.descriptions.map((d) => d.replace(/^Recommended: /, '')) };
  assert.match(cardProblems({ question: data.question, header: data.header, options: unrecommended.options.map((label, i) => ({ label, description: unrecommended.descriptions[i] })) }).join(' '), /recommended/);
  assert.deepEqual(cardButtons(unrecommended), { buttons: [FAILED_WHY], note: CANT_ANSWER });
  // A card with no descriptions at all can't show a recommendation.
  const { descriptions, ...bare } = data;
  assert.deepEqual(cardButtons(bare), { buttons: [FAILED_WHY], note: CANT_ANSWER });
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
  assert.deepEqual(setup.options, ['Go ahead', 'Show me', 'Not now']);
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

test('setup\'s card of the rules found gets no button on the pane either, by its kind or by its line', () => {
  const rules = dataOf('confirm-all');
  assert.equal(isSetupCard(rules), true);
  assert.deepEqual(rules.options, ['Confirm all', 'Let me correct some', 'Not now']);
  assert.equal(rules.code, null);
  assert.deepEqual(cardButtons(rules), NO_BUTTONS);
  for (const kind of ['approval', 'confirm', 'question', undefined]) {
    assert.equal(isSetupCard({ ...rules, kind }), true, String(kind));
    assert.deepEqual(cardButtons({ ...rules, kind }), NO_BUTTONS, String(kind));
  }
  assert.equal(isSetupCard({ ...dataOf('approval'), kind: 'confirm-all' }), true);
});
