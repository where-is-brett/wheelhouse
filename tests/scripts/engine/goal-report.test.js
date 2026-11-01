// tests/scripts/engine/goal-report.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { goalReport, goalReportText, goalSettled, goalProgress, goalPaneLine, goalEndOf, goalOpening, goalLogbook, spendShareWords } from '../../../scripts/engine/goal-report.js';
import { dataHash } from '../../../scripts/state/events.js';
import { areaQuestion } from '../../../scripts/engine/areas.js';

const TZ = 'UTC';
const START = '2026-11-01T08:00:00.000Z';
const END = '2026-11-01T16:40:00.000Z';
const UNTIL = '2026-11-01T18:00:00.000Z';
const CHECK = { command: 'npm test', expect: 0 };
const OTHER = { test: 'tests/export.test.js' };

const data = (id, title, lane = 'quick') => ({ id, title, lane, visible: false, dependsOn: [] });
const PIECES = { a: data('a', 'Export button'), b: data('b', 'File format'), c: data('c', 'Large orders'), d: data('d', 'Download page') };
const spentOf = (over = {}) => ({ tokens: 400000, points: 28, requests: null, unknown: false, shareAtStart: { share: 10 }, queueRuns: [], readAt: '2026-11-01T16:38:00.000Z', ...over });
const sheetOf = (over = {}) => ({
  title: 'Customers can export their orders', done: [CHECK, OTHER], checksSay: ['the tests pass', 'the export works'],
  pieces: Object.values(PIECES).map((p) => ({ work: p.id, hash: dataHash(p) })), areas: { may: ['src/**'], wontTouch: ['billing/**'] },
  spend: { tokens: 1000000, points: 33 }, until: UNTIL, ...over,
});
const goalOf = ({ ending = 'done', at = END, spent = spentOf(), words, sheet = sheetOf() } = {}) => ({
  id: 'orders', sheet, hash: 'h'.repeat(64), startedAt: START, endAsked: null, ended: { ending, at, spent, ...(words ? { words } : {}) },
});
const merged = (...works) => Object.fromEntries(works.map((w, i) => [w, { at: `2026-11-01T1${i}:00:00.000Z`, data: { work: w, outcome: 'merged', pr: 10 + i } }]));
const viewsOf = (over = {}) => ({
  goals: {}, reports: {}, runs: {}, asks: {}, costs: {}, slept: [], goalChecks: {}, goalNotes: [], waiting: [], questions: {}, features: {}, gateAsks: {},
  work: Object.fromEntries(Object.values(PIECES).map((p) => [p.id, { work: { at: START, data: p } }])), ...over,
});
const reportOf = (goal, views) => goalReport({ goal, views, ending: goal.ended, timeZone: TZ });
const textOf = (goal, views) => goalReportText(reportOf(goal, views));
const question = (id, work, what, { at = '2026-11-01T12:00:00.000Z', level = 3, options } = {}) => [id, { question: { id, at, data: { id, work, what, level, ...(options ? { options } : {}) } } }];

test('the parts come in their fixed order, and an empty one is left out', () => {
  const goal = goalOf({ ending: 'stuck', words: 'The main line went red 2 times.' });
  const views = viewsOf({
    reports: merged('a'),
    questions: Object.fromEntries([question('q1', 'b', 'Which file format?')]),
    slept: [{ from: '2026-11-01T13:10:00.000Z', to: '2026-11-01T13:50:00.000Z' }],
  });
  const text = textOf(goal, views);
  const at = (label) => text.indexOf(label);
  assert.ok(at('**Customers can export') === 0, text);
  assert.ok(at('**Added (1):**') > 0, text);
  assert.ok(at('**Added (1):**') < at('**Waits for you (1):**'), text);
  assert.ok(at('**Waits for you (1):**') < at('**What went wrong:**'), text);
  assert.ok(at('**What went wrong:**') < at('**Spent:**'), text);
  assert.ok(!text.includes('Decided for you'), text);
  const none = textOf(goalOf({ ending: 'spend' }), viewsOf());
  assert.ok(!none.includes('Added') && !none.includes('Waits for you') && !none.includes('What went wrong'), none);
});

