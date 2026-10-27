// tests/scripts/cards/compose.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeCard, answerInput, questionProblem, textOf, DECIDING, HEADERS, MEANWHILE, CHECKS_UNSAID, NO_REPLY_CODE } from '../../../scripts/cards/compose.js';
import { decide } from '../../../scripts/hooks/prompt-record.js';
import { makeEvent, eventPath, dataHash } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import {
  approvalLine, confirmLine, LIFT_STOP, runbookLine, ciPushLine, approveWorkLine, answerLine, amendLine,
  liftIncidentLine, incidentFixLine, setupLine, confirmAllLine, baselineLine, trustLine, takeOverLine, uninstallLine, keepControlLine, usageLine, premiumLine, replyCode, replyCodeLine, setLineOf,
} from '../../../scripts/state/card-lines.js';
import { stateDir, stopFile } from '../../../scripts/lib/paths.js';
import { CARD, CARD_KINDS, PUT_OFF } from '../../../scripts/lib/front-desk.js';
import { BUILD_QUESTION_OPTIONS } from '../../../scripts/protection/windows-builds.js';
import { SUGGEST, WHY, SHOW_ME, NOT_NOW, TO_KNOW_MORE, TO_CHANGE_IT, SUGGEST_SAYS, WHAT_CHANGED } from '../../../scripts/lib/calm-words.js';
import { withHome as inOwnHome } from '../../helpers/homes.js';

const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const DOC = 'fedcba9876543210'.repeat(4);
const USAGE_AT = '2026-10-26T01:00:00.000Z';
const NOW = new Date('2026-10-18T05:00:00.000Z');
const P = 'owner__name';

// Made in a home of its own: an event names its computer, which is kept in the home, so made with
// none it would be kept in the real ~/.wheelhouse.
const RULING = inOwnHome(() => makeEvent({ kind: 'ruling', data: { words: 'Money is shown in dollars' }, now: () => NOW }));
const OWN = [
  { label: 'Comma', says: 'Commas between values; opens in any spreadsheet.' },
  { label: 'Tab', says: 'Tabs between values; safe for text with commas.' },
];

// One input for each kind, written the way the front desk would.
const common = {
  why: 'It changes what users see, which is yours to decide at level 3.',
  recommend: 'Approve',
  because: 'the checks passed and the change is small.',
  meanwhile: 'Nothing is released and the agents carry on with other work.',
  level: 3,
};
const says = (what) => ({ label: what, says: `It ${what.toLowerCase()} and goes ahead.` });
const INPUTS = {
  approval: { ...common, kind: 'approval', what: 'Pull request #7 changes the wording on the sign-in page.', options: [says('Approve')], target: { pr: 7, sha: FULL } },
  confirm: { ...common, recommend: 'Confirm', kind: 'confirm', what: 'A rule you gave: money is shown in dollars.', options: [says('Confirm')], target: { event: RULING } },
  'lift-stop': { ...common, recommend: 'Lift STOP', kind: 'lift-stop', what: 'Every agent is stopped, and nothing moves until you say.', options: [says('Lift STOP')], target: {} },
  'ci-push': { ...common, recommend: 'Push it', kind: 'ci-push', what: 'A change to the automatic checks, on the ci-fix branch, is ready to go out under your sign-in.', options: [says('Push it')], target: { branch: 'ci-fix', sha: FULL } },
  runbook: { ...common, recommend: 'Do it', kind: 'runbook', what: 'The emergency steps say: put the product back to an earlier release.', options: [says('Do it')], target: { step: 3, sha: FULL } },
  'approve-work': { ...common, kind: 'approve-work', what: 'The plan for exporting a report as a spreadsheet file (export-csv).', options: [says('Approve')], target: { work: 'export-csv', lane: 'feature', hash: DOC, shownFirst: true } },
  answer: { ...common, recommend: 'Comma', kind: 'answer', what: 'The export needs to know which separator to use.', options: OWN, target: { questionId: 'q-export-csv-1' } },
  amend: { ...common, recommend: 'Change it', kind: 'amend', what: 'A change to the plan you approved for export-csv.', options: [says('Change it')], target: { work: 'export-csv', hash: DOC } },
  'lift-incident': { ...common, recommend: 'End it', kind: 'lift-incident', what: 'Incident bad-total, the wrong totals, has been corrected, so merging can start again.', options: [says('End it')], target: { incident: 'bad-total' } },
  'incident-fix': { ...common, recommend: 'Merge the fix', kind: 'incident-fix', what: 'Pull request #31 corrects the wrong totals in incident bad-total.', options: [says('Merge the fix')], target: { incident: 'bad-total', pr: 31 } },
  setup: { ...common, recommend: 'Go ahead', kind: 'setup', what: 'Setup step 6, Changes to this computer: transcripts are kept 30 days.', options: [says('Go ahead')], target: { step: 6, hash: DOC } },
  'confirm-all': {
    ...common, recommend: 'Confirm all', kind: 'confirm-all', what: 'Setup step 5 found 2 rules this project follows: 1) "Money is shown in dollars"; 2) "Never push to main".',
    options: [says('Confirm all'), says('Let me correct some')], target: { count: 2, hash: DOC },
  },
  baseline: { ...common, recommend: 'Record these', kind: 'baseline', what: 'The first version\'s figures from your note: US$100.00 for 4 merged pull requests.', options: [says('Record these')], target: { hash: DOC } },
  trust: {
    ...common, recommend: 'Trust it', kind: 'trust', what: 'Your computer 0a1b2c3d put its key in your profile.',
    options: [says('Trust it')], target: { computer: '0a1b2c3d', at: '2026-10-19T22:30:00.000Z', fingerprint: 'abcdef012345' },
  },
  'take-over': {
    ...common, recommend: 'Take over here', kind: 'take-over', what: 'Your computer 0a1b2c3d has the front desk and nothing was written there for 3 hours; this one can only look.',
    options: [says('Take over here'), { label: 'Leave it there', says: 'This computer only shows the board.' }], target: { holder: '0a1b2c3d', counter: 4 },
  },
  uninstall: {
    ...common, recommend: 'Remove it', kind: 'uninstall', level: 4, checks: 'The checks no longer guard this project.',
    what: 'Remove Wheelhouse from cafe menu: stop its jobs, put back 3 changes on this computer.',
    options: [says('Remove it')], target: { project: 'cafe menu', hash: DOC },
  },
  question: { ...common, recommend: 'Comma', kind: 'question', what: 'The export needs to know which separator to use.', options: OWN, target: undefined },
  'keep-control-files': {
    ...common, recommend: 'Confirm', kind: 'keep-control-files', what: 'The export-csv feature\'s folder has a new or changed file that steers agents.',
    options: [says('Confirm')], target: { work: 'export-csv', hash: DOC },
  },
  usage: {
    ...common, recommend: 'Switch to Lean until it resets', kind: 'usage', ask: 'Switch to Lean until it resets?', what: 'You\'ve used 76% of this week\'s allowance.',
    options: [{ label: 'Switch to Lean until it resets', says: 'Thoroughness changes to Lean until your allowance resets.' }, { label: 'Stay on Balanced', says: 'Thoroughness stays on Balanced.' }],
    target: { to: 'lean', at: USAGE_AT },
  },
  premium: {
    ...common, level: 4, checks: 'Every check still runs.', recommend: 'Allow it within my plan', kind: 'premium', ask: 'Allow the premium model at Thorough?',
    what: 'Claude has a larger model than the one Wheelhouse uses now.',
    options: [{ label: 'Allow it within my plan', says: 'It is used within your plan.' }, { label: 'Allow it, paid credits too', says: 'It may be paid from your usage credits.' }, { label: 'Not now', says: 'Nothing changes.' }],
    target: { at: USAGE_AT },
  },
};
const LINES = {
  approval: approvalLine(7, FULL),
  confirm: confirmLine(RULING),
  'lift-stop': LIFT_STOP,
  'ci-push': ciPushLine('ci-fix', FULL),
  runbook: runbookLine(3, FULL),
  'approve-work': approveWorkLine('export-csv', 'feature', DOC, { shownFirst: true }),
  answer: answerLine('q-export-csv-1'),
  amend: amendLine('export-csv', DOC),
  'lift-incident': liftIncidentLine('bad-total'),
  'incident-fix': incidentFixLine('bad-total', 31),
  setup: setupLine(6, DOC),
  'confirm-all': confirmAllLine(DOC, 2),
  baseline: baselineLine(DOC),
  trust: trustLine('0a1b2c3d', '2026-10-19T22:30:00.000Z', 'abcdef012345'),
  'take-over': takeOverLine('0a1b2c3d', 4),
  uninstall: uninstallLine('cafe menu', DOC),
  question: null,
  'keep-control-files': keepControlLine('export-csv', DOC),
  usage: usageLine('lean', USAGE_AT),
  premium: premiumLine(USAGE_AT),
};
const input = (kind, over = {}) => ({ ...INPUTS[kind], ...over });
const refused = (over, pattern, kind = 'approval') => assert.throws(() => composeCard(input(kind, over)), pattern);
const lines = (text) => text.split('\n');

