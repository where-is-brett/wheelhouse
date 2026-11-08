// tests/scripts/digest/due.test.js
// When the digest is made (once a day, after the time the director set), when it carries the weekly log, and how it waits for
// the director's next message. Made-up project: harbour-demo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { digestDue, logDue, readDigest, writeDigest, clearDigest, digestFile } from '../../../scripts/digest/due.js';
import { readDigestSeen, markSeen } from '../../../scripts/briefing/seen.js';
import { withHome } from '../../helpers/homes.js';

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m);

test('the digest is due once a day after digestAt, local time, 17:00 unless changed', () => {
  const none = { digestAt: null };
  assert.equal(digestDue({ seen: none, now: at(8, 16, 59) }), false);
  assert.equal(digestDue({ seen: none, now: at(8, 17, 0) }), true);
  assert.equal(digestDue({ seen: none, now: at(8, 23, 0) }), true);
  // Made this evening, so not due again until tomorrow's slot.
  const made = { digestAt: at(8, 17, 2).toISOString() };
  assert.equal(digestDue({ seen: made, now: at(8, 18) }), false);
  assert.equal(digestDue({ seen: made, now: at(9, 16, 59) }), false);
  assert.equal(digestDue({ seen: made, now: at(9, 17) }), true);
  // The director's own time.
  assert.equal(digestDue({ seen: none, now: at(8, 8, 59), at: '09:00' }), false);
  assert.equal(digestDue({ seen: none, now: at(8, 9, 0), at: '09:00' }), true);
  // A time that isn't one falls back to 17:00; a clock that can't be read makes none.
  assert.equal(digestDue({ seen: none, now: at(8, 12), at: 'noon' }), false);
  assert.equal(digestDue({ seen: none, now: at(8, 18), at: 'noon' }), true);
  assert.equal(digestDue({ seen: none, now: 'never' }), false);
});

test('the weekly log is added on the first digest seven or more days after the last', () => {
  assert.equal(logDue({ seen: { digestLogAt: null }, now: at(8, 17) }), true);
  const last = at(1, 17, 1).toISOString();
  assert.equal(logDue({ seen: { digestLogAt: last }, now: at(7, 17) }), false);
  assert.equal(logDue({ seen: { digestLogAt: last }, now: at(8, 17, 1) }), true);
  assert.equal(logDue({ seen: { digestLogAt: last }, now: at(9, 17) }), true);
});

test('the digest shows once: it waits in its file, is read back whole, and is taken away when shown', () => withHome(() => {
  assert.equal(readDigest('harbour-demo'), null);
  writeDigest('harbour-demo', { at: at(8, 17, 1).toISOString(), text: 'Daily digest, 8 November 2026\n\nMerged by itself\nNothing.', weekly: true });
  assert.deepEqual(readDigest('harbour-demo'), { at: at(8, 17, 1).toISOString(), text: 'Daily digest, 8 November 2026\n\nMerged by itself\nNothing.', weekly: true });
  // A newer digest replaces one not yet shown.
  writeDigest('harbour-demo', { at: at(9, 17, 1).toISOString(), text: 'Daily digest, 9 November 2026' });
  assert.equal(readDigest('harbour-demo').text, 'Daily digest, 9 November 2026');
  assert.equal(readDigest('harbour-demo').weekly, false);
  clearDigest('harbour-demo');
  assert.equal(readDigest('harbour-demo'), null);
  clearDigest('harbour-demo');
  // A damaged file reads as none.
  fs.mkdirSync(digestFile('harbour-demo').replace(/digest\.json$/, ''), { recursive: true });
  fs.writeFileSync(digestFile('harbour-demo'), '{ not json');
  assert.equal(readDigest('harbour-demo'), null);
}));

test('the digest times are kept in seen.json beside the others, and a time in the future reads as none', () => withHome(() => {
  const now = at(8, 18);
  assert.deepEqual(readDigestSeen('harbour-demo', { now }), { digestAt: null, digestLogAt: null, digestShownAt: null });
  markSeen('harbour-demo', { digestAt: at(8, 17, 1), digestLogAt: at(8, 17, 1).toISOString(), promptAt: at(8, 10).toISOString() });
  markSeen('harbour-demo', { digestShownAt: at(8, 17, 30) });
  const seen = readDigestSeen('harbour-demo', { now });
  assert.equal(seen.digestAt, at(8, 17, 1).toISOString());
  assert.equal(seen.digestLogAt, at(8, 17, 1).toISOString());
  assert.equal(seen.digestShownAt, at(8, 17, 30).toISOString());
  assert.equal(readDigestSeen('harbour-demo', { now: at(8, 12) }).digestAt, null);
}));
