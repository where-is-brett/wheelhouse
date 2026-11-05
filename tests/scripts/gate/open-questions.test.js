// tests/scripts/gate/open-questions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionHold, questionsOf } from '../../../scripts/gate/open-questions.js';

const q = (work, answerAt = null) => ({ question: { data: { work } }, answer: answerAt === null ? null : { label: 'Cut it', at: answerAt } });
const review = (at) => ({ kind: 'review', at, data: { verdict: 'CLEAN' } });

test('a question still open on the work holds the merge', () => {
  const views = { questions: { a: q('todo-cli'), b: q('other') } };
  assert.match(questionHold({ views, work: 'todo-cli', review: review('2026-11-06T10:00:00.000Z') }), /a question open on todo-cli/);
  assert.equal(questionHold({ views, work: 'unrelated', review: review('2026-11-06T10:00:00.000Z') }), null);
});

test('an answer given after the head was reviewed holds the merge, carried or not', () => {
  const views = { questions: { a: q('todo-cli', '2026-11-06T11:00:00.000Z') } };
  const hold = questionHold({ views, work: 'todo-cli', review: review('2026-11-06T10:00:00.000Z') });
  assert.match(hold, /answered a question on todo-cli after this version was reviewed/);
  assert.match(questionHold({ views, work: 'todo-cli', review: { carried: true, record: review('2026-11-06T10:00:00.000Z') } }), /after this version was reviewed/);
});

test('an answer given before the head was reviewed does not hold it', () => {
  const views = { questions: { a: q('todo-cli', '2026-11-06T09:00:00.000Z') } };
  assert.equal(questionHold({ views, work: 'todo-cli', review: review('2026-11-06T10:00:00.000Z') }), null);
});

test('no questions, no review time or odd input holds nothing and never throws', () => {
  assert.equal(questionHold({ views: { questions: {} }, work: 'w', review: null }), null);
  assert.equal(questionHold({ views: { questions: { a: q('w', '2026-11-06T11:00:00.000Z') } }, work: 'w', review: null }), null);
  assert.equal(questionHold({ views: null, work: undefined, review: undefined }), null);
  assert.deepEqual(questionsOf({ questions: { a: null, b: { question: null } } }, 'w'), []);
});