test('every kind has an input here', () => {
  assert.deepEqual(Object.keys(INPUTS).sort(), [...CARD_KINDS].sort());
});

// The kinds whose question, when none is given, is their `what`.
const ASKS_WHAT = ['answer', 'question', 'setup', 'confirm-all', 'baseline', 'trust', 'uninstall'];

test("each kind's card carries its plain lines in Calm's order, then its set line and its reply code, but a setup card no code", () => {
  for (const kind of CARD_KINDS) {
    const { question, card } = composeCard(input(kind));
    const rows = lines(question.question);
    // Where the question is the `what`, the text says it once.
    const front = ASKS_WHAT.includes(kind) ? [INPUTS[kind].what] : [card.parts.ask, INPUTS[kind].what];
    const plain = [...front, INPUTS[kind].why, INPUTS[kind].meanwhile, ...(INPUTS[kind].checks === undefined ? [] : [INPUTS[kind].checks]), TO_KNOW_MORE];
    assert.deepEqual(rows.slice(0, plain.length), plain, kind);
    const after = rows.slice(plain.length);
    if (kind === 'question') {
      assert.deepEqual(after, [], 'a product question has no set line and no reply code');
      assert.equal(setLineOf(question.question), null);
      assert.equal(card.line, null);
      assert.equal(card.code, null);
    } else if (NO_REPLY_CODE.includes(kind)) {
      assert.deepEqual(after, [LINES[kind]], 'a setup card is approved by its click alone, so it has no reply code');
      assert.equal(setLineOf(question.question), LINES[kind]);
      assert.equal(card.line, LINES[kind]);
      assert.equal(card.code, null);
      assert.deepEqual(NO_REPLY_CODE, ['setup', 'confirm-all', 'trust', 'take-over', 'uninstall', 'keep-control-files', 'usage', 'premium']);
    } else {
      assert.deepEqual(after, [LINES[kind], replyCodeLine(replyCode(LINES[kind]))]);
      assert.equal(setLineOf(question.question), LINES[kind]);
      assert.equal(card.line, LINES[kind]);
      assert.equal(card.code, replyCode(LINES[kind]));
    }
    assert.equal(question.multiSelect, false);
    assert.equal(card.question, question.question);
    assert.equal(card.header, question.header);
    assert.equal(card.kind, kind);
    assert.equal(card.level, INPUTS[kind].level);
    assert.deepEqual(card.options, question.options.map((o) => o.label));
    assert.deepEqual(card.descriptions, question.options.map((o) => o.description));
    // The card keeps the option it recommended, so the delegation review can tell a choice made as recommended.
    assert.equal(card.recommend, INPUTS[kind].recommend, kind);
    // The state accepts the card data as composed.
    assert.doesNotThrow(() => inOwnHome(() => makeEvent({ kind: 'card', data: card, now: () => NOW })), kind);
  }
});

test('the chat text is the question, what, why, meanwhile and "To know more, just ask.", then the set line and the code', () => {
  const { question } = composeCard(input('approval'));
  assert.deepEqual(lines(question.question), [
    'Put pull request #7 live?',
    INPUTS.approval.what,
    INPUTS.approval.why,
    INPUTS.approval.meanwhile,
    'To know more, just ask.',
    approvalLine(7, FULL),
    replyCodeLine(replyCode(approvalLine(7, FULL))),
  ]);
  assert.equal(TO_KNOW_MORE, 'To know more, just ask.');
  // An explicit question replaces the default; the same words as `what` are said once.
  const asked = composeCard(input('approval', { ask: "Put 'save a search' live? (pull request #7)" }));
  assert.equal(lines(asked.question.question)[0], "Put 'save a search' live? (pull request #7)");
  assert.equal(lines(asked.question.question).filter((l) => l === INPUTS.approval.what).length, 1);
  const same = composeCard(input('approval', { ask: INPUTS.approval.what }));
  assert.equal(lines(same.question.question).filter((l) => l === INPUTS.approval.what).length, 1);
});

test('no part label appears in the text', () => {
  for (const kind of CARD_KINDS) {
    const { question } = composeCard(input(kind, kind === 'approval' ? { level: 4, checks: 'It makes the review optional.' } : {}));
    for (const label of ['What this is:', "Why it's coming to you:", 'Options:', 'My recommendation:', 'While you decide:', 'What this does to the checks:']) {
      assert.ok(!question.question.includes(label), `${kind}: ${label}`);
    }
    // The options and the recommendation are in the options' descriptions, not the text.
    for (const o of question.options) assert.ok(!question.question.includes(o.description), kind);
  }
});

test('the default ask for each kind is one line ending in a question mark, or the card\'s what', () => {
  const asks = {
    approval: 'Put pull request #7 live?',
    confirm: 'Confirm this?',
    'lift-stop': 'Lift All stop?',
    'ci-push': 'Push this change to the checks?',
    runbook: 'Put the product back to an earlier release?',
    'approve-work': 'Approve this work as written?',
    amend: 'Change the approved work to this?',
    'lift-incident': 'End the incident?',
    'incident-fix': 'Merge this fix?',
    'keep-control-files': 'Keep these files as they are?',
    usage: 'Switch to Lean until it resets?',
    premium: 'Allow the premium model at Thorough?',
    'take-over': 'Move the First Mate to this computer?',
  };
  for (const kind of CARD_KINDS) {
    const { card } = composeCard(input(kind));
    if (ASKS_WHAT.includes(kind)) {
      assert.equal(card.parts.ask, INPUTS[kind].what, kind);
      continue;
    }
    assert.equal(card.parts.ask, asks[kind], kind);
    assert.ok(!/[\r\n]/.test(card.parts.ask) && card.parts.ask.endsWith('?'), kind);
  }
  // A runbook step asks its title, whichever step.
  const one = composeCard(input('runbook', { what: 'The emergency steps start with: turn STOP on.', target: { step: 1 } }));
  assert.equal(one.card.parts.ask, 'Turn STOP on?');
});

