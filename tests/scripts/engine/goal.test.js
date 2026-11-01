// tests/scripts/engine/goal.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataHash } from '../../../scripts/state/events.js';
import { sheetHash, checkSheet, narrowed, goalInForce, pieceCovered, goalsView as viewOf, startProblem, goalRule, gateStart, orderGoal, goalStep, unfinishedOf } from '../../../scripts/engine/goal.js';
import { MAX_PIECES, MAX_HOURS, GOAL_ENDINGS } from '../../../scripts/engine/goal-limits.js';

const NOW = new Date('2026-11-01T10:00:00.000Z');
const hoursAfter = (h) => new Date(NOW.getTime() + h * 3600000).toISOString();
const PAGE = { id: 'export-page', title: 'The page', lane: 'small', visible: false, dependsOn: [] };
const FILE = { id: 'export-file', title: 'The file', lane: 'small', visible: false, dependsOn: [] };
const WORK_HASH = dataHash(PAGE);

const sheet = (extra = {}) => ({
  title: 'Customers can export their orders',
  done: [{ test: 'export downloads every order' }, { command: 'node check.js', expect: 0 }],
  checksSay: ['The export holds every order.', 'The checking script passes.'],
  pieces: [{ work: 'export-page', hash: WORK_HASH }, { work: 'export-file', hash: dataHash(FILE), waived: true }],
  areas: { may: ['src/orders/**', 'tests/orders/**'], wontTouch: ['billing/**', 'tests/orders/export.test.js'] },
  checkFiles: ['tests/orders/export.test.js'],
  spend: { tokens: 20000000, points: 10 },
  until: hoursAfter(8),
  stopEarly: { failedInARow: 2, reds: 2 },
  ...extra,
});

test('the limits table holds the ending words, frozen', () => {
  assert.equal(MAX_PIECES, 12);
  assert.equal(MAX_HOURS, 24);
  assert.equal(Object.isFrozen(GOAL_ENDINGS), true);
  assert.equal(GOAL_ENDINGS.includes('all-stop'), true);
});

test('a well-formed sheet is accepted', () => {
  assert.equal(checkSheet(sheet(), { now: NOW }), null);
});

test('the sheet\'s hash covers a key it doesn\'t know', () => {
  const a = sheet();
  const b = sheet({ somethingLater: 'x' });
  assert.equal(sheetHash(a), dataHash(a));
  assert.notEqual(sheetHash(a), sheetHash(b));
  assert.equal(checkSheet(b, { now: NOW }), null, 'an unknown key passes');
});

test('a sheet of 13 pieces is refused', () => {
  const pieces = (n) => Array.from({ length: n }, (_, i) => ({ work: `piece-${i}`, hash: WORK_HASH }));
  assert.equal(checkSheet(sheet({ pieces: pieces(MAX_PIECES) }), { now: NOW }), null);
  assert.match(checkSheet(sheet({ pieces: pieces(13) }), { now: NOW }), /piece/);
  assert.match(checkSheet(sheet({ pieces: [] }), { now: NOW }), /piece/);
  assert.match(checkSheet(sheet({ pieces: [{ work: 'a', hash: WORK_HASH }, { work: 'a', hash: WORK_HASH }] }), { now: NOW }), /twice/);
  assert.match(checkSheet(sheet({ pieces: [{ work: 'Bad Id', hash: WORK_HASH }] }), { now: NOW }), /piece/);
  assert.match(checkSheet(sheet({ pieces: [{ work: 'a', hash: '' }] }), { now: NOW }), /piece/);
  assert.match(checkSheet(sheet({ pieces: [{ work: 'a', hash: WORK_HASH, waived: 'yes' }] }), { now: NOW }), /piece/);
});

test('until more than 24 hours ahead is refused', () => {
  assert.equal(checkSheet(sheet({ until: hoursAfter(24) }), { now: NOW }), null, 'exactly 24 hours passes');
  assert.match(checkSheet(sheet({ until: new Date(NOW.getTime() + 24 * 3600000 + 1).toISOString() }), { now: NOW }), /24 hours/);
  assert.match(checkSheet(sheet({ until: hoursAfter(-1) }), { now: NOW }), /later/);
  assert.match(checkSheet(sheet({ until: NOW.toISOString() }), { now: NOW }), /later/);
  assert.match(checkSheet(sheet({ until: 'tomorrow evening' }), { now: NOW }), /time/);
  assert.match(checkSheet(sheet({ until: undefined }), { now: NOW }), /time/);
});

test('a sheet with no test or command check is refused', () => {
  assert.match(checkSheet(sheet({ done: [], checksSay: [] }), { now: NOW }), /check/);
  assert.match(checkSheet(sheet({ done: [{ page: '/export', mustShow: 'Download' }], checksSay: ['x'] }), { now: NOW }), /page/);
  assert.match(checkSheet(sheet({ done: [{ test: 'a' }, { page: '/export', mustShow: 'Download' }], checksSay: ['x', 'y'] }), { now: NOW }), /page/);
  assert.match(checkSheet(sheet({ done: [{ test: '' }], checksSay: ['x'] }), { now: NOW }), /test/);
  assert.match(checkSheet(sheet({ done: [{ command: 'x' }], checksSay: ['x'] }), { now: NOW }), /check/);
  assert.match(checkSheet(sheet({ done: 'a test' }), { now: NOW }), /check/);
  // A command check alone is enough, and needs no check file.
  assert.equal(checkSheet(sheet({ done: [{ command: 'node check.js', expect: 0 }], checksSay: ['It passes.'], checkFiles: [] }), { now: NOW }), null);
});

