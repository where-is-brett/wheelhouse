// tests/scripts/decisions/reply.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReply } from '../../../scripts/decisions/reply.js';

const options = [{ label: 'Daily' }, { label: 'Weekly' }, { label: 'Monthly' }];
const decision = (n, code) => ({ n, code, options });
const one = [decision(1, 'K7QP')];
const two = [decision(1, 'K7QP'), decision(2, 'M3TX')];

test('a lone letter answers the only waiting decision', () => assert.deepEqual(parseReply('B', one), { kind: 'answer', n: 1, label: 'B', words: '' }));

test('a lone letter with two waiting is ambiguous', () => assert.deepEqual(parseReply('b', two).candidates, [1, 2]));

test('"2 c", "2C" and "#2 C" answer decision 2 with C', () => {
  for (const text of ['2 c', '2C', '#2 C', 'Reply 2 C']) {
    assert.deepEqual(parseReply(text, two), { kind: 'answer', n: 2, label: 'C', words: '' }, text);
  }
});

test('"2: weekly, not daily" is decision 2 in the director\'s own words', () => {
  assert.deepEqual(parseReply('2: weekly, not daily', two), { kind: 'answer', n: 2, label: 'own', words: 'weekly, not daily' });
});

test('"B, but keep the old export" is B with words', () => {
  assert.deepEqual(parseReply('B, but keep the old export', one), { kind: 'answer', n: 1, label: 'B', words: 'but keep the old export' });
});

test('a reply code and a letter answer that code\'s decision', () => {
  assert.deepEqual(parseReply('M3TX B', two), { kind: 'answer', n: 2, label: 'B', words: '' });
  assert.deepEqual(parseReply('m3tx: use monthly', two), { kind: 'answer', n: 2, label: 'own', words: 'use monthly' });
});

test('"why" and "why 2 what about cost" ask why', () => {
  assert.deepEqual(parseReply('why', one), { kind: 'why', n: 1, words: '' });
  assert.deepEqual(parseReply('why 2 what about cost', two), { kind: 'why', n: 2, words: 'what about cost' });
  assert.deepEqual(parseReply('2 why', two), { kind: 'why', n: 2, words: '' });
  assert.deepEqual(parseReply('why', two).candidates, [1, 2]);
});

test('words with no number or letter are not an answer, even with one waiting', () => {
  assert.equal(parseReply('looks good to me', one).kind, 'none');
  assert.equal(parseReply('A lot of this looks fine', one).kind, 'none');
  assert.equal(parseReply('2 weekly please', two).kind, 'none');
  assert.equal(parseReply('2', two).kind, 'none');
});

test('a letter beyond the options is refused', () => {
  assert.deepEqual(parseReply('1 E', one), { kind: 'refused', n: 1, reason: 'beyond-options' });
  assert.deepEqual(parseReply('E', one), { kind: 'refused', n: 1, reason: 'beyond-options' });
});

test('a number that waits on nothing is refused, but only when it reads as a reply', () => {
  assert.deepEqual(parseReply('7 A', two), { kind: 'refused', n: 7, reason: 'not-waiting' });
  assert.equal(parseReply('7 things to ask you about', two).kind, 'none');
});

test('with no decision waiting nothing is a reply', () => {
  assert.equal(parseReply('B', []).kind, 'none');
  assert.equal(parseReply('2 A', []).kind, 'none');
});