test('card.parts holds every part, and rebuilding the text from the parts gives the same text', () => {
  for (const kind of CARD_KINDS) {
    const given = input(kind);
    const { question, card } = composeCard(given);
    const parts = card.parts;
    assert.equal(parts.kind, kind);
    assert.equal(parts.header, HEADERS[kind]);
    assert.equal(parts.what, given.what);
    assert.equal(parts.why, given.why);
    assert.equal(parts.meanwhile, given.meanwhile);
    assert.equal(parts.small, given.why, 'with no size, the small line is the reason');
    assert.equal(parts.recommendation, `${given.recommend}, because ${given.because.replace(/\.$/, '')}.`);
    assert.equal(parts.line, card.line);
    assert.equal(parts.code, card.code);
    assert.equal(Object.hasOwn(parts, 'checks'), given.checks !== undefined, kind);
    assert.deepEqual(parts.options.map((o) => o.label), card.options);
    assert.deepEqual(parts.options.map((o) => o.recommended), card.options.map((l) => l === given.recommend));
    assert.equal(parts.options.filter((o) => o.recommended).length, 1, kind);
    assert.equal(textOf(parts), question.question, kind);
    assert.equal(textOf(JSON.parse(JSON.stringify(parts))), question.question, `${kind}: through the state`);
  }
  const sized = composeCard(input('approval', { size: 'Small feature', optional: 3 })).card.parts;
  assert.equal(sized.small, `Small feature · ${INPUTS.approval.why}`);
  assert.equal(sized.optional, 3);
  assert.ok(!Object.hasOwn(composeCard(input('approval')).card.parts, 'optional'));
  refused({ size: '' }, /size/);
  refused({ optional: 0 }, /optional/);
  refused({ optional: 2.5 }, /optional/);
  refused({ optional: '3' }, /optional/);
  refused({ ask: '   ' }, /ask/);
  refused({ ask: 'Put it live?\nYes?' }, /ask/);
  refused({ ask: approvalLine(7, FULL) }, /ask/);
});

