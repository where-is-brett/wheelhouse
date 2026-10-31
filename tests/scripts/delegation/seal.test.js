// tests/scripts/delegation/seal.test.js
// A seal: what the script checks said about a card, hashed, and what no rule can reach marked as such.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealOf, scoreOf, scoreLine, firstLines } from '../../../scripts/delegation/seal.js';
import { SUGGEST_LABEL } from '../../../scripts/engine/router.js';
import { setupStamp } from '../../../scripts/delegation/stamp.js';
import { CANDIDATES } from '../../../scripts/delegation/candidates.js';
import { dataHash, makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { withHome } from '../../helpers/homes.js';

const AT = '2026-11-01T02:00:00.000Z';
const stamp = setupStamp({ bindings: { reviewer: null }, packDigest: 'd'.repeat(64), ruleHash: null, exclusionsHash: 'e'.repeat(64) });
const facts = { readable: true, head: 'a'.repeat(40), paths: ['src/a.js'], lines: 2, testsChanged: false, depsChanged: false, schemaChanged: true, guardrail: false, secrets: false, critical: false };
const card = (over = {}) => ({ id: 'q-w-1', kind: 'question', work: 'w', runId: 'r', level: 3, ...over });

test('the stamp names what the reading rests on', () => {
  assert.deepEqual(stamp, { models: { reviewer: null }, pack: 'd'.repeat(64), rule: null, exclusions: 'e'.repeat(64) });
});

test('a question card\'s seal gives every candidate an answer, and the exclusions hit and unread', () => {
  const seal = sealOf({ card: card(), facts, stamp, at: AT });
  assert.equal(seal.card, 'q-w-1');
  assert.equal(seal.work, 'w');
  assert.equal(seal.head, facts.head);
  assert.equal(seal.signed, null);
  assert.equal(seal.reader, true);
  assert.deepEqual(Object.keys(seal.candidates), CANDIDATES.map((c) => c.id));
  assert.deepEqual(seal.exclusions.hit, ['data-model']);
  assert.ok(seal.exclusions.unread.includes('legal'));
  assert.equal(seal.exclusions.unread.includes('data-model'), false);
});

test('the hash covers the whole seal', () => {
  const { hash, ...rest } = sealOf({ card: card(), facts, stamp, at: AT });
  assert.equal(hash, dataHash(rest));
});

test('a card no rule can reach is sealed as what it is, with no reader', () => {
  for (const kind of ['approval', 'cap', 'stall', 'clash', 'red', 'requests', 'fix', 'merge', 'trouble', 'checks', 'folder']) {
    const seal = sealOf({ card: card({ kind }), facts, stamp, at: AT });
    assert.equal(seal.signed, kind);
    assert.equal(seal.reader, false);
  }
});

test('a level 4 card is sealed and marked as no rule can reach it', () => {
  const seal = sealOf({ card: card({ level: 4 }), facts, stamp, at: AT });
  assert.equal(seal.signed, 'level-4');
  assert.equal(seal.reader, false);
});

test('a card with no change to read seals as unreadable, with every exclusion unread', () => {
  const seal = sealOf({ card: card(), facts: { readable: false }, stamp, at: AT });
  assert.equal(seal.head, null);
  assert.ok(seal.exclusions.unread.includes('data-model'));
  assert.deepEqual(seal.exclusions.hit, []);
  assert.equal(seal.candidates.land, null);
});

test('a change that can\'t be read keeps its head', () => {
  assert.equal(sealOf({ card: card(), facts: { readable: false, head: 'a'.repeat(40) }, stamp, at: AT }).head, 'a'.repeat(40));
});

test('what a card\'s context says reaches the candidates', () => {
  assert.equal(sealOf({ card: card(), facts, ctx: { hostPrivate: true }, stamp, at: AT }).candidates['push-draft'], true);
});

test('a seal is a whole shadow line, and a line with anything else isn\'t', () => withHome(() => {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-11-01T00:00:00.000Z' });
  const seal = sealOf({ card: card(), facts, stamp, at: AT });
  assert.equal(makeEvent({ kind: 'shadow', data: seal }).kind, 'shadow');
  assert.throws(() => makeEvent({ kind: 'shadow', data: { ...seal, extra: 1 } }), /shadow/);
  assert.throws(() => makeEvent({ kind: 'shadow', data: { ...seal, hash: 'x' } }), /shadow/);
  assert.throws(() => makeEvent({ kind: 'shadow', data: { ...seal, line: 'other' } }), /shadow/);
}));

const seal = sealOf({ card: card(), facts, stamp, at: AT });
const reading = (pick) => ({ seal, reading: { line: 'reading', card: 'q-w-1', pick } });

test('the reader\'s pick against the director\'s label is a match or a miss', () => {
  assert.equal(scoreOf({ ...reading('Keep'), answer: { label: 'Keep' } }), 'match');
  assert.equal(scoreOf({ ...reading('keep '), answer: { label: 'Keep' } }), 'match');
  assert.equal(scoreOf({ ...reading('Keep'), answer: { label: 'Remove' } }), 'miss');
});

test('a typed answer, a suggestion or a steered card counts outside, whatever it says', () => {
  assert.equal(scoreOf({ ...reading('Keep'), answer: { label: SUGGEST_LABEL, words: 'Keep' } }), 'outside');
  assert.equal(scoreOf({ ...reading('Keep'), answer: { label: 'Keep' }, steered: true }), 'outside');
  assert.equal(scoreOf({ ...reading('Keep'), answer: { label: 'Other', words: 'Keep it, but smaller' } }), 'outside');
});

test('with no reading and no set answer there is no score', () => {
  assert.equal(scoreOf({ seal, reading: null, answer: { label: 'Keep' } }), null);
  assert.equal(scoreOf({ seal, reading: null, answer: { label: SUGGEST_LABEL }, steered: true }), null);
  assert.equal(scoreOf({ seal, reading: { line: 'reading', card: 'q-w-1', pick: null }, answer: { label: 'Keep' } }), null);
});

test('a rule\'s set answer is scored as a reading is', () => {
  assert.equal(scoreOf({ seal: { ...seal, set: 'Keep' }, reading: null, answer: { label: 'Keep' } }), 'match');
  assert.equal(scoreOf({ seal: { ...seal, set: 'Keep' }, reading: { pick: 'Remove' }, answer: { label: 'Keep' } }), 'match');
});

test('with no answer yet there is no score', () => {
  assert.equal(scoreOf({ ...reading('Keep'), answer: null }), null);
});

test('Not now, Explain more, Show me and Why? answer nothing, so they score nothing and aren\'t outside', () => {
  for (const label of ['Not now', 'Explain more', 'Show me', 'Why?']) {
    assert.equal(scoreOf({ ...reading('Keep'), answer: { label } }), null);
  }
});

test('a score is a whole shadow line, tied to its seal by the hash', () => withHome(() => {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-11-01T00:00:00.000Z' });
  const line = scoreLine({ seal, score: 'miss', at: AT });
  assert.deepEqual(Object.keys(line).sort(), ['at', 'card', 'hash', 'line', 'score', 'seal', 'work']);
  assert.equal(line.seal, seal.hash);
  const { hash, ...rest } = line;
  assert.equal(hash, dataHash(rest));
  assert.equal(makeEvent({ kind: 'shadow', data: line }).kind, 'shadow');
  assert.throws(() => makeEvent({ kind: 'shadow', data: { ...line, score: 'close' } }), /shadow/);
  assert.throws(() => makeEvent({ kind: 'shadow', data: { ...line, label: 'Keep' } }), /shadow/);
  assert.throws(() => makeEvent({ kind: 'shadow', data: { ...line, line: 'other' } }), /shadow/);
}));

test('the first of each line stands, oldest first, whatever order the lines came in', () => {
  const at = (n) => `2026-11-01T02:00:0${n}.000Z`;
  const line = (n, data) => ({ id: `e${n}`, at: at(n), kind: 'shadow', data });
  const got = firstLines([
    line(4, { line: 'score', card: 'a', score: 'miss' }),
    line(2, { line: 'seal', card: 'a', head: 'second' }),
    line(1, { line: 'seal', card: 'a', head: 'first' }),
    line(3, { line: 'reading', card: 'a', pick: 'Keep' }),
    line(5, { line: 'seal', card: 'b', head: 'other' }),
  ]);
  assert.equal(got.get('a').seal.head, 'first');
  assert.equal(got.get('a').reading.pick, 'Keep');
  assert.equal(got.get('a').score.score, 'miss');
  assert.equal(got.get('b').reading, undefined);
});
