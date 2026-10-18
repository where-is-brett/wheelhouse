// tests/probes/05-glab/coverage.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkCoverage } from '../../../probes/05-glab/coverage.js';

const helpDir = new URL('../../fixtures/glab-help/', import.meta.url);

function helpTexts() {
  const texts = {};
  for (const name of fs.readdirSync(helpDir)) {
    texts[name.replace(/\.txt$/, '').replace('-', ' ')] = fs.readFileSync(new URL(name, helpDir), 'utf8');
  }
  return texts;
}

test('every adapter operation is covered by the recorded glab help', () => {
  const rows = checkCoverage(helpTexts());
  assert.equal(rows.length, 8);
  for (const row of rows) assert.equal(row.covered, true, `${row.operation}: ${row.command} ${row.flag}`);
});

test('a help text without --sha leaves the exact-head merge uncovered', () => {
  const texts = helpTexts();
  texts['mr merge'] = texts['mr merge'].replaceAll('--sha', '--other');
  const row = checkCoverage(texts).find((item) => item.operation === 'merge exact head');
  assert.equal(row.covered, false);
});

test('a missing command is uncovered, not an error', () => {
  const texts = helpTexts();
  delete texts['issue update'];
  const row = checkCoverage(texts).find((item) => item.operation === 'issue checklist');
  assert.equal(row.covered, false);
});
