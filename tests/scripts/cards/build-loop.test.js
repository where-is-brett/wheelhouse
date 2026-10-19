// tests/scripts/cards/build-loop.test.js
// The cards the build loop's records call for, worked out from the views: what each click the merge
// gate waits for needs, whether the host's pull request still waits for it, and a hold's card input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateAsksDue, holdInput, stillWaits } from '../../../scripts/cards/build-loop.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { CLICK_MS } from '../../../scripts/lib/core-numbers.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const HEAD = 'a'.repeat(40);
const MERGE = 'b'.repeat(40);
const LATER = 'c'.repeat(40);
const approval = { work: 'x', pr: 7, ask: 'approval', sha: HEAD };
const push = { work: 'x', pr: 7, ask: 'ci-push', sha: MERGE, branch: 'wh/x', from: HEAD };
const entry = (data, over = {}) => ({ id: 'g', at: ago(2 * CLICK_MS), data, line: 'the line', card: 'c1', askedAt: ago(2 * CLICK_MS), clickedAt: null, ...over });
const due = (e) => gateAsksDue({ gateAsks: { 7: e } }, NOW).map((d) => (d.make ? 'make' : `again ${d.again}`));

test('a gate card is made once; only a CI push card whose click lapsed is asked again, once for that click', () => {
  assert.deepEqual(due(entry(approval, { card: null })), ['make']);
  // Asked long ago and put off: the usual rules, never asked again (ruling F77).
  assert.deepEqual(due(entry(approval)), []);
  assert.deepEqual(due(entry(push)), []);
  // An approval on record however old, and a CI push click within the window: nothing.
  assert.deepEqual(due(entry(approval, { clickedAt: ago(10 * CLICK_MS) })), []);
  assert.deepEqual(due(entry(push, { clickedAt: ago(CLICK_MS - 1000) })), []);
  // A CI push click that lapsed, not asked since: asked again; once asked after the click, not.
  assert.deepEqual(due(entry(push, { clickedAt: ago(CLICK_MS + 1000) })), ['again c1']);
  assert.deepEqual(due(entry(push, { clickedAt: ago(CLICK_MS + 2000), askedAt: ago(CLICK_MS + 1000) })), []);
  // Without the head the update was made from, never (ruling F78).
  const { from, ...unnamed } = push;
  assert.deepEqual(due(entry(unnamed, { clickedAt: ago(CLICK_MS + 1000) })), []);
  // Finished work asks nothing.
  assert.deepEqual(gateAsksDue({ gateAsks: { 7: entry(approval, { card: null }) }, reports: { x: { data: { outcome: 'merged' } } } }, NOW), []);
});

test('whether the pull request still waits for the click, as the host gives it', () => {
  const open = (headSha) => ({ state: 'open', headSha });
  assert.equal(stillWaits(entry(approval), open(HEAD)), true);
  assert.equal(stillWaits(entry(approval), open(LATER)), false);
  // Before its update is pushed, the head isn't the update yet.
  assert.equal(stillWaits(entry(push), open(HEAD)), true);
  assert.equal(stillWaits(entry(push), open(MERGE)), false);
  // Asked again only while the head is still the one the update was made from.
  assert.equal(stillWaits(entry(push), open(HEAD), { again: true }), true);
  assert.equal(stillWaits(entry(push), open(MERGE), { again: true }), false);
  assert.equal(stillWaits(entry(push), open(LATER), { again: true }), false);
  for (const state of ['merged', 'closed']) assert.equal(stillWaits(entry(approval), { state, headSha: HEAD }), false);
  // An answer that says nothing either way: asking is the safe side.
  for (const pr of [undefined, null, { state: 'open' }, open('short')]) assert.equal(stillWaits(entry(approval), pr), true);
});

test('a hold\'s card names each kit with its first paths, or with how many files differ', () => {
  const paths = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((p) => `skills/${p}/SKILL.md`);
  const hold = { id: 'h1', data: { mismatches: [...paths.map((path) => ({ upstream: 'superpowers', path })), { upstream: 'feature-dev', path: '*' }] } };
  const full = holdInput(hold);
  assert.equal(full.kind, 'question');
  assert.equal(full.event, 'h1');
  assert.ok(full.what.includes('superpowers (skills/a/SKILL.md, skills/b/SKILL.md, skills/c/SKILL.md, skills/d/SKILL.md, skills/e/SKILL.md, and 2 more); feature-dev (not installed)'), full.what);
  const short = holdInput(hold, { short: true });
  assert.ok(short.what.includes('superpowers (7 files); feature-dev (1 file)'), short.what);
  assert.ok(!short.what.includes('skills/a'));
  for (const input of [full, short]) assert.equal(composeCard(input).card.event, 'h1');
});
