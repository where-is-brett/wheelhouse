// tests/scripts/engine/goal.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataHash } from '../../../scripts/state/events.js';
import { sheetHash, checkSheet, narrowed, goalInForce, pieceCovered, goalsView as viewOf, startProblem } from '../../../scripts/engine/goal.js';
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
const goalsView = (events, starts) => viewOf([...WORKS, ...events], starts);

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
  const goals = viewOf([...WORKS, goalRec(s), changed], [startOf(s)]);
  assert.deepEqual(Object.keys(goals), ['export-orders']);
});

test('startProblem asks its checks in order, and null when all pass', () => {
  const s = sheetNow();
  const work = { 'export-page': { work: { data: PAGE } }, 'export-file': { work: { data: FILE } } };
  const running = { other: { ended: null } };
  const base = { id: 'export-orders', hash: sheetHash(s), sheet: s, goals: {}, work, now: NOW };
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