test('a revised card needs changed, keeps revises, and says "What changed:"', () => {
  const { question, card } = composeCard(input('approval', { revises: 'e-20261021-old', changed: 'The wording now says "sign in", not "log in".' }));
  assert.equal(card.revises, 'e-20261021-old');
  assert.equal(card.parts.revises, 'e-20261021-old');
  assert.equal(card.parts.changed, 'The wording now says "sign in", not "log in".');
  const rows = lines(question.question);
  const at = rows.indexOf('What changed: The wording now says "sign in", not "log in".');
  assert.ok(at > 0, 'the line is there');
  assert.equal(rows[at - 1], INPUTS.approval.meanwhile);
  assert.equal(rows[at + 1], TO_KNOW_MORE);
  assert.equal(WHAT_CHANGED, 'What changed:');
  assert.equal(textOf(card.parts), question.question);
  // A revised card of level 4 puts the checks line before what changed.
  const four = lines(composeCard(input('approval', { level: 4, checks: 'It makes review optional.', revises: 'e-old', changed: 'Smaller.' })).question.question);
  assert.deepEqual(four.slice(3, 7), [INPUTS.approval.meanwhile, 'It makes review optional.', 'What changed: Smaller.', TO_KNOW_MORE]);
  refused({ revises: 'e-old' }, /changed/);
  refused({ revises: 'e-old', changed: '  ' }, /changed/);
  refused({ revises: 'e-old', changed: 'a\nb' }, /changed/);
  refused({ changed: 'Smaller.' }, /changed/);
  for (const bad of ['', 'two words', 7]) refused({ revises: bad, changed: 'x' }, /revises/);
  assert.ok(!Object.hasOwn(composeCard(input('approval')).card, 'revises'));
  // The words of what changed name no other pull request or commit than the set line's.
  refused({ revises: 'e-old', changed: 'It was pull request #9 before.' }, /text.*#7/);
  assert.doesNotThrow(() => inOwnHome(() => makeEvent({ kind: 'card', data: card, now: () => NOW })));
});

test('every plain line names no other pull request or commit than the set line', () => {
  for (const over of [{ why: 'Pull request #9 is related.' }, { meanwhile: 'Commit 1234567890ab waits.' }, { ask: 'Put pull request #9 live?' }]) {
    refused(over, /text/);
  }
  assert.doesNotThrow(() => composeCard(input('approval', { why: 'Pull request #7 is the one.' })));
});

test('the set line and the first part name the same pull request and commit', () => {
  // The first part naming another pull request or commit than the set line is refused.
  refused({ what: 'Pull request #12 changes the wording on the sign-in page.' }, /what.*#12.*#7|#7/);
  refused({ what: 'Pull request #7 and #12 together change the wording.' }, /what/);
  refused({ what: 'Pull request #7 at commit 1234567890ab changes the wording.' }, /what.*commit/);
  refused({ what: 'This changes the wording on the sign-in page.' }, /what.*#7/);
  const ok = composeCard(input('approval', { what: `Pull request #7 (commit ${FULL.slice(0, 12)}) changes the wording.` }));
  assert.ok(ok.question.question.includes(approvalLine(7, FULL)));
  refused({ what: 'Pull request #30 corrects the wrong totals.' }, /what/, 'incident-fix');
  // A word that only looks like a commit is not one.
  composeCard(input('approval', { what: 'Pull request #7 makes a decade-old defaced page readable.' }));
});

test('the first part names what the set line names, for every kind', () => {
  const cases = [
    ['approval', { what: 'A change to the sign-in page.' }, /what.*#7/],
    ['incident-fix', { what: 'Pull request #31 corrects the wrong totals.' }, /what.*incident bad-total/],
    ['incident-fix', { what: 'Incident bad-total: pull request #32 corrects the totals.' }, /what.*#31/],
    ['incident-fix', { what: 'Pull request #31 corrects the totals in incident bad-total-2.' }, /what.*bad-total/],
    ['approve-work', { what: 'The plan for exporting a report.' }, /what.*export-csv/],
    ['approve-work', { what: 'The plan for export-csv-two.' }, /what.*export-csv/],
    ['amend', { what: 'A change to the plan you approved.' }, /what.*export-csv/],
    ['amend', { what: 'A change to the plan for other-work.' }, /what.*export-csv/],
    ['lift-incident', { what: 'The wrong totals have been corrected.' }, /what.*bad-total/],
    ['runbook', { what: 'The emergency steps are open.' }, /what.*Put the product back/],
    ['runbook', { what: 'The emergency steps say to cut the access.' }, /what.*Put the product back/],
    ['ci-push', { what: 'A change to the automatic checks is ready.' }, /what.*ci-fix/],
    ['ci-push', { what: 'A change to the checks on the ci-fix-2 branch is ready.' }, /what.*ci-fix/],
    ['confirm', { what: 'A rule you gave about money.' }, /what.*Money is shown in dollars/],
  ];
  for (const [kind, over, pattern] of cases) refused(over, pattern, kind);
  // Each is accepted once it names the subject, in any case.
  composeCard(input('runbook', { what: 'The emergency step to PUT THE PRODUCT BACK to an earlier release.' }));
  composeCard(input('confirm', { what: 'You said:  "money is shown   in DOLLARS".' }));
  composeCard(input('ci-push', { what: 'The checks on branch ci-fix, please.' }));
  // Kinds with nothing more to name need nothing more.
  composeCard(input('answer', { what: 'Which separator?' }));
  composeCard(input('lift-stop', { what: 'Everything is paused.' }));
});

test('a level-4 card without what it does to the checks is refused, and one with it carries its checks line', () => {
  refused({ level: 4 }, /checks/);
  refused({ level: 4, checks: '  ' }, /checks/);
  const { question, card } = composeCard(input('approval', { level: 4, checks: 'It makes the review step optional for small changes.' }));
  const rows = lines(question.question);
  assert.deepEqual(rows.slice(3, 6), [INPUTS.approval.meanwhile, 'It makes the review step optional for small changes.', TO_KNOW_MORE], 'the checks line comes before "To know more, just ask."');
  assert.equal(rows[6], approvalLine(7, FULL));
  assert.equal(card.parts.checks, 'It makes the review step optional for small changes.');
  assert.equal(card.level, 4);
  refused({ checks: 'Nothing.' }, /checks/);
});

test('an approval card offers Approve, Suggest a change…, Show me and Not now, in that order', () => {
  const { question, card } = composeCard(input('approval'));
  assert.deepEqual(question.options.map((o) => o.label), ['Approve', SUGGEST, SHOW_ME, NOT_NOW]);
  assert.deepEqual(card.options, ['Approve', 'Suggest a change…', 'Show me', 'Not now']);
  assert.equal(question.options[1].description, SUGGEST_SAYS);
  assert.equal(SUGGEST_SAYS, "Tell me what you'd change; I'll come back with a new proposal.");
  assert.ok(!card.options.includes('Explain more'), 'Explain more is never offered');
});

test('decision cards offer the deciding label, Suggest a change…, Show me and Not now; the kinds answered in setup\'s own chat and lift-stop offer no Suggest a change…', () => {
  const expected = {
    approval: 'Approve', confirm: 'Confirm', 'lift-stop': 'Lift STOP', 'ci-push': 'Push it', runbook: 'Do it',
    'approve-work': 'Approve', amend: 'Change it', 'lift-incident': 'End it', 'incident-fix': 'Merge the fix', setup: 'Go ahead',
  };
  const lists = {
    'lift-stop': (label) => [label, SHOW_ME, NOT_NOW],
    setup: (label) => [label, SHOW_ME, NOT_NOW],
  };
  for (const [kind, label] of Object.entries(expected)) {
    assert.equal(DECIDING[kind], label);
    const { question } = composeCard(input(kind));
    assert.deepEqual(question.options.map((o) => o.label), (lists[kind] ?? ((l) => [l, SUGGEST, SHOW_ME, NOT_NOW]))(label), kind);
    assert.ok(question.options.length <= CARD.options);
    for (const o of question.options) assert.ok(typeof o.description === 'string' && o.description.length > 0);
    assert.equal(question.options.filter((o) => o.description.startsWith('Recommended:')).length, 1, kind);
    assert.ok(question.options[0].description.startsWith('Recommended:'));
  }
  // None of the kinds answered in setup's or the session start's own chat offers Suggest a change… or Explain more.
  const offers = (kind) => composeCard(input(kind)).question.options.map((o) => o.label);
  assert.deepEqual(offers('confirm-all'), ['Confirm all', 'Let me correct some', NOT_NOW]);
  assert.deepEqual(offers('trust'), ['Trust it', NOT_NOW]);
  assert.deepEqual(offers('take-over'), ['Take over here', 'Leave it there']);
  assert.deepEqual(offers('uninstall'), ['Remove it', NOT_NOW]);
  assert.deepEqual(offers('baseline'), ['Record these', NOT_NOW]);
  for (const kind of ['lift-stop', 'setup', 'confirm-all', 'baseline', 'trust', 'take-over', 'uninstall']) {
    assert.ok(!offers(kind).includes(SUGGEST), `${kind} offers no Suggest a change…`);
  }
  for (const kind of CARD_KINDS) assert.ok(!offers(kind).includes('Explain more'), `${kind} offers no Explain more`);
  // Recommending Not now moves the mark; the descriptions given override the defaults.
  const { question } = composeCard(input('approval', {
    recommend: 'Not now', options: [says('Approve'), { label: 'Not now', says: 'Wait for the next release.' }],
  }));
  assert.equal(question.options[3].description, 'Recommended: Wait for the next release, because the checks passed and the change is small.');
  assert.ok(!question.options[0].description.startsWith('Recommended:'));
  // Only labels the card offers can be described or recommended, and the deciding one is needed.
  refused({ options: [says('Approve'), says('Delete everything')] }, /options.*Delete everything/);
  refused({ options: [{ label: 'Not now', says: 'Wait.' }] }, /options.*Approve/);
  refused({ options: [says('Approve'), { label: 'Explain more' }] }, /options.*Explain more/);
  refused({ options: [says('Approve'), { label: 'Why?' }] }, /options.*Why\?/);
  refused({ recommend: 'Delete everything' }, /recommend/);
  refused({ options: [says('Approve'), says('Approve')] }, /options.*twice|options.*Approve/);
  refused({ options: [says('Lift STOP'), { label: SUGGEST }] }, /options.*Suggest a change/, 'lift-stop');
  refused({ options: [says('Go ahead'), { label: 'Explain more' }] }, /options.*Explain more/, 'setup');
  refused({ options: [says('Trust it'), { label: SUGGEST }] }, /options.*Suggest a change/, 'trust');
  refused({ options: [says('Take over here'), { label: SUGGEST }] }, /options.*Suggest a change/, 'take-over');
  refused({ what: 'Your computer 1b2c3d4e has the front desk.' }, /must name.*0a1b2c3d/, 'take-over');
  // A put-off or steering button may leave out what it says, or give it.
  assert.equal(composeCard(input('approval', { options: [says('Approve'), { label: SUGGEST, says: 'Say what to change.' }] })).question.options[1].description, 'Say what to change.');
});

test("the recommended option's description starts \"Recommended:\" and carries the reason", () => {
  const { question, card } = composeCard(input('approval'));
  assert.equal(question.options[0].description, 'Recommended: It approve and goes ahead, because the checks passed and the change is small.');
  assert.deepEqual(card.descriptions, question.options.map((o) => o.description));
  // The reason follows the says without its full stop, as a clause.
  const stop = composeCard(input('approval', { options: [{ label: 'Approve', says: 'It goes live within the hour.' }], because: 'The checks passed.' }));
  assert.equal(stop.question.options[0].description, 'Recommended: It goes live within the hour, because the checks passed.');
  // Exactly one option is led by "Recommended:" on every kind.
  for (const kind of CARD_KINDS) {
    const got = composeCard(input(kind)).question.options.filter((o) => o.description.startsWith('Recommended:'));
    assert.equal(got.length, 1, kind);
  }
});

test('a proposal offers Keep as is in place of Show me; any other confirm card keeps its four', () => {
  const proposal = (kind, data) => inOwnHome(() => makeEvent({ kind, data, now: () => NOW }));
  const learnt = proposal('setting', { key: 'boardTab', value: 'build', words: 'Board opens on: build', because: 'you asked for it three times' });
  const level = proposal('level', { key: 'copy-changes', value: 2, words: '"copy-changes": decide alone and tell you (level 2)', because: 'you chose it five times' });
  for (const event of [learnt, level]) {
    const { question, card } = composeCard(input('confirm', { what: `A change: ${event.data.words}`, target: { event } }));
    assert.deepEqual(question.options.map((o) => o.label), ['Confirm', SUGGEST, 'Keep as is', NOT_NOW], event.kind);
    assert.deepEqual(card.options, ['Confirm', SUGGEST, 'Keep as is', NOT_NOW]);
    assert.match(question.options[2].description, /as they are/);
    assert.match(question.options[2].description, /isn't asked again for a while/);
    // What Keep as is says may be given, as a put-off button's may.
    const given = composeCard(input('confirm', { what: `A change: ${event.data.words}`, target: { event }, options: [says('Confirm'), { label: 'Keep as is', says: 'It stays.' }] }));
    assert.equal(given.question.options[2].description, 'It stays.');
  }
  // A setting the director asked for, a ruling and a level without a reason are no proposals.
  const asked = proposal('setting', { key: 'boardTab', value: 'build', words: 'Board opens on: build' });
  const bare = proposal('level', { key: 'copy-changes', value: 2, words: '"copy-changes": level 2', because: '  ' });
  const ruling = proposal('ruling', { words: 'Money is shown in dollars', because: 'it is how we do it' });
  for (const event of [asked, bare, ruling]) {
    const { question } = composeCard(input('confirm', { what: `A change: ${event.data.words}`, target: { event } }));
    assert.deepEqual(question.options.map((o) => o.label), ['Confirm', SUGGEST, SHOW_ME, NOT_NOW], event.kind);
    refused({ what: `A change: ${event.data.words}`, target: { event }, options: [says('Confirm'), says('Keep as is')] }, /options.*Keep as is/, 'confirm');
  }
  // Any other kind of card can't offer it either.
  refused({ options: [says('Approve'), says('Keep as is')] }, /options.*Keep as is/);
});

test('an answer card with three own options adds Suggest a change…; with four it adds none and says to type a change; five are refused', () => {
  const opt = (n) => ({ label: `Option ${n}`, says: `Means ${n}.` });
  const three = composeCard(input('answer', { options: [opt(1), opt(2), opt(3)], recommend: 'Option 2' }));
  assert.deepEqual(three.question.options.map((o) => o.label), ['Option 1', 'Option 2', 'Option 3', SUGGEST]);
  assert.ok(three.question.options[1].description.startsWith('Recommended: Means 2, because'));
  assert.ok(three.question.options.every((o) => o.description));
  assert.ok(lines(three.question.question).includes(TO_KNOW_MORE));
  assert.ok(!three.question.question.includes(TO_CHANGE_IT));
  const two = composeCard(input('answer'));
  assert.deepEqual(two.question.options.map((o) => o.label), ['Comma', 'Tab', SUGGEST]);
  const four = composeCard(input('answer', { options: [opt(1), opt(2), opt(3), opt(4)], recommend: 'Option 4' }));
  assert.deepEqual(four.question.options.map((o) => o.label), ['Option 1', 'Option 2', 'Option 3', 'Option 4']);
  assert.deepEqual(four.card.options, ['Option 1', 'Option 2', 'Option 3', 'Option 4']);
  assert.equal(TO_CHANGE_IT, "To change it, type what you'd change.");
  assert.equal(lines(four.question.question).at(-3), TO_CHANGE_IT, 'in place of "To know more, just ask."');
  assert.ok(!four.question.question.includes(TO_KNOW_MORE));
  assert.equal(textOf(four.card.parts), four.question.question);
  refused({ options: [opt(1), opt(2), opt(3), opt(4), opt(5)] }, /options.*(four|4)/, 'answer');
  refused({ options: [] }, /options/, 'answer');
  // A button that put-offs share a name with would never be an answer.
  for (const label of PUT_OFF) refused({ options: [{ label, says: 'x' }, opt(2)], recommend: 'Option 2' }, /options/, 'answer');
  refused({ options: [{ label: 'Why?', says: 'x' }, opt(2)], recommend: 'Option 2' }, /options.*Why\?/, 'answer');
  refused({ options: [{ label: SUGGEST, says: 'x' }, opt(2)], recommend: 'Option 2' }, /options.*Suggest a change/, 'answer');
  refused({ options: [opt(1), opt(1)], recommend: 'Option 1' }, /options/, 'answer');
  refused({ options: [{ label: 'Comma', says: '' }, opt(2)] }, /options/, 'answer');
  // The same holds for a product question, which has no set line.
  const asked = composeCard(input('question', { options: [opt(1), opt(2), opt(3)], recommend: 'Option 1' }));
  assert.deepEqual(asked.question.options.map((o) => o.label), ['Option 1', 'Option 2', 'Option 3', SUGGEST]);
  const typed = composeCard(input('question', { options: [opt(1), opt(2), opt(3), opt(4)], recommend: 'Option 1' }));
  assert.equal(typed.question.options.length, 4);
  assert.equal(lines(typed.question.question).at(-1), TO_CHANGE_IT);
  refused({ options: [opt(1), opt(2), opt(3), opt(4), opt(5)], recommend: 'Option 1' }, /options/, 'question');
  // An answer card's recommendation is one of its buttons.
  refused({ recommend: 'Semicolon' }, /recommend/, 'answer');
});

test('suggest: false leaves Suggest a change… off a question card, and the card still ends with To know more, just ask.', () => {
  const opt = (n) => ({ label: `Option ${n}`, says: `Means ${n}.` });
  for (const kind of ['question', 'answer']) {
    for (const count of [2, 3, 4]) {
      const own = [1, 2, 3, 4].slice(0, count).map(opt);
      const { question, card } = composeCard(input(kind, { options: own, recommend: 'Option 1', suggest: false }));
      assert.deepEqual(question.options.map((o) => o.label), own.map((o) => o.label), `${kind} with ${count}`);
      const plain = lines(question.question).filter((l) => l !== LINES[kind] && !l.startsWith('Reply code:'));
      assert.equal(plain.at(-1), TO_KNOW_MORE, `${kind} with ${count}`);
      assert.ok(!question.question.includes(TO_CHANGE_IT));
      assert.equal(card.parts.suggest, false);
      assert.equal(textOf(card.parts), question.question);
      assert.equal(textOf(JSON.parse(JSON.stringify(card.parts))), question.question, 'through the state');
      assert.doesNotThrow(() => inOwnHome(() => makeEvent({ kind: 'card', data: card, now: () => NOW })));
    }
  }
  // Without it (or with suggest: true) a card keeps Suggest a change….
  assert.ok(composeCard(input('question')).question.options.some((o) => o.label === SUGGEST));
  assert.ok(composeCard(input('question', { suggest: true })).question.options.some((o) => o.label === SUGGEST));
  assert.ok(!Object.hasOwn(composeCard(input('question')).card.parts, 'suggest'));
  // It is a boolean, and only a question or an answer can leave Suggest a change… off.
  for (const bad of ['no', 0, null]) refused({ suggest: bad }, /suggest/, 'question');
  refused({ suggest: false }, /suggest/, 'approval');
});

test('a question or answer card that would offer one option is refused, since AskUserQuestion never shows it', () => {
  const one = [{ label: 'Option 1', says: 'Means 1.' }];
  for (const kind of ['question', 'answer']) {
    assert.throws(() => composeCard(input(kind, { options: one, recommend: 'Option 1', suggest: false })), /options must offer at least 2/, kind);
    // With Suggest a change… beside it, the card has two.
    assert.equal(composeCard(input(kind, { options: one, recommend: 'Option 1' })).question.options.length, 2, kind);
  }
});

test('an answer card refuses an own option called Why? or Suggest a change…', () => {
  for (const label of [WHY, SUGGEST]) {
    refused({ options: [{ label, says: 'x' }, { label: 'Tab', says: 'y' }], recommend: 'Tab' }, new RegExp(`options.*${label.replace(/[?…]/g, '.')}`), 'answer');
    refused({ options: [{ label, says: 'x' }, { label: 'Tab', says: 'y' }], recommend: 'Tab' }, /options/, 'question');
  }
});

test('a proposal offers Keep as is in place of Show me, and no other card does', () => {
  const learnt = inOwnHome(() => makeEvent({ kind: 'setting', data: { key: 'boardTab', value: 'build', words: 'Board opens on: build', because: 'you asked for it three times' }, now: () => NOW }));
  const { question } = composeCard(input('confirm', { what: `A change: ${learnt.data.words}`, target: { event: learnt } }));
  assert.deepEqual(question.options.map((o) => o.label), ['Confirm', SUGGEST, 'Keep as is', NOT_NOW]);
  assert.ok(!question.options.some((o) => o.label === SHOW_ME));
});

test("concepts default to the glossary terms in the card's text", () => {
  const { card } = composeCard(input('approval', { what: 'Pull request #7 changes the wording; the CI is green.', meanwhile: 'The branch waits.' }));
  assert.deepEqual(card.concepts, ['pull request', 'CI', 'branch']);
  // Only what the director reads as explanation counts: the set line's "commit" and the code line do not.
  const plain = composeCard(input('approval')).card;
  assert.ok(plain.line.includes('commit'));
  assert.deepEqual(plain.concepts, ['pull request']);
  assert.deepEqual(composeCard(input('lift-stop')).card.concepts, ['All stop']);
  // The checks line is explanation too, and names such as All stop count only in their capitals.
  assert.deepEqual(composeCard(input('approval', { level: 4, checks: 'It lets a change merge while All stop is on; all stop signs are unaffected.' })).card.concepts, ['pull request', 'merge', 'All stop']);
  assert.deepEqual(composeCard(input('approval', { concepts: ['merge'] })).card.concepts, ['merge']);
  assert.deepEqual(composeCard(input('approval', { concepts: [] })).card.concepts, []);
  const mine = composeCard(input('question', { what: 'Should the sprocket be blue?', glossary: { sprocket: { plain: 'a toothed wheel' } } }));
  assert.deepEqual(mine.card.concepts, ['sprocket']);
  // The optional fields reach the card only when given.
  const bare = composeCard(input('approval')).card;
  assert.ok(!('importance' in bare) && !('topic' in bare));
  const full = composeCard(input('approval', { importance: 80, topic: 'sign-in' })).card;
  assert.equal(full.importance, 80);
  assert.equal(full.topic, 'sign-in');
});

test('the header keeps to 12 characters and the text to the limit', () => {
  for (const kind of CARD_KINDS) {
    const { question } = composeCard(input(kind));
    assert.ok(question.header.length > 0 && question.header.length <= CARD.header, `${kind}: ${question.header}`);
    assert.equal(question.header, HEADERS[kind]);
    assert.ok(question.question.length <= CARD.chars);
  }
  assert.equal(HEADERS['lift-incident'], 'End incident');
  assert.equal(HEADERS.runbook, 'Emergency');
  assert.equal(HEADERS['ci-push'], 'Push checks');
  // The text is checked as a whole, set line included.
  composeCard(input('approval', { meanwhile: 'x'.repeat(CARD.chars - 600) }));
  refused({ meanwhile: 'x'.repeat(CARD.chars) }, /text|characters/);
});

test('a missing or empty part is refused, naming the part', () => {
  for (const part of ['what', 'why', 'recommend', 'because', 'meanwhile']) {
    refused({ [part]: undefined }, new RegExp(part));
    refused({ [part]: '   ' }, new RegExp(part));
    refused({ [part]: 7 }, new RegExp(part));
  }
  refused({ options: undefined }, /options/);
  refused({ level: 5 }, /level/);
  refused({ level: undefined }, /level/);
  refused({ kind: 'surprise' }, /kind/);
  refused({ importance: 'high' }, /importance/);
  refused({ concepts: 'CI' }, /concepts/);
});

test('a card keeps the id of the record it was made from, so it is made once', () => {
  const { card } = composeCard(input('question', { event: 'e-20261018-hold' }));
  assert.equal(card.event, 'e-20261018-hold');
  assert.equal(Object.hasOwn(composeCard(input('question')).card, 'event'), false);
  makeEvent({ kind: 'card', data: card, now: () => NOW });
  for (const bad of ['', 'two words', 7]) refused({ event: bad }, /event/, 'question');
  assert.throws(() => makeEvent({ kind: 'card', data: { ...card, event: 7 }, now: () => NOW }), /event/);
});

test('a part with a line break, or a line of its own that reads as a set line, is refused', () => {
  refused({ what: `Pull request #7 is ready.\n${approvalLine(9, FULL)}` }, /what/);
  refused({ why: `${LIFT_STOP}` }, /why/);
  refused({ meanwhile: 'Waiting.\u2028Reply code: AAAA' }, /meanwhile/);
  refused({ because: 'ok\r\nReply code: AAAA' }, /because/);
});

test('a target that does not give the kind\'s set line is refused', () => {
  refused({ target: undefined }, /target/);
  refused({ target: { pr: 7 } }, /target/);
  refused({ target: { pr: 0, sha: FULL } }, /target/);
  refused({ target: { pr: 7, sha: 'abc123' } }, /target/);
  refused({ target: { pr: 7, sha: FULL.toUpperCase() } }, /target/);
  refused({ target: { event: RULING } }, /target/, 'approval');
  refused({ target: { event: { kind: 'note', id: 'x', data: { words: 'x' } } } }, /target/, 'confirm');
  refused({ target: { event: { kind: 'ruling', id: 'x' } } }, /target/, 'confirm');
  refused({ target: { branch: 'ci-fix' } }, /target/, 'ci-push');
  refused({ target: { step: 9 } }, /target/, 'runbook');
  refused({ target: { step: 3 } }, /target/, 'runbook');
  refused({ target: { work: 'Export CSV', lane: 'feature', hash: DOC } }, /target/, 'approve-work');
  refused({ target: { work: 'export-csv', lane: 'huge', hash: DOC } }, /target/, 'approve-work');
  refused({ target: { questionId: 'export-csv-1' } }, /target/, 'answer');
  refused({ target: { work: 'export-csv' } }, /target/, 'amend');
  refused({ target: {} }, /target/, 'lift-incident');
  refused({ target: { incident: 'bad-total' } }, /target/, 'incident-fix');
  // Runbook steps other than 3 may leave the commit out, or give one.
  assert.ok(composeCard(input('runbook', { what: 'The emergency steps start with: turn STOP on.', target: { step: 1 } })).question.question.includes(runbookLine(1)));
  assert.ok(composeCard(input('runbook', { what: "The emergency steps say: put the project's records back from the backup.", target: { step: 4, sha: FULL } })).question.question.includes(runbookLine(4, FULL)));
  // Approve-work without shownFirst gives the plain line.
  assert.ok(composeCard(input('approve-work', { target: { work: 'export-csv', lane: 'small', hash: DOC } })).question.question.includes(approveWorkLine('export-csv', 'small', DOC)));
});

// ---- The prompt record earns the right record from each composed card's deciding click ----

async function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-compose-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    return await fn(home);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function fakeHelper() {
  const calls = { write: [], record: [] };
  return {
    calls,
    prState: async () => ({ ok: true, result: { headSha: FULL, state: 'open' } }),
    state: {
      write: async (b) => { calls.write.push(b); return { ok: true }; },
      record: async (b) => { calls.record.push(b); return { ok: true }; },
    },
    profile: { record: async () => ({ ok: true }) },
  };
}

function keep(event) {
  const file = path.join(stateDir(P), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(event));
}

const QUESTION = { id: 'q-export-csv-1', work: 'export-csv', what: 'Which separator?', why: 'It changes the file', options: OWN, recommendation: 'Comma', level: 2 };

test("the prompt record earns the right record from each composed card's deciding click", async () => {
  await withHome(async (home) => {
    keep(RULING);
    keep(makeEvent({ kind: 'work', data: { id: 'export-csv', title: 'Export', lane: 'feature', doc: { path: 'd.md', hash: DOC }, visible: true, dependsOn: [] }, now: () => NOW }));
    keep(makeEvent({ kind: 'question', data: QUESTION, now: () => NOW }));
    keep(makeEvent({ kind: 'amendment', data: { work: 'export-csv', change: 'CSV, not Excel', hash: DOC }, now: () => NOW }));
    keep(makeEvent({ kind: 'incident', data: { id: 'bad-total', what: 'Totals are wrong' }, now: () => NOW }));
    fs.writeFileSync(stopFile(), '{}');
    fs.mkdirSync(path.join(home, 'projects', P), { recursive: true });
    fs.writeFileSync(path.join(home, 'projects', P, 'ci-pending.json'), JSON.stringify({ 'ci-fix': { branch: 'ci-fix', sha: FULL, at: NOW.toISOString() } }));

    const expected = {
      approval: (r) => { assert.equal(r.kind, 'approval'); assert.deepEqual([r.data.pr, r.data.commit], [7, FULL]); },
      confirm: (r) => { assert.equal(r.kind, 'confirmation'); assert.equal(r.data.confirms, RULING.id); },
      'lift-stop': (r) => assert.deepEqual([r.kind, r.data.action], ['action', 'lift-stop']),
      'ci-push': (r) => assert.deepEqual([r.data.action, r.data.branch, r.data.sha], ['ci-push', 'ci-fix', FULL]),
      runbook: (r) => assert.deepEqual([r.data.action, r.data.step, r.data.sha], ['runbook', 3, FULL.slice(0, 12)]),
      'approve-work': (r) => assert.deepEqual([r.data.action, r.data.work, r.data.lane, r.data.hash, r.data.shownFirst], ['approve-work', 'export-csv', 'feature', DOC, true]),
      answer: (r) => assert.deepEqual([r.data.action, r.data.questionId, r.data.questionHash, r.data.label], ['answer', 'q-export-csv-1', dataHash(QUESTION), 'Tab']),
      amend: (r) => assert.deepEqual([r.data.action, r.data.work, r.data.hash], ['amend', 'export-csv', DOC]),
      'lift-incident': (r) => assert.deepEqual([r.data.action, r.data.incident], ['lift-incident', 'bad-total']),
      'incident-fix': (r) => assert.deepEqual([r.data.action, r.data.incident, r.data.pr], ['incident-fix', 'bad-total', 31]),
    };
    for (const [kind, check] of Object.entries(expected)) {
      fs.writeFileSync(stopFile(), '{}');
      const { question } = composeCard(input(kind));
      const label = kind === 'answer' ? 'Tab' : DECIDING[kind];
      const helper = fakeHelper();
      await decide({
        cwd: '/x', hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
        tool_input: { questions: [question], answers: { [question.question]: label } },
        tool_response: { answers: { [question.question]: label } },
      }, { client: helper, now: () => NOW, projectOf: () => ({ project: P }) });
      const signed = helper.calls.record.map((r) => r.event).filter((e) => e.kind !== 'shown');
      assert.equal(signed.length, 1, `${kind} earns one signed record`);
      assert.ok(signed[0].sig, kind);
      check(signed[0]);
      // The card is also shown with its reply code.
      assert.deepEqual(helper.calls.record.filter((r) => r.event.kind === 'shown').map((r) => r.event.data.code), [replyCode(LINES[kind])], kind);
      // A click on Suggest a change… earns nothing signed.
      const off = fakeHelper();
      await decide({
        cwd: '/x', hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
        tool_input: { questions: [question], answers: { [question.question]: SUGGEST } },
        tool_response: { answers: { [question.question]: SUGGEST } },
      }, { client: off, now: () => NOW, projectOf: () => ({ project: P }) });
      assert.deepEqual(off.calls.record.map((r) => r.event.kind).filter((k) => k !== 'shown'), [], `${kind}: Suggest a change…`);
    }
  });
});

test('questionProblem says why a question from the build could not be its answer card, by the composer\'s own rules', () => {
  const question = {
    id: 'q-export-csv-1', work: 'export-csv', what: 'Which separator should the export use?', why: 'It changes the file people download.',
    options: OWN, recommendation: 'Tab', level: 2,
  };
  assert.equal(questionProblem(question), null);
  // The composer's answer card from the same input: the question's own words and options.
  const { card } = composeCard(answerInput(question, 'Export a report'));
  assert.equal(card.line, answerLine('q-export-csv-1'));
  const tab = card.descriptions[card.options.indexOf('Tab')];
  assert.equal(tab, 'Recommended: Tabs between values; safe for text with commas, because the session building Export a report recommends it.');
  assert.ok(lines(card.question).includes(MEANWHILE));
  assert.ok(lines(composeCard(answerInput({ ...question, level: 4 }, 'x')).card.question).includes(CHECKS_UNSAID));
  assert.equal(CHECKS_UNSAID, "The build didn't say. Ask me why and I'll find out before you answer.");
  const five = ['A', 'B', 'C', 'D', 'E'].map((label) => ({ label, says: `${label} goes ahead.` }));
  for (const [name, bad, why] of [
    ['five options', { ...question, options: five, recommendation: 'A' }, /at most 4/],
    ['a put-off label', { ...question, options: [...OWN, { label: 'Not now', says: 'Later.' }] }, /Not now/],
    ['words past the card\'s length', { ...question, why: 'w'.repeat(CARD.chars) }, new RegExp(`${CARD.chars} characters`)],
    ['a label on two lines', { ...question, options: [{ label: 'Com\nma', says: 'x' }, OWN[1]] }, /one line/],
    ['no options', { ...question, options: undefined }, /can't be read/],
  ]) assert.match(questionProblem(bad) ?? '', why, name);
});

test('a build-command question\'s answer card offers the design\'s three options, Not now among them', () => {
  const asked = {
    id: 'q-export-csv-2', work: 'export-csv', kind: 'build-command', what: 'Let this feature\'s builder run: npm test, which runs "node --test".',
    why: 'The tests need running', options: BUILD_QUESTION_OPTIONS.map((o) => ({ ...o })), recommendation: 'Allow this time', level: 3, commands: ['npm test'],
  };
  assert.equal(questionProblem(asked), null);
  const { question, card } = composeCard(answerInput(asked, 'Export a report'));
  assert.equal(card.line, answerLine('q-export-csv-2'));
  assert.deepEqual(card.options, ['Allow this time', 'Allow for this feature', 'Not now', SUGGEST]);
  assert.ok(question.options[0].description.startsWith('Recommended: '));
  assert.ok(card.question.includes('npm test'), 'the card names the commands');
  // In plain words, as the front desk rewrites what each option says, the card is still composed.
  const input = answerInput(asked, 'Export a report');
  const plain = composeCard({ ...input, options: input.options.map((o) => ({ ...o, says: `In plain words: ${o.label.toLowerCase()}.` })) });
  assert.deepEqual(plain.card.options, card.options);
  assert.equal(plain.card.descriptions[2], 'In plain words: not now.');
  // Only a question that names its commands, with the design's three labels in order, carries Not
  // now; a product question never does.
  const changed = [
    ['another order', { options: [asked.options[1], asked.options[0], asked.options[2]] }],
    ['a fourth option', { options: [...asked.options, { label: 'Never', says: 'Never run it.' }] }],
    ['no commands', { commands: undefined }],
    ['an empty list of commands', { commands: [] }],
  ];
  for (const [name, change] of changed) assert.match(questionProblem({ ...asked, ...change }) ?? '', /Not now/, name);
  assert.throws(() => composeCard({
    kind: 'question', level: 3, what: 'Which commands?', why: 'w', because: 'b', meanwhile: 'm', recommend: 'Allow this time', options: asked.options,
  }), /Not now/);
});

test('setup\'s card of the rules found offers Confirm all and Let me correct some, names its count, and has no reply code', () => {
  const { question, card } = composeCard(input('confirm-all'));
  assert.deepEqual(card.options, ['Confirm all', 'Let me correct some', 'Not now']);
  assert.equal(question.header, 'Rules found');
  assert.equal(card.code, null);
  assert.equal(setLineOf(question.question), confirmAllLine(DOC, 2));
  refused({ options: [says('Confirm all')] }, /must describe Let me correct some/, 'confirm-all');
  refused({ options: [says('Confirm all'), says('Let me correct some'), says('Show me')] }, /can't describe Show me/, 'confirm-all');
  refused({ what: 'Setup step 5 found 3 rules: "Money is shown in dollars".' }, /what.*how many rules it lists, 2/, 'confirm-all');
  refused({ target: { count: 0, hash: DOC } }, /target/, 'confirm-all');
  refused({ target: { count: 2, hash: 'not hex' } }, /target/, 'confirm-all');
  // One rule reads as one.
  const one = composeCard(input('confirm-all', { what: 'Setup step 5 found 1 rule: "Never push to main".', target: { count: 1, hash: DOC } }));
  assert.equal(setLineOf(one.question.question), confirmAllLine(DOC, 1));
});

test('uninstall\'s card (ruling R90): level 4, no reply code, Remove it and Not now, and a first part naming the project', () => {
  const { question, card } = composeCard(input('uninstall'));
  assert.equal(question.header, 'Uninstall');
  assert.equal(DECIDING.uninstall, 'Remove it');
  assert.deepEqual(card.options, ['Remove it', 'Not now']);
  assert.equal(card.code, null);
  assert.equal(card.line, 'Remove Wheelhouse from cafe menu as listed, fedcba987654');
  assert.ok(!question.question.includes('Reply code:'));
  // Level 4 only: removing Wheelhouse removes the checks.
  refused({ level: 3, checks: undefined }, /level.*4/, 'uninstall');
  // No Show me: the whole list is `cli.js uninstall status`.
  refused({ options: [says('Remove it'), says('Show me')] }, /can't describe Show me/, 'uninstall');
  // The first part names the project its line names, and no other commit.
  refused({ what: 'Remove Wheelhouse from another folder.' }, /must name the project cafe menu/, 'uninstall');
  refused({ what: 'Remove Wheelhouse from cafe menu, as at abcdef123456.' }, /names commit abcdef123456/, 'uninstall');
  // A project's own name that looks like a commit is the project, not a commit.
  assert.doesNotThrow(() => composeCard(input('uninstall', { what: 'Remove Wheelhouse from cafe1234abc: stop its jobs.', target: { project: 'cafe1234abc', hash: DOC } })));
  // A name on two lines, or with a space at an end, gives no line.
  refused({ target: { project: 'cafe\nmenu', hash: DOC } }, /target/, 'uninstall');
  refused({ target: { project: ' cafe', hash: DOC } }, /target/, 'uninstall');
  refused({ target: { project: 'cafe menu', hash: 'xyz' } }, /target/, 'uninstall');
});

test('a usage card offers its switch and its stay option, then Suggest a change…, with its line and no reply code', () => {
  const { question, card } = composeCard(input('usage'));
  assert.deepEqual(card.options, ['Switch to Lean until it resets', 'Stay on Balanced', 'Suggest a change…']);
  assert.equal(card.header, 'Thoroughness');
  assert.equal(lines(question.question).at(-1), usageLine('lean', USAGE_AT));
  assert.equal(card.code, null);
  const two = INPUTS.usage.options;
  refused({ options: [two[0]] }, /must be its switch and its stay option/, 'usage');
  refused({ options: [...two, { label: 'Stay on Lean', says: 'Thoroughness stays on Lean.' }] }, /must be its switch and its stay option/, 'usage');
  refused({ options: [two[0], { label: 'Not now', says: 'Later.' }] }, /must not use Not now/, 'usage');
  refused({ target: { to: 'premium', at: USAGE_AT } }, /needs the Thoroughness level its switch sets/, 'usage');
  refused({ target: { to: 'lean', at: '26 October 2026' } }, /needs the Thoroughness level its switch sets/, 'usage');
  refused({ target: undefined }, /target is needed/, 'usage');
});

test('the premium model\'s card offers its Allow options, then Not now and Suggest a change…, with its line and no reply code', () => {
  const { question, card } = composeCard(input('premium'));
  assert.deepEqual(card.options, ['Allow it within my plan', 'Allow it, paid credits too', 'Not now', 'Suggest a change…']);
  assert.equal(card.header, 'Premium');
  assert.equal(lines(question.question).at(-1), premiumLine(USAGE_AT));
  assert.equal(card.code, null);
  const [within, paid, later] = INPUTS.premium.options;
  refused({ options: [within] }, /must be its Allow options, then Not now/, 'premium');
  refused({ options: [within, paid] }, /must be its Allow options, then Not now/, 'premium');
  refused({ options: [later, within] }, /must be its Allow options, then Not now/, 'premium');
  refused({ options: [{ label: 'Show me', says: 'Shows it.' }, later] }, /must be its Allow options, then Not now/, 'premium');
  refused({ level: 3, checks: undefined }, /premium/, 'premium');
  refused({ target: { at: '26 October 2026' } }, /needs the time the card was offered/, 'premium');
});
