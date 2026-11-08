// tests/probes/haiku-trial/reference-app/tests/month-totals-test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthTotals } from '../src/lib/totals.js';

test('month totals add whole cents per category, refunds taking away', () => {
  const totals = monthTotals([
    { category: 'shopping', cents: 5000 },
    { category: 'shopping', cents: -4000 },
    { category: 'groceries', cents: 1234 },
  ]);
  assert.equal(totals.shopping, 1000);
  assert.equal(totals.groceries, 1234);
  assert.equal(totals.income, 0);
});