test('Decided for you is left out when empty, and says Nothing when the sheet has ticks', () => {
  assert.equal(reportOf(goalOf(), viewsOf({ reports: merged('a', 'b', 'c', 'd') })).decided, undefined);
  const ticked = goalOf({ sheet: sheetOf({ ticks: ['small wording'] }) });
  const report = reportOf(ticked, viewsOf({ reports: merged('a', 'b', 'c', 'd') }));
  assert.equal(report.decided, 'Nothing');
  const text = goalReportText(report);
  assert.ok(text.includes('**Decided for you:** Nothing'), text);
  assert.ok(text.indexOf('**Added') < text.indexOf('**Decided for you'), text);
});

test('a piece merged is Added', () => {
  const report = reportOf(goalOf(), viewsOf({ reports: merged('a', 'c') }));
  assert.deepEqual(report.added.pieces, ['Export button', 'Large orders']);
});

test('nothing is rounded up: built and waiting is under Waits', () => {
  const goal = goalOf({ ending: 'waiting-for-you' });
  const views = viewsOf({
    reports: merged('a'),
    questions: Object.fromEntries([question('q1', 'b', 'File format is built. Add it?')]),
  });
  const report = reportOf(goal, views);
  assert.deepEqual(report.added.pieces, ['Export button']);
  assert.deepEqual(report.waits.top.map((c) => c.title), ['File format is built. Add it?']);
  assert.ok(!report.added.pieces.includes('File format'));
});

test('a piece held by the areas is under Waits, and a superseded area card is not counted', () => {
  const allow = [{ label: 'Allow this once' }, { label: 'Stop here' }];
  const old = areaQuestion('b', 'a'.repeat(40));
  const now = areaQuestion('b', 'b'.repeat(40));
  const views = viewsOf({
    questions: Object.fromEntries([
      question(old, 'b', 'Older head outside the areas', { at: '2026-11-01T11:00:00.000Z', options: allow }),
      question(now, 'b', 'Newer head outside the areas', { at: '2026-11-01T12:00:00.000Z', options: allow }),
    ]),
  });
  const report = reportOf(goalOf({ ending: 'time' }), views);
  assert.deepEqual(report.waits.top.map((c) => c.title), ['Newer head outside the areas']);
  assert.deepEqual(report.added.pieces, []);
});

test('unknown spend reads as unknown', () => {
  const text = textOf(goalOf({ spent: spentOf({ points: null, unknown: true, tokens: 500000 }) }), viewsOf({ reports: merged('a', 'b', 'c', 'd') }));
  assert.match(text, /\*\*Spent:\*\* Unknown/);
  assert.ok(!text.includes('inside its time and spend'), text);
  assert.match(text, /with its spend unknown/);
  const never = textOf(goalOf({ ending: 'stuck', spent: spentOf({ points: null, unknown: true, tokens: 0 }) }), viewsOf());
  assert.match(never, /\*\*Spent:\*\* Unknown: no reading was made\./);
  assert.ok(!never.includes('0 tokens'), never);
});

test('the spend reads points of the allowance, of what was allowed, and when it was read', () => {
  const text = textOf(goalOf(), viewsOf({ reports: merged('a', 'b', 'c', 'd') }));
  assert.ok(text.includes('**Spent:** 28 points of this week\'s allowance, of the 33 you allowed, read at 4:38 PM.'), text);
});

test('with no reading the tokens stand alone, and the report says so', () => {
  const text = textOf(goalOf({ spent: spentOf({ points: null, readAt: null }) }), viewsOf({ reports: merged('a', 'b', 'c', 'd') }));
  assert.match(text, /400K tokens, of the 1\.0M tokens you allowed/);
  assert.match(text, /The week's allowance couldn't be read, so these are tokens alone/);
});

