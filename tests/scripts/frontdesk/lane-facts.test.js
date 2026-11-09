// tests/scripts/frontdesk/lane-facts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTS_FENCE, FACTS, readFacts, MISSING, laneFactsProblem } from '../../../scripts/frontdesk/lane-facts.js';

const NO = { addsPage: false, storesData: false, parsesInput: false, touchesMoreThanOneArea: false };
const block = (body) => '```wheelhouse-facts\n' + body + '\n```';
const brief = (facts) => `# Brief\n\n${block(JSON.stringify({ ...NO, ...facts }))}\n`;
const ALL_YES = { addsPage: true, storesData: true, parsesInput: true, touchesMoreThanOneArea: true };
const TAIL = '. Write a design that ends with its slices and record it in the feature lane';

test('the names and words are as the refusal uses them', () => {
  assert.equal(FACTS_FENCE, 'wheelhouse-facts');
  assert.deepEqual(Object.keys(FACTS), ['addsPage', 'storesData', 'parsesInput', 'touchesMoreThanOneArea']);
  assert.equal(FACTS.touchesMoreThanOneArea, 'it touches more than one area');
  assert.ok(Object.isFrozen(FACTS));
});

test('text with no block is unanswered', () => {
  assert.equal(readFacts('no block here'), null);
});

test('a block gives its facts, whatever the line endings or prose above, and the first block wins', () => {
  const want = { facts: { ...NO, addsPage: true } };
  assert.deepEqual(readFacts(brief({ addsPage: true })), want);
  assert.deepEqual(readFacts(brief({ addsPage: true }).replace(/\n/g, '\r\n')), want);
  assert.deepEqual(readFacts('prose\n'.repeat(10) + brief({ addsPage: true })), want);
  assert.deepEqual(readFacts(brief({ addsPage: true }) + brief({ storesData: true })), want);
});

test('a malformed block gives a problem naming the fence', () => {
  const cases = [
    block('not json'),
    block('[]'),
    block(JSON.stringify({ addsPage: true, parsesInput: false, touchesMoreThanOneArea: false })),
    block(JSON.stringify({ ...NO, addsPage: 'yes' })),
  ];
  for (const text of cases) {
    const got = readFacts(text);
    assert.equal(typeof got.problem, 'string');
    assert.ok(got.problem.includes(FACTS_FENCE));
    assert.ok(got.problem.includes('true or false'));
  }
  assert.ok(readFacts(block('not json')).problem.endsWith(": it isn't JSON"));
});

test('small and quick work with a yes answer is named a feature', () => {
  const words = `this is a feature: it adds a page and it stores data${TAIL}`;
  const text = brief({ addsPage: true, storesData: true });
  assert.equal(laneFactsProblem(text, 'small'), words);
  assert.equal(laneFactsProblem(text, 'quick'), words);
});

test('three yes answers read as a list, one names just that fact', () => {
  assert.equal(
    laneFactsProblem(brief({ addsPage: true, storesData: true, parsesInput: true }), 'small'),
    `this is a feature: it adds a page, it stores data and it parses input${TAIL}`,
  );
  assert.equal(laneFactsProblem(brief({ parsesInput: true }), 'quick'), `this is a feature: it parses input${TAIL}`);
});

test('other lanes are never refused', () => {
  for (const lane of ['feature', 'bug', 'chore', '']) assert.equal(laneFactsProblem(brief(ALL_YES), lane), null);
});

test('all no is fine for small work', () => {
  assert.equal(laneFactsProblem(brief({}), 'small'), null);
});

test('no block asks for one on small and quick work only', () => {
  assert.equal(laneFactsProblem('nothing', 'small'), MISSING);
  assert.equal(laneFactsProblem('nothing', 'quick'), MISSING);
  assert.equal(laneFactsProblem('nothing', 'feature'), null);
});

test('a malformed block gives its problem on small work only', () => {
  const text = block('not json');
  assert.equal(laneFactsProblem(text, 'small'), readFacts(text).problem);
  assert.equal(laneFactsProblem(text, 'feature'), null);
});
