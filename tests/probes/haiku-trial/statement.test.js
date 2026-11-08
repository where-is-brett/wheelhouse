// tests/probes/haiku-trial/statement.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeStatement, formatCents, MERCHANTS, SAMPLE, HELD_BACK, TRY_ME, UNKNOWN_MERCHANT, CATEGORIES,
} from '../../../probes/haiku-trial/statement.js';

function monthOfRow(row) {
  const [, m, y] = row.date.split('/');
  return `${y}-${m}`;
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.date}|${row.description}|${row.cents}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

test('makeStatement is the same for the same seed', () => {
  assert.equal(makeStatement(SAMPLE).csv, makeStatement(SAMPLE).csv);
});

test('amounts reconcile', () => {
  for (const config of [SAMPLE, HELD_BACK, TRY_ME]) {
    const { rows, expected } = makeStatement(config);
    const counted = uniqueRows(rows);
    for (const [month, entry] of Object.entries(expected)) {
      const sum = Object.values(entry.byCategory).reduce((a, b) => a + b, 0);
      assert.equal(entry.total, sum);
      const mine = counted.filter((row) => monthOfRow(row) === month);
      assert.equal(entry.count, mine.length);
      for (const { key } of CATEGORIES) {
        const expectedCents = mine.filter((row) => row.category === key).reduce((a, row) => a + row.cents, 0);
        assert.equal(entry.byCategory[key], expectedCents, `${month} ${key}`);
      }
    }
  }
});

test('bracket refund is written in brackets and counted negative', () => {
  const withRefund = makeStatement(SAMPLE);
  assert.ok(withRefund.csv.includes(',(40.00)'));
  const without = makeStatement({ ...SAMPLE, extras: { ...SAMPLE.extras, bracketRefund: undefined } });
  assert.equal(
    without.expected['2026-09'].byCategory.shopping - withRefund.expected['2026-09'].byCategory.shopping,
    4000,
  );
});

test('held-back has a BOM, a duplicate, an unknown merchant and a quoted comma', () => {
  const { csv, rows } = makeStatement(HELD_BACK);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.split('\r\n').slice(1).filter(Boolean);
  const counts = new Map();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  assert.equal([...counts.values()].filter((n) => n === 2).length, 1);
  assert.equal([...counts.values()].filter((n) => n > 2).length, 0);
  assert.ok(lines.some((line) => line.includes(UNKNOWN_MERCHANT)));
  assert.equal(rows.find((row) => row.description.includes(UNKNOWN_MERCHANT)).category, 'other');
  assert.ok(lines.some((line) => line.includes('"Pasta, Pizza & Co')));
});

test('month-end rows fall in their own month', () => {
  const { rows, expected } = makeStatement(HELD_BACK);
  for (const date of ['31/05/2026', '30/06/2026', '31/07/2026', '31/08/2026']) {
    assert.ok(rows.some((row) => row.date === date), date);
    const [, m, y] = date.split('/');
    assert.ok(expected[`${y}-${m}`].count > 0);
  }
});

test('try-me has 41 rows in November 2026 and no duplicates', () => {
  const { rows, expected } = makeStatement(TRY_ME);
  assert.equal(rows.length, 41);
  assert.equal(uniqueRows(rows).length, 41);
  assert.deepEqual(Object.keys(expected), ['2026-11']);
  assert.ok(rows.every((row) => row.date.endsWith('/11/2026')));
});

test('formatCents', () => {
  assert.equal(formatCents(-4000), '-40.00');
  assert.equal(formatCents(5), '0.05');
  assert.equal(formatCents(123450), '1234.50');
});

test('every merchant name is made up', () => {
  for (const { name } of MERCHANTS) {
    assert.doesNotMatch(name, /woolworths|coles|aldi|uber|netflix|amazon|kmart|telstra|optus/i);
  }
});

test('merchants cover every category with at least three each, and one name has a comma', () => {
  for (const { key } of CATEGORIES.filter((c) => c.key !== 'other')) {
    assert.ok(MERCHANTS.filter((m) => m.category === key).length >= 3, key);
  }
  assert.ok(MERCHANTS.some((m) => m.name === 'Pasta, Pizza & Co'));
});