test('counted requests stand in for the allowance', () => {
  const sheet = sheetOf({ spend: { tokens: 1000000, requests: 300 } });
  const text = textOf(goalOf({ sheet, spent: spentOf({ points: null, requests: 120, readAt: null }) }), viewsOf({ reports: merged('a', 'b', 'c', 'd') }));
  assert.match(text, /120 requests, of the 300 you allowed/);
  assert.ok(!text.includes('allowance'), text);
});

test('the merge queue\'s spend after the end is named', () => {
  const notes = [
    { at: '2026-11-01T17:00:00.000Z', data: { about: 'goal-queue-after', goal: 'orders', run: 'r1', tokens: 3000, unknown: false } },
    { at: '2026-11-01T17:10:00.000Z', data: { about: 'goal-queue-after', goal: 'other', run: 'r2', tokens: 9000, unknown: false } },
  ];
  const report = reportOf(goalOf(), viewsOf({ reports: merged('a', 'b', 'c', 'd'), goalNotes: notes }));
  assert.equal(report.spent.afterEnd.tokens, 3000);
  assert.match(goalReportText(report), /merge queue spent 3K tokens more after the goal ended/);
  const unknown = [{ at: notes[0].at, data: { ...notes[0].data, tokens: 0, unknown: true } }];
  assert.match(textOf(goalOf(), viewsOf({ reports: merged('a', 'b', 'c', 'd'), goalNotes: unknown })), /merge queue spent more after the goal ended, and how much is unknown/);
});

test('a stopped goal names what\'s left undone', () => {
  const report = reportOf(goalOf({ ending: 'spend' }), viewsOf({ reports: merged('a') }));
  assert.deepEqual(report.verdict.left, ['File format', 'Large orders', 'Download page']);
  const text = goalReportText(report);
  assert.ok(text.startsWith('**Customers can export their orders has ended: it reached its spend'), text);
  assert.ok(text.includes('Left undone: File format, Large orders and Download page.'), text);
});

test('a piece whose work changed since the signature is named, by the sheet', () => {
  const changed = viewsOf({ reports: merged('a', 'b', 'c') });
  changed.work.d = { work: { at: START, data: { ...PIECES.d, title: 'Download page, reworded' } } };
  const report = reportOf(goalOf({ ending: 'stuck' }), changed);
  assert.deepEqual(report.verdict.left, ['Download page, reworded']);
  assert.ok(report.wrong.some((line) => line.includes('Download page, reworded changed')), report.wrong.join(' '));
});

test('Done says it, inside its time and spend', () => {
  const text = textOf(goalOf(), viewsOf({ reports: merged('a', 'b', 'c', 'd') }));
  assert.ok(text.startsWith('**Customers can export their orders is done.** Done at 4:40 PM, inside its time and spend.'), text);
  assert.ok(!text.includes('Left undone'), text);
});

test('Done past its spend says so', () => {
  const text = textOf(goalOf({ spent: spentOf({ points: 40 }) }), viewsOf({ reports: merged('a', 'b', 'c', 'd') }));
  assert.match(text, /inside its time, over its spend/);
});

test('a feature\'s run that passed reads as ready for its switch-on, its slices Added, the switch-on under Waits', () => {
  const feature = data('f', 'Order export', 'feature');
  const sheet = sheetOf({ pieces: [{ work: 'f', hash: dataHash(feature) }] });
  const slice = (n, title) => ({ at: `2026-11-01T1${n}:00:00.000Z`, data: { about: 'engine', work: 'f', words: 'x', slice: { n, of: 2, title, flag: 'order-export' } } });
  const views = viewsOf({
    work: { f: { work: { at: START, data: feature } } }, goalNotes: [slice(1, 'Export button'), slice(2, 'Download page')],
    questions: Object.fromEntries([question('switch', 'f', 'Switch it on, once you\'ve looked.')]),
  });
  const goal = goalOf({ sheet });
  const report = reportOf(goal, views);
  assert.deepEqual(report.added.pieces, ['Export button', 'Download page']);
  assert.equal(report.added.flag, 'order-export');
  assert.equal(report.verdict.switchOn, true);
  const text = goalReportText(report);
  assert.ok(text.startsWith('**Customers can export their orders is ready for your switch-on.**'), text);
  assert.ok(text.includes('**Added (2):** Export button · Download page. All behind `order-export`, all checks passing.'), text);
  assert.ok(text.includes('- Switch it on, once you\'ve looked.'), text);
});

