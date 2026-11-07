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

test('"why", "why?", "why 2" and "why 2?" ask why, and nothing longer does', () => {
  assert.deepEqual(parseReply('why', one), { kind: 'why', n: 1, words: '' });
  assert.deepEqual(parseReply('Why?', one), { kind: 'why', n: 1, words: '' });
  assert.deepEqual(parseReply('why 2', two), { kind: 'why', n: 2, words: '' });
  assert.deepEqual(parseReply('why #2?', two), { kind: 'why', n: 2, words: '' });
  assert.deepEqual(parseReply('why', two).candidates, [1, 2]);
  assert.deepEqual(parseReply('why 7', two), { kind: 'refused', n: 7, reason: 'not-waiting' });
  // A sentence that starts with why is the director talking.
  for (const text of ['Why is the build slow?', 'why 2 what about cost', 'why not both', '2 why']) assert.equal(parseReply(text, two).kind, 'none', text);
});

test('a letter is followed by the end, or by a mark that closes there: "2 a.m. works" is no answer', () => {
  for (const text of ['2 a.m. works', 'a.m.', 'A-list customers', 'B2B sales first', 'a/b test']) assert.equal(parseReply(text, two).kind, 'none', text);
  assert.equal(parseReply('a.m. works', one).kind, 'none');
  assert.deepEqual(parseReply('B.', one), { kind: 'answer', n: 1, label: 'B', words: '' });
  assert.deepEqual(parseReply('2 B, but later', two), { kind: 'answer', n: 2, label: 'B', words: 'but later' });
});

test('own words after "n:" need a space after the colon: "2:30 is fine" and "1:1 with Sam" are no answer', () => {
  for (const text of ['2:30 is fine', '1:1 with Sam', '2:weekly', '1:30pm']) assert.equal(parseReply(text, two).kind, 'none', text);
  assert.equal(parseReply('7:30 is fine', two).kind, 'none');
  assert.deepEqual(parseReply('2: weekly', two), { kind: 'answer', n: 2, label: 'own', words: 'weekly' });
  assert.deepEqual(parseReply('1 : weekly', two), { kind: 'answer', n: 1, label: 'own', words: 'weekly' });
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
