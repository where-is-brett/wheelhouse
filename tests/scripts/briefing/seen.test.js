// tests/scripts/briefing/seen.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withHome } from '../../helpers/homes.js';
import { readSeen, markSeen, readVisits, seenFile, BOARD_ASKS } from '../../../scripts/briefing/seen.js';

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

test('visits and board commands are kept beside the times, the last ten commands only, read by the same rules', () => withHome(() => {
  assert.deepEqual(readVisits('demo', { now: NOW }), { visitAt: null, boardAsks: [] });
  markSeen('demo', { promptAt: '2026-10-19T10:00:00.000Z', visitAt: '2026-10-19T10:00:00.000Z' });
  markSeen('demo', { boardAsk: { at: new Date('2026-10-19T10:05:00.000Z'), tab: 'build', visit: '2026-10-19T10:00:00.000Z' } });
  markSeen('demo', { boardAsk: { at: '2026-10-19T10:06:00.000Z', visit: '2026-10-19T10:00:00.000Z' } });
  // Neither is a board command: a tab that isn't one, a visit that isn't a time.
  markSeen('demo', { boardAsk: { at: '2026-10-19T10:07:00.000Z', tab: 'other', visit: '2026-10-19T10:00:00.000Z' } });
  markSeen('demo', { boardAsk: { at: '2026-10-19T10:08:00.000Z', tab: 'build', visit: 'today' } });
  assert.deepEqual(readVisits('demo', { now: NOW }), {
    visitAt: '2026-10-19T10:00:00.000Z',
    boardAsks: [{ at: '2026-10-19T10:05:00.000Z', tab: 'build', visit: '2026-10-19T10:00:00.000Z' }, { at: '2026-10-19T10:06:00.000Z', tab: null, visit: '2026-10-19T10:00:00.000Z' }],
  });
  // The times are kept as they were, and a later time write keeps the commands.
  assert.deepEqual(readSeen('demo', { now: NOW }), { promptAt: '2026-10-19T10:00:00.000Z', briefedAt: null, weeklyAt: null });
  markSeen('demo', { briefedAt: '2026-10-19T10:00:00.000Z' });
  assert.equal(readVisits('demo', { now: NOW }).boardAsks.length, 2);
  // Only the last ten are kept.
  for (let i = 0; i < 12; i += 1) markSeen('demo', { boardAsk: { at: `2026-10-19T11:${String(i).padStart(2, '0')}:00.000Z`, tab: 'director', visit: '2026-10-19T10:00:00.000Z' } });
  const { boardAsks } = readVisits('demo', { now: NOW });
  assert.equal(BOARD_ASKS, 10);
  assert.equal(boardAsks.length, BOARD_ASKS);
  assert.equal(boardAsks[0].at, '2026-10-19T11:02:00.000Z');
  // One after now is left out, as a time after now is.
  assert.equal(readVisits('demo', { now: new Date('2026-10-19T11:05:30.000Z') }).boardAsks.length, 4);
  // A damaged list reads as none.
  fs.writeFileSync(seenFile('demo'), JSON.stringify({ visitAt: 'soon', boardAsks: 'many' }));
  assert.deepEqual(readVisits('demo', { now: NOW }), { visitAt: null, boardAsks: [] });
}));
