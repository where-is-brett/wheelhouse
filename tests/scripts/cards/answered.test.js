// tests/scripts/cards/answered.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WHERE, answeredWords, subjectOf, whenSaid, countedOf, askOf } from '../../../scripts/cards/answered.js';

const NOW = new Date(2026, 10, 4, 10, 40);
const at = (y, m, d, h, min) => new Date(y, m, d, h, min).toISOString();
const card = (data = {}) => ({ id: 'c1', data: { question: 'Approve the Doubt plan?', kind: 'question', ...data } });

test('WHERE names the three places', () => {
  assert.deepEqual([...WHERE], ['panel', 'chat', 'reply']);
  assert.throws(() => { WHERE.push('x'); });
});

test('answeredWords: approve in the panel today', () => {
  const decided = { at: at(2026, 10, 4, 10, 34), label: 'Approve', where: 'panel' };
  assert.equal(answeredWords({ card: card({ kind: 'approval' }), decided }, NOW), 'approved in the panel at 10:34');
});

test('answeredWords: another label reads as answered, in the chat', () => {
  const decided = { at: at(2026, 10, 4, 9, 2), label: 'Not now', where: 'chat' };
  assert.equal(answeredWords({ card: card(), decided }, NOW), 'answered Not now in the chat at 09:02');
});

test('answeredWords: a reply code, another day, and no place', () => {
  assert.equal(answeredWords({ card: card(), decided: { at: at(2026, 10, 4, 10, 1), label: 'Round', where: 'reply' } }, NOW), 'answered Round by reply code at 10:01');
  assert.equal(answeredWords({ card: card({ kind: 'approval' }), decided: { at: at(2026, 10, 3, 18, 10), label: 'Approve', where: null } }, NOW), 'approved on 3 November at 18:10');
  assert.equal(answeredWords({ card: card({ kind: 'approval' }), decided: { at: at(2026, 10, 4, 10, 34), label: 'Approve', where: null } }, NOW), 'approved at 10:34');
  assert.equal(answeredWords({ card: card({ kind: 'approval' }), decided: { at: at(2026, 10, 3, 18, 10), label: 'Approve', where: 'panel' } }, NOW), 'approved in the panel on 3 November at 18:10');
});

test('answeredWords: Confirm and Push it, and a signed record with no label', () => {
  const d = { at: at(2026, 10, 4, 10, 34), where: 'chat' };
  assert.equal(answeredWords({ card: card(), decided: { ...d, label: 'Confirm' } }, NOW), 'confirmed in the chat at 10:34');
  assert.equal(answeredWords({ card: card(), decided: { ...d, label: 'Push it' } }, NOW), 'pushed in the chat at 10:34');
  assert.equal(answeredWords({ card: card({ kind: 'ci-push' }), decided: { ...d, label: null } }, NOW), 'pushed in the chat at 10:34');
});

test('subjectOf: the what line, else the question', () => {
  assert.equal(subjectOf(card({ parts: { what: 'The Doubt plan.\nMore.' } })), 'The Doubt plan.');
  assert.equal(subjectOf(card()), 'Approve the Doubt plan?');
  assert.equal(subjectOf(card({ parts: { what: '' }, question: 'First\nSecond' })), 'First');
});

test('the moved helpers behave as before', () => {
  assert.equal(whenSaid('nonsense', NOW), 'earlier');
  assert.equal(askOf(card({ question: 'A\nB' })), 'A');
  assert.equal(countedOf({ card: card({ kind: 'confirm' }), decided: { label: null } }), 'Confirm');
  assert.equal(countedOf({ card: card(), decided: { label: null } }), 'an answer');
});
