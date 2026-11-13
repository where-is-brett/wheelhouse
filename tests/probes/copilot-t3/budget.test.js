// tests/probes/copilot-t3/budget.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { BudgetStop, makeBudget } from '../../../probes/copilot-t3/budget.js';

test('a stage whose month cannot be read does not start', () => {
  assert.throws(() => makeBudget({ monthUsed: null }), BudgetStop);
});

test('a run is settled as the rise in the session\'s cumulative count', () => {
  const b = makeBudget({ monthUsed: 20 });
  b.reserve('build');
  assert.equal(b.settle('build', { session: 's', cumulative: 2 }), 2);
  b.reserve('resume');
  assert.equal(b.settle('resume', { session: 's', cumulative: 3 }), 1);
  assert.equal(b.used, 3);
});

test('a run with no figure counts as one request and says so', () => {
  const b = makeBudget({ monthUsed: 0 });
  b.reserve('build');
  b.settle('build', { session: 's', cumulative: null });
  assert.deepEqual(b.steps.map((s) => [s.requests, s.assumed]), [[1, true]]);
});

test('a run that would pass the stage budget is refused before it starts', () => {
  const b = makeBudget({ monthUsed: 0, limit: 2 });
  b.reserve('a'); b.settle('a', { session: 's', cumulative: 2 });
  assert.throws(() => b.reserve('b'), /would take the stage to 3 of its 2/);
});

test('a run that would take the month past 150 is refused', () => {
  const b = makeBudget({ monthUsed: 150 });
  assert.throws(() => b.reserve('build'), /month to 151 of 150/);
});

test('a run is never reserved twice without settling', () => {
  const b = makeBudget({ monthUsed: 0 });
  b.reserve('a');
  assert.throws(() => b.reserve('b'), /not been settled/);
  b.release('a');
  b.reserve('b');
});

test('a restored stage carries what was spent, and the session\'s next figure counts from it', () => {
  const b = makeBudget({ monthUsed: 0, limit: 4 });
  b.restore([{ step: 'build', session: 's', requests: 1, assumed: true, total: 1 }]);
  assert.equal(b.used, 1);
  assert.equal(b.reserve('resume'), 3);
  assert.equal(b.settle('resume', { session: 's', cumulative: 3 }), 2);
  assert.equal(b.used, 3);
});