test('the waiting list shows the top four and names the rest', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'];
  const works = Object.fromEntries(six.map((w) => [w, { work: { at: START, data: data(w, `Piece ${w}`) } }]));
  const sheet = sheetOf({ pieces: six.map((w) => ({ work: w, hash: dataHash(works[w].work.data) })) });
  // The level 4 card is the newest, so the order of importance puts it first.
  const questions = Object.fromEntries([
    ...['a', 'b', 'c', 'd', 'e'].map((w, i) => question(`q${w}`, w, `Question ${w}`, { at: `2026-11-01T1${i}:00:00.000Z` })),
    question('qf', 'f', 'Question f', { at: '2026-11-01T15:00:00.000Z', level: 4 }),
  ]);
  const report = reportOf(goalOf({ ending: 'waiting-for-you', sheet }), viewsOf({ work: works, questions }));
  assert.deepEqual(report.waits.top.map((c) => c.title), ['Question f', 'Question a', 'Question b', 'Question c']);
  assert.deepEqual(report.waits.rest, ['Question d', 'Question e']);
  const text = goalReportText(report);
  assert.ok(text.includes('**Waits for you (6):**'), text);
  assert.ok(text.includes('And 2 more: Question d and Question e. Show them'), text);
});

test('a card of other work, or of a piece already merged, is not the goal\'s', () => {
  const questions = Object.fromEntries([question('q1', 'elsewhere', 'Not this goal'), question('q2', 'a', 'Too late')]);
  const report = reportOf(goalOf({ ending: 'time' }), viewsOf({ reports: merged('a'), questions }));
  assert.deepEqual(report.waits, { top: [], rest: [] });
});

test('What went wrong reads sleep, limits, retries, losses and reds from the record', () => {
  const run = (work, runId, state, at, more = {}) => ({ at, data: { work, lane: 'quick', engine: 'archon', runId, state, ...more } });
  const views = viewsOf({
    reports: merged('a', 'b', 'c', 'd'),
    slept: [{ from: '2026-11-01T13:10:00.000Z', to: '2026-11-01T13:50:00.000Z' }, { from: '2026-11-02T03:00:00.000Z', to: '2026-11-02T04:00:00.000Z' }],
    runs: {
      a: [run('a', 'r1', 'started', '2026-11-01T09:00:00.000Z'), run('a', 'r1', 'ended', '2026-11-01T09:10:00.000Z', { outcome: 'failed', failure: 'connection' }), run('a', 'r1', 'started', '2026-11-01T09:15:00.000Z', { resume: 1 }), run('a', 'r1', 'ended', '2026-11-01T09:30:00.000Z', { outcome: 'completed' })],
      b: [run('b', 'r2', 'started', '2026-11-01T10:00:00.000Z'), run('b', 'r2', 'paused', '2026-11-01T10:05:00.000Z'), run('b', 'r2', 'started', '2026-11-01T11:00:00.000Z'), run('b', 'r2', 'ended', '2026-11-01T11:30:00.000Z', { outcome: 'completed' })],
    },
    asks: { b: [{ at: '2026-11-01T10:05:00.000Z', data: { work: 'b', runId: 'r2', kind: 'usage-limit' } }] },
    goalNotes: [{ at: '2026-11-01T12:00:00.000Z', data: { about: 'engine', work: 'c', words: 'x', lost: true } }],
  });
  const goal = goalOf({ words: 'The main line went red twice.' });
  const { wrong } = reportOf(goal, views);
  assert.deepEqual(wrong, [
    'The computer slept for 40 minutes at 1:10 PM.',
    'A usage limit held work for 55 minutes.',
    'One run was tried again after a dropped connection.',
    'One run lost its process and was carried on: Large orders.',
    'The main line went red twice.',
  ]);
});

