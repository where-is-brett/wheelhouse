// tests/probes/haiku-trial/acceptance.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAcceptance, ACCEPTANCE_ITEMS } from '../../../probes/haiku-trial/acceptance.js';
import { REFERENCE, variant } from './variants.js';

const failing = (run) => run.items.filter((i) => !i.pass).map((i) => i.id);

test('there are 15 acceptance items with distinct ids', () => {
  assert.equal(new Set(ACCEPTANCE_ITEMS).size, 15);
});

test('the reference app passes all 15 items', async () => {
  const run = await runAcceptance({ dir: REFERENCE });
  assert.deepEqual(run.items.filter((i) => !i.pass), []);
  assert.equal(run.passed, 15);
  assert.equal(run.total, 15);
});

test('a copy without labels fails the label items', async () => {
  const run = await runAcceptance({ dir: variant('labels') });
  assert.deepEqual(failing(run).sort(), ['all-fields-labelled', 'import-field-labelled']);
});

test('a copy with the same title on every page fails titles-name-pages', async () => {
  assert.deepEqual(failing(await runAcceptance({ dir: variant('titles') })), ['titles-name-pages']);
});

test('a copy whose export is named export.csv fails export-file-name', async () => {
  assert.deepEqual(failing(await runAcceptance({ dir: variant('export-name') })), ['export-file-name']);
});
