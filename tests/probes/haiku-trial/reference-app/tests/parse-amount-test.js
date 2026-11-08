// tests/probes/haiku-trial/reference-app/tests/parse-amount-test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatCents } from '../src/lib/money.js';

test('a plain amount is read as whole cents', () => {
  assert.equal(parseAmount('12.50'), 1250);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('0.29'), 29);
});

test('a minus sign means money back', () => {
  assert.equal(parseAmount('-12.50'), -1250);
});

test('brackets mean money back', () => {
  assert.equal(parseAmount('(40.00)'), -4000);
});

test('something that is not an amount is refused', () => {
  assert.throws(() => parseAmount('twelve'));
});

test('cents are written as a plain decimal', () => {
  assert.equal(formatCents(-4000), '-40.00');
  assert.equal(formatCents(5), '0.05');
});
