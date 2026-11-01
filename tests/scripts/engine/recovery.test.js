// tests/scripts/engine/recovery.test.js
// The rules of recovery (unattended goals design, section 9): pure, and the same with or without a goal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLEEP_GAP_MINUTES, sleepGap } from '../../../scripts/engine/recovery.js';

const T0 = Date.parse('2026-11-01T01:00:00.000Z');
const LIMIT = SLEEP_GAP_MINUTES * 60 * 1000;

test('a beat at three minutes is no sleep, and a millisecond more is', () => {
  assert.equal(sleepGap(T0, T0 + LIMIT), null);
  assert.deepEqual(sleepGap(T0, T0 + LIMIT + 1), { from: '2026-11-01T01:00:00.000Z', to: '2026-11-01T01:03:00.001Z' });
});

test('no earlier beat, or a clock put back, is no sleep', () => {
  assert.equal(sleepGap(null, T0), null);
  assert.equal(sleepGap(T0, T0 - LIMIT * 10), null);
});
