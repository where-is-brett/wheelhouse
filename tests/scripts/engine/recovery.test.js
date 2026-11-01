// tests/scripts/engine/recovery.test.js
// The rules of recovery (unattended goals design, section 9): pure, and the same with or without a goal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLEEP_GAP_MINUTES, sleepGap, sleepWatch } from '../../../scripts/engine/recovery.js';

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

function watch({ fails = 0 } = {}) {
  const w = { at: T0, written: [], left: fails };
  w.sleeping = sleepWatch({
    now: () => new Date(w.at),
    write: async (gap) => {
      if (w.left > 0) { w.left -= 1; throw new Error('the record was refused'); }
      w.written.push(gap);
    },
  });
  return w;
}

test('one gap writes one span, and the beat answers once it is written', async () => {
  const w = watch();
  assert.equal(await w.sleeping.beat(), true);
  w.at += 60 * 1000;
  assert.equal(await w.sleeping.beat(), true);
  assert.deepEqual(w.written, []);
  w.at += 6 * 60 * 60 * 1000;
  const first = w.sleeping.beat();
  const second = w.sleeping.beat();
  assert.deepEqual([await first, await second], [true, true]);
  assert.equal(w.written.length, 1);
  assert.equal(w.written[0].from, '2026-11-01T01:01:00.000Z');
});

test('a failed write answers false, and the next beat writes the span from its start', async () => {
  const w = watch({ fails: 1 });
  await w.sleeping.beat();
  w.at += 6 * 60 * 60 * 1000;
  assert.equal(await w.sleeping.beat(), false);
  w.at += 60 * 1000;
  assert.equal(await w.sleeping.beat(), true);
  assert.deepEqual(w.written, [{ from: '2026-11-01T01:00:00.000Z', to: '2026-11-01T07:01:00.000Z' }]);
});
