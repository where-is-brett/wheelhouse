// tests/scripts/decisions/signed.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signedDecisionFor } from '../../../scripts/decisions/signed.js';
import { inHome, P, raiseBuildQuestion, typedAnswer } from '../../helpers/decisions-world.js';

const ASK = 'Should the harbour map show tide times?';

test('an answer signed for the same work and question is found, with its time', async () => {
  await inHome(() => {
    const card = raiseBuildQuestion('q-w-tide-1-1', '2026-11-08T01:00:00.000Z');
    typedAnswer(card, { n: 1, label: 'A' }, '2026-11-08T02:00:00.000Z');
    assert.deepEqual(signedDecisionFor(P, 'w-tide-1', ASK), { at: '2026-11-08T02:00:00.000Z' });
  });
});

test('no signed answer, another work or another question gives null', async () => {
  await inHome(() => {
    const card = raiseBuildQuestion('q-w-tide-1-1', '2026-11-08T01:00:00.000Z');
    assert.equal(signedDecisionFor(P, 'w-tide-1', ASK), null, 'asked but not answered');
    typedAnswer(card, { n: 1, label: 'A' }, '2026-11-08T02:00:00.000Z');
    assert.equal(signedDecisionFor(P, 'w-other-2', ASK), null);
    assert.equal(signedDecisionFor(P, 'w-tide-1', 'Which colour is the header?'), null);
  });
});

test('an unreadable record gives null, so the card is asked as usual', async () => {
  await inHome(() => {
    assert.equal(signedDecisionFor('no__such-project', 'w-tide-1', ASK), null);
  });
});
