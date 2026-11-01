// tests/scripts/engine/goal-start.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataHash } from '../../../scripts/state/events.js';
import { sheetHash, narrowed } from '../../../scripts/engine/goal.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';
import { cardHash } from '../../../scripts/lib/measures-clicks.js';
import { sheetDesk, checksBeforeLeaving, proposedSpend, pieceTokens, sheetCardInput, composeSheetCard, onBattery, awayForGoal, draftPieces, PAID_USAGE_BILLS, paidUsageOf } from '../../../scripts/engine/goal-start.js';

const NOW = new Date('2026-11-01T01:00:00.000Z');
const HEAD = 'a'.repeat(40);
const PAGE = { id: 'export-page', title: 'The export page', lane: 'small', visible: false, dependsOn: [] };
const FILE = { id: 'export-file', title: 'The file format', lane: 'feature', visible: true, dependsOn: [] };

const sheet = (extra = {}) => ({
  title: 'Customers can export their orders',
  done: [{ test: 'export downloads every order' }, { command: 'node check.js', expect: 0 }],
  checksSay: ['The export holds every order', 'The checking script passes'],
  pieces: [{ work: 'export-page', hash: dataHash(PAGE) }, { work: 'export-file', hash: dataHash(FILE) }],
  areas: { may: ['src/orders/**', 'tests/orders/**'], wontTouch: ['billing/**', 'tests/orders/export.test.js'] },
  checkFiles: ['tests/orders/export.test.js'],
  spend: { tokens: 14000000, points: 20 },
  until: '2026-11-01T07:00:00.000Z',
  ...extra,
});

const baselineOf = (given, extra = {}) => ({
  goal: 'orders-export', hash: sheetHash(given), when: 'before', head: HEAD, ok: false, at: '2026-11-01T00:50:00.000Z',
  results: given.done.map((check, i) => ({ check, ok: i !== 0 })), ...extra,
});

const viewsFor = (given, extra = {}) => ({
  work: {
    'export-page': { work: { data: PAGE }, approved: false },
    'export-file': { work: { data: FILE }, approved: true },
  },
  features: {},
  settings: { engine: { key: 'engine', value: 'archon' }, engineLanes: { key: 'engineLanes', value: ['quick', 'small', 'bug', 'feature'] } },
  incidents: { open: [] },
  goals: {},
  goalChecks: { 'orders-export': [baselineOf(given)] },
  waiting: [],
  engineOn: true,
  ...extra,
});

const health = (extra = {}) => ({ engine: { ok: true, findings: [] }, stop: false, mainGreen: true, mainHead: HEAD, testCommand: 'npm test', midpoints: [], ...extra });
const reading = (extra = {}) => ({ share: 40, shareAt: '2026-11-01T00:55:00.000Z', resetsAt: '2026-11-05T00:00:00.000Z', ...extra });
const leaving = (given, extra = {}) => checksBeforeLeaving({
  id: 'orders-export', sheet: given, views: viewsFor(given), health: health(), power: { battery: false }, sessions: 1, reading: reading(), paid: false, now: NOW, ...extra,
});

test('a sheet with nothing wrong passes and warns of nothing', () => {
  assert.deepEqual(leaving(sheet()), { refused: [], warns: [] });
});

// Must pass.
test('an engine that is unwell refuses Start, saying what it found', () => {
  const { refused } = leaving(sheet(), { health: health({ engine: { ok: false, findings: ['the pack is out of date'] } }) });
  assert.match(refused.join(' '), /the pack is out of date/);
});

test('All stop refuses Start', () => {
  assert.match(leaving(sheet(), { health: health({ stop: true }) }).refused.join(' '), /All stop is on/);
});

test('an open incident refuses Start', () => {
  const given = sheet();
  assert.match(leaving(given, { views: viewsFor(given, { incidents: { open: [{ id: 'x' }] } }) }).refused.join(' '), /incident is open/);
});

