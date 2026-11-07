// tests/scripts/cards/compose-shape.test.js
// The shape of a decision (design section 6.2): two to four options, each with a cost and an undo answer, a recommendation with
// its reason, what the agent goes on with meanwhile, and a message short enough for a phone screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeProblems, PHONE_LIMIT, questionProblem } from '../../../scripts/cards/compose.js';
import { decisionText } from '../../../scripts/decisions/message.js';

const option = (label, extra = {}) => ({ label, says: `Use ${label}`, cost: 'A day', undo: 'Can be undone', ...extra });
const whole = (extra = {}) => ({
  what: 'How often should the tide digest go out?', why: 'It decides what visitors of harbour-demo get in their inbox.',
  options: [option('Daily'), option('Weekly')], recommendation: 'Weekly', because: 'Visitors plan their week, not their day.',
  meanwhile: 'I build the sending, which both need.', holds: 'the digest on w-tide-1', ...extra,
});

test('a decision with every part passes', () => {
  assert.deepEqual(shapeProblems(whole()), []);
});

test('an option with no cost is sent back, naming the option', () => {
  const problems = shapeProblems(whole({ options: [option('Daily'), option('Weekly', { cost: undefined })] }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Option "Weekly" doesn't say what it costs/);
});

test('an option with no undo answer is sent back', () => {
  const problems = shapeProblems(whole({ options: [option('Daily', { undo: '' }), option('Weekly')] }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Option "Daily" doesn't say whether it can be undone/);
});

test('one option, or five, is sent back', () => {
  assert.match(shapeProblems(whole({ options: [option('Daily')] })).join('\n'), /two to four options; there is 1/);
  const five = ['A', 'B', 'C', 'D', 'E'].map((l) => option(l));
  assert.match(shapeProblems(whole({ options: five, recommendation: 'A' })).join('\n'), /two to four options; there are 5/);
});

test('no recommendation, or a recommendation with no reason, is sent back', () => {
  assert.match(shapeProblems(whole({ recommendation: undefined })).join('\n'), /which option you recommend/);
  assert.match(shapeProblems(whole({ recommendation: 'Monthly' })).join('\n'), /"Monthly" is not one of the options/);
  assert.match(shapeProblems(whole({ because: undefined })).join('\n'), /why you recommend it/);
  assert.match(shapeProblems(whole({ because: '  ' })).join('\n'), /why you recommend it/);
});

test('no meanwhile line is sent back', () => {
  assert.match(shapeProblems(whole({ meanwhile: undefined })).join('\n'), /what you go on with while it waits/);
});

test('a message over 1400 characters or 18 lines is sent back with its length', () => {
  assert.deepEqual(PHONE_LIMIT, { chars: 1400, lines: 18 });
  const long = shapeProblems(whole({ why: 'w'.repeat(1500) }));
  assert.equal(long.length, 1);
  assert.match(long[0], /The decision is \d{4} characters and \d+ lines; a phone screen takes 1400 characters and 18 lines/);
  // The message puts each part on lines of its own, so four options come to twelve lines at the most: the line limit holds as a guard.
  const four = ['A', 'B', 'C', 'D'].map((l) => option(l));
  const text = decisionText({ n: 1, question: 'q', why: 'w', options: four, recommend: 'A', because: 'b', meanwhile: 'm' });
  assert.ok(text.split('\n').length <= PHONE_LIMIT.lines);
});

test('a decision raised before cost and undo were asked for is judged on the rest', () => {
  const old = whole({ options: [{ label: 'Daily', says: 'Daily' }, { label: 'Weekly', says: 'Weekly' }] });
  assert.equal(shapeProblems(old).length, 4);
  assert.deepEqual(shapeProblems(old, { costAndUndo: false }), []);
});

test('the composer carries each option\'s cost and undo, the reason, what waits and the meanwhile line into the card', () => {
  const data = {
    id: 'q-w-tide-1-1', work: 'w-tide-1', what: 'How often should the tide digest go out?', why: 'It decides what visitors get', level: 3,
    options: [option('Daily'), option('Weekly')], recommendation: 'Weekly', because: 'Visitors plan their week', holds: 'the digest on w-tide-1', meanwhile: 'I build the sending',
  };
  assert.equal(questionProblem(data), null);
});
