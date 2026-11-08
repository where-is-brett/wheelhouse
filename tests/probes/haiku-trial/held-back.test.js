// tests/probes/haiku-trial/held-back.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHeldBack, HELD_BACK_CHECKS } from '../../../probes/haiku-trial/held-back/held-back.js';
import { REFERENCE, variant } from './variants.js';

const failing = (run) => run.checks.filter((c) => !c.pass).map((c) => c.id);

test('the reference app passes every check', async () => {
  const run = await runHeldBack({ dir: REFERENCE });
  assert.deepEqual(run.checks.filter((c) => !c.pass), []);
  assert.equal(run.share, 1);
  assert.equal(run.total, HELD_BACK_CHECKS.length);
  assert.ok(run.total >= 24);
});

test('a copy with the bracket bug fails the refund checks', async () => {
  const failed = failing(await runHeldBack({ dir: variant('bracket') }));
  assert.ok(failed.includes('bracket-refund'));
  assert.ok(failed.some((id) => id.startsWith('totals-')));
  assert.ok(!failed.includes('minus-refund'));
});

test('a copy that ignores duplicates fails the duplicate checks', async () => {
  const failed = failing(await runHeldBack({ dir: variant('duplicates') }));
  assert.ok(failed.includes('skipped-duplicate'));
  assert.ok(failed.includes('again-adds-none'));
});

test("a copy that drops the BOM's first row fails bom-first-row", async () => {
  assert.ok(failing(await runHeldBack({ dir: variant('bom') })).includes('bom-first-row'));
});

test('a copy that reads dates in UTC plus a day fails month-end-own-month', async () => {
  assert.ok(failing(await runHeldBack({ dir: variant('utc') })).includes('month-end-own-month'));
});

test('held-back marks a check failed when a request times out', async () => {
  const run = await runHeldBack({ dir: variant('export-hangs'), timeoutMs: 1500 });
  const exported = run.checks.find((c) => c.id === 'export-matches');
  assert.equal(exported.pass, false);
  assert.match(exported.detail, /timed out/);
  assert.equal(run.total, HELD_BACK_CHECKS.length);
});