test('a red main line refuses Start', () => {
  assert.match(leaving(sheet(), { health: health({ mainGreen: false }) }).refused.join(' '), /main line is red/);
});

test('a main line whose checks cannot be read warns and doesn\'t refuse', () => {
  const got = leaving(sheet(), { health: health({ mainGreen: null }) });
  assert.deepEqual(got.refused, []);
  assert.match(got.warns.join(' '), /couldn't read the main line/);
});

test('no test command refuses Start', () => {
  assert.match(leaving(sheet(), { health: health({ testCommand: null }) }).refused.join(' '), /test command/);
});

test('a piece whose lane is not on the build engine refuses Start, by its name', () => {
  const given = sheet();
  const views = viewsFor(given, { settings: { engine: { key: 'engine', value: 'archon' }, engineLanes: { key: 'engineLanes', value: ['quick', 'small', 'bug'] } } });
  assert.match(leaving(given, { views }).refused.join(' '), /The file format .*build engine/);
});

test('a feature whose design isn\'t approved refuses Start, by its name', () => {
  const given = sheet();
  const views = viewsFor(given);
  views.work['export-file'].approved = false;
  assert.match(leaving(given, { views }).refused.join(' '), /design of The file format/);
});

test('a sheet that lets nothing be touched refuses Start', () => {
  const given = sheet({ areas: { may: [], wontTouch: ['billing/**', 'tests/orders/export.test.js'] } });
  assert.match(leaving(given).refused.join(' '), /May touch/);
});

test('every check passing today refuses Start', () => {
  const given = sheet();
  const passing = baselineOf(given, { results: given.done.map((check) => ({ check, ok: true })), ok: true });
  assert.match(leaving(given, { views: viewsFor(given, { goalChecks: { 'orders-export': [passing] } }) }).refused.join(' '), /already passes/);
});

test('no baseline for this sheet refuses Start', () => {
  const given = sheet();
  assert.match(leaving(given, { views: viewsFor(given, { goalChecks: {} }) }).refused.join(' '), /haven't been run/);
});

test('a baseline from an older head of the main line refuses Start', () => {
  assert.match(leaving(sheet(), { health: health({ mainHead: 'b'.repeat(40) }) }).refused.join(' '), /main line has moved/);
});

test('a main line whose head can\'t be read leaves the baseline standing', () => {
  assert.deepEqual(leaving(sheet(), { health: health({ mainHead: null }) }).refused, []);
});

test('another goal running refuses Start', () => {
  const given = sheet();
  const views = viewsFor(given, { goals: { other: { ended: null, sheet: given, hash: 'x', startedAt: NOW.toISOString(), endAsked: null } } });
  assert.match(leaving(given, { views }).refused.join(' '), /only one goal runs at a time/);
});

test('a paid-usage account is refused where U4 found a limit can bill', () => {
  assert.match(leaving(sheet(), { paid: true, billable: true }).refused.join(' '), /paid usage/i);
});

test('U4 saw no real limit bill, so paid usage warns, and an account that can\'t be read says so too', () => {
  assert.equal(PAID_USAGE_BILLS, false);
  for (const paid of [true, null]) {
    const got = leaving(sheet(), { paid });
    assert.deepEqual(got.refused, []);
    assert.match(got.warns.join(' '), /paid usage/i);
  }
  assert.deepEqual(leaving(sheet(), { paid: false }).warns, []);
});

test('what reads the account\'s paid usage takes only true or false', () => {
  assert.equal(paidUsageOf({ oauthAccount: { hasExtraUsageEnabled: true } }), true);
  assert.equal(paidUsageOf({ oauthAccount: { hasExtraUsageEnabled: false } }), false);
  assert.equal(paidUsageOf({ oauthAccount: {} }), null);
  assert.equal(paidUsageOf(null), null);
});

// Warns.
test('on battery warns', () => {
  assert.match(leaving(sheet(), { power: { battery: true } }).warns.join(' '), /battery/);
  assert.deepEqual(leaving(sheet(), { power: { battery: null } }).warns, []);
});

test('no First Mate left open warns', () => {
  assert.match(leaving(sheet(), { sessions: 0 }).warns.join(' '), /First Mate/);
});

test('cards still waiting warn', () => {
  const given = sheet();
  const waiting = [{ id: 'c1', data: { kind: 'approval' } }, { id: 'c2', data: { kind: 'question' } }];
  assert.match(leaving(given, { views: viewsFor(given, { waiting }) }).warns.join(' '), /2 cards/);
});

test('this goal\'s own sheet card isn\'t counted as a card waiting', () => {
  const given = sheet();
  const waiting = [{ id: 'c1', data: { kind: 'start-goal' } }];
  assert.deepEqual(leaving(given, { views: viewsFor(given, { waiting }) }).warns, []);
});

test('a midpoint demo warns, by the feature\'s name', () => {
  assert.match(leaving(sheet(), { health: health({ midpoints: ['export-file'] }) }).warns.join(' '), /The file format/);
});

test('less allowance left than the goal\'s spend warns', () => {
  assert.match(leaving(sheet({ spend: { tokens: 1000, points: 70 } })).warns.join(' '), /allowance/);
});

test('a stale reading says nothing of what is left', () => {
  assert.deepEqual(leaving(sheet({ spend: { tokens: 1000, points: 70 } }), { reading: reading({ shareAt: '2026-10-31T00:00:00.000Z' }) }).warns, []);
});

// What the First Mate proposes.
test('the default spend is a third of what\'s left, rounded down', () => {
  const got = proposedSpend({ tokens: 5000000, reading: reading({ share: 45 }), now: NOW });
  assert.deepEqual(got.spend, { tokens: 5000000, points: 18 });
  assert.match(got.says, /a third of what's left/);
});

test('with no reading the sheet offers tokens and says so', () => {
  for (const given of [null, reading({ share: null, shareAt: null }), reading({ shareAt: '2026-10-31T00:00:00.000Z' })]) {
    const got = proposedSpend({ tokens: 5000000, reading: given, now: NOW });
    assert.deepEqual(got.spend, { tokens: 5000000 });
    assert.match(got.says, /can't read/);
  }
});

test('with next to nothing left the sheet offers no points, and says so', () => {
  const got = proposedSpend({ tokens: 5000000, reading: reading({ share: 99 }), now: NOW });
  assert.deepEqual(got.spend, { tokens: 5000000 });
  assert.match(got.says, /next to nothing/);
});

test('a piece\'s tokens are its lane\'s cap, and a feature\'s count each slice and its last run', () => {
  const views = viewsFor(sheet());
  assert.equal(pieceTokens('export-page', { views, config: {}, slicesOf: () => null }), 4000000);
  assert.equal(pieceTokens('export-file', { views, config: {}, slicesOf: () => 3 }), 40000000);
  assert.equal(pieceTokens('export-file', { views, config: {}, slicesOf: () => null }), 10000000);
});

test('the draft lists what is asked, or else what the last goal left, with each record\'s hash', () => {
  const views = viewsFor(sheet());
  assert.deepEqual(draftPieces({ asked: ['export-page'], views }), { pieces: [{ work: 'export-page', hash: dataHash(PAGE) }], left: null });
  assert.throws(() => draftPieces({ asked: ['nothing-here'], views }), /nothing-here/);
  const ended = { ...views, goals: { before: { ended: { ending: 'time', at: NOW.toISOString(), spent: {} }, sheet: sheet(), hash: 'x', startedAt: NOW.toISOString(), endAsked: null } } };
  const got = draftPieces({ asked: [], views: { ...ended, reports: { 'export-page': { data: { outcome: 'merged' } } } } });
  assert.deepEqual(got, { pieces: [{ work: 'export-file', hash: dataHash(FILE) }], left: { goal: 'before', ending: 'time' } });
  assert.deepEqual(draftPieces({ asked: [], views }), { pieces: [], left: null });
});

// The card.
const cardOf = (given = sheet(), extra = {}) => composeCard(sheetCardInput({ id: 'orders-export', sheet: given, views: viewsFor(given), warns: [], now: NOW, timeZone: 'Australia/Sydney', ...extra }));

test('a sheet card passes the card check, with why it comes, what happens meanwhile, options and a recommendation', () => {
  const { question, card } = cardOf();
  assert.deepEqual(cardProblems(question), []);
  assert.deepEqual(card.options, ['Start', 'Suggest a change…', 'Not now']);
  assert.equal(card.recommend, 'Start');
  assert.match(question.question, /only you can start it/);
  assert.match(question.question, /Nothing starts until you click Start/);
  assert.equal(card.code, null);
});

test('the card is made from the sheet: each bound on a line of its own', () => {
  const lines = cardOf().question.question.split('\n');
  const line = (lead) => lines.find((l) => l.startsWith(lead));
  assert.match(line('Done means:'), /The export holds every order; The checking script passes\./);
  assert.match(line('The work:'), /The export page · The file format/);
  assert.match(line('The work:'), /You see 1 of them before it goes in/);
  assert.match(line('May touch:'), /src\/orders\/\*\*, tests\/orders\/\*\*/);
  assert.match(line('Won\'t touch:'), /billing\/\*\*/);
  assert.match(line('Spend:'), /20 points of this week's allowance/);
  assert.match(line('Spend:'), /14 million tokens/);
  assert.match(line('Time:'), /6:00 PM/);
  assert.match(line('If it has a question:'), /that piece waits/);
  assert.match(line('It stops early if:'), /two pieces fail in a row/);
  assert.match(line('Ready to leave?'), /plugged in/);
});

test('a waived piece isn\'t counted as shown first, and no tick covers a whole goal', () => {
  const small = { ...FILE, lane: 'small' };
  const given = sheet({ pieces: [{ work: 'export-page', hash: dataHash(PAGE) }, { work: 'export-file', hash: dataHash(small), waived: true }] });
  const views = viewsFor(given);
  views.work['export-file'].work.data = small;
  assert.doesNotMatch(cardOf(given, { views }).question.question, /You see/);
});

test('the card shows what is wrong, and only that', () => {
  assert.doesNotMatch(cardOf().question.question, /Check first:/);
  assert.match(cardOf(sheet(), { warns: ['It\'s on battery.'] }).question.question, /Check first: It's on battery\./);
});

test('the time carries its day when it isn\'t today, in the computer\'s time', () => {
  const given = sheet({ until: '2026-11-02T00:00:00.000Z' });
  assert.match(cardOf(given).question.question, /11:00 AM on 2 November/);
});

test('a sheet\'s stop-early numbers are the sheet\'s own', () => {
  assert.match(cardOf(sheet({ stopEarly: { failedInARow: 3, reds: 1 } })).question.question, /3 pieces fail in a row, or the main line goes red once/);
});

test('a sheet with no points says the tokens stand alone', () => {
  assert.match(cardOf(sheet({ spend: { tokens: 1500000 } })).question.question, /Spend: up to 1\.5 million tokens\./);
});

test('a long list of pieces falls back to ids, then to a count, and the card still composes', () => {
  const long = Array.from({ length: 12 }, (_, i) => ({ id: `piece-${i}`, title: `${'A piece with a long plain title '.repeat(3)}${i}`, lane: 'small', visible: false, dependsOn: [] }));
  const given = sheet({ pieces: long.map((p) => ({ work: p.id, hash: dataHash(p) })) });
  const views = viewsFor(given, { work: Object.fromEntries(long.map((p) => [p.id, { work: { data: p }, approved: true }])) });
  const { question } = composeSheetCard({ id: 'orders-export', sheet: given, views, warns: [], now: NOW, timeZone: 'UTC' });
  assert.deepEqual(cardProblems(question), []);
  assert.doesNotMatch(question.question, /long plain title/);
  assert.match(question.question, /12 pieces/);
});

test('a sheet too long for any card is refused in words the First Mate can act on', () => {
  const given = sheet({ checksSay: ['x'.repeat(900), 'y'.repeat(900)] });
  assert.throws(() => composeSheetCard({ id: 'orders-export', sheet: given, views: viewsFor(given), warns: [], now: NOW, timeZone: 'UTC' }), /shorter/);
});

test('onBattery reads pmset on a Mac, and elsewhere knows nothing', () => {
  assert.equal(onBattery({ platform: 'darwin', run: () => "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t80%; discharging" }), true);
  assert.equal(onBattery({ platform: 'darwin', run: () => "Now drawing from 'AC Power'\n" }), false);
  assert.equal(onBattery({ platform: 'darwin', run: () => { throw new Error('no pmset'); } }), null);
  assert.equal(onBattery({ platform: 'win32', run: () => 'anything' }), null);
});

test('Start sets Away until until, unless a nearer Away or Do not disturb is set', () => {
  const until = '2026-11-01T07:00:00.000Z';
  assert.deepEqual(awayForGoal({ presence: { value: 'here' }, until, now: NOW }), { key: 'presence', value: 'away', until });
  assert.deepEqual(awayForGoal({ presence: undefined, until, now: NOW }), { key: 'presence', value: 'away', until });
  assert.equal(awayForGoal({ presence: { value: 'away', until: '2026-11-01T03:00:00.000Z' }, until, now: NOW }), null);
  assert.equal(awayForGoal({ presence: { value: 'dnd', until: '2026-11-02T03:00:00.000Z' }, until, now: NOW }), null);
  assert.equal(awayForGoal({ presence: { value: 'dnd' }, until, now: NOW }), null);
});

test('an Away or a Do not disturb already over doesn\'t count, and an Away that lasts longer is left alone', () => {
  const until = '2026-11-01T07:00:00.000Z';
  assert.deepEqual(awayForGoal({ presence: { value: 'dnd', until: '2026-11-01T00:00:00.000Z' }, until, now: NOW }), { key: 'presence', value: 'away', until });
  assert.equal(awayForGoal({ presence: { value: 'away', until: '2026-11-03T00:00:00.000Z' }, until, now: NOW }), null);
  assert.equal(awayForGoal({ presence: { value: 'away' }, until, now: NOW }), null);
});

// The helper's desk for the sheet.
const DESIGN = '```wheelhouse-slices\n{"goal":"g","flag":{"name":"f"},"demo":"midpoint","slices":[{"title":"a","goal":"b","done":[{"test":"t"}]},{"title":"c","goal":"d","done":[{"test":"u"}]}]}\n```';
const desk = ({ given = sheet(), views = viewsFor(given), extra = {} } = {}) => {
  const kept = [];
  const records = [{ kind: 'goal', data: { id: 'orders-export', sheet: given } }];
  return {
    kept,
    records,
    sheets: sheetDesk({
      views: () => views, events: () => records, health: async () => ({ ok: true, findings: [] }), config: () => ({ testCommand: 'npm test' }), settings: () => ({}),
      designOf: (work) => (work === 'export-file' ? { text: DESIGN } : null), mainGreen: async () => true, mainHead: async () => HEAD, stopped: () => false,
      reading: () => reading(), paid: () => false, sessions: () => 1, battery: () => false,
      offer: async (kind, data) => { kept.push({ kind, data }); return `id-${kept.length}`; }, now: () => NOW, timeZone: 'UTC', ...extra,
    }),
  };
};

test('the draft proposes a third of what\'s left and the sum of the pieces\' caps, a feature\'s slices counted', async () => {
  const got = await desk().sheets.draft({ pieces: ['export-page', 'export-file'] });
  assert.deepEqual(got.pieces.map((p) => p.work), ['export-page', 'export-file']);
  assert.deepEqual(got.spend, { tokens: 34000000, points: 20 });
});

test('a sheet not yet checked says so, and makes no card', async () => {
  const given = sheet();
  const { sheets, kept } = desk({ views: viewsFor(given, { goalChecks: {} }) });
  assert.deepEqual(await sheets.card({ goal: 'orders-export' }), { ok: true, offered: false, waiting: true });
  assert.deepEqual(kept, []);
});

test('the result of the checks comes back with what refuses the sheet, and no card is made', async () => {
  const given = sheet();
  const passing = baselineOf(given, { results: given.done.map((check) => ({ check, ok: true })), ok: true });
  const { sheets, kept } = desk({ views: viewsFor(given, { goalChecks: { 'orders-export': [passing] } }) });
  const got = await sheets.card({ goal: 'orders-export' });
  assert.equal(got.offered, false);
  assert.match(got.refused.join(' '), /already passes/);
  assert.deepEqual(got.results, passing.results);
  assert.deepEqual(kept, []);
});

test('a good sheet gets its card and an offer that names that very card', async () => {
  const { sheets, kept } = desk();
  const got = await sheets.card({ goal: 'orders-export' });
  assert.equal(got.offered, true);
  assert.equal(got.id, 'id-1');
  assert.deepEqual(kept.map((k) => k.kind), ['card', 'goal-card']);
  assert.equal(kept[1].data.hash, cardHash(got.question));
  assert.equal(kept[1].data.sheet, sheetHash(sheet()));
  assert.match(got.question.question, /stops half way|Check first/);
});

test('asked again with nothing changed, the waiting card stands, with a fresh offer', async () => {
  const given = sheet();
  const first = desk({ views: viewsFor(given) });
  const card = await first.sheets.card({ goal: 'orders-export' });
  const views = viewsFor(given, { waiting: [{ id: 'c1', data: first.kept[0].data }] });
  const second = desk({ given, views });
  const got = await second.sheets.card({ goal: 'orders-export' });
  assert.equal(got.id, 'c1');
  assert.deepEqual(second.kept.map((k) => k.kind), ['goal-card']);
  assert.equal(second.kept[0].data.hash, cardHash(card.question));
});

test('a new sheet revises the card still waiting', async () => {
  const given = sheet();
  const first = desk({ views: viewsFor(given) });
  await first.sheets.card({ goal: 'orders-export' });
  const changed = sheet({ until: '2026-11-01T05:00:00.000Z' });
  const views = viewsFor(changed, { waiting: [{ id: 'c1', data: first.kept[0].data }] });
  const second = desk({ given: changed, views });
  await second.sheets.card({ goal: 'orders-export' });
  assert.equal(second.kept[0].data.revises, 'c1');
});

test('an engine that can\'t be read refuses the sheet, and a sheet too long says what to shorten', async () => {
  const unwell = await desk({ extra: { health: async () => { throw new Error('no'); } } }).sheets.card({ goal: 'orders-export' });
  assert.match(unwell.refused.join(' '), /build engine/);
  const given = sheet({ checksSay: ['x'.repeat(900), 'y'.repeat(900)] });
  assert.match((await desk({ given }).sheets.card({ goal: 'orders-export' })).refused.join(' '), /shorter/);
});

test('narrowing needs nothing, widening needs a new sheet', () => {
  const given = sheet();
  const earlier = new Date(Date.parse(given.until) - 3600000).toISOString();
  const later = new Date(Date.parse(given.until) + 3600000).toISOString();
  assert.equal(narrowed(given, { until: earlier }).until, earlier);
  assert.equal(narrowed(given, { spend: { tokens: given.spend.tokens / 2 } }).spend.tokens, given.spend.tokens / 2);
  assert.equal(narrowed(given, { until: later }), null);
  assert.equal(narrowed(given, { spend: { tokens: given.spend.tokens + 1 } }), null);
  // A wider sheet is another sheet: its hash differs, so a click on the old card starts nothing.
  assert.notEqual(sheetHash({ ...given, until: later }), sheetHash(given));
});
