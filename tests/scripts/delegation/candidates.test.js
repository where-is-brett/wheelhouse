// tests/scripts/delegation/candidates.test.js
// The eight unsigned candidates and the exclusions no rule can lift: what each can say from a change's facts, and that
// what can't be read is null, never false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANDIDATES, COMMON_EXCLUSIONS, exclusionsHit, exclusionsHash } from '../../../scripts/delegation/candidates.js';
import { normaliseWords, sameOptions } from '../../../scripts/delegation/words.js';

const clean = { readable: true, paths: ['src/a.js'], lines: 4, testsChanged: true, depsChanged: false, schemaChanged: false, guardrail: false, secrets: false, critical: false };
const byId = (id) => CANDIDATES.find((c) => c.id === id);

test('the eight candidates are the design\'s, in order', () => {
  assert.deepEqual(CANDIDATES.map((c) => c.id), ['land', 'push-draft', 'remove-branches', 'defect-in-work', 'run-plan', 'tested-choice', 'follow-mock-up', 'written-rule']);
});

test('each candidate has its words and its undo', () => {
  for (const c of CANDIDATES) {
    assert.ok(typeof c.words === 'string' && c.words !== '', c.id);
    assert.ok(['allowed', 'switch-or-held'].includes(c.undo), c.id);
  }
});

test('landing never applies to work that touches a guardrail', () => {
  assert.equal(byId('land').applies({ ...clean, guardrail: true }, { permitHolds: true }), false);
});

test('landing applies only where the permit holds and no decision is open', () => {
  assert.equal(byId('land').applies(clean, { permitHolds: true, openDecision: false }), true);
  assert.equal(byId('land').applies(clean, { permitHolds: true }), null);
  assert.equal(byId('land').applies(clean, { permitHolds: false }), false);
  assert.equal(byId('land').applies(clean, { permitHolds: true, openDecision: true }), false);
  assert.equal(byId('land').applies(clean, {}), null);
  assert.equal(byId('land').applies({ readable: false }, { permitHolds: true, openDecision: false }), null);
});

test('a candidate that needs a done check, a mock-up or a private host can\'t say without it', () => {
  for (const id of ['push-draft', 'remove-branches', 'run-plan', 'tested-choice', 'follow-mock-up', 'written-rule']) assert.equal(byId(id).applies(clean, {}), null, id);
  assert.equal(byId('push-draft').applies(clean, { hostPrivate: true }), true);
  assert.equal(byId('push-draft').applies(clean, { hostPrivate: false }), false);
  assert.equal(byId('follow-mock-up').applies(clean, { mockUp: true }), true);
});

test('a technical choice needs a named done check and no change to the data', () => {
  assert.equal(byId('tested-choice').applies(clean, { doneCheck: 'npm test' }), true);
  assert.equal(byId('tested-choice').applies({ ...clean, schemaChanged: true }, { doneCheck: 'npm test' }), false);
  assert.equal(byId('tested-choice').applies({ readable: false }, { doneCheck: 'npm test' }), null);
});

test('a defect fix stays inside the piece\'s files, small, with a test that failed first', () => {
  const ctx = { pieceFiles: ['src/a.js'], failedFirst: true };
  assert.equal(byId('defect-in-work').applies(clean, ctx), true);
  assert.equal(byId('defect-in-work').applies({ ...clean, paths: ['src/a.js', 'src/b.js'] }, ctx), false);
  assert.equal(byId('defect-in-work').applies({ ...clean, lines: 5000 }, ctx), false);
  assert.equal(byId('defect-in-work').applies(clean, { ...ctx, failedFirst: false }), false);
  assert.equal(byId('defect-in-work').applies(clean, {}), null);
});

test('a change to a data model hits the common exclusions, and no candidate lifts one', () => {
  assert.deepEqual(exclusionsHit({ ...clean, schemaChanged: true }), ['data-model']);
});

test('what a change shows hits its own exclusion', () => {
  assert.deepEqual(exclusionsHit(clean), []);
  assert.deepEqual(exclusionsHit({ ...clean, guardrail: true }), ['guardrail']);
  assert.deepEqual(exclusionsHit({ ...clean, secrets: true }), ['secrets']);
  assert.deepEqual(exclusionsHit({ ...clean, critical: true }), ['critical-area']);
  assert.deepEqual(exclusionsHit({ ...clean, depsChanged: true }), ['dependency']);
});

test('a fact that can\'t be read is null, never false', () => {
  assert.equal(COMMON_EXCLUSIONS.find((e) => e.id === 'data-model').hit({ ...clean, readable: false }), null);
  assert.equal(COMMON_EXCLUSIONS.find((e) => e.id === 'data-model').hit({ ...clean, schemaChanged: undefined }), null);
});

test('legal, privacy, outside contact and a claim\'s meaning can\'t be read from any change', () => {
  for (const id of ['legal', 'privacy', 'outside-contact', 'claim-meaning']) assert.equal(COMMON_EXCLUSIONS.find((e) => e.id === id).hit(clean), null, id);
});

test('the exclusions\' hash is a stable digest of the list', () => {
  assert.match(exclusionsHash(), /^[0-9a-f]{64}$/);
  assert.equal(exclusionsHash(), exclusionsHash());
});

test('words normalise by case, space, invisible marks and end punctuation, and keep other scripts', () => {
  assert.equal(normaliseWords('  Which​  ONE? '), 'which one');
  assert.equal(normaliseWords('どちらにしますか？'), normaliseWords('どちらにしますか'));
  assert.equal(normaliseWords(null), '');
});

test('options are the same by their words, in any order', () => {
  assert.equal(sameOptions(['Keep it', 'Drop'], ['drop', 'keep  it.']), true);
  assert.equal(sameOptions(['Keep it', 'Drop'], ['Keep it']), false);
  assert.equal(sameOptions(['Keep it'], ['Keep']), false);
});
