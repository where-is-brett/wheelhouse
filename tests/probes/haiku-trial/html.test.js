// tests/probes/haiku-trial/html.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAll, textOf, totalsOf, labelled, centsOfDecimal } from '../../../probes/haiku-trial/lib/html.js';

test('findAll returns nested elements with attrs, inner and outer', () => {
  const html = '<table><tr id="a"><td>1<table><tr><td>2</td></tr></table></td></tr><tr><td>3</td></tr></table>';
  const rows = findAll(html, 'tr');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].attrs.id, 'a');
  assert.equal(textOf(rows[0].inner), '1 2');
  assert.equal(textOf(rows[2].inner), '3');
});

test('textOf drops tags and decodes entities', () => {
  assert.equal(textOf('<b>Pasta, Pizza &amp; Co</b> <i>x</i>'), 'Pasta, Pizza & Co x');
});

test('centsOfDecimal reads exact cents and refuses three decimals', () => {
  assert.equal(centsOfDecimal('12.3'), 1230);
  assert.equal(centsOfDecimal('-0.10'), -10);
  assert.equal(centsOfDecimal('12.301'), null);
  assert.equal(centsOfDecimal('abc'), null);
});

test('totalsOf reads every data-total and applies aliases', () => {
  const html = '<td data-category="dining" data-total="12.30">x</td><td data-category="all" data-total="-40.00">y</td><td data-category="bills" data-total="1.234">z</td>';
  assert.deepEqual(totalsOf(html), { eating_out: 1230, all: -4000, bills: null });
});

test('labelled finds fields with no label and skips hidden and submit', () => {
  const html = `<form>
<label for="a">A</label><input id="a" name="a">
<label>Wrapped <input name="w"></label>
<input name="aria" aria-label="Aria">
<input type="hidden" name="h"><input type="submit">
<select name="bare"><option>x</option></select>
<textarea id="t" name="t"></textarea>
</form>`;
  const { fields, unlabelled } = labelled(html);
  assert.deepEqual(fields.map((f) => f.name), ['a', 'w', 'aria', 'bare', 't']);
  assert.deepEqual(unlabelled.map((f) => f.name), ['bare', 't']);
});
