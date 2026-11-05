// tests/scripts/gate/open-questions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionHold, questionsOf } from '../../../scripts/gate/open-questions.js';

const q = (work, answerAt = null, id = 'q') => ({ question: { data: { work } }, answer: answerAt === null ? null : { label: 'Cut it', at: answerAt } });
const review = (at) => ({ kind: 'review', at, data: { verdict: 'CLEAN' } });

test('a question still open on the work holds the merge', () => {
  const views = { questions: { 'q-todo-cli-1': q('todo-cli'), 'q-other-1': q('other') } };
  assert.match(questionHold({ views, work: 'todo-cli', review: review('2026-11-06T10:00:00.000Z') }), /a question open on todo-cli/);
  assert.equal(questionHold({ views, work: 'unrelated', review: review('2026-11-06T10:00:00.000Z') }), null);
});

test('an answer given after the head was reviewed holds the merge, carried or not', () => {
  const views = { questions: { 'q-todo-cli-1': q('todo-cli', '2026-11-06T11:00:00.000Z') } };
  const hold = questionHold({ views, work: 'todo-cli', review: review('2026-11-06T10:00:00.000Z') });
  assert.match(hold, /answered a question on todo-cli after this version was reviewed/);
  assert.match(questionHold({ views, work: 'todo-cli', review: { carried: true, record: review('2026-11-06T10:00:00.000Z') } }), /after this version was reviewed/);
});

test('an answer given before the head was reviewed does not hold it', () => {
  const views = { questions: { 'q-todo-cli-1': q('todo-cli', '2026-11-06T09:00:00.000Z') } };
  assert.equal(questionHold({ views, work: 'todo-cli', review: review('2026-11-06T10:00:00.000Z') }), null);
});

test('no questions, no review time or odd input holds nothing and never throws', () => {
  assert.equal(questionHold({ views: { questions: {} }, work: 'w', review: null }), null);
  assert.equal(questionHold({ views: { questions: { 'q-w-1': q('w', '2026-11-06T11:00:00.000Z') } }, work: 'w', review: null }), null);
  assert.equal(questionHold({ views: null, work: undefined, review: undefined }), null);
  assert.deepEqual(questionsOf({ questions: { 'q-w-1': null, 'q-w-2': { question: null } } }, 'w'), []);
});

test('an answer marked as needing no change lets go, only for the answer time it covers', async () => {
  const { markHandled, readHandled } = await import('../../../scripts/gate/open-questions.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handled-'));
  const at = '2026-11-06T11:00:00.000Z';
  const views = { questions: { 'q-todo-cli-1': q('todo-cli', at) } };
  const rev = review('2026-11-06T10:00:00.000Z');
  assert.match(questionHold({ views, work: 'todo-cli', review: rev, handled: readHandled(dir, ['q-todo-cli-1']) }), /after this version was reviewed/);
  assert.equal(markHandled(dir, 'q-todo-cli-1', at), true);
  assert.equal(questionHold({ views, work: 'todo-cli', review: rev, handled: readHandled(dir, ['q-todo-cli-1']) }), null);
  // The director changes the answer: a new time holds again.
  const changed = { questions: { 'q-todo-cli-1': q('todo-cli', '2026-11-06T12:00:00.000Z') } };
  assert.match(questionHold({ views: changed, work: 'todo-cli', review: rev, handled: readHandled(dir, ['q-todo-cli-1']) }), /after/);
  assert.equal(markHandled(dir, '../x', at), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// A question the work's own session raised counts; the other kinds, left open by their nature, never hold a merge.
const entry = (id, over = {}, answer = null) => ({ question: { data: { work: 'w', ...(over.data ?? {}) } }, answer, ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'data')) });

test('an engine question never holds a merge', () => {
  assert.deepEqual(questionsOf({ questions: { 'q-w-1': entry('q-w-1', { data: { engine: { runId: 'r' } } }) } }, 'w'), []);
});

test('a question with a key of its own never holds a merge', () => {
  assert.deepEqual(questionsOf({ questions: { 'q-w-1': entry('q-w-1', { data: { key: 'k' } }) } }, 'w'), []);
});

test('a question that joins another, or is gone, never holds a merge', () => {
  assert.deepEqual(questionsOf({ questions: { 'q-w-1': entry('q-w-1', { joins: 'q-w-2' }), 'q-w-3': entry('q-w-3', { gone: true }) } }, 'w'), []);
});

test('a question asked again that the director had already answered never holds a merge', () => {
  assert.deepEqual(questionsOf({ questions: { 'q-w-1': entry('q-w-1', { saidBefore: { label: 'x', at: 'y' } }) } }, 'w'), []);
});

test('a question tied to a change by hand, or with an id the work did not raise, never holds a merge', () => {
  assert.deepEqual(questionsOf({ questions: { 'q-w-1': entry('q-w-1', { byHand: { n: 1 } }), 'by-hand-3': entry('by-hand-3'), 'q-other-1': entry('q-other-1') } }, 'w'), []);
});

test('a plain question the work raised counts, answered or not', () => {
  const found = questionsOf({ questions: { 'q-w-1': entry('q-w-1'), 'q-w-2': entry('q-w-2', {}, { label: 'x', at: '2026-11-06T11:00:00.000Z' }) } }, 'w');
  assert.deepEqual(found.map((f) => [f.id, f.answered]), [['q-w-1', false], ['q-w-2', true]]);
});
