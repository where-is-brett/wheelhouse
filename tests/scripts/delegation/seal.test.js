// tests/scripts/delegation/seal.test.js
// A seal: what the script checks said about a card, hashed, and what no rule can reach marked as such.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealOf } from '../../../scripts/delegation/seal.js';
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
