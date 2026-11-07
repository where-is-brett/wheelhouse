// tests/scripts/decisions/private.test.js
// A decision on a public project can be answered "private": the signed private record keeps it, and no file goes into the
// project. The mark is a trailing word after a letter, and the message offers it only where the project is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReply } from '../../../scripts/decisions/reply.js';
import { decisionText, blocksIn } from '../../../scripts/decisions/message.js';
import { makeEvent } from '../../../scripts/state/events.js';

const options = [{ label: 'Daily' }, { label: 'Weekly' }, { label: 'Monthly' }];
const decision = (n, code) => ({ n, code, options });
const one = [decision(1, 'K7QP')];
const two = [decision(1, 'K7QP'), decision(2, 'M3TX')];

test('a trailing "private" after a letter keeps the choice and marks it private', () => {
  assert.deepEqual(parseReply('2 B private', two), { kind: 'answer', n: 2, label: 'B', words: '', private: true });
  assert.deepEqual(parseReply('B private', one), { kind: 'answer', n: 1, label: 'B', words: '', private: true });
  assert.deepEqual(parseReply('Reply 2 b PRIVATE.', two), { kind: 'answer', n: 2, label: 'B', words: '', private: true });
  assert.deepEqual(parseReply('M3TX C private', two), { kind: 'answer', n: 2, label: 'C', words: '', private: true });
  assert.deepEqual(parseReply('2: B private', two), { kind: 'answer', n: 2, label: 'B', words: '', private: true });
});

test('"private" inside the director\'s own words, or after words, is never taken as the mark', () => {
  assert.deepEqual(parseReply('2: keep it private', two), { kind: 'answer', n: 2, label: 'own', words: 'keep it private' });
  assert.deepEqual(parseReply('B, but keep it private', one), { kind: 'answer', n: 1, label: 'B', words: 'but keep it private' });
  assert.equal(parseReply('2 B', two).private, undefined);
});

test('"private" after a letter that offers no option is refused as the letter is', () => {
  assert.deepEqual(parseReply('2 D private', two), { kind: 'refused', n: 2, reason: 'beyond-options' });
});

const shown = {
  n: 2,
  question: 'How often should the digest go out?',
  work: 'Weekly digest',
  why: 'It changes what customers receive, so it is yours.',
  options: [{ label: 'Daily', says: 'One email each morning' }, { label: 'Weekly', says: 'One email each Monday' }],
  recommend: 'Weekly',
  because: 'most people ask for one email a week.',
  meanwhile: 'The piece builds the weekly version.',
};

test('the private line shows only on a public project\'s decision', () => {
  const plain = decisionText(shown);
  assert.ok(!/private/i.test(plain));
  assert.equal(plain.split('\n').at(-1), 'Reply 2 A, 2 B, "why 2", or "2: your own words".');

  const offered = decisionText({ ...shown, canPrivate: true });
  const lines = offered.split('\n');
  assert.match(lines.at(-2), /^This project is public\. Add "private" after your letter \("2 B private"\) to keep this answer out of the project's files\.$/);
  // The Reply line stays last, so the block still runs from its first line to its Reply line.
  assert.equal(lines.at(-1), 'Reply 2 A, 2 B, "why 2", or "2: your own words".');
  assert.deepEqual(blocksIn(`Here you go.\n\n${offered}\n\nThanks.`), [offered]);
});

test('a decision-answer may carry private: true, and nothing else extra', () => {
  const now = () => new Date('2026-11-07T01:00:00.000Z');
  const data = { question: 'Which?', n: 1, label: 'B', option: 'Weekly', words: '', where: 'chat' };
  assert.ok(makeEvent({ kind: 'decision-answer', data: { ...data, private: true }, now }));
  assert.ok(makeEvent({ kind: 'decision-answer', data, now }));
  assert.throws(() => makeEvent({ kind: 'decision-answer', data: { ...data, private: false }, now }), /decision-answer/);
  assert.throws(() => makeEvent({ kind: 'decision-answer', data: { ...data, private: 'yes' }, now }), /decision-answer/);
  assert.throws(() => makeEvent({ kind: 'decision-answer', data: { ...data, public: true }, now }), /decision-answer/);
  // The director's own words never carry the mark: it follows a letter.
  assert.throws(() => makeEvent({ kind: 'decision-answer', data: { ...data, label: 'own', option: '', words: 'x', private: true }, now }), /decision-answer/);
});
