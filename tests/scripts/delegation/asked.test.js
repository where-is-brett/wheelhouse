// tests/scripts/delegation/asked.test.js
// One decision, one card (delegated decisions design, section 7.4): the key is the piece and its words, and an earlier
// answer is taken only where every condition holds. Anything less is a card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decisionKey, earlierAnswer, reuse, spokenSince, repeatExclusions } from '../../../scripts/delegation/asked.js';

const OPTIONS = [{ label: 'The first' }, { label: 'The last' }];
const hit = {
  ask: { kind: 'blocked', level: 3, options: [{ label: 'the last.' }, { label: 'THE FIRST' }] },
  earlier: { answer: 'The last', level: 3, options: OPTIONS },
  commitsSince: 0, spokenSince: false, changed: false, exclusions: [],
};

test('the key is from the piece and the words, and the topic label plays no part', () => {
  assert.equal(decisionKey('w', 'Which one?'), decisionKey('w', ' which  ONE'));
  assert.notEqual(decisionKey('w', 'Which one?'), decisionKey('x', 'Which one?'));
  assert.notEqual(decisionKey('w', 'Which one?'), decisionKey('w', 'Which two?'));
  assert.notEqual(decisionKey('ab', 'c'), decisionKey('a', 'bc'), 'the piece and the words stay apart');
  assert.match(decisionKey('w', 'Which one?'), /^[0-9a-f]{64}$/);
  assert.equal(decisionKey.length, 2, 'nothing else goes in');
});

test('an exact repeat takes the earlier answer only when all hold', () => {
  assert.deepEqual(reuse(hit), { answer: 'The last' });
  assert.deepEqual(reuse({ ...hit, ask: { ...hit.ask, kind: 'question' } }), { answer: 'The last' });
  const other = [{ label: 'The first' }, { label: 'The middle' }];
  for (const miss of [
    { ask: { ...hit.ask, kind: 'approval' } }, { ask: { ...hit.ask, level: 4 } }, { ask: { ...hit.ask, options: other } },
    { earlier: { ...hit.earlier, level: 4 } }, { commitsSince: 1 }, { commitsSince: null }, { exclusions: ['data-model'] }, { exclusions: null }, { asksAgain: true },
  ]) assert.equal(reuse({ ...hit, ...miss })?.answer, undefined, JSON.stringify(miss));
});

test('a stale answer dies: the director spoke on the piece, or changed it', () => {
  assert.equal(reuse({ ...hit, spokenSince: true }), null);
  assert.equal(reuse({ ...hit, changed: true }), null);
});

test('same words and different options is a card saying You said this before', () => {
  assert.deepEqual(reuse({ ...hit, ask: { ...hit.ask, options: [{ label: 'The middle' }] } }), { card: 'said-before' });
  assert.deepEqual(reuse({ ...hit, commitsSince: 2 }), { card: 'said-before' });
  assert.deepEqual(reuse({ ...hit, commitsSince: null }), { card: 'said-before' }, 'commits that can\'t be read give a card');
  assert.deepEqual(reuse({ ...hit, exclusions: ['guardrail'] }), { card: 'said-before' });
});

test('with no earlier answer, an approval or level 4, nothing is said of one', () => {
  assert.equal(reuse({ ...hit, earlier: null }), null);
  assert.equal(reuse({ ...hit, ask: { ...hit.ask, kind: 'approval' } }), null);
  assert.equal(reuse({ ...hit, ask: { ...hit.ask, level: 4 } }), null);
});

const asked = (over = {}, answer = { label: 'The last', at: '2026-11-01T01:00:00.000Z' }) => ({ question: { data: { work: 'w', key: 'k', level: 3, options: OPTIONS, head: 'a'.repeat(40), ...over } }, answer });

test('the earlier answer is the latest the build was given, on this piece, for this key', () => {
  const views = { questions: {
    'q-w-1': asked(),
    'q-w-2': asked({}, { label: 'The first', at: '2026-11-01T02:00:00.000Z' }),
    'q-w-3': asked({}, { label: 'The first', at: '2026-11-01T03:00:00.000Z' }),
    'q-w-4': asked({}, null),
    'q-x-1': asked({ work: 'x' }, { label: 'The first', at: '2026-11-01T05:00:00.000Z' }),
    'q-w-5': asked({ key: 'other' }, { label: 'The first', at: '2026-11-01T05:00:00.000Z' }),
  } };
  const got = earlierAnswer({ views, work: 'w', key: 'k', settled: (id) => id !== 'q-w-3' });
  assert.deepEqual([got.id, got.answer, got.level, got.head], ['q-w-2', 'The first', 3, 'a'.repeat(40)]);
  assert.equal(earlierAnswer({ views, work: 'w', key: 'none', settled: () => true }), null);
  assert.equal(earlierAnswer({ views: {}, work: 'w', key: 'k', settled: () => true }), null);
});

test('the director speaks on a piece by answering, steering or recording it again', () => {
  const at = '2026-11-01T02:00:00.000Z';
  const earlier = { id: 'q-w-1', at };
  const views = (questions, work = {}) => ({ questions: { 'q-w-1': asked({}, { label: 'The last', at }), ...questions }, work: { w: { work: { at: '2026-11-01T00:00:00.000Z', ...work } } } });
  assert.equal(spokenSince({ views: views({}), work: 'w', earlier }), false);
  assert.equal(spokenSince({ views: views({ 'q-w-2': asked({ key: 'other' }, { label: 'x', at: '2026-11-01T03:00:00.000Z' }) }), work: 'w', earlier }), true);
  assert.equal(spokenSince({ views: views({ 'q-w-2': asked({ key: 'other' }, { label: 'x', at: '2026-11-01T01:00:00.000Z' }) }), work: 'w', earlier }), false, 'an answer before it');
  assert.equal(spokenSince({ views: views({ 'q-x-2': asked({ work: 'x' }, { label: 'x', at: '2026-11-01T03:00:00.000Z' }) }), work: 'w', earlier }), false, 'another piece');
  assert.equal(spokenSince({ views: views({ 'q-w-2': { ...asked({ key: 'other' }, null), steered: '2026-11-01T03:00:00.000Z' } }), work: 'w', earlier }), true, 'a steer on a card still open');
  assert.equal(spokenSince({ views: views({}, { at: '2026-11-01T03:00:00.000Z' }), work: 'w', earlier }), true, 'the piece recorded again');
});

test('exclusions that can\'t be read are none to rely on, and a piece with nothing done hits none', () => {
  assert.equal(repeatExclusions({ readable: false }), null);
  assert.equal(repeatExclusions({ readable: false, head: 'a' }), null, 'work not committed');
  assert.deepEqual(repeatExclusions({ readable: false, head: 'a', nothing: true }), []);
  assert.deepEqual(repeatExclusions({ readable: true, guardrail: false, secrets: false, critical: false, schemaChanged: true, depsChanged: false }), ['data-model']);
  assert.deepEqual(repeatExclusions({ readable: true, guardrail: false, secrets: false, critical: false, schemaChanged: false, depsChanged: false }), []);
  assert.equal(repeatExclusions(null), null);
});