test('sleep before the goal or after its end is not its own', () => {
  const views = viewsOf({ reports: merged('a', 'b', 'c', 'd'), slept: [{ from: '2026-11-01T02:00:00.000Z', to: '2026-11-01T03:00:00.000Z' }, { from: '2026-11-01T20:00:00.000Z', to: '2026-11-01T21:00:00.000Z' }] });
  assert.deepEqual(reportOf(goalOf(), views).wrong, []);
});

test('a run stopped at the end, and a piece failed past its retries, are named', () => {
  const run = (work, runId, state, more = {}) => ({ at: '2026-11-01T16:30:00.000Z', data: { work, lane: 'quick', engine: 'archon', runId, state, ...more } });
  const views = viewsOf({
    reports: merged('a'),
    runs: { b: [run('b', 'r1', 'started'), run('b', 'r1', 'ended', { outcome: 'cancelled' })], c: [run('c', 'r2', 'started'), run('c', 'r2', 'ended', { outcome: 'failed', failure: 'provider' })] },
  });
  const report = reportOf(goalOf({ ending: 'spend' }), views);
  assert.deepEqual(report.verdict.stopped, ['File format']);
  assert.ok(report.wrong.includes('File format was stopped at the end, and what it did is kept on its branch.'), report.wrong.join(' | '));
  assert.ok(report.wrong.some((line) => line.startsWith('Large orders failed: the AI service kept failing')), report.wrong.join(' | '));
});

test('a change allowed outside the areas is named', () => {
  const id = areaQuestion('a', 'c'.repeat(40));
  const [, entry] = question(id, 'a', 'Outside the areas', { options: [{ label: 'Allow this once' }, { label: 'Stop here' }] });
  const views = viewsOf({ reports: merged('a', 'b', 'c', 'd'), questions: { [id]: { ...entry, answer: { label: 'Allow this once', at: '2026-11-01T12:30:00.000Z' } } } });
  assert.ok(reportOf(goalOf(), views).wrong.includes('You allowed Export button outside its areas, once.'));
});

test('a failed last check names the check, and never reads as Done', () => {
  const views = viewsOf({
    reports: merged('a', 'b', 'c', 'd'),
    goalChecks: { orders: [{ goal: 'orders', hash: 'h'.repeat(64), when: 'last', head: 'x', ok: false, at: END, results: [{ check: CHECK, ok: true }, { check: OTHER, ok: false }] }] },
  });
  const report = reportOf(goalOf({ ending: 'check-failed' }), views);
  assert.deepEqual(report.verdict.failed, ['the export works']);
  const text = goalReportText(report);
  assert.ok(text.startsWith('**Customers can export their orders has ended, and its last check failed, so it isn\'t done'), text);
  assert.ok(text.includes('Failed: the export works.'), text);
  assert.ok(!text.includes('all checks passing'), text);
});

test('a check that couldn\'t run isn\'t a failed one, and a check run that said nothing says so', () => {
  const goalChecks = (results, said) => ({ orders: [{ goal: 'orders', hash: 'h'.repeat(64), when: 'last', head: 'x', ok: false, at: END, results, ...(said ? { said } : {}) }] });
  const unrun = reportOf(goalOf({ ending: 'check-failed' }), viewsOf({ reports: merged('a', 'b', 'c', 'd'), goalChecks: goalChecks([{ check: CHECK, ok: false, unrun: true }]) }));
  assert.deepEqual(unrun.verdict.failed, []);
  assert.deepEqual(unrun.verdict.unrun, ['the tests pass']);
  assert.ok(goalReportText(unrun).includes('Couldn\'t run: the tests pass.'));
  const said = reportOf(goalOf({ ending: 'check-failed' }), viewsOf({ reports: merged('a', 'b', 'c', 'd'), goalChecks: goalChecks([], 'The check run never started') }));
  assert.equal(said.verdict.said, 'The check run never started');
  assert.ok(goalReportText(said).includes('The check run never started'));
});

