// tests/scripts/usage/store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withHome } from '../../helpers/homes.js';
import { usageDir } from '../../../scripts/lib/paths.js';
import {
  addPoints, recordModReading, recordReceived, recordAllowance, recordSession, summariseDay, computeDay, readDay, pruneUsage,
} from '../../../scripts/usage/store.js';

const NOW = '2026-10-18T10:00:00.000Z';
const START = '2026-10-18T08:00:00.000Z';

function point(over = {}) {
  return {
    metric: 'tokens', session: 's1', model: 'model-a', type: 'input', source: 'main', value: 10,
    at: '2026-10-18T09:00:00.000Z', start: START, cumulative: true, ...over,
  };
}

function records(date = '2026-10-18') {
  const file = path.join(usageDir(), 'records', `${date}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const total = (lines, key = 'tokens') => lines.reduce((sum, line) => sum + (line[key] ?? 0), 0);

test('a cumulative series adds only its increase; the same point twice adds nothing', () => withHome(() => {
  addPoints([point({ value: 10 })], { now: NOW });
  addPoints([point({ value: 10, at: '2026-10-18T09:01:00.000Z' })], { now: NOW }); // the same count again
  addPoints([point({ value: 25, at: '2026-10-18T09:02:00.000Z' })], { now: NOW });
  addPoints([point({ value: 25, at: '2026-10-18T09:02:00.000Z' })], { now: NOW }); // the same export sent twice
  addPoints([point({ value: 18, at: '2026-10-18T09:03:00.000Z' })], { now: NOW }); // arrives out of order
  addPoints([point({ value: 25, at: '2026-10-18T09:04:00.000Z' })], { now: NOW });
  assert.equal(total(records()), 25);
  assert.deepEqual(records().map((line) => line.tokens), [10, 15]);
  // two points of one series in one batch are handled in order too
  addPoints([point({ value: 30 }), point({ value: 30 })], { now: NOW });
  assert.equal(total(records()), 30);
}));

test('a series that restarts with a new start time counts from zero', () => withHome(() => {
  addPoints([point({ value: 100 })], { now: NOW });
  addPoints([point({ value: 7, start: '2026-10-18T09:30:00.000Z', at: '2026-10-18T09:31:00.000Z' })], { now: NOW });
  addPoints([point({ value: 9, start: '2026-10-18T09:30:00.000Z', at: '2026-10-18T09:32:00.000Z' })], { now: NOW });
  // the old run, late: its count is unchanged, so nothing is added
  addPoints([point({ value: 100, at: '2026-10-18T09:33:00.000Z' })], { now: NOW });
  assert.equal(total(records()), 109);
}));

test('series are told apart by metric, session, model, type and source', () => withHome(() => {
  addPoints([
    point({ value: 5 }),
    point({ value: 5, session: 's2' }),
    point({ value: 5, model: 'model-b' }),
    point({ value: 5, type: 'output' }),
    point({ value: 5, source: 'subagent' }),
    point({ value: 5, source: undefined }),
  ], { now: NOW });
  assert.equal(total(records()), 30);
  assert.equal(records().length, 6);
}));

test('delta points are added as they are; one repeated exactly adds nothing', () => withHome(() => {
  const delta = (over) => point({ cumulative: false, ...over });
  addPoints([delta({ value: 4, at: '2026-10-18T09:00:00.000Z', start: '2026-10-18T08:59:00.000Z' })], { now: NOW });
  addPoints([delta({ value: 4, at: '2026-10-18T09:01:00.000Z', start: '2026-10-18T09:00:00.000Z' })], { now: NOW });
  addPoints([delta({ value: 6, at: '2026-10-18T09:02:00.000Z', start: '2026-10-18T09:01:00.000Z' })], { now: NOW });
  addPoints([delta({ value: 6, at: '2026-10-18T09:02:00.000Z', start: '2026-10-18T09:01:00.000Z' })], { now: NOW }); // sent twice
  assert.deepEqual(records().map((line) => line.tokens), [4, 4, 6]);
  // a smaller delta is not a restart
  addPoints([delta({ value: 1, at: '2026-10-18T09:03:00.000Z', start: '2026-10-18T09:02:00.000Z' })], { now: NOW });
  assert.equal(total(records()), 15);
  // the kept series file does not grow with every delta
  const series = JSON.parse(fs.readFileSync(path.join(usageDir(), 'series.json'), 'utf8'));
  assert.equal(Object.keys(series).length, 1);
}));

test('a delta export is counted once: same-time points of a series are summed, and an export seen before adds nothing', () => withHome(() => {
  const delta = (over) => point({ cumulative: false, ...over });
  const t1 = '2026-10-18T09:00:00.000Z';
  const t2 = '2026-10-18T09:01:00.000Z';
  // two points of one series in one export (a dropped attribute split them)
  const export1 = [delta({ value: 5, at: t1 }), delta({ value: 7, at: t1 })];
  addPoints(export1, { now: NOW });
  addPoints(export1, { now: NOW }); // sent again
  assert.equal(total(records()), 12);
  // equal values are both counted
  addPoints([delta({ value: 3, at: t2 }), delta({ value: 3, at: t2 })], { now: NOW });
  assert.equal(total(records()), 18);
  // A, B, A: the first export comes again after a later one
  addPoints([delta({ value: 5, at: t1 })], { now: NOW });
  addPoints([delta({ value: 7, at: '2026-10-18T09:02:00.000Z' })], { now: NOW });
  addPoints([delta({ value: 5, at: t1 })], { now: NOW });
  assert.equal(total(records()), 25);
  // another series at the same time is its own
  addPoints([delta({ value: 2, at: t1, model: 'model-b' })], { now: NOW });
  assert.equal(total(records()), 27);
  // only the recent export times are kept
  for (let i = 0; i < 40; i++) addPoints([delta({ value: 1, at: new Date(Date.UTC(2026, 9, 18, 10, i)).toISOString() })], { now: NOW });
  const [entry] = Object.values(JSON.parse(fs.readFileSync(path.join(usageDir(), 'series.json'), 'utf8'))).filter((item) => item.ats);
  assert.ok(entry.ats.length <= 32);
}));

test('a cumulative point with no start time is one series, not a new one each export', () => withHome(() => {
  addPoints([point({ start: undefined, value: 10, at: '2026-10-18T09:00:00.000Z' })], { now: NOW });
  addPoints([point({ start: undefined, value: 10, at: '2026-10-18T09:01:00.000Z' })], { now: NOW });
  addPoints([point({ start: undefined, value: 16, at: '2026-10-18T09:02:00.000Z' })], { now: NOW });
  assert.equal(total(records()), 16);
}));

test('the cost metric is kept in dollars beside the tokens', () => withHome(() => {
  addPoints([
    point({ metric: 'usd', type: undefined, value: 0.25, cumulative: false }),
    point({ metric: 'tokens', value: 12 }),
  ], { now: NOW });
  const [cost, tokens] = records();
  assert.deepEqual(cost, { at: '2026-10-18T09:00:00.000Z', session: 's1', model: 'model-a', source: 'main', usd: 0.25 });
  assert.deepEqual(tokens, {
    at: '2026-10-18T09:00:00.000Z', session: 's1', model: 'model-a', type: 'input', source: 'main', tokens: 12,
  });
  const summary = summariseDay('2026-10-18');
  assert.equal(summary.sessions.s1.usd, 0.25);
  assert.equal(summary.sessions.s1.tokens, 12);
  assert.deepEqual(summary.sessions.s1.byModel, { 'model-a': { tokens: 12, usd: 0.25 } });
  assert.deepEqual(summary.sessions.s1.bySource, { main: 12 });
}));

test('records go in the file of the day they were counted, and nothing unusable is kept', () => withHome(() => {
  addPoints([
    point({ at: '2026-10-17T23:59:00.000Z', value: 3 }),
    point({ at: '2026-10-18T00:01:00.000Z', value: 5 }),
    point({ session: '../escape', value: 5 }),
    point({ session: undefined, value: 5, model: 'model-b' }),
    point({ value: Number.NaN, model: 'model-c' }),
    point({ value: -4, model: 'model-d' }),
  ], { now: NOW });
  assert.deepEqual(records('2026-10-17').map((line) => line.tokens), [3]);
  assert.deepEqual(records('2026-10-18').map((line) => line.tokens), [2]);
  assert.deepEqual(fs.readdirSync(path.join(usageDir(), 'records')).sort(), ['2026-10-17.jsonl', '2026-10-18.jsonl']);
}));

test('the series file survives a restart and a damaged file starts again', () => withHome(() => {
  addPoints([point({ value: 10 })], { now: NOW });
  fs.writeFileSync(path.join(usageDir(), 'series.json'), '{ not json');
  addPoints([point({ value: 10, at: '2026-10-18T09:05:00.000Z' })], { now: NOW });
  assert.equal(total(records()), 20);
  assert.deepEqual(fs.readdirSync(usageDir()).filter((name) => name.endsWith('.tmp')), []);
}));

test('the mod\'s cumulative cost becomes the day\'s increase per session', () => withHome(() => {
  const read = (date, usd, session = 's1') => recordModReading({ session, usd, at: `${date}T12:00:00.000Z` });
  read('2026-10-16', 1.5);
  read('2026-10-17', 2);
  read('2026-10-17', 4);
  read('2026-10-18', 4.5);
  read('2026-10-18', 6);
  read('2026-10-18', 3, 's2'); // a session first seen today: from its first reading
  read('2026-10-18', 3.75, 's2');
  assert.equal(summariseDay('2026-10-18').sessions.s1.modUsd, 2);
  assert.equal(summariseDay('2026-10-18').sessions.s2.modUsd, 0.75);
  assert.equal(summariseDay('2026-10-17').sessions.s1.modUsd, 2.5);
  assert.equal(summariseDay('2026-10-16').sessions.s1.modUsd, 0);
  // a reading that goes down (a session that started over) is never negative
  read('2026-10-19', 0.5);
  assert.equal(summariseDay('2026-10-19').sessions.s1.modUsd, 0);
  // no readings that day: no figure
  recordModReading({ session: 's3', usd: 1, at: '2026-10-18T12:00:00.000Z' });
  addPoints([point({ session: 's4', value: 2 })], { now: NOW });
  assert.equal(summariseDay('2026-10-18').sessions.s4.modUsd, null);
  const lines = fs.readFileSync(path.join(usageDir(), 'mod', '2026-10-18.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines[0], { at: '2026-10-18T12:00:00.000Z', session: 's1', usd: 4.5 });
}));

test('the allowance file holds the latest windows and their reset times', () => withHome(() => {
  const file = path.join(usageDir(), 'allowance.json');
  recordModReading({ session: 's1', usd: 1, windows: [], at: '2026-10-18T09:00:00.000Z' });
  assert.equal(fs.existsSync(file), false);
  recordModReading({
    session: 's1',
    usd: 1,
    windows: [{ kind: 'five_hour', percentUsed: 41, resetsAt: '2026-10-18T13:00:00.000Z', extra: 'dropped' }, { kind: 'weekly', percentUsed: 12 }],
    at: '2026-10-18T10:00:00.000Z',
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
    at: '2026-10-18T10:00:00.000Z',
    windows: [{ kind: 'five_hour', percentUsed: 41, resetsAt: '2026-10-18T13:00:00.000Z' }, { kind: 'weekly', percentUsed: 12 }],
  });
  // the terminal's status line writes the same file; the later reading wins
  recordAllowance({ windows: [{ kind: 'five_hour', percentUsed: 55, resetsAt: '2026-10-18T13:00:00.000Z' }], at: '2026-10-18T11:00:00.000Z' });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).windows[0].percentUsed, 55);
  // an older reading does not replace a newer one, and an empty list changes nothing
  recordAllowance({ windows: [{ kind: 'five_hour', percentUsed: 3 }], at: '2026-10-18T09:30:00.000Z', now: new Date('2026-10-18T12:00:00.000Z') });
  recordAllowance({ windows: [], at: '2026-10-18T12:00:00.000Z' });
  const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(kept.windows[0].percentUsed, 55);
  assert.equal(kept.at, '2026-10-18T11:00:00.000Z');
}));

test('a kept allowance stamped ahead of now (the clock moved back) gives way to the next reading', () => withHome(() => {
  const file = path.join(usageDir(), 'allowance.json');
  recordAllowance({ windows: [{ kind: 'weekly', percentUsed: 40 }], at: '2026-10-25T09:00:00.000Z', now: new Date('2026-10-25T09:00:00.000Z') });
  // The clock is put back a week: the kept reading is in the future, so it no longer blocks.
  recordAllowance({ windows: [{ kind: 'weekly', percentUsed: 12 }], at: '2026-10-18T09:00:00.000Z', now: new Date('2026-10-18T09:00:00.000Z') });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { at: '2026-10-18T09:00:00.000Z', windows: [{ kind: 'weekly', percentUsed: 12 }] });
  recordModReading({ session: 's1', windows: [{ kind: 'weekly', percentUsed: 13 }], at: '2026-10-18T10:00:00.000Z', now: new Date('2026-10-18T10:00:00.000Z') });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).windows[0].percentUsed, 13);
}));

test('a session is recorded once', () => withHome(() => {
  recordSession({ session: 's1', project: 'o__p', role: 'feature', work: 'feat-1', at: '2026-10-18T09:00:00.000Z' });
  recordSession({ session: 's1', project: 'o__q', role: 'foreman', at: '2026-10-18T10:00:00.000Z' });
  const file = path.join(usageDir(), 'sessions', 's1.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
    session: 's1', project: 'o__p', role: 'feature', work: 'feat-1', at: '2026-10-18T09:00:00.000Z',
  });
  assert.throws(() => recordSession({ session: '../x', project: 'o__p', role: 'feature', at: NOW }), /session/i);
  assert.throws(() => recordSession({ session: 's2', project: 'o__p', role: 'boss', at: NOW }), /role/i);
}));

test('a session file the mod wrote is replaced once by the session start; the session start\'s stays', () => withHome(() => {
  const file = (id) => path.join(usageDir(), 'sessions', `${id}.json`);
  const read = (id) => JSON.parse(fs.readFileSync(file(id), 'utf8'));
  // The mod's bridge got there first and couldn't tell the foreman.
  recordSession({ session: 's1', project: 'o__p', role: 'front-desk', at: '2026-10-18T09:00:00.000Z', by: 'mod' });
  assert.deepEqual(read('s1'), { session: 's1', project: 'o__p', role: 'front-desk', at: '2026-10-18T09:00:00.000Z', by: 'mod' });
  // Another reading from the mod changes nothing.
  recordSession({ session: 's1', project: 'o__p', role: 'feature', work: 'w', at: '2026-10-18T09:01:00.000Z', by: 'mod' });
  assert.equal(read('s1').role, 'front-desk');
  // The session start replaces it, once.
  recordSession({ session: 's1', project: 'o__p', role: 'foreman', at: '2026-10-18T09:02:00.000Z' });
  assert.deepEqual(read('s1'), { session: 's1', project: 'o__p', role: 'foreman', at: '2026-10-18T09:02:00.000Z' });
  recordSession({ session: 's1', project: 'o__p', role: 'front-desk', at: '2026-10-18T09:03:00.000Z' });
  recordSession({ session: 's1', project: 'o__p', role: 'front-desk', at: '2026-10-18T09:04:00.000Z', by: 'mod' });
  assert.equal(read('s1').role, 'foreman');
  // The session start first: the mod never replaces it.
  recordSession({ session: 's2', project: 'o__p', role: 'foreman', at: '2026-10-18T09:00:00.000Z' });
  recordSession({ session: 's2', project: 'o__p', role: 'front-desk', at: '2026-10-18T09:01:00.000Z', by: 'mod' });
  assert.deepEqual(read('s2'), { session: 's2', project: 'o__p', role: 'foreman', at: '2026-10-18T09:00:00.000Z' });
}));

test('summariseDay writes the day and readDay reads it back', () => withHome(() => {
  assert.equal(readDay('2026-10-18'), null);
  addPoints([
    point({ value: 100, type: 'input' }),
    point({ value: 50, type: 'output', source: 'subagent' }),
    point({ value: 8, session: 's2', model: 'model-b' }),
  ], { now: NOW });
  const summary = summariseDay('2026-10-18');
  assert.equal(summary.date, '2026-10-18');
  assert.equal(summary.sessions.s1.tokens, 150);
  assert.deepEqual(summary.sessions.s1.bySource, { main: 100, subagent: 50 });
  assert.equal(summary.sessions.s1.usd, 0);
  assert.equal(summary.sessions.s2.byModel['model-b'].tokens, 8);
  assert.deepEqual(readDay('2026-10-18'), summary);
  assert.ok(fs.existsSync(path.join(usageDir(), 'days', '2026-10-18.json')));
  assert.throws(() => summariseDay('../2026'), /date/i);
  assert.equal(readDay('not-a-date'), null);
  // a day whose raw counts are gone keeps its summary
  fs.rmSync(path.join(usageDir(), 'records'), { recursive: true });
  assert.deepEqual(summariseDay('2026-10-18'), summary);
}));

test('raw files go after 14 days and summaries after 90', () => withHome(() => {
  const dayOffset = (n) => new Date(Date.UTC(2026, 9, 18) - n * 86400000).toISOString().slice(0, 10);
  const put = (folder, name, body = '{}\n') => {
    const file = path.join(usageDir(), folder, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
  };
  const line = (session, date) => `${JSON.stringify({ at: `${date}T09:00:00.000Z`, session, tokens: 1 })}\n`;
  const oldRaw = put('records', `${dayOffset(15)}.jsonl`, line('gone', dayOffset(15)));
  const keptRaw = put('records', `${dayOffset(14)}.jsonl`, line('kept-raw', dayOffset(14)));
  const oldMod = put('mod', `${dayOffset(15)}.jsonl`);
  const keptMod = put('mod', `${dayOffset(1)}.jsonl`, line('kept-mod', dayOffset(1)));
  const oldDay = put('days', `${dayOffset(91)}.json`, JSON.stringify({ date: dayOffset(91), sessions: { gone: {} } }));
  const keptDay = put('days', `${dayOffset(90)}.json`, JSON.stringify({ date: dayOffset(90), sessions: { 'kept-day': {} } }));
  const sessionFile = (name) => put('sessions', `${name}.json`, JSON.stringify({ session: name, at: '2026-01-01T00:00:00.000Z' }));
  const goneSession = sessionFile('gone');
  const keptSessions = ['kept-raw', 'kept-mod', 'kept-day'].map(sessionFile);
  const unrelated = put('sessions', 'recent.json', JSON.stringify({ session: 'recent', at: '2026-10-18T09:00:00.000Z' }));
  put('', 'series.json', JSON.stringify({
    old: { value: 1, start: START, seen: `${dayOffset(20)}T00:00:00.000Z` },
    live: { value: 1, start: START, seen: `${dayOffset(1)}T00:00:00.000Z` },
  }));
  pruneUsage({ now: NOW });
  for (const gone of [oldRaw, oldMod, oldDay, goneSession]) assert.equal(fs.existsSync(gone), false, gone);
  for (const kept of [keptRaw, keptMod, keptDay, unrelated, ...keptSessions]) assert.equal(fs.existsSync(kept), true, kept);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(usageDir(), 'series.json'), 'utf8'))), ['live']);
  // nothing to prune in an empty home is not an error
  assert.doesNotThrow(() => withHome(() => pruneUsage({ now: NOW })));
}));

test('a time can be given as a function, a Date or text', () => withHome(() => {
  recordAllowance({ windows: [{ kind: 'weekly', percentUsed: 1 }], at: new Date('2026-10-18T09:00:00Z') });
  addPoints([point({ at: undefined })], { now: () => new Date(NOW) });
  assert.equal(records()[0].at, NOW);
}));

test('computeDay sums a day from its raw files and writes nothing', () => withHome(() => {
  addPoints([point({ value: 12 })], { now: NOW });
  const summary = computeDay('2026-10-18');
  assert.equal(summary.sessions.s1.tokens, 12);
  assert.equal(readDay('2026-10-18'), null);
  assert.equal(fs.existsSync(path.join(usageDir(), 'days')), false);
  assert.equal(computeDay('2026-10-17'), null); // no raw files for the day
  assert.deepEqual(summariseDay('2026-10-18'), summary);
}));

test('a received line is kept in the day\'s mod file and is not a cost reading', () => withHome(() => {
  recordModReading({ session: 's1', usd: 1, at: '2026-10-18T09:00:00.000Z' });
  recordReceived({ session: 's1', via: 'prompt', origin: 'sdk', at: '2026-10-18T09:30:00.000Z' });
  recordReceived({ session: 's1', via: 'receive', origin: 'peer', at: '2026-10-18T09:31:00.000Z' });
  const lines = fs.readFileSync(path.join(usageDir(), 'mod', '2026-10-18.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(lines.slice(1), [
    { at: '2026-10-18T09:30:00.000Z', event: 'received', via: 'prompt', origin: 'sdk', session: 's1' },
    { at: '2026-10-18T09:31:00.000Z', event: 'received', via: 'receive', origin: 'peer', session: 's1' },
  ]);
  // The day's figures are the same with them there.
  assert.equal(summariseDay('2026-10-18').sessions.s1.modUsd, 0);
  assert.throws(() => recordReceived({ session: '../x', via: 'prompt', origin: 'sdk', at: '2026-10-18T09:30:00.000Z' }));
}));
