// tests/probes/haiku-trial/requests.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIECES, WAVES } from '../../../probes/haiku-trial/requests.js';
import { MERCHANTS, CATEGORIES } from '../../../probes/haiku-trial/statement.js';

const piece = (id) => PIECES.find((p) => p.id === id);

test('P1 carries the import contract', () => {
  const { text } = piece('P1');
  for (const part of [
    'statement', 'PORT', 'LEDGER_DB', ':memory:', 'DD/MM/YYYY', 'parseAmount', 'parseDate', 'added', 'skipped',
    'A duplicate has the same date, description and amount as a stored row',
  ]) {
    assert.ok(text.toLowerCase().includes(part.toLowerCase()), part);
  }
  assert.ok(text.includes('PORT') && text.includes('LEDGER_DB'));
});

test('P2 lists every merchant and every key', () => {
  const { text } = piece('P2');
  for (const { name } of MERCHANTS) assert.ok(text.includes(name), name);
  for (const { key } of CATEGORIES) assert.ok(text.includes(key), key);
  assert.ok(text.includes('src/lib/categories.js'));
  assert.ok(text.includes('other'));
});

test('P3 asks for two slices and names monthOf and the data attributes', () => {
  const { text } = piece('P3');
  for (const part of ['two slices', 'monthOf', 'data-category', 'data-total', 'data-category="all"']) {
    assert.ok(text.includes(part), part);
  }
});

test('P4 carries the edit contract and says nothing about rules', () => {
  const { text } = piece('P4');
  for (const part of ['/edit?id=', 'name="category"', 'label']) assert.ok(text.includes(part), part);
  assert.doesNotMatch(text, /\brule/i);
});

test('P5, P6 and P8 are the spec\'s words', () => {
  assert.equal(piece('P5').text, 'A $40 refund shows as spending');
  assert.equal(piece('P6').text, 'Make CI also run on Node 24');
  assert.equal(
    piece('P8').text,
    "Rename the category key 'eating_out' to 'dining' in src/lib/categories.js, and touch nothing else. Nobody sees this.",
  );
});

test('P7 carries the export contract and names the month page', () => {
  const { text } = piece('P7');
  for (const part of ['Download this month', '/export?m=', 'spending-YYYY-MM.csv', 'Date,Description,Amount,Category']) {
    assert.ok(text.includes(part), part);
  }
  assert.ok(text.includes('month page'));
});

test('waves match section 7', () => {
  assert.deepEqual(WAVES, { 1: ['S0'], 2: ['P1', 'P2', 'P6'], 3: ['P3', 'P5', 'P8'], 4: ['P4', 'P7'], 5: [], 6: [] });
  for (const p of PIECES) assert.ok(WAVES[p.wave].includes(p.id), p.id);
});

test('lanes and rows match section 7', () => {
  assert.equal(piece('P6').lane, 'quick');
  assert.equal(piece('P6').visible, false);
  assert.equal(piece('P5').lane, 'bug');
  for (const id of ['P1', 'P3']) assert.equal(piece(id).lane, 'feature');
  for (const id of ['P2', 'P4', 'P7', 'P8']) assert.equal(piece(id).lane, 'small');
  assert.deepEqual(piece('P1').rows, [3, 7, 8, 10, 25, 26, 27, 28]);
  assert.deepEqual(piece('P2').rows, [5, 10, 22, 28]);
  assert.deepEqual(piece('P3').rows, [7, 11, 22, 25, 26, 28]);
  assert.deepEqual(piece('P4').rows, [13, 16, 17, 18, 31, 43]);
  assert.deepEqual(piece('P5').rows, [6]);
  assert.deepEqual(piece('P6').rows, [4, 29]);
  assert.deepEqual(piece('P7').rows, [12, 26, 28]);
  assert.deepEqual(piece('P8').rows, [30]);
});