test('a page check is said to have been walked at its piece, not again at the end', () => {
  const page = { page: '/export' };
  const views = viewsOf({
    reports: merged('a', 'b', 'c', 'd'),
    goalChecks: { orders: [{ goal: 'orders', hash: 'h'.repeat(64), when: 'last', head: 'x', ok: true, at: END, results: [{ check: CHECK, ok: true }, { check: page, ok: null, walked: true }] }] },
  });
  assert.match(textOf(goalOf(), views), /A page check was walked when its piece was built, and not again at the end\./);
});

test('checks run again after the end are read, the latest only', () => {
  const after = (ok, at) => ({ goal: 'orders', hash: 'h'.repeat(64), when: 'last', head: 'x', ok, at, results: [{ check: CHECK, ok }] });
  const passed = viewsOf({ reports: merged('a', 'b', 'c', 'd'), goalChecks: { orders: [after(false, '2026-11-02T01:00:00.000Z'), after(true, '2026-11-02T02:00:00.000Z')] } });
  const report = reportOf(goalOf({ ending: 'waiting-for-you' }), passed);
  assert.equal(report.verdict.checkedAgain, true);
  assert.match(goalReportText(report), /The goal's checks ran again once the work waiting for you had merged, and they all passed\./);
  const failed = viewsOf({ reports: merged('a', 'b', 'c', 'd'), goalChecks: { orders: [after(false, '2026-11-02T01:00:00.000Z')] } });
  const later = reportOf(goalOf({ ending: 'waiting-for-you' }), failed);
  assert.equal(later.verdict.checkedAgain, false);
  assert.deepEqual(later.verdict.failed, ['the tests pass']);
});

test('a report checked line by line against its record', () => {
  const read = (name) => fs.readFileSync(new URL(`../../fixtures/goal-report/${name}`, import.meta.url), 'utf8');
  const { goal, views } = JSON.parse(read('views.json'));
  const text = goalReportText(goalReport({ goal, views, timeZone: TZ }));
  assert.deepEqual(text.split('\n'), read('report.md').trimEnd().split('\n'));
});

test('the briefing opens with the whole report once, then a line until each item is settled, then nothing', () => {
  const left = viewsOf({ reports: merged('a'), goals: { orders: goalOf({ ending: 'stuck' }) } });
  assert.match(goalOpening(left, {}), /^\*\*Customers can export/);
  assert.match(goalOpening(left, { since: '2026-11-01T12:00:00.000Z' }), /^\*\*Customers can export/);
  assert.equal(goalOpening(left, { since: '2026-11-01T17:00:00.000Z' }), 'The report on Customers can export their orders stays on the Logbook, with 3 things still to settle. Ask for it to read it again.');
  const settled = viewsOf({ reports: merged('a', 'b', 'c', 'd'), goals: { orders: goalOf() } });
  assert.equal(goalOpening(settled, { since: '2026-11-01T17:00:00.000Z' }), '');
  assert.equal(goalOpening(viewsOf(), {}), '');
});

test('the Logbook keeps the report until each item is settled', () => {
  assert.match(goalLogbook(viewsOf({ reports: merged('a'), goals: { orders: goalOf({ ending: 'stuck' }) } })), /Left undone/);
  assert.equal(goalLogbook(viewsOf({ reports: merged('a', 'b', 'c', 'd'), goals: { orders: goalOf() } })), '');
});

test('settled once nothing waits and nothing is left', () => {
  assert.equal(goalSettled(reportOf(goalOf(), viewsOf({ reports: merged('a', 'b', 'c', 'd') }))), true);
  assert.equal(goalSettled(reportOf(goalOf({ ending: 'stuck' }), viewsOf({ reports: merged('a') }))), false);
  assert.equal(goalSettled(reportOf(goalOf(), viewsOf({ reports: merged('a'), questions: Object.fromEntries([question('q', 'b', 'Add it?')]) }))), false);
});

test('goalProgress counts pieces, and a feature\'s slices once they are known', () => {
  assert.deepEqual(goalProgress(goalOf(), viewsOf({ reports: merged('a', 'b') })), { added: 2, of: 4 });
  const feature = data('f', 'Order export', 'feature');
  const sheet = sheetOf({ pieces: [{ work: 'f', hash: dataHash(feature) }] });
  const note = { at: START, data: { about: 'engine', work: 'f', words: 'x', slice: { n: 1, of: 4, title: 'One', flag: 'x' } } };
  assert.deepEqual(goalProgress(goalOf({ sheet }), viewsOf({ goalNotes: [note] })), { added: 1, of: 4 });
});

test('the pane line reads as the design has it', () => {
  const sheet = sheetOf();
  const goal = { id: 'orders', sheet, hash: 'h'.repeat(64), startedAt: START, ended: null, endAsked: null };
  const now = new Date('2026-11-01T14:40:00.000Z');
  const live = { state: 'running', meter: { tokens: 333000, points: null, requests: null, unknown: false } };
  assert.equal(goalPaneLine({ goal, views: viewsOf({ reports: merged('a', 'b') }), live, now }), 'Goal: 2 of 4 added, 3 hours left, a third of its spend used.');
});

test('the pane line says when it is winding down, waits, or its spend isn\'t known', () => {
  const goal = { id: 'orders', sheet: sheetOf(), hash: 'h'.repeat(64), startedAt: START, ended: null, endAsked: null };
  const now = new Date('2026-11-01T17:30:00.000Z');
  const views = viewsOf();
  assert.equal(goalPaneLine({ goal, views, live: { state: 'winding', meter: { tokens: 10, unknown: true } }, now }), 'Goal: 0 of 4 added, winding down, its spend unknown.');
  assert.equal(goalPaneLine({ goal, views, live: { state: 'waiting', meter: null }, now }), 'Goal: 0 of 4 added, waiting for you, its spend not read yet.');
  assert.equal(goalPaneLine({ goal, views, live: null, now }), 'Goal: 0 of 4 added, 30 minutes left, its spend not read yet.');
});

test('the spend share takes the larger of the limits and never reads low', () => {
  assert.equal(spendShareWords({ tokens: 100, points: 11 }, { tokens: 1000, points: 33 }), 'a third');
  assert.equal(spendShareWords({ tokens: 250000 }, { tokens: 1000000 }), 'a quarter');
  assert.equal(spendShareWords({ tokens: 260000 }, { tokens: 1000000 }), 'a third');
  assert.equal(spendShareWords({ tokens: 0 }, { tokens: 1000000 }), 'none');
  assert.equal(spendShareWords({ tokens: 1500000 }, { tokens: 1000000 }), 'all');
});

test('goalEndOf gives the latest ending for the courier, and whether it stopped early', () => {
  assert.equal(goalEndOf({}), null);
  const stopped = { goals: { orders: goalOf({ ending: 'spend' }) } };
  assert.deepEqual(goalEndOf(stopped), { id: 'orders', stoppedEarly: true });
  assert.deepEqual(goalEndOf({ goals: { orders: goalOf() } }), { id: 'orders', stoppedEarly: false });
  assert.deepEqual(goalEndOf({ goals: { orders: goalOf({ ending: 'waiting-for-you' }) } }), { id: 'orders', stoppedEarly: false });
  assert.equal(goalEndOf({ goals: { orders: goalOf(), next: { ...goalOf(), ended: null } } }), null);
});