test('checksSay says one thing for each check', () => {
  assert.match(checkSheet(sheet({ checksSay: ['only one'] }), { now: NOW }), /checks/);
  assert.match(checkSheet(sheet({ checksSay: ['a', ''] }), { now: NOW }), /checks/);
  assert.match(checkSheet(sheet({ checksSay: undefined }), { now: NOW }), /checks/);
});

test('a test check with no check file, or one outside wontTouch, is refused', () => {
  assert.match(checkSheet(sheet({ checkFiles: [] }), { now: NOW }), /check file/);
  const { checkFiles: _none, ...without } = sheet();
  assert.match(checkSheet(without, { now: NOW }), /check file/);
  assert.match(checkSheet(sheet({ checkFiles: ['tests/orders/other.test.js'] }), { now: NOW }), /Won't touch/);
  assert.match(checkSheet(sheet({ checkFiles: [''] }), { now: NOW }), /check file/);
  // A pattern covers it.
  assert.equal(checkSheet(sheet({ checkFiles: ['tests/orders/export.test.js'], areas: { may: ['src/**'], wontTouch: ['tests/**'] } }), { now: NOW }), null);
  // One in two outside is enough to refuse.
  assert.match(checkSheet(sheet({ checkFiles: ['tests/orders/export.test.js', 'tests/x.js'] }), { now: NOW }), /Won't touch/);
});

test('areas, spend and the early stop are checked', () => {
  assert.match(checkSheet(sheet({ areas: { may: 'src' , wontTouch: [] } }), { now: NOW }), /area/);
  assert.match(checkSheet(sheet({ areas: undefined }), { now: NOW }), /area/);
  assert.match(checkSheet(sheet({ spend: { tokens: 0 } }), { now: NOW }), /tokens/);
  assert.match(checkSheet(sheet({ spend: { tokens: 1.5 } }), { now: NOW }), /tokens/);
  assert.match(checkSheet(sheet({ spend: { points: 5 } }), { now: NOW }), /tokens/);
  assert.match(checkSheet(sheet({ spend: { tokens: 5, points: 0 } }), { now: NOW }), /points/);
  assert.match(checkSheet(sheet({ spend: { tokens: 5, requests: -1 } }), { now: NOW }), /requests/);
  assert.equal(checkSheet(sheet({ spend: { tokens: 5, requests: 12.5 } }), { now: NOW }), null);
  assert.match(checkSheet(sheet({ stopEarly: { failedInARow: 0, reds: 2 } }), { now: NOW }), /early/);
  assert.match(checkSheet(sheet({ stopEarly: { failedInARow: 2, reds: 1.5 } }), { now: NOW }), /early/);
  assert.match(checkSheet(sheet({ title: '  ' }), { now: NOW }), /title/);
  assert.match(checkSheet('a sheet', { now: NOW }), /sheet/);
});

// --- narrowing ---

test('a narrowing that narrows is accepted, and the sheet it was given is not changed', () => {
  const s = sheet();
  const before = structuredClone(s);
  assert.equal(narrowed(s, { until: hoursAfter(2) }).until, hoursAfter(2));
  assert.deepEqual(narrowed(s, { spend: { tokens: 100, points: 10 } }).spend, { tokens: 100, points: 10 });
  assert.deepEqual(narrowed(s, { spend: { requests: 40 } }).spend, { tokens: 20000000, points: 10, requests: 40 }, 'a limit the sheet lacks may be added');
  assert.deepEqual(narrowed(s, { areas: { may: ['src/orders/**'] } }).areas, { may: ['src/orders/**'], wontTouch: s.areas.wontTouch });
  assert.deepEqual(narrowed(s, { areas: { wontTouch: [...s.areas.wontTouch, 'docs/**'] } }).areas.wontTouch, [...s.areas.wontTouch, 'docs/**']);
  const kept = narrowed(s, { pieces: ['export-file'] });
  assert.deepEqual(kept.pieces, [{ work: 'export-file', hash: dataHash(FILE), waived: true }]);
  assert.deepEqual(narrowed(s, { pieces: ['export-file', 'export-page'] }).pieces.map((p) => p.work), ['export-page', 'export-file'], 'the sheet\'s order');
  assert.deepEqual(s, before);
});

test('a narrowing that widens anything is refused', () => {
  const s = sheet();
  const refused = [
    { until: hoursAfter(9) },
    { until: s.until },
    { until: 'later' },
    { spend: { tokens: 20000001 } },
    { spend: { points: 11 } },
    { spend: { tokens: 1.5 } },
    { spend: { tokens: 0 } },
    { spend: { tokens: 5, other: 1 } },
    { areas: { may: [...s.areas.may, 'src/billing/**'] } },
    { areas: { wontTouch: ['billing/**'] } },
    { areas: { wontTouch: [] } },
    { areas: { other: [] } },
    { pieces: ['export-page', 'not-on-it'] },
    { pieces: [] },
    { pieces: 'export-page' },
    { checkFiles: [] },
    { done: [] },
    {},
    null,
    'until',
    [],
  ];
  for (const change of refused) assert.equal(narrowed(s, change), null, JSON.stringify(change));
  // One widening spoils the whole change.
  assert.equal(narrowed(s, { until: hoursAfter(2), spend: { tokens: 20000001 } }), null);
});

// --- reading the record ---

const START = '2026-11-01T10:00:00.000Z';
const t = (minutes) => new Date(Date.parse(START) + minutes * 60000).toISOString();
const goalRec = (s, id = 'export-orders', at = t(-5)) => ({ id: `g-${id}-${at}`, at, kind: 'goal', data: { id, sheet: s } });
const startOf = (s, id = 'export-orders', at = START) => ({ id: `s-${id}-${at}`, at, kind: 'action', data: { action: 'start-goal', goal: id, hash: sheetHash(s), question: 'q', label: 'Start' } });
const endRec = (id, at, ending = 'done') => ({ id: `e-${id}-${at}`, at, kind: 'goal-end', data: { goal: id, ending, at, spent: { tokens: 1, points: null, requests: null, unknown: 0, shareAtStart: null, queueRuns: 0 } } });
const note = (data, at) => ({ id: `n-${at}`, at, kind: 'note', data });
const sheetNow = () => sheet({ until: hoursAfter(8) });
const workRec = (data, at) => ({ id: `w-${data.id}-${at}`, at, kind: 'work', data });
// The two pieces' work records, recorded before the signatures the tests make.
const WORKS = [workRec(PAGE, t(-10)), workRec(FILE, t(-10))];
// Each sheet's baseline, as the helper signs it: its first check failing on the main line.
const baselines = (events) => {
  const out = {};
  for (const e of events.filter((x) => x.kind === 'goal')) {
    (out[e.data.id] ??= []).push({ goal: e.data.id, hash: sheetHash(e.data.sheet), when: 'before', head: 'a'.repeat(40), results: e.data.sheet.done.map((check, i) => ({ check, ok: i > 0 })), ok: false, at: t(-6) });
  }
  return out;
};
const goalsView = (events, starts) => viewOf([...WORKS, ...events], starts, baselines(events));

test('a goal with no signature is not in force', () => {
  const s = sheetNow();
  assert.deepEqual(goalsView([goalRec(s)], []), {});
  assert.equal(goalInForce({ goals: goalsView([goalRec(s)], []) }), null);
  assert.equal(goalInForce({}), null);
  assert.equal(goalInForce(undefined), null);
});

test('a signature over another hash counts for nothing', () => {
  const s = sheetNow();
  const other = sheet({ title: 'Something else', until: s.until });
  assert.deepEqual(goalsView([goalRec(s)], [startOf(other)]), {});
  assert.deepEqual(goalsView([goalRec(s)], [{ ...startOf(s), data: { ...startOf(s).data, goal: 'another' } }]), {});
});

test('a signed goal is in force, with its sheet, hash and time', () => {
  const s = sheetNow();
  const goals = goalsView([goalRec(s)], [startOf(s)]);
  assert.deepEqual(Object.keys(goals), ['export-orders']);
  assert.equal(goals['export-orders'].hash, sheetHash(s));
  assert.equal(goals['export-orders'].startedAt, START);
  assert.equal(goals['export-orders'].ended, null);
  assert.equal(goals['export-orders'].endAsked, null);
  assert.deepEqual(goalInForce({ goals }), {
    id: 'export-orders', hash: sheetHash(s), sheet: s, state: 'running', startedAt: START, until: s.until,
  });
});

test('a re-record of a signed id leaves the signed sheet standing', () => {
  const s = sheetNow();
  const wider = sheet({ until: hoursAfter(20), spend: { tokens: 99999999 } });
  const events = [goalRec(s), goalRec(wider, 'export-orders', t(-1))];
  const goals = goalsView(events, [startOf(s)]);
  assert.deepEqual(goals['export-orders'].sheet, s);
  // And a signature over the later record signs that one, not the first.
  assert.deepEqual(goalsView(events, [startOf(wider)])['export-orders'].sheet, wider);
  // A sheet that is refused at its start is no goal.
  const long = sheet({ until: hoursAfter(30) });
  assert.deepEqual(goalsView([goalRec(long)], [startOf(long)]), {});
});

test('the first signature of an id stands', () => {
  const s = sheetNow();
  const again = startOf(s, 'export-orders', t(30));
  const goals = goalsView([goalRec(s)], [startOf(s), again]);
  assert.equal(goals['export-orders'].startedAt, START);
});

test('a second goal in a project is refused while one is in force', () => {
  const a = sheetNow();
  const b = sheet({ title: 'A second goal', until: hoursAfter(8) });
  const events = [goalRec(a, 'first'), goalRec(b, 'second')];
  const during = goalsView(events, [startOf(a, 'first'), startOf(b, 'second', t(10))]);
  assert.deepEqual(Object.keys(during), ['first']);
  // Signed after the first has ended, it comes in.
  const after = goalsView([...events, endRec('first', t(20))], [startOf(a, 'first'), startOf(b, 'second', t(30))]);
  assert.deepEqual(Object.keys(after).sort(), ['first', 'second']);
  assert.deepEqual(after.first.ended.ending, 'done');
  assert.equal(after.second.ended, null);
  assert.equal(goalInForce({ goals: after }).id, 'second');
  // Signed before the first ended, it stays out even if the first ends later.
  const early = goalsView([...events, endRec('first', t(40))], [startOf(a, 'first'), startOf(b, 'second', t(30))]);
  assert.deepEqual(Object.keys(early), ['first']);
});

test('the first goal-end of an id is its end', () => {
  const s = sheetNow();
  const goals = goalsView([goalRec(s), endRec('export-orders', t(20), 'time'), endRec('export-orders', t(25), 'done')], [startOf(s)]);
  assert.equal(goals['export-orders'].ended.ending, 'time');
  assert.equal(goals['export-orders'].ended.at, t(20));
  assert.equal(goalInForce({ goals }), null);
});

test('a narrowing that widens anything is ignored by the view', () => {
  const s = sheetNow();
  const events = [
    goalRec(s),
    note({ about: 'narrow-goal', goal: 'export-orders', change: { until: hoursAfter(20) } }, t(5)),
    note({ about: 'narrow-goal', goal: 'export-orders', change: { spend: { tokens: 100 } } }, t(6)),
    note({ about: 'narrow-goal', goal: 'export-orders', change: { pieces: ['export-page'], spend: { tokens: 99999999999 } } }, t(7)),
    note({ about: 'narrow-goal', goal: 'other', change: { spend: { tokens: 50 } } }, t(8)),
    note({ about: 'narrow-goal', goal: 'export-orders', change: { pieces: ['export-page'] } }, t(9)),
  ];
  const goal = goalsView(events, [startOf(s)])['export-orders'];
  assert.equal(goal.sheet.until, s.until);
  assert.equal(goal.sheet.spend.tokens, 100);
  assert.deepEqual(goal.sheet.pieces.map((p) => p.work), ['export-page']);
  assert.equal(goal.hash, sheetHash(s), 'the hash stays the signed one');
});

test('a note before the signature, or after the end, is ignored', () => {
  const s = sheetNow();
  const early = note({ about: 'narrow-goal', goal: 'export-orders', change: { spend: { tokens: 100 } } }, t(-2));
  const late = note({ about: 'narrow-goal', goal: 'export-orders', change: { spend: { tokens: 7 } } }, t(30));
  const lateAsk = note({ about: 'end-goal', goal: 'export-orders', now: true }, t(31));
  const goal = goalsView([goalRec(s), early, endRec('export-orders', t(20)), late, lateAsk], [startOf(s)])['export-orders'];
  assert.equal(goal.sheet.spend.tokens, s.spend.tokens);
  assert.equal(goal.endAsked, null);
  // A note at the end's own time counts.
  const same = note({ about: 'end-goal', goal: 'export-orders', now: false }, t(20));
  assert.deepEqual(goalsView([goalRec(s), endRec('export-orders', t(20)), same], [startOf(s)])['export-orders'].endAsked, { at: t(20), now: false });
});

test('an end-goal note is kept, and a later wish for now is not undone', () => {
  const s = sheetNow();
  const ask = (now, at) => note({ about: 'end-goal', goal: 'export-orders', now }, at);
  const view = (...notes) => goalsView([goalRec(s), ...notes], [startOf(s)])['export-orders'].endAsked;
  assert.deepEqual(view(ask(false, t(5))), { at: t(5), now: false });
  assert.deepEqual(view(ask(false, t(5)), ask(true, t(6))), { at: t(6), now: true });
  assert.deepEqual(view(ask(true, t(5)), ask(false, t(6))), { at: t(5), now: true });
  assert.equal(view(note({ about: 'end-goal', goal: 'other', now: true }, t(5))), null);
});

test('a piece whose work record changed isn\'t covered', () => {
  const s = sheetNow();
  const goal = { id: 'export-orders', hash: sheetHash(s), sheet: s };
  const data = { id: 'export-page', title: 'The page', lane: 'small', visible: false, dependsOn: [] };
  const views = (d) => ({ work: { 'export-page': { work: { data: d } } } });
  const covered = { ...s, pieces: [{ work: 'export-page', hash: dataHash(data) }, { work: 'export-file', hash: 'b'.repeat(64) }] };
  const g = { ...goal, sheet: covered };
  assert.equal(pieceCovered(g, 'export-page', views(data)), true);
  assert.equal(pieceCovered(g, 'export-page', views({ ...data, title: 'Changed' })), false);
  assert.equal(pieceCovered(g, 'export-file', views(data)), false, 'no work record');
  assert.equal(pieceCovered(g, 'not-listed', views(data)), false);
  assert.equal(pieceCovered(g, 'export-page', {}), false);
});

test('a signed start over a changed piece stays out of views.goals', () => {
  const s = sheetNow();
  const changed = workRec({ ...PAGE, title: 'Changed' }, t(-2));
  assert.deepEqual(viewOf([...WORKS, changed, goalRec(s)], [startOf(s)]), {});
  assert.deepEqual(viewOf([goalRec(s)], [startOf(s)]), {}, 'no work record at all');
});

test('a piece changed after the signature leaves the goal in force', () => {
  const s = sheetNow();
  const changed = workRec({ ...PAGE, title: 'Changed' }, t(3));
  const goals = viewOf([...WORKS, goalRec(s), changed], [startOf(s)], baselines([goalRec(s)]));
  assert.deepEqual(Object.keys(goals), ['export-orders']);
});

test('startProblem asks its checks in order, and null when all pass', () => {
  const s = sheetNow();
  const work = { 'export-page': { work: { data: PAGE } }, 'export-file': { work: { data: FILE } } };
  const running = { other: { ended: null } };
  const goalChecks = { 'export-orders': [{ hash: sheetHash(s), when: 'before', results: s.done.map((check, i) => ({ check, ok: i > 0 })) }] };
  const base = { id: 'export-orders', hash: sheetHash(s), sheet: s, goals: {}, work, goalChecks, now: NOW };
  assert.equal(startProblem(base), null);
  // Each failing at once: the first in the order is the one said.
  const all = { ...base, stopped: true, goals: { ...running, 'export-orders': { ended: { at: hoursAfter(-1) } } }, sheet: { ...s, title: '' }, work: {} };
  assert.match(startProblem(all), /All stop is on/);
  assert.match(startProblem({ ...all, stopped: false }), /other is running/);
  assert.match(startProblem({ ...all, stopped: false, goals: { 'export-orders': { ended: { at: hoursAfter(-1) } } } }), /started before/);
  assert.match(startProblem({ ...all, stopped: false, goals: {} }), /needs a title/);
  assert.match(startProblem({ ...all, stopped: false, goals: {}, sheet: s }), /export-page/);
  // A goal that ended before now doesn't hold the way; one ending later does.
  assert.equal(startProblem({ ...base, goals: { other: { ended: { at: hoursAfter(-1) } } } }), null);
  assert.match(startProblem({ ...base, goals: { other: { ended: { at: hoursAfter(1) } } } }), /one goal runs at a time/);
});

// A goal's work only, and the gate at the start of every run (unattended goals design, section 6; build plan, choice 9).
const UNTIL = hoursAfter(8);
const entry = (extra = {}) => ({ sheet: sheet({ until: UNTIL }), hash: 'signed', startedAt: NOW.toISOString(), ended: null, endAsked: null, ...extra });
const ENDING = { ending: 'time', at: hoursAfter(9), spent: {} };
const worksOf = (...list) => Object.fromEntries(list.map((data) => [data.id, { work: { at: NOW.toISOString(), data } }]));
const rule = { id: 'g', pieces: ['export-page'], only: true, startsStopped: false, until: UNTIL };
const lateRule = { id: 'g', pieces: ['export-page'], only: false, startsStopped: true };

test('a goal\'s rule lists the covered pieces, in the sheet\'s order', () => {
  const views = { goals: { g: entry() }, work: worksOf(PAGE, FILE) };
  assert.deepEqual(goalRule(views, NOW), { id: 'g', pieces: ['export-page', 'export-file'], only: true, startsStopped: false, until: UNTIL, state: 'running' });
});

test('a piece changed since the signature drops out of the rule', () => {
  const views = { goals: { g: entry() }, work: worksOf({ ...PAGE, title: 'Another page' }, FILE) };
  assert.deepEqual(goalRule(views, NOW).pieces, ['export-file']);
});

test('past until the goal\'s own starts have stopped, and only its work may run', () => {
  const late = new Date(Date.parse(UNTIL) + 1000);
  const got = goalRule({ goals: { g: entry() }, work: worksOf(PAGE, FILE) }, late);
  assert.equal(got.startsStopped, true);
  assert.equal(got.only, true);
});

test('after the end the rule holds what is unfinished, and other work may start', () => {
  const views = {
    goals: { g: entry({ ended: ENDING }) }, work: worksOf(PAGE, FILE),
    reports: { 'export-file': { at: hoursAfter(1), data: { outcome: 'merged' } } },
  };
  assert.deepEqual(goalRule(views, NOW), { id: 'g', pieces: ['export-page'], only: false, startsStopped: true });
});

test('an ended goal with nothing unfinished holds nothing', () => {
  const merged = { at: hoursAfter(1), data: { outcome: 'merged' } };
  const views = { goals: { g: entry({ ended: ENDING }) }, work: worksOf(PAGE, FILE), reports: { 'export-page': merged, 'export-file': merged } };
  assert.equal(goalRule(views, NOW), null);
});

test('a new sheet takes over from a goal that ended, and the latest ending speaks', () => {
  const work = worksOf(PAGE, FILE);
  const only = (id) => [{ work: id, hash: dataHash(id === 'export-page' ? PAGE : FILE) }];
  const ended = entry({ ended: ENDING, sheet: sheet({ pieces: only('export-page') }) });
  const next = entry({ sheet: sheet({ until: UNTIL, pieces: only('export-file') }) });
  assert.equal(goalRule({ goals: { a: ended, b: next }, work }, NOW).id, 'b');
  const later = entry({ ended: { ...ENDING, at: hoursAfter(10) }, sheet: sheet({ pieces: only('export-file') }) });
  assert.equal(goalRule({ goals: { a: ended, b: later }, work }, NOW).id, 'b');
  assert.equal(goalRule({ goals: {}, work }, NOW), null);
});

test('with no goal the gate holds nothing', () => {
  assert.equal(gateStart({ goal: null, work: 'x', lane: 'quick', via: 'start', now: NOW }), null);
});

test('the gate lets a piece of the goal start, whatever its way', () => {
  for (const via of ['start', 'slice', 'rework', 'try-again', 'retry', 'requeue', 'carry-on']) {
    assert.equal(gateStart({ goal: rule, work: 'export-page', lane: 'small', via, state: 'running', now: NOW }), null, via);
  }
});

test('the gate holds work outside the goal, and names the goal', () => {
  assert.deepEqual(gateStart({ goal: rule, work: 'other', lane: 'quick', via: 'try-again', state: 'running', now: NOW }), { goalHeld: true, goal: 'g', why: 'goal' });
});

test('the gate holds every way of starting from the moment until is reached', () => {
  const at = new Date(UNTIL);
  for (const via of ['start', 'slice', 'rework', 'try-again', 'retry', 'build-again']) {
    assert.equal(gateStart({ goal: rule, work: 'export-page', lane: 'feature', via, state: 'running', now: at })?.why, 'time', via);
  }
  assert.equal(gateStart({ goal: rule, work: 'export-page', lane: 'feature', via: 'slice', state: 'running', now: new Date(at.getTime() - 1) }), null);
});

test('the gate holds a goal that is winding down', () => {
  assert.equal(gateStart({ goal: rule, work: 'export-page', lane: 'small', via: 'rework', state: 'winding-down', now: NOW })?.why, 'winding-down');
});

test('the fix lane passes the time bound and work outside the goal, and a wind-down', () => {
  const at = new Date(Date.parse(UNTIL) + 1000);
  assert.equal(gateStart({ goal: rule, work: 'fix-1', lane: 'fix-main', via: 'start', state: 'running', now: at }), null);
  assert.equal(gateStart({ goal: rule, work: 'fix-1', lane: 'fix-main', via: 'start', state: 'winding-down', now: NOW }), null);
});

test('a meter that has reached its bound holds every lane', () => {
  for (const lane of ['quick', 'fix-main']) {
    assert.equal(gateStart({ goal: rule, work: 'export-page', lane, via: 'start', state: 'running', meter: { reached: 'tokens' }, now: NOW })?.why, 'spend', lane);
  }
  assert.equal(gateStart({ goal: rule, work: 'export-page', lane: 'quick', via: 'start', state: 'running', meter: { reached: null }, now: NOW }), null);
});

test('after the end the gate lets an answered piece through and holds the rest of the goal', () => {
  for (const via of ['rework', 'more', 'try-again', 'build-again', 'carry', 'answer']) {
    assert.equal(gateStart({ goal: lateRule, work: 'export-page', lane: 'small', via, now: NOW }), null, via);
  }
  for (const via of ['start', 'slice', 'retry', 'requeue', 'carry-on']) {
    assert.deepEqual(gateStart({ goal: lateRule, work: 'export-page', lane: 'small', via, now: NOW }), { goalHeld: true, goal: 'g', why: 'goal-ended' }, via);
  }
  assert.equal(gateStart({ goal: lateRule, work: 'other', lane: 'quick', via: 'start', now: NOW }), null);
});

test('an order names the goal that covers its piece, in force or ended', () => {
  const work = worksOf(PAGE, FILE);
  assert.equal(orderGoal({ goals: { g: entry() }, work }, 'export-page').goalId, 'g');
  assert.equal(orderGoal({ goals: { g: entry({ ended: ENDING }) }, work }, 'export-page').goalId, 'g');
  assert.deepEqual(orderGoal({ goals: { g: entry() }, work }, 'other'), {});
  assert.deepEqual(orderGoal({ goals: {}, work }, 'export-page'), {});
});

test('a tick is honoured only on a small visible piece of the goal in force', () => {
  const look = (data, ended = null) => {
    const line = { work: data.id, hash: dataHash(data), waived: true };
    return orderGoal({ goals: { g: entry({ ended, sheet: sheet({ pieces: [line] }) }) }, work: worksOf(data) }, data.id);
  };
  assert.deepEqual(look({ ...PAGE, visible: true }), { goalId: 'g', waived: true });
  assert.deepEqual(look({ ...PAGE, lane: 'quick', visible: true }), { goalId: 'g', waived: true });
  assert.deepEqual(look({ ...PAGE, lane: 'feature', visible: true }), { goalId: 'g' });
  assert.deepEqual(look({ ...PAGE, lane: 'bug', visible: true }), { goalId: 'g' });
  assert.deepEqual(look(PAGE), { goalId: 'g' }, 'nothing to waive');
  assert.deepEqual(look({ ...PAGE, visible: true }, ENDING), { goalId: 'g' }, 'an ended goal takes its tick with it');
});

test('a piece whose cap doesn\'t fit is held', () => {
  const goal = { id: 'g', pieces: ['a'], only: true, until: '2026-11-01T18:00:00.000Z' };
  const at = (left, cap, lane = 'small') => gateStart({ goal, work: 'a', lane, via: 'start', meter: { reached: null, left }, cap, now: new Date('2026-11-01T10:00:00.000Z') });
  assert.deepEqual(at(99, 100), { goalHeld: true, goal: 'g', why: 'spend' });
  assert.equal(at(100, 100), null, 'a cap that just fits starts');
  assert.equal(at(99, 100, 'fix-main'), null, 'a fix isn\'t a piece: spend holds it only once reached');
});

// What a goal does next (unattended goals design, section 8), one test for each row of its table.
const stepGoal = (over = {}) => ({ sheet: { until: '2026-11-01T18:00:00.000Z', pieces: [], ...over } });
const minutesAfter = (m) => new Date(NOW.getTime() + m * 60000).toISOString();
const facts = (over = {}) => ({
  pieces: { a: 'going', b: 'queued' }, failedInARow: 0, reds: 0, meter: null, lastStepAt: NOW.toISOString(), parkedRuns: [], liveRuns: ['r1'], fixRuns: [],
  windingSince: null, windingFor: null, slept: [], endAsked: null, allStop: false, lastCheck: null, ...over,
});
const step = (over = {}, { goal = stepGoal(), now = NOW } = {}) => goalStep({ goal, facts: facts(over), now });

test('a goal with work going runs on', () => {
  assert.deepEqual(step(), { state: 'running' });
});

test('Done: every piece merged and the last check passing', () => {
  assert.deepEqual(step({ pieces: { a: 'merged', b: 'merged' }, liveRuns: [], lastCheck: 'passed' }), { state: 'ended', ending: 'done' });
});

test('every piece merged with the last check still to come runs on', () => {
  assert.deepEqual(step({ pieces: { a: 'merged', b: 'merged' }, liveRuns: [] }), { state: 'running' });
});

test('Done: a feature\'s own run passed and only its switch-on waits', () => {
  assert.deepEqual(step({ pieces: { a: 'merged', b: 'passed' }, liveRuns: [] }), { state: 'ended', ending: 'done' });
});

test('Check failed: every piece merged and the last check failing', () => {
  assert.deepEqual(step({ pieces: { a: 'merged', b: 'merged' }, liveRuns: [], lastCheck: 'failed' }), { state: 'ended', ending: 'check-failed' });
});

test('nothing can run and all waits on the director: the goal waits until until', () => {
  const pieces = { a: 'merged', b: 'waiting' };
  assert.deepEqual(step({ pieces, liveRuns: [] }), { state: 'waiting' });
  assert.deepEqual(step({ pieces, liveRuns: [] }, { now: new Date('2026-11-01T18:00:00.000Z') }), { state: 'ended', ending: 'waiting-for-you' });
});

test('a piece that merged while another fails isn\'t waiting on the director', () => {
  assert.deepEqual(step({ pieces: { a: 'merged', b: 'failed' }, liveRuns: [] }), { state: 'running' });
});

test('Time: until passing winds down, and a run under way may finish', () => {
  const now = new Date('2026-11-01T18:00:00.000Z');
  assert.deepEqual(step({ lastStepAt: now.toISOString() }, { now }), { state: 'winding', ending: 'time', cancel: [] });
  const since = { windingSince: now.toISOString(), windingFor: 'time' };
  assert.deepEqual(step(since, { now: new Date('2026-11-01T18:59:00.000Z') }), { state: 'winding', ending: 'time', cancel: [] });
  assert.deepEqual(step(since, { now: new Date('2026-11-01T19:00:00.000Z') }), { state: 'ended', ending: 'time', cancel: ['r1'] });
  assert.deepEqual(step({ ...since, liveRuns: [] }, { now: new Date('2026-11-01T18:10:00.000Z') }), { state: 'ended', ending: 'time' });
});

test('a run parked at a limit is cancelled once the goal winds down', () => {
  const now = new Date('2026-11-01T18:00:00.000Z');
  assert.deepEqual(step({ parkedRuns: ['p1'], lastStepAt: now.toISOString() }, { now }), { state: 'winding', ending: 'time', cancel: ['p1'] });
  assert.deepEqual(step({ parkedRuns: ['p1'], liveRuns: [], windingSince: now.toISOString(), windingFor: 'time' }, { now }), { state: 'ended', ending: 'time', cancel: ['p1'] });
});

test('a sleep past until gives the run its wind-down', () => {
  const now = new Date('2026-11-01T22:00:00.000Z');
  assert.equal(step({}, { now }).state, 'winding', 'it winds down from the wake');
  const since = { windingSince: '2026-11-01T18:30:00.000Z', windingFor: 'time', slept: [{ from: '2026-11-01T18:40:00.000Z', to: '2026-11-01T21:50:00.000Z' }] };
  assert.equal(step(since, { now: new Date('2026-11-01T22:00:00.000Z') }).state, 'winding', '20 minutes awake of 3 hours 30');
  assert.equal(step(since, { now: new Date('2026-11-01T22:40:00.000Z') }).state, 'ended');
});

test('Spend: the meter reaching the goal\'s spend cancels running runs at once', () => {
  const meter = { reached: 'tokens', settled: true, unread: false };
  assert.deepEqual(step({ meter, parkedRuns: ['p1'], fixRuns: ['f1'] }), { state: 'ended', ending: 'spend', cancel: ['r1', 'p1', 'f1'] });
});

test('spend that rests on a run that couldn\'t be read holds until the reads have failed a while', () => {
  const meter = { reached: 'tokens', settled: false, unread: true };
  assert.deepEqual(step({ meter, unreadSince: minutesAfter(-9) }), { state: 'running' });
  assert.equal(step({ meter, unreadSince: minutesAfter(-10) }).ending, 'spend');
});

test('a sleep doesn\'t count against a read that failed', () => {
  const meter = { reached: 'tokens', settled: false, unread: true };
  const slept = [{ from: minutesAfter(-40), to: minutesAfter(-2) }];
  assert.deepEqual(step({ meter, unreadSince: minutesAfter(-41), slept }), { state: 'running' });
});

test('spend standing in for a live run the engine read holds starts and ends nothing', () => {
  assert.deepEqual(step({ meter: { reached: 'tokens', settled: false, unread: false }, unreadSince: minutesAfter(-500) }), { state: 'running' });
});

test('a last check still to come isn\'t lost to a spend reached with nothing running', () => {
  const pieces = { a: 'merged', b: 'merged' };
  assert.deepEqual(step({ pieces, liveRuns: [], meter: { reached: 'tokens', settled: true, unread: false } }), { state: 'running' });
});

test('Stuck: two pieces failing in a row winds down, and the sheet can say how many', () => {
  assert.deepEqual(step({ failedInARow: 2 }), { state: 'winding', ending: 'stuck', cancel: [] });
  const goal = stepGoal({ stopEarly: { failedInARow: 3 } });
  assert.deepEqual(step({ failedInARow: 2 }, { goal }), { state: 'running' });
  assert.equal(step({ failedInARow: 3 }, { goal }).ending, 'stuck');
});

test('Stuck: a second red main line winds down', () => {
  assert.deepEqual(step({ reds: 1 }), { state: 'running' });
  assert.equal(step({ reds: 2 }).ending, 'stuck');
});

test('Stuck: no step finishing for an hour while a run works winds down', () => {
  assert.deepEqual(step({ lastStepAt: minutesAfter(-59) }), { state: 'running' });
  assert.equal(step({ lastStepAt: minutesAfter(-60) }).ending, 'stuck');
});

test('stuck counts no time asleep', () => {
  assert.deepEqual(step({ lastStepAt: minutesAfter(-90), slept: [{ from: minutesAfter(-80), to: minutesAfter(-10) }] }), { state: 'running' });
});

test('nothing left that can run, with nothing waiting on the director, winds down as stuck', () => {
  assert.deepEqual(step({ pieces: { a: 'merged', b: 'ended' }, liveRuns: [] }), { state: 'ended', ending: 'stuck' });
});

test('End goal winds down, and End goal now stops at once', () => {
  assert.deepEqual(step({ endAsked: { at: NOW.toISOString(), now: false } }), { state: 'winding', ending: 'end-goal', cancel: [] });
  assert.deepEqual(step({ endAsked: { at: NOW.toISOString(), now: true }, parkedRuns: ['p1'], fixRuns: ['f1'] }), { state: 'ended', ending: 'end-goal', cancel: ['r1', 'p1', 'f1'] });
});

test('All stop ends the goal at once, and cancels nothing itself', () => {
  assert.deepEqual(step({ allStop: true }), { state: 'ended', ending: 'all-stop' });
});

test('a wind-down keeps the ending that began it', () => {
  const now = new Date('2026-11-01T18:30:00.000Z');
  assert.deepEqual(step({ windingSince: minutesAfter(-1), windingFor: 'stuck' }, { now: new Date(NOW.getTime() + 60000) }).ending, 'stuck');
  assert.deepEqual(step({ windingSince: now.toISOString(), windingFor: 'end-goal', endAsked: { at: now.toISOString(), now: false } }, { now }).ending, 'end-goal');
});

test('a spend reached in a wind-down ends it, and End goal now does too', () => {
  const since = { windingSince: NOW.toISOString(), windingFor: 'stuck' };
  assert.equal(step({ ...since, meter: { reached: 'points', settled: true, unread: false } }).ending, 'spend');
  assert.deepEqual(step({ ...since, endAsked: { at: NOW.toISOString(), now: true } }), { state: 'ended', ending: 'end-goal', cancel: ['r1'] });
});

test('a last check that passes in a wind-down is still Done', () => {
  const since = { windingSince: NOW.toISOString(), windingFor: 'time', pieces: { a: 'merged' }, liveRuns: [] };
  assert.equal(step({ ...since, lastCheck: 'passed' }).ending, 'done');
  assert.equal(step({ ...since, lastCheck: 'failed' }).ending, 'check-failed');
  assert.deepEqual(step(since), { state: 'winding', ending: 'time', cancel: [] }, 'the check is given the wind-down to finish');
  assert.equal(step(since, { now: new Date(NOW.getTime() + 60 * 60000) }).ending, 'time');
});

test('what a goal left unfinished reads the sheet, so a piece whose record changed is named', () => {
  const views = { work: { a: { work: { data: { id: 'a', title: 'changed since' } } } }, reports: { b: { data: { outcome: 'merged' } } } };
  const goal = { sheet: { pieces: [{ work: 'a', hash: 'old' }, { work: 'b', hash: 'x' }] } };
  assert.deepEqual(unfinishedOf(goal, views), ['a']);
});

test('a goal winding down stops starts in `goalRule`, and one that waits doesn\'t', () => {
  const goals = { g: { sheet: { until: '2026-11-01T18:00:00.000Z', pieces: [] }, hash: 'h', startedAt: NOW.toISOString(), ended: null, endAsked: null } };
  assert.equal(goalRule({ goals }, NOW).startsStopped, false);
  assert.deepEqual([goalRule({ goals }, NOW, { winding: true }).startsStopped, goalRule({ goals }, NOW, { winding: true }).state], [true, 'winding']);
});
