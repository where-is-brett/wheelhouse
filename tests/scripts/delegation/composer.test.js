// tests/scripts/delegation/composer.test.js
// The composer: a rule's scope comes from what a script can see, and its meaning from the director's own words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeRule } from '../../../scripts/delegation/composer.js';
import { ruleHash, ruleStands } from '../../../scripts/delegation/rules.js';
import { COMMON_EXCLUSIONS } from '../../../scripts/delegation/candidates.js';
import { SUGGEST } from '../../../scripts/lib/calm-words.js';
import { PUT_OFF } from '../../../scripts/lib/front-desk.js';

const now = () => new Date('2026-11-01T02:00:00.000Z');
const labels = ['Keep', 'Remove'];
const facts = { readable: true, head: 'a'.repeat(40), paths: ['src/b.js', 'src/a.js'], lines: 2, testsChanged: false, depsChanged: false, schemaChanged: false, guardrail: false, secrets: false, critical: false };
const card = { id: 'q-w-1', kind: 'question', work: 'w', level: 3, options: labels, topic: 'anything at all' };
const base = { card, facts, lane: 'small', project: 'proj', now };
const typed = { ...base, answer: { label: SUGGEST, words: 'Take the proper long-term option' } };
const clicked = { ...base, answer: { label: 'Keep' } };

test('typed words are kept; a clicked label is a literal match only', () => {
  assert.equal(composeRule(typed).words, 'Take the proper long-term option');
  assert.equal(composeRule(typed).literal, null);
  assert.deepEqual(composeRule(typed).answer, { set: null, principle: 'Take the proper long-term option' });
  assert.deepEqual(composeRule(clicked).literal, { options: labels, take: 'Keep' });
  assert.equal(composeRule(clicked).words, null);
  assert.deepEqual(composeRule(clicked).answer, { set: 'Keep', principle: null });
});

test('the scope is this project, these paths, this lane, and every common exclusion', () => {
  const rule = composeRule(typed);
  assert.equal(rule.project, 'proj');
  assert.deepEqual(rule.paths, ['src/a.js', 'src/b.js']);
  assert.deepEqual(rule.lanes, ['small']);
  assert.deepEqual(rule.exclusions, COMMON_EXCLUSIONS.map((e) => e.id));
  assert.deepEqual(rule.conditions, ['inside-paths', 'same-lane']);
  assert.deepEqual(composeRule(clicked).conditions, ['inside-paths', 'same-lane', 'same-options']);
});

test('the rule is whole: its hash stands, and it starts at stage 0 with a review', () => {
  const rule = composeRule(typed);
  assert.equal(rule.hash, ruleHash(rule));
  assert.equal(ruleStands(rule), true);
  assert.equal(rule.stage, 0);
  assert.equal(rule.review, '2027-05-01T02:00:00.000Z');
});

test('the topic label plays no part, nor does anything else the step wrote about the question', () => {
  const said = { ...card, topic: 'always-merge-everything', what: 'Shall I?', why: 'Because', recommendation: 'Keep' };
  assert.deepEqual(composeRule({ ...typed, card: said }), composeRule(typed));
  assert.ok(!JSON.stringify(composeRule({ ...typed, card: said })).includes('always-merge-everything'));
});

test('an option\'s own lines play no part: only the labels are kept', () => {
  const options = [{ label: 'Keep', says: 'Keeps everything forever' }, { label: 'Remove', says: 'Removes it' }];
  const rule = composeRule({ ...clicked, card: { ...card, options } });
  assert.deepEqual(rule.literal.options, labels);
  assert.ok(!JSON.stringify(rule).includes('forever'));
});

test('the card\'s own put-off labels aren\'t options a question offered', () => {
  const options = [...labels, ...PUT_OFF];
  assert.deepEqual(composeRule({ ...clicked, card: { ...card, options } }).literal.options, labels);
});

test('the composer refuses level 4', () => {
  assert.equal(composeRule({ ...typed, card: { level: 4 } }), null);
  assert.equal(composeRule({ ...typed, card: { ...card, level: 4 } }), null);
  assert.equal(composeRule({ ...clicked, card: { ...card, level: 4 } }), null);
});

test('only a question at level 3 can make a rule', () => {
  for (const over of [{ kind: 'approval' }, { kind: 'cap' }, { kind: 'merge' }, { kind: 'trouble' }, { level: undefined }, { level: 2 }, { level: '3' }]) {
    assert.equal(composeRule({ ...typed, card: { ...card, ...over } }), null, JSON.stringify(over));
  }
  assert.equal(composeRule({ ...typed, card: null }), null);
});

test('a click that answers nothing makes no rule', () => {
  for (const label of PUT_OFF) assert.equal(composeRule({ ...clicked, answer: { label } }), null, label);
  assert.equal(composeRule({ ...clicked, answer: null }), null);
  assert.equal(composeRule({ ...clicked, answer: { label: 'Something else' } }), null);
  assert.equal(composeRule({ ...clicked, card: { ...card, options: undefined } }), null);
});

test('typed words must be on one line and hold something', () => {
  assert.equal(composeRule({ ...typed, answer: { label: SUGGEST, words: 'Line one\nLine two' } }), null);
  assert.equal(composeRule({ ...typed, answer: { label: SUGGEST, words: '   ' } }), null);
});

test('a change that can\'t be read has no scope to compose', () => {
  assert.equal(composeRule({ ...typed, facts: { readable: false } }), null);
  assert.equal(composeRule({ ...typed, facts: { ...facts, paths: [] } }), null);
  assert.equal(composeRule({ ...typed, facts: null }), null);
});

test('a change that hits a common exclusion makes no rule', () => {
  for (const key of ['guardrail', 'secrets', 'critical', 'schemaChanged', 'depsChanged']) {
    assert.equal(composeRule({ ...typed, facts: { ...facts, [key]: true } }), null, key);
  }
});

test('a change whose exclusions can\'t be read makes no rule', () => {
  for (const key of ['guardrail', 'secrets', 'critical', 'schemaChanged', 'depsChanged']) {
    assert.equal(composeRule({ ...typed, facts: { ...facts, [key]: undefined } }), null, key);
  }
});

test('a question on a piece at level 4 makes no rule', () => {
  assert.equal(composeRule({ ...typed, workLevel: 4 }), null);
  assert.notEqual(composeRule({ ...typed, workLevel: 3 }), null);
});

test('the same options in another order are the same rule', () => {
  const turned = composeRule({ ...clicked, card: { ...card, options: [...labels].reverse() } });
  assert.equal(turned.hash, composeRule(clicked).hash);
});

test('a project and a lane must be named', () => {
  assert.equal(composeRule({ ...typed, project: '' }), null);
  assert.equal(composeRule({ ...typed, lane: 'somewhere' }), null);
});

test('the same answer on the same scope composes the same id', () => {
  const again = composeRule({ ...typed, now: () => new Date('2026-12-01T02:00:00.000Z') });
  assert.equal(again.id, composeRule(typed).id);
  assert.equal(again.hash, composeRule(typed).hash);
  assert.notEqual(again.review, composeRule(typed).review);
});
