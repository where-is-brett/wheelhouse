// tests/scripts/briefing/seen.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withHome } from '../../helpers/homes.js';
import { readSeen, markSeen, seenFile } from '../../../scripts/briefing/seen.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const none = { promptAt: null, briefedAt: null, weeklyAt: null };

test('seen times are kept per project, and a time in the future is treated as none', () => withHome((home) => {
  assert.equal(seenFile('demo'), path.join(home, 'projects', 'demo', 'seen.json'));
  assert.deepEqual(readSeen('demo', { now: NOW }), none);

  markSeen('demo', { promptAt: '2026-10-19T10:00:00.000Z' });
  assert.deepEqual(readSeen('demo', { now: NOW }), { promptAt: '2026-10-19T10:00:00.000Z', briefedAt: null, weeklyAt: null });
  // Each write keeps the other field.
  markSeen('demo', { briefedAt: new Date('2026-10-19T11:00:00.000Z') });
  assert.deepEqual(readSeen('demo', { now: NOW }), { promptAt: '2026-10-19T10:00:00.000Z', briefedAt: '2026-10-19T11:00:00.000Z', weeklyAt: null });
  markSeen('demo', { promptAt: '2026-10-19T11:30:00.000Z', briefedAt: 'not a time' });
  assert.deepEqual(readSeen('demo', { now: NOW }), { promptAt: '2026-10-19T11:30:00.000Z', briefedAt: '2026-10-19T11:00:00.000Z', weeklyAt: null });
  // Another project has its own.
  assert.deepEqual(readSeen('other', { now: NOW }), none);
  markSeen('other', { briefedAt: '2026-10-18T09:00:00.000Z' });
  assert.deepEqual(readSeen('other', { now: NOW }), { promptAt: null, briefedAt: '2026-10-18T09:00:00.000Z', weeklyAt: null });
  assert.equal(readSeen('demo', { now: NOW }).briefedAt, '2026-10-19T11:00:00.000Z');
  // Written whole, with nothing left beside it.
  assert.deepEqual(fs.readdirSync(path.dirname(seenFile('demo'))), ['seen.json']);

  // A time after now is one this computer's clock can't have written: treated as none.
  markSeen('demo', { briefedAt: '2026-10-20T12:00:00.000Z' });
  assert.deepEqual(readSeen('demo', { now: NOW }), { promptAt: '2026-10-19T11:30:00.000Z', briefedAt: null, weeklyAt: null });
  assert.equal(readSeen('demo', { now: new Date('2026-10-21T00:00:00.000Z') }).briefedAt, '2026-10-20T12:00:00.000Z');

  // A damaged file, or a field that isn't a time, reads as none.
  for (const body of ['not json', '[]', 'null', JSON.stringify({ promptAt: 'yesterday', briefedAt: '2026-02-30T00:00:00.000Z' }), JSON.stringify({ promptAt: 5 })]) {
    fs.writeFileSync(seenFile('demo'), body);
    assert.deepEqual(readSeen('demo', { now: NOW }), none);
  }
  // A damaged file is replaced whole by the next write.
  markSeen('demo', { promptAt: '2026-10-19T11:45:00.000Z' });
  assert.deepEqual(readSeen('demo', { now: NOW }), { promptAt: '2026-10-19T11:45:00.000Z', briefedAt: null, weeklyAt: null });

  // A name that can't be a project's reads as none and is never written.
  assert.deepEqual(readSeen('../demo', { now: NOW }), none);
  assert.throws(() => markSeen('../demo', { promptAt: '2026-10-19T11:00:00.000Z' }));
}));

test('the last briefing that showed the weekly lines is kept beside the others', () => withHome(() => {
  markSeen('demo', { briefedAt: '2026-10-19T09:00:00.000Z', weeklyAt: '2026-10-19T09:00:00.000Z' });
  markSeen('demo', { briefedAt: '2026-10-19T11:00:00.000Z' });
  assert.deepEqual(readSeen('demo', { now: NOW }), { promptAt: null, briefedAt: '2026-10-19T11:00:00.000Z', weeklyAt: '2026-10-19T09:00:00.000Z' });
  markSeen('demo', { weeklyAt: 'not a time' });
  assert.equal(readSeen('demo', { now: NOW }).weeklyAt, '2026-10-19T09:00:00.000Z');
}));
