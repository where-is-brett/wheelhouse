// tests/scripts/hooks/stopped-question.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stoppedQuestion } from '../../../scripts/hooks/stopped-question.js';

const ask = (id, ...questions) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions: questions.map((question) => ({ question })) } }] },
});
const stopped = (id) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'The user doesn\'t want to proceed with this tool use.' }] },
});
const interrupted = { type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } };
const answered = (id) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'User has answered your questions.' }] },
  toolUseResult: { answers: { 'Approve A?': 'Approve' } },
});
const said = (text) => ({ type: 'user', message: { content: text } });

test('a stopped card question is found, with the 4 November words', () => {
  const entries = [said('Hello'), ask('t1', 'Approve A?', 'Approve B?'), stopped('t1'), interrupted];
  assert.deepEqual(stoppedQuestion(entries), ['Approve A?', 'Approve B?']);
});

test('the match does not depend on the error words', () => {
  const odd = { ...stopped('t1'), message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Something else entirely' }] } };
  assert.deepEqual(stoppedQuestion([ask('t1', 'Approve A?'), odd]), ['Approve A?']);
});

test('an answered question is null', () => {
  assert.equal(stoppedQuestion([ask('t1', 'Approve A?'), answered('t1')]), null);
});

test('a question with no result yet, and no question at all, are null', () => {
  assert.equal(stoppedQuestion([ask('t1', 'Approve A?')]), null);
  assert.equal(stoppedQuestion([said('Hello')]), null);
  assert.equal(stoppedQuestion(null), null);
});

test('a prompt of the director\'s after the stopped question makes it null', () => {
  const entries = [ask('t1', 'Approve A?'), stopped('t1'), interrupted, said('Why was that?')];
  assert.equal(stoppedQuestion(entries), null);
});

test('the prompt now arriving does not count, even when the transcript already holds it', () => {
  const entries = [ask('t1', 'Approve A?'), stopped('t1'), interrupted, said('What did I answer?')];
  assert.deepEqual(stoppedQuestion(entries, { prompt: 'What did I answer?' }), ['Approve A?']);
  assert.equal(stoppedQuestion([...entries, said('And again?')], { prompt: 'And again?' }), null);
});

test('only the last card question counts', () => {
  const entries = [ask('t1', 'Old?'), stopped('t1'), ask('t2', 'New?'), answered('t2')];
  assert.equal(stoppedQuestion(entries), null);
});
