// tests/scripts/decisions/pending.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingDecisions, decisionNumber, readDecisions, isDecisionCard } from '../../../scripts/decisions/pending.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { setupLine } from '../../../scripts/state/card-lines.js';
import { inHome, P, raise, raiseBuildQuestion, typedAnswer, keep } from '../../helpers/decisions-world.js';
import { makeEvent } from '../../../scripts/state/events.js';

test('numbers count up and restart only when none waits', async () => {
  await inHome(() => {
    const first = raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const second = raise('Which harbour comes first on the map?', '2026-11-08T02:00:00.000Z');
    assert.deepEqual(pendingDecisions(P).map((d) => d.n), [1, 2]);
    assert.equal(decisionNumber(P), 3);

    // Decision 1 is answered while 2 waits: 2 keeps its number and the next is 3, never 1 again.
    typedAnswer(first, { n: 1, label: 'B' }, '2026-11-08T03:00:00.000Z');
    assert.deepEqual(pendingDecisions(P).map((d) => d.n), [2]);
    const third = raise('Should the digest carry a picture?', '2026-11-08T04:00:00.000Z');
    assert.deepEqual(pendingDecisions(P).map((d) => d.n), [2, 3]);

    // Once none waits, the next decision starts again at 1.
    typedAnswer(second, { n: 2, label: 'A' }, '2026-11-08T05:00:00.000Z');
    typedAnswer(third, { n: 3, label: 'C' }, '2026-11-08T05:01:00.000Z');
    assert.deepEqual(pendingDecisions(P), []);
    assert.equal(decisionNumber(P), 4, 'a late reply still meets "already answered"');
    raise('Which colour is the header?', '2026-11-08T06:00:00.000Z');
    assert.deepEqual(pendingDecisions(P).map((d) => d.n), [1]);
  });
});

test('a decision carries its options, its recommendation and its reason', async () => {
  await inHome(() => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const [d] = pendingDecisions(P);
    assert.deepEqual(d.options.map((o) => o.label), ['Daily', 'Weekly', 'Monthly']);
    assert.equal(d.recommend, 'Weekly');
    assert.equal(d.because, 'the session building w-tide-1 recommends it');
    assert.equal(d.question, 'How often should the digest go out?');
    assert.match(d.code, /^[A-Z0-9]{4}$/);
  });
});

test('an option\'s cost and undo come from the card when it has them', async () => {
  await inHome(() => {
    const { card } = composeCard({
      kind: 'answer', level: 3, what: 'How often should the digest go out?', why: 'It changes what customers receive.', because: 'most people want one a week.',
      meanwhile: 'The piece carries on.', recommend: 'Weekly', target: { questionId: 'q-w-tide-1-90' },
      options: [
        { label: 'Daily', says: 'One email each morning.', cost: 'About a day of work.', undo: 'Can be changed later.' },
        { label: 'Weekly', says: 'One email each Monday.', cost: 'About a day of work.', undo: 'Can be changed later.' },
      ],
    });
    keep(makeEvent({ kind: 'card', data: card, now: () => new Date('2026-11-08T01:00:00.000Z') }));
    const [d] = pendingDecisions(P);
    assert.deepEqual(d.options.map((o) => [o.cost, o.undo]), [['About a day of work.', 'Can be changed later.'], ['About a day of work.', 'Can be changed later.']]);
  });
});

test('a decision made from a question of the build names its work', async () => {
  await inHome(() => {
    raiseBuildQuestion('q-w-tide-1-1', '2026-11-08T01:00:00.000Z');
    const [d] = pendingDecisions(P);
    assert.equal(d.work, 'w-tide-1');
    assert.deepEqual(d.options.map((o) => o.label), ['Show them', 'Leave them out']);
  });
});

test('a decision with no reply still waits after thirty days', async () => {
  await inHome(() => {
    raise('How often should the digest go out?', '2026-09-01T00:00:00.000Z');
    const [d] = pendingDecisions(P);
    assert.equal(d.raisedAt, '2026-09-01T00:00:00.001Z');
    assert.ok(Date.now() - Date.parse(d.raisedAt) > 30 * 24 * 60 * 60 * 1000);
  });
});

test('an answer by an unsigned record decides nothing', async () => {
  await inHome(() => {
    const card = raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const signed = typedAnswer(card, { n: 1, label: 'B' }, '2026-11-08T02:00:00.000Z');
    const { sig, ...unsigned } = signed;
    assert.ok(sig);
    assert.equal(readDecisions(P, { events: [card, unsigned] }).pending.length, 1);
    assert.equal(readDecisions(P, { events: [card, signed] }).pending.length, 0);
  });
});

test('click-only kinds and build-command questions are not decisions', () => {
  const { card: setup } = composeCard({
    kind: 'setup', level: 3, what: 'Set up step 4 as listed.', why: 'It changes the project.', because: 'it is the next step.', meanwhile: 'Nothing else changes.',
    options: [{ label: 'Go ahead', says: 'Do it.' }], recommend: 'Go ahead', target: { step: 4, hash: 'abcdef123456' },
  });
  assert.equal(setup.line, setupLine(4, 'abcdef123456'));
  assert.equal(isDecisionCard(setup), false);
  // A product question and the cards Wheelhouse raises about itself are acted on by their click, so they stay on the picker.
  const { card: product } = composeCard({
    kind: 'question', level: 2, what: 'Which colour is the header?', why: 'It is yours.', because: 'it is bold.', meanwhile: 'Nothing waits.',
    options: [{ label: 'Red', says: 'Red.' }, { label: 'Blue', says: 'Blue.' }], recommend: 'Red',
  });
  assert.equal(isDecisionCard(product), false);
  assert.equal(isDecisionCard({ kind: 'answer', options: ['Allow this time', 'Allow for this feature', 'Not now'] }), false);
  // The composed card carries the button that steers it as well, which is not one of its options.
  assert.equal(isDecisionCard({ kind: 'answer', options: ['Allow this time', 'Allow for this feature', 'Not now', 'Suggest a change…'] }), false);
});
