// tests/scripts/setup/first-check.test.js
// What the first check's result does (spec 4.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstCheck, GET_THEM_PASSING, CARRY_ON } from '../../../scripts/setup/first-check.js';
import { answerInput, composeCard, questionProblem } from '../../../scripts/cards/compose.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';

function world() {
  const w = { states: [], notes: [], cards: [] };
  return { w, args: { state: async (s) => { w.states.push(s); }, note: async (words) => { w.notes.push(words); }, card: async (c) => { w.cards.push(c); } } };
}
const found = { testCommand: 'npm test', prepare: null, why: 'a test script' };

test('passed writes one Logbook line and counts from here on', async () => {
  const { w, args } = world();
  assert.equal(await firstCheck({ ...args, found, check: { result: 'passed', minutes: 3 } }), 'passed');
  assert.deepEqual(w.states, [{ state: 'counting', why: 'passed' }]);
  assert.deepEqual(w.notes, ['Checks ran on this computer: passed, 3 minutes.']);
  assert.equal(w.cards.length, 0);
});

test('failed and timed-out raise the level-3 card, and nothing else', async () => {
  for (const result of ['failed', 'timed-out']) {
    const { w, args } = world();
    assert.equal(await firstCheck({ ...args, found, check: { result, minutes: 1 } }), 'failed');
    assert.equal(w.cards.length, 1);
    assert.equal(w.cards[0].level, 3);
    assert.deepEqual(w.states, []);
  }
});

test('the card\'s first option is Get them passing first, and it is a real card', async () => {
  const { w, args } = world();
  await firstCheck({ ...args, found, check: { result: 'failed', minutes: 1 } });
  const [card] = w.cards;
  assert.deepEqual(card.options.map((o) => o.label), [GET_THEM_PASSING, CARRY_ON]);
  assert.equal(card.recommendation, GET_THEM_PASSING);
  const data = { ...card, id: 'q-checks-1', work: 'checks' };
  assert.equal(questionProblem(data), null);
  assert.deepEqual(cardProblems(composeCard(answerInput(data, 'the checks')).question), []);
  assert.doesNotMatch(JSON.stringify(card), /commit status|bare repository|\bremote\b|\bforge\b|pull request/i);
});

test('nothing found starts not counting, with no card', async () => {
  const { w, args } = world();
  assert.equal(await firstCheck({ ...args, found: null, check: null }), 'nothing');
  assert.deepEqual(w.states, [{ state: 'not-counting', why: 'nothing-found' }]);
  assert.equal(w.cards.length, 0);
});

test('could not run leaves it to the runner\'s own card', async () => {
  const { w, args } = world();
  assert.equal(await firstCheck({ ...args, found, check: { result: 'could-not-run', minutes: 1 } }), 'could-not-run');
  assert.deepEqual([w.states, w.notes, w.cards], [[], [], []]);
});
