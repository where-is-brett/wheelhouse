// tests/probes/haiku-trial/sittings.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SITTING_POINTS, CLICKS, placeClicks, parseWindow, windowState, estimate, directorNote, TYPICAL_MS, WAVE_WAIT_MS } from '../../../probes/haiku-trial/sittings.js';

test('placeClicks defaults to one sitting at w4 with all three clicks', () => {
  assert.deepEqual(placeClicks(), [{ n: 1, point: 'w4', after: 'w4-type', clicks: ['F6', 'F5a', 'F5b'] }]);
  assert.deepEqual(placeClicks(['w4']), placeClicks());
  assert.deepEqual(CLICKS.map((c) => c.id), ['F6', 'F5a', 'F5b']);
  assert.deepEqual(SITTING_POINTS, { w3: 'f1c', w4: 'w4-type', end: 'w5-midnight' });
});

test('w3 and w4 keep the original order', () => {
  assert.deepEqual(placeClicks(['w3', 'w4']).map((s) => [s.n, s.after, s.clicks]), [[1, 'f1c', ['F6', 'F5a']], [2, 'w4-type', ['F5b']]]);
  assert.deepEqual(placeClicks(['w4', 'w3']), placeClicks(['w3', 'w4']), 'the order given does not matter');
});

test('a click no sitting can take goes in one at the end, and an empty sitting is left out', () => {
  assert.deepEqual(placeClicks(['w3']).map((s) => [s.point, s.clicks]), [['w3', ['F6', 'F5a']], ['end', ['F5b']]]);
  assert.deepEqual(placeClicks(['w4', 'end']).map((s) => s.point), ['w4']);
  assert.throws(() => placeClicks(['w9']), /no sitting point called w9/);
});

test('a window across midnight is open at 01:00', () => {
  const night = [parseWindow('22:00-02:00')];
  assert.deepEqual(night, [{ start: 1320, end: 120 }]);
  assert.equal(windowState(night, 60), 'open');
  assert.equal(windowState(night, 23 * 60), 'open');
  assert.equal(windowState(night, 12 * 60), 'before');
  assert.equal(windowState(night, 1440 + 3 * 60), 'past', 'on the next day, after the window has closed');
  const day = [parseWindow('09:00-10:00'), parseWindow('13:00-14:00')];
  assert.equal(windowState(day, 8 * 60), 'before');
  assert.equal(windowState(day, 9 * 60 + 30), 'open');
  assert.equal(windowState(day, 11 * 60), 'before', 'the second window is still to come');
  assert.equal(windowState(day, 15 * 60), 'past');
  assert.throws(() => parseWindow('9-10'), /HH:MM-HH:MM/);
  assert.throws(() => parseWindow('25:00-26:00'), /HH:MM-HH:MM/);
});

test('estimate gives early before late', () => {
  const now = Date.parse('2026-11-13T09:00:00Z');
  const got = estimate({ remaining: ['w2-merge-wait', 'w3-merge-wait'], now });
  assert.equal(got.early, now + TYPICAL_MS['w2-merge-wait'] + TYPICAL_MS['w3-merge-wait']);
  assert.equal(got.late, now + WAVE_WAIT_MS[2] + WAVE_WAIT_MS[3]);
  assert.ok(got.early < got.late);
  assert.deepEqual(estimate({ remaining: [], now }), { early: now, late: now });
});

test('the director note names each sitting, its clicks and its time range', () => {
  const now = new Date(2026, 10, 13, 9, 0).getTime();
  const sittings = placeClicks(['w3', 'w4']);
  const estimates = [{ early: now + 60 * 60000, late: now + 3 * 60 * 60000 }, { early: now + 4 * 60 * 60000, late: now + 30 * 60 * 60000 }];
  const note = directorNote({ sittings, estimates, now });
  assert.match(note, /Sitting 1.*between 10:00 and 12:00 today.*2 clicks.*about 8 minutes/);
  assert.match(note, /Sitting 2.*between 13:00 and 15:00 tomorrow.*1 click in.*about 5 minutes/);
  for (const id of ['F6', 'F5a', 'F5b']) assert.match(note, new RegExp(`- ${id}:`));
  assert.match(note, /asks once/);
  assert.match(directorNote({ sittings: placeClicks(), estimates: [estimate({ remaining: [], now })], now }), /3 clicks.*about 10 minutes/);
  assert.match(directorNote({ sittings, estimates, windows: [parseWindow('22:00-02:00')], now }), /Held to: 22:00-02:00/);
});
