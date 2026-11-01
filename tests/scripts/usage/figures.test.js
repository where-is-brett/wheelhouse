// tests/scripts/usage/figures.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withHome } from '../../helpers/homes.js';
import { usageDir } from '../../../scripts/lib/paths.js';
import { addPoints, recordModReading } from '../../../scripts/usage/store.js';
import { usageFigures, weeklyShare, markRaised, wasRaised } from '../../../scripts/usage/figures.js';

const NOW = '2026-10-19T10:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

const put = (relative, value) => {
  const file = path.join(usageDir(), relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};
const dateBack = (days) => new Date(Date.parse(NOW) - days * DAY_MS).toISOString().slice(0, 10);

// One session's share of a day: tokens and dollars split over models.
const entry = (tokens, over = {}) => ({
  tokens,
  usd: over.usd ?? 0,
  byModel: over.byModel ?? { 'model-a': { tokens, usd: over.usd ?? 0 } },
  bySource: over.bySource ?? { main: tokens },
  modUsd: over.modUsd ?? null,
});
const day = (date, sessions) => put(`days/${date}.json`, { date, sessions });
const session = (id, over = {}) => put(`sessions/${id}.json`, {
  session: id, project: 'shop', role: 'feature', at: '2026-10-01T00:00:00.000Z', ...over,
});
const allowance = (windows, at = '2026-10-19T09:00:00.000Z') => put('allowance.json', { at, windows });

test('the week follows the allowance\'s reset time when it has one', () => withHome(() => {
  allowance([{ kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-22T14:00:00.000Z' }]);
  session('s1');
  day('2026-10-14', { s1: entry(1000) }); // before the window began
  day('2026-10-15', { s1: entry(100) });
  day('2026-10-19', { s1: entry(10) });
  const { week } = usageFigures({ project: null, now: NOW });
  assert.equal(week.from, '2026-10-15T14:00:00.000Z');
  assert.equal(week.to, '2026-10-22T14:00:00.000Z');
  assert.equal(week.tokens, 110);
}));

test('a reset time in the past, missing, or more than a week ahead falls back to the last seven days', () => withHome(() => {
  session('s1');
  day('2026-10-12', { s1: entry(1000) }); // eight days back: outside
  day('2026-10-13', { s1: entry(100) });
  day('2026-10-19', { s1: entry(10) });
  const cases = [
    { kind: 'seven_day', percentUsed: 10, resetsAt: '2026-10-18T10:00:00.000Z' }, // in the past
    { kind: 'seven_day', percentUsed: 10, resetsAt: '2026-10-19T10:00:00.000Z' }, // right now
    { kind: 'seven_day', percentUsed: 10 }, // none
    { kind: 'seven_day', percentUsed: 10, resetsAt: new Date(Date.parse(NOW) + 7 * DAY_MS + 1000).toISOString() }, // too far ahead
  ];
  for (const window of cases) {
    allowance([window]);
    const { week } = usageFigures({ project: null, now: NOW });
    assert.equal(week.from, '2026-10-12T10:00:00.000Z', JSON.stringify(window));
    assert.equal(week.to, NOW);
    assert.equal(week.tokens, 110);
  }
  // no allowance at all
  fs.rmSync(path.join(usageDir(), 'allowance.json'));
  assert.equal(usageFigures({ project: null, now: NOW }).week.tokens, 110);
}));

test('the share says when its week resets', () => withHome(() => {
  const resetsAt = '2026-10-22T14:00:00.000Z';
  allowance([{ kind: 'seven_day', percentUsed: 40, resetsAt }], '2026-10-19T09:30:00.000Z');
  assert.deepEqual(weeklyShare({ now: NOW }), { share: 40, shareAt: '2026-10-19T09:30:00.000Z', resetsAt });
  allowance([{ kind: 'seven_day', percentUsed: 40, resetsAt }], '2026-10-15T13:00:00.000Z');
  assert.deepEqual(weeklyShare({ now: NOW }), { share: null, shareAt: null, resetsAt: null });
}));

test('a reading older than its window shows no share', () => withHome(() => {
  const resetsAt = '2026-10-22T14:00:00.000Z'; // the window began 15 October at 14:00
  allowance([{ kind: 'five_hour', percentUsed: 90 }, { kind: 'seven_day', percentUsed: 40, resetsAt }], '2026-10-15T13:00:00.000Z');
  assert.deepEqual(
    (({ share, shareAt }) => ({ share, shareAt }))(usageFigures({ project: null, now: NOW }).week),
    { share: null, shareAt: null },
  );
  allowance([{ kind: 'seven_day', percentUsed: 40, resetsAt }], '2026-10-15T14:00:00.000Z'); // exactly at the start: not newer
  assert.equal(usageFigures({ project: null, now: NOW }).week.share, null);
  allowance([{ kind: 'five_hour', percentUsed: 90 }, { kind: 'seven_day', percentUsed: 40, resetsAt }], '2026-10-19T09:30:00.000Z');
  const { week } = usageFigures({ project: null, now: NOW });
  assert.equal(week.share, 40);
  assert.equal(week.shareAt, '2026-10-19T09:30:00.000Z');
  // a window with no reset time can't be placed, so it shows no share
  allowance([{ kind: 'seven_day', percentUsed: 40 }]);
  assert.equal(usageFigures({ project: null, now: NOW }).week.share, null);
}));

test('dollars come from telemetry where a session has them, else from the mod', () => withHome(() => {
  session('s1');
  session('s2');
  session('s3');
  day('2026-10-18', {
    s1: entry(10, { usd: 3, modUsd: 9 }), // telemetry wins
    s2: entry(10, { usd: 0, modUsd: 2 }), // the mod's reading
    s3: entry(10), // neither
  });
  const { week, byPart } = usageFigures({ project: null, now: NOW });
  assert.equal(week.usd, 5);
  assert.deepEqual(byPart.feature, { tokens: 30, usd: 5 });
}));

test('tokens are split by part and by feature from the session files', () => withHome(() => {
  session('desk', { role: 'front-desk' });
  session('fore', { role: 'foreman', work: 'checkout' });
  session('f1', { role: 'feature', work: 'checkout' });
  session('f2', { role: 'feature', work: 'checkout' });
  session('f3', { role: 'feature', work: 'search' });
  session('other', { role: 'feature', work: 'billing', project: 'blog' });
  day('2026-10-18', {
    desk: entry(5), fore: entry(7), f1: entry(100), f3: entry(50), other: entry(1000), loose: entry(3), // loose has no session file
  });
  day('2026-10-19', { f2: entry(200, { usd: 1.5 }), f1: entry(20, { bySource: { main: 10, subagent: 10 } }) });
  const mine = usageFigures({ project: 'shop', now: NOW });
  assert.equal(mine.week.tokens, 5 + 7 + 100 + 50 + 200 + 20); // the other project's and the loose session don't count
  assert.deepEqual(mine.byPart['front-desk'], { tokens: 5, usd: null });
  assert.deepEqual(mine.byPart.foreman, { tokens: 7, usd: null });
  assert.deepEqual(mine.byPart.feature, { tokens: 370, usd: 1.5 });
  assert.deepEqual(mine.byFeature, {
    checkout: { tokens: 320, usd: 1.5 },
    search: { tokens: 50, usd: null },
  });
  assert.deepEqual(mine.bySubagents, { tokens: 10 });
  // every session counts in the totals when no project is asked for, but a session with no file has no part or feature
  const all = usageFigures({ project: null, now: NOW });
  assert.equal(all.week.tokens, 5 + 7 + 100 + 50 + 1000 + 3 + 200 + 20);
  assert.equal(all.byPart.feature.tokens, 370 + 1000);
  assert.deepEqual(Object.keys(all.byFeature).sort(), ['billing', 'checkout', 'search']);
}));

test('a part with no use has empty figures', () => withHome(() => {
  const { byPart, byFeature, week, bySubagents } = usageFigures({ project: null, now: NOW });
  assert.deepEqual(byPart, {
    'front-desk': { tokens: null, usd: null }, foreman: { tokens: null, usd: null }, feature: { tokens: null, usd: null },
  });
  assert.deepEqual(byFeature, {});
  assert.deepEqual(bySubagents, { tokens: 0 });
  assert.equal(week.tokens, null);
  assert.equal(week.usd, null);
}));

// Six features, one session each, over the last few days.
function sixFeatures(spike) {
  for (let i = 0; i < 6; i += 1) {
    session(`s${i}`, { work: `f${i}` });
    day(dateBack(i), { [`s${i}`]: entry(i === 0 ? spike : 100) });
  }
}

test('a feature at four times the median is unusual, with the part and model that drew most', () => withHome(() => {
  session('s0', { work: 'checkout' });
  for (let i = 1; i < 6; i += 1) session(`s${i}`, { work: `f${i}` });
  day(dateBack(0), {
    s0: entry(400, { byModel: { 'model-a': { tokens: 100, usd: 0 }, 'model-b': { tokens: 300, usd: 0 } } }),
  });
  for (let i = 1; i < 6; i += 1) day(dateBack(i), { [`s${i}`]: entry(100) });
  const { unusual } = usageFigures({ project: 'shop', now: NOW });
  const found = unusual.find((item) => item.kind === 'feature');
  assert.deepEqual(found, {
    kind: 'feature', id: 'feature:checkout', tokens: 400, median: 100, cause: 'Mostly feature work on checkout, on model-b', unit: 'tokens',
  });
  // the session is unusual by the same measure, and has its own id
  assert.equal(unusual.find((item) => item.kind === 'session').id, 'session:s0');
  assert.equal(unusual.find((item) => item.kind === 'day').id, `day:${dateBack(0)}`);
  assert.equal(unusual.length, 3);
}));

test('three times the median is not unusual, and the factor argument sets the line', () => withHome(() => {
  sixFeatures(300);
  assert.deepEqual(usageFigures({ project: null, now: NOW }).unusual, []);
  assert.equal(usageFigures({ project: null, now: NOW, factor: 2 }).unusual.some((item) => item.id === 'feature:f0'), true);
  assert.equal(usageFigures({ project: null, now: NOW, factor: 'x' }).unusual.length, 0); // not a number: the usual factor
}));

test('nothing is unusual with fewer than five of a kind', () => withHome(() => {
  for (let i = 0; i < 4; i += 1) {
    session(`s${i}`, { work: `f${i}` });
    day(dateBack(i), { [`s${i}`]: entry(i === 0 ? 4000 : 100) });
  }
  assert.deepEqual(usageFigures({ project: null, now: NOW }).unusual, []);
}));

test('use is compared with the other items of its kind in the last 28 days only', () => withHome(() => {
  sixFeatures(400);
  // five quiet features from 40 days ago are outside the comparison and change nothing
  for (let i = 0; i < 5; i += 1) {
    session(`old${i}`, { work: `old${i}` });
    day(dateBack(40), { [`old${i}`]: entry(1) });
  }
  // one from 27 days ago is inside it
  session('edge', { work: 'edge' });
  day(dateBack(27), { edge: entry(100) });
  const found = usageFigures({ project: null, now: NOW }).unusual.find((item) => item.id === 'feature:f0');
  assert.equal(found.median, 100);
  assert.equal(found.tokens, 400);
}));

test('only items that had use in the week are tested', () => withHome(() => {
  for (let i = 0; i < 6; i += 1) session(`s${i}`, { work: `f${i}` });
  day(dateBack(20), { s0: entry(5000) }); // a big one, but three weeks ago
  for (let i = 1; i < 6; i += 1) day(dateBack(i), { [`s${i}`]: entry(100) });
  const { unusual } = usageFigures({ project: null, now: NOW });
  assert.deepEqual(unusual, []);
}));

test('a session is tested by dollars where the sessions have no tokens', () => withHome(() => {
  for (let i = 0; i < 6; i += 1) {
    session(`s${i}`);
    day(dateBack(i), { [`s${i}`]: entry(0, { modUsd: i === 0 ? 20 : 2, byModel: {}, bySource: {} }) });
  }
  const found = usageFigures({ project: null, now: NOW }).unusual.find((item) => item.id === 'session:s0');
  assert.equal(found.tokens, 20);
  assert.equal(found.median, 2);
  assert.equal(found.unit, 'usd');
}));

test('an unusual item is raised once', () => withHome(() => {
  sixFeatures(400);
  const ids = usageFigures({ project: null, now: NOW }).unusual.map((item) => item.id);
  assert.ok(ids.includes('feature:f0'));
  assert.equal(wasRaised('feature:f0'), false);
  markRaised(ids, { now: NOW });
  assert.equal(wasRaised('feature:f0'), true);
  assert.equal(wasRaised('feature:other'), false);
  // still unusual in the figures; the briefing is what asks wasRaised
  assert.ok(usageFigures({ project: null, now: NOW }).unusual.some((item) => item.id === 'feature:f0'));
  markRaised(['feature:g'], { now: NOW }); // adding more keeps the earlier ones
  assert.equal(wasRaised('feature:f0'), true);
  assert.equal(wasRaised('feature:g'), true);
  // a damaged file reads as nothing raised
  fs.writeFileSync(path.join(usageDir(), 'raised.json'), '{ not json');
  assert.equal(wasRaised('feature:f0'), false);
  markRaised(['feature:h'], { now: NOW });
  assert.equal(wasRaised('feature:h'), true);
}));

test('missing counts are named in plain words', () => withHome(() => {
  assert.deepEqual(usageFigures({ project: null, now: NOW }).missing, [
    'Token counts start once setup switches on usage counting on this computer',
    'The weekly allowance shows once the mod or the terminal has read it',
  ]);
  session('s1');
  day('2026-10-18', { s1: entry(10) });
  allowance([{ kind: 'seven_day', percentUsed: 5, resetsAt: '2026-10-22T14:00:00.000Z' }]);
  assert.deepEqual(usageFigures({ project: null, now: NOW }).missing, []);
  fs.writeFileSync(path.join(usageDir(), 'allowance.json'), 'damaged');
  assert.deepEqual(usageFigures({ project: null, now: NOW }).missing, [
    'The weekly allowance shows once the mod or the terminal has read it',
  ]);
}));

test('today is worked out from the raw counts without writing a summary', () => withHome(() => {
  addPoints([{ metric: 'tokens', session: 's1', model: 'model-a', source: 'main', value: 40, at: '2026-10-19T08:00:00.000Z', start: '2026-10-19T07:00:00.000Z', cumulative: true }], { now: NOW });
  recordModReading({ session: 's1', usd: 1, at: '2026-10-19T08:00:00.000Z' });
  recordModReading({ session: 's1', usd: 3, at: '2026-10-19T09:00:00.000Z' });
  session('s1');
  const { week } = usageFigures({ project: 'shop', now: NOW });
  assert.equal(week.tokens, 40);
  assert.equal(week.usd, 2);
  assert.equal(fs.existsSync(path.join(usageDir(), 'days')), false);
  assert.equal(fs.existsSync(path.join(usageDir(), 'raised.json')), false);
}));

test('damaged files become missing figures, never an error', () => withHome(() => {
  fs.mkdirSync(path.join(usageDir(), 'days'), { recursive: true });
  fs.writeFileSync(path.join(usageDir(), 'days', '2026-10-18.json'), '{ nope');
  fs.mkdirSync(path.join(usageDir(), 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(usageDir(), 'sessions', 's1.json'), 'nope');
  day('2026-10-19', { s1: entry(10) });
  const figures = usageFigures({ project: null, now: NOW });
  assert.equal(figures.week.tokens, 10);
  assert.deepEqual(figures.byPart.feature, { tokens: null, usd: null });
}));
