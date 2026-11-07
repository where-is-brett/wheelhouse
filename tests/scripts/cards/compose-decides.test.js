// tests/scripts/cards/compose-decides.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeCard, answerInput, questionProblem } from '../../../scripts/cards/compose.js';

const data = (extra = {}) => ({
  id: 'q-w-tide-1-1', work: 'w-tide-1', what: 'Which order do the tide times show in?', why: 'It decides what visitors see.',
  options: [{ label: 'Soonest', says: 'Soonest first.' }, { label: 'Latest', says: 'Latest first.' }], recommendation: 'Soonest', level: 3, ...extra,
});

test('a question about a director kind needs level 3 or above, and an unknown kind is the director\'s', () => {
  for (const decides of ['algorithm', 'security', 'something-new']) {
    assert.equal(questionProblem(data({ level: 3, decides })), null, `${decides} at 3`);
    assert.equal(questionProblem(data({ level: 4, decides })), null, `${decides} at 4`);
    for (const level of [1, 2]) assert.match(questionProblem(data({ level, decides })), /level.*3 or 4/, `${decides} at ${level}`);
  }
});

test('a question about an agent kind, or about no kind, may come at any level', () => {
  for (const level of [1, 2, 3, 4]) assert.equal(questionProblem(data({ level, decides: 'structure' })), null);
  assert.equal(questionProblem(data({ level: 1 })), null);
});

test('decides belongs to a question or an answer card, as text', () => {
  const input = answerInput(data({ level: 3, decides: 'algorithm' }), 'w-tide-1');
  assert.equal(input.decides, 'algorithm');
  assert.ok(composeCard(input));
  assert.throws(() => composeCard({ ...input, decides: '' }), /decides/);
  assert.throws(() => composeCard({ ...input, kind: 'approval', decides: 'algorithm' }), /decides/);
});
