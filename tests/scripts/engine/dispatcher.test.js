// tests/scripts/engine/dispatcher.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, MERGE_QUEUE_EVERY_MS } from '../../../scripts/engine/dispatcher.js';

const NOW = new Date('2026-10-29T12:00:00.000Z');
const piece = (id, { lane = 'quick', place, at = '2026-10-29T09:00:00.000Z', approved = false, visible = false, files } = {}) => [id, {
  work: { id: `w-${id}`, at, data: { id, title: id, lane, visible, dependsOn: [], ...(place === undefined ? {} : { place }) } }, approved, since: at,
  ...(files ? { files } : {}),
}];
const runOf = (work, state, extra = {}) => ({ at: '2026-10-29T10:00:00.000Z', data: { work, runId: `run-${work}`, lane: 'quick', engine: 'archon', state, ...extra } });
const base = (over = {}) => ({ work: {}, runs: {}, reports: {}, settings: { engineLanes: ['quick', 'bug', 'feature'] }, stop: false, incident: false, capsReached: false, mergeQueue: { running: false, lastStart: null, waiting: 0, newReady: false }, now: NOW, ...over });

test('three quick pieces start at pace three, the fourth holds for pace', () => {
  const work = Object.fromEntries(['a', 'b', 'c', 'd'].map((id, n) => piece(id, { place: n })));
  const got = dispatch(base({ work }));
  assert.deepEqual(got.start.map((s) => s.work), ['a', 'b', 'c']);
  assert.deepEqual(got.hold, [{ work: 'd', why: 'pace' }]);
});

test('a run waiting on the director gives its slot up and keeps its files; a run at a usage limit keeps both', () => {
  const work = Object.fromEntries([...['a', 'b', 'c'].map((id, n) => piece(id, { place: n })), piece('e', { place: 3, files: ['a.js'] }), piece('d', { place: 4, files: ['x.js'] })]);
  work.a.files = ['a.js'];
  const runs = { a: [runOf('a', 'paused')], b: [runOf('b', 'paused')], c: [runOf('c', 'started')] };
  const got = dispatch(base({ work, runs, waiting: ['a'] }));
  assert.deepEqual(got.start.map((s) => s.work), ['d']);
  assert.deepEqual(got.hold, [{ work: 'e', why: 'clash', by: ['a'] }]);
  assert.ok(!got.hold.some((h) => ['a', 'b', 'c'].includes(h.work)), 'running or waiting work isn\'t queued again');
});

test('with nothing said to wait, a paused run keeps its slot', () => {
  const work = Object.fromEntries(['a', 'b', 'c', 'd'].map((id, n) => piece(id, { place: n })));
  const runs = { a: [runOf('a', 'paused')], b: [runOf('b', 'paused')], c: [runOf('c', 'paused')] };
  assert.deepEqual(dispatch(base({ work, runs })).hold, [{ work: 'd', why: 'pace' }]);
});

test('work that already ran isn\'t started again', () => {
  const work = Object.fromEntries(['a', 'b'].map((id, n) => piece(id, { place: n })));
  const runs = { a: [runOf('a', 'ended', { outcome: 'cancelled' })] };
  const got = dispatch(base({ work, runs }));
  assert.deepEqual(got.start.map((s) => s.work), ['b']);
  assert.ok(!got.hold.some((h) => h.work === 'a'));
});

test('the First Mate\'s order is kept: a placed piece before an unplaced one, then oldest first', () => {
  const work = Object.fromEntries([piece('late', { at: '2026-10-29T11:00:00.000Z' }), piece('early', { at: '2026-10-29T08:00:00.000Z' }), piece('first', { place: 0, at: '2026-10-29T11:30:00.000Z' })]);
  assert.deepEqual(dispatch(base({ work })).start.map((s) => s.work), ['first', 'early', 'late']);
});

test('a piece in a lane not in engineLanes is left for the old engine', () => {
  const work = Object.fromEntries([piece('a', { lane: 'small', approved: true }), piece('b')]);
  const got = dispatch(base({ work, settings: { engineLanes: ['quick'] } }));
  assert.deepEqual(got.start.map((s) => s.work), ['b']);
  assert.ok(!got.hold.some((h) => h.work === 'a'));
});

test('work that needs the director\'s approval waits for it', () => {
  const work = Object.fromEntries([piece('shown', { visible: true }), piece('feat', { lane: 'feature' }), piece('ok', { lane: 'feature', approved: true })]);
  const got = dispatch(base({ work }));
  assert.deepEqual(got.start.map((s) => s.work), ['ok']);
  assert.deepEqual(got.hold.map((h) => [h.work, h.why]), [['feat', 'unapproved'], ['shown', 'unapproved']]);
});

test('one feature at a time, a feature counting as one', () => {
  const work = Object.fromEntries([piece('f1', { lane: 'feature', approved: true, place: 0 }), piece('f2', { lane: 'feature', approved: true, place: 1 }), piece('q', { place: 2 })]);
  const got = dispatch(base({ work }));
  assert.deepEqual(got.start.map((s) => s.work), ['f1', 'q']);
  assert.deepEqual(got.hold, [{ work: 'f2', why: 'pace' }]);
});

test('nothing starts under All stop', () => {
  const got = dispatch(base({ work: Object.fromEntries([piece('a')]), stop: true, mergeQueue: { running: false, lastStart: null, waiting: 2, newReady: true } }));
  assert.deepEqual(got.start, []);
  assert.deepEqual(got.hold, [{ work: 'a', why: 'stop' }]);
  assert.equal(got.startMergeQueue, false);
});

test('nothing starts under an open incident', () => {
  assert.deepEqual(dispatch(base({ work: Object.fromEntries([piece('a')]), incident: true })).hold, [{ work: 'a', why: 'incident' }]);
});

test('nothing starts while a spend cap is reached', () => {
  assert.deepEqual(dispatch(base({ work: Object.fromEntries([piece('a')]), capsReached: true })).hold, [{ work: 'a', why: 'cap' }]);
});

test('an overlapping piece holds for the clash', () => {
  const work = Object.fromEntries([piece('a', { place: 0, files: ['src/a.js'] }), piece('b', { place: 1, files: ['src/a.js'] }), piece('c', { place: 2, files: ['src/c.js'] })]);
  const got = dispatch(base({ work }));
  assert.deepEqual(got.start.map((s) => s.work), ['a', 'c']);
  assert.deepEqual(got.hold, [{ work: 'b', why: 'clash', by: ['a'] }]);
});

test('work that would use the plan\'s counted requests holds when the cap allows none', () => {
  const work = Object.fromEntries([piece('a', { place: 0 }), piece('b', { place: 1 })]);
  const requests = { counts: (id) => id === 'a', used: 0, cap: 0, confirmed: true };
  const got = dispatch(base({ work, requests }));
  assert.deepEqual(got.start.map((s) => s.work), ['b']);
  assert.deepEqual(got.hold, [{ work: 'a', why: 'requests' }]);
  assert.deepEqual(dispatch(base({ work, requests: { ...requests, cap: 50, confirmed: false } })).hold, [{ work: 'a', why: 'requests-unconfirmed' }]);
  assert.equal(dispatch(base({ work, requests: { ...requests, cap: 50 } })).start.length, 2);
});

test('the merge queue starts when a pull request is newly ready, and again every 15 minutes while any wait', () => {
  assert.equal(dispatch(base({ mergeQueue: { running: false, lastStart: null, waiting: 1, newReady: true } })).startMergeQueue, true);
  const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
  assert.equal(dispatch(base({ mergeQueue: { running: false, lastStart: ago(5 * 60000), waiting: 1, newReady: false } })).startMergeQueue, false);
  assert.equal(dispatch(base({ mergeQueue: { running: false, lastStart: ago(MERGE_QUEUE_EVERY_MS), waiting: 1, newReady: false } })).startMergeQueue, true);
  assert.equal(dispatch(base({ mergeQueue: { running: true, lastStart: ago(MERGE_QUEUE_EVERY_MS * 3), waiting: 1, newReady: true } })).startMergeQueue, false, 'one merge-queue run at a time');
  assert.equal(dispatch(base({ mergeQueue: { running: false, lastStart: ago(MERGE_QUEUE_EVERY_MS), waiting: 0, newReady: false } })).startMergeQueue, false);
});

test('two missed ticks start one merge-queue run', () => {
  const ago = new Date(NOW.getTime() - MERGE_QUEUE_EVERY_MS * 2 - 60000).toISOString();
  const got = dispatch(base({ mergeQueue: { running: false, lastStart: ago, waiting: 3, newReady: true } }));
  assert.strictEqual(got.startMergeQueue, true, 'a yes, never a count');
});

test('a red head goes back as a clash does, and says why; a second red raises its own card', () => {
  const work = Object.fromEntries([piece('a', { place: 0 }), piece('b', { place: 1 })]);
  const runs = { a: [runOf('a', 'ended', { outcome: 'completed', pr: 3 })], b: [runOf('b', 'ended', { outcome: 'completed', pr: 4 })] };
  const got = dispatch(base({ work, runs, sentBack: [{ work: 'a', times: 1, reason: 'red' }, { work: 'b', times: 2, reason: 'red' }] }));
  assert.deepEqual(got.requeue, [{ work: 'a', lane: 'quick', branch: null, reason: 'red' }]);
  assert.deepEqual(got.redCards, [{ work: 'b' }]);
  assert.deepEqual(got.clashCards, []);
});

test('reds and clashes are counted apart', () => {
  const work = Object.fromEntries([piece('a', { place: 0 })]);
  const runs = { a: [runOf('a', 'ended', { outcome: 'completed', pr: 3 })] };
  const got = dispatch(base({ work, runs, sentBack: [{ work: 'a', times: 1, reason: 'clash' }, { work: 'a', times: 1, reason: 'red' }] }));
  assert.deepEqual(got.requeue, [{ work: 'a', lane: 'quick', branch: null, reason: 'red' }]);
  assert.deepEqual([got.redCards, got.clashCards], [[], []]);
});

test('a pull request sent back for a clash is started again to bring it up to date; a second clash raises a card', () => {
  const work = Object.fromEntries([piece('a', { place: 0 }), piece('b', { place: 1 })]);
  const runs = { a: [runOf('a', 'ended', { outcome: 'completed', pr: 3 })], b: [runOf('b', 'ended', { outcome: 'completed', pr: 4 })] };
  const got = dispatch(base({ work, runs, sentBack: [{ work: 'a', times: 1 }, { work: 'b', times: 2 }] }));
  assert.deepEqual(got.requeue, [{ work: 'a', lane: 'quick', branch: null }]);
  assert.deepEqual(got.clashCards, [{ work: 'b' }]);
  assert.deepEqual(got.start, []);
});

test('a feature between slices still holds the feature lane and a slot, so a second feature waits for pace', () => {
  const work = Object.fromEntries([piece('f1', { lane: 'feature', approved: true, place: 0 }), piece('f2', { lane: 'feature', approved: true, place: 1 }), piece('q', { place: 2 })]);
  const runs = { f1: [runOf('f1', 'ended', { lane: 'slice', outcome: 'completed', pr: 70 })] };
  const got = dispatch(base({ work, runs, settings: { engineLanes: ['quick', 'feature'] } }));
  assert.deepEqual(got.start.map((s) => s.work), ['q']);
  assert.deepEqual(got.hold, [{ work: 'f2', why: 'pace' }]);
  const ended = dispatch(base({ work, runs, reports: { f1: { at: '2026-10-29T11:00:00.000Z', data: { work: 'f1', outcome: 'merged' } } } }));
  assert.ok(ended.start.some((s) => s.work === 'f2'), 'a feature that merged holds nothing');
});

const FEATURES = { engineLanes: ['quick', 'feature'] };
const merged = (id) => ({ [id]: { at: '2026-10-29T11:00:00.000Z', data: { work: id, outcome: 'merged' } } });

test('a second feature starts while the first waits on the director, and only one builds', () => {
  const work = Object.fromEntries([piece('f1', { lane: 'feature', approved: true, place: 0 }), piece('f2', { lane: 'feature', approved: true, place: 1 }), piece('f3', { lane: 'feature', approved: true, place: 2 })]);
  const runs = { f1: [runOf('f1', 'paused', { lane: 'slice' })] };
  const got = dispatch(base({ work, runs, settings: FEATURES, waiting: ['f1'] }));
  assert.deepEqual(got.start.map((s) => s.work), ['f2']);
  assert.deepEqual(got.hold, [{ work: 'f3', why: 'pace' }]);
});

test('work that depends on a waiting piece still waits', () => {
  const work = Object.fromEntries([piece('a', { place: 0 }), piece('b', { place: 1 })]);
  work.b.work.data.dependsOn = ['a'];
  const got = dispatch(base({ work, runs: { a: [runOf('a', 'paused')] }, waiting: ['a'] }));
  assert.deepEqual(got.start, []);
  assert.deepEqual(got.hold, [{ work: 'b', why: 'dependency', by: ['a'] }]);
});

test('new work holds as parked once waiting plus running reach twice pace', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const work = Object.fromEntries([...ids.map((id, n) => piece(id, { place: n })), piece('g', { place: 6 })]);
  const runs = Object.fromEntries(ids.map((id) => [id, [runOf(id, 'paused')]]));
  const got = dispatch(base({ work, runs, waiting: ids }));
  assert.deepEqual(got.start, []);
  assert.deepEqual(got.hold, [{ work: 'g', why: 'parked', by: ids }]);
});

test('the parked limit counts what runs and what waits, and follows pace', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const work = Object.fromEntries([...ids.map((id, n) => piece(id, { place: n })), piece('g', { place: 6 }), piece('h', { place: 7 })]);
  const runs = Object.fromEntries(ids.map((id) => [id, [runOf(id, id === 'a' ? 'started' : 'paused')]]));
  const five = dispatch(base({ work, runs, waiting: ids.slice(1) }));
  assert.deepEqual(five.start.map((s) => s.work), ['g'], 'one running and four waiting leave one place below six');
  assert.deepEqual(five.hold, [{ work: 'h', why: 'parked', by: ids.slice(1) }]);

  const slow = { ...FEATURES, pace: { value: 1 } };
  const small = dispatch(base({ work: Object.fromEntries([piece('a', { place: 0 }), piece('b', { place: 1 }), piece('c', { place: 2 })]), runs: { a: [runOf('a', 'paused')], b: [runOf('b', 'paused')] }, settings: slow, waiting: ['a', 'b'] }));
  assert.deepEqual(small.hold, [{ work: 'c', why: 'parked', by: ['a', 'b'] }]);
});

test('a place taken by what runs reads as pace, and only a free place reads as parked', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const work = Object.fromEntries([...ids.map((id, n) => piece(id, { place: n })), piece('g', { place: 6 })]);
  const runs = Object.fromEntries(ids.map((id, n) => [id, [runOf(id, n < 3 ? 'started' : 'paused')]]));
  assert.deepEqual(dispatch(base({ work, runs, waiting: ids.slice(3) })).hold, [{ work: 'g', why: 'pace' }]);
});

test('a waiting piece that has ended counts for nothing', () => {
  const work = Object.fromEntries([piece('a', { place: 0, files: ['a.js'] }), piece('b', { place: 1, files: ['a.js'] })]);
  const runs = { a: [runOf('a', 'ended', { outcome: 'completed', pr: 3 })] };
  const got = dispatch(base({ work, runs, reports: merged('a'), waiting: ['a'] }));
  assert.deepEqual(got.start.map((s) => s.work), ['b']);
});

test('a name that is no work on the engine counts for nothing', () => {
  const work = Object.fromEntries([piece('a', { files: ['a.js'] })]);
  assert.deepEqual(dispatch(base({ work, waiting: ['merge-queue', 'gone'] })).start.map((s) => s.work), ['a']);
});

test('a reserved file keeps its hold after a run ends, until the work ends', () => {
  const work = Object.fromEntries([piece('a', { place: 0 }), piece('b', { place: 1, files: ['a.js'] })]);
  const runs = { a: [runOf('a', 'ended', { outcome: 'completed' })] };
  const held = dispatch(base({ work, runs, reserved: { a: ['a.js'] } }));
  assert.deepEqual(held.hold, [{ work: 'b', why: 'clash', by: ['a'] }]);
  assert.deepEqual(dispatch(base({ work, runs, reserved: { a: ['a.js'] }, reports: merged('a') })).start.map((s) => s.work), ['b']);
});

test('a reservation holds beside a waiting piece\'s expected files', () => {
  const work = Object.fromEntries([piece('a', { place: 0, files: ['a.js'] }), piece('b', { place: 1, files: ['b.js'] }), piece('c', { place: 2, files: ['a.js'] })]);
  const runs = { a: [runOf('a', 'paused')] };
  const got = dispatch(base({ work, runs, waiting: ['a'], reserved: { a: ['b.js'] } }));
  assert.deepEqual(got.hold, [{ work: 'b', why: 'clash', by: ['a'] }, { work: 'c', why: 'clash', by: ['a'] }]);
});

test('a reservation holds no piece by itself in place of the running count', () => {
  const work = Object.fromEntries([piece('a', { place: 0 }), piece('b', { place: 1 }), piece('c', { place: 2 }), piece('d', { place: 3 })]);
  const runs = { a: [runOf('a', 'ended', { outcome: 'completed' })] };
  const got = dispatch(base({ work, runs, reserved: { a: ['a.js'] } }));
  assert.deepEqual(got.start.map((s) => s.work), ['b', 'c', 'd']);
});

test('a piece never clashes with its own reservation', () => {
  // A Carry on of a stopped piece: queued again, its files still reserved.
  const again = '2026-10-29T11:30:00.000Z';
  const work = Object.fromEntries([piece('a', { place: 0, at: again, files: ['a.js'] })]);
  const got = dispatch(base({ work, reports: { a: { at: '2026-10-29T11:00:00.000Z', data: { work: 'a', outcome: 'closed' } } }, reserved: { a: ['a.js'] } }));
  assert.deepEqual(got.start.map((s) => s.work), ['a']);
  assert.deepEqual(got.hold, []);
});

test('a hot file a parked piece reserved holds what would touch it', () => {
  const work = Object.fromEntries([piece('a', { place: 0 }), piece('b', { place: 1, files: ['db/two.sql'] })]);
  const runs = { a: [runOf('a', 'paused')] };
  const got = dispatch(base({ work, runs, waiting: ['a'], reserved: { a: ['db/one.sql'] }, settings: { engineLanes: ['quick'], hotFiles: ['db/*.sql'] } }));
  assert.deepEqual(got.hold, [{ work: 'b', why: 'clash', by: ['a'] }]);
});

test('a hold names each piece once', () => {
  const work = Object.fromEntries([piece('a', { place: 0, files: ['a.js', 'b.js'] }), piece('b', { place: 1, files: ['a.js', 'b.js'] })]);
  assert.deepEqual(dispatch(base({ work })).hold, [{ work: 'b', why: 'clash', by: ['a'] }]);
});

test('the running count never passes pace', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  for (const pace of [1, 2, 3]) {
    for (const [running, waits] of [[0, 0], [0, 1], [1, 0], [1, 2], [2, 2], [3, 0], [3, 3], [0, 6], [1, 5]]) {
      const work = Object.fromEntries(ids.map((id, n) => piece(id, { place: n })));
      const live = ids.slice(0, running);
      const parked = ids.slice(running, running + waits);
      const runs = Object.fromEntries([...live.map((id) => [id, [runOf(id, 'started')]]), ...parked.map((id) => [id, [runOf(id, 'paused')]])]);
      const got = dispatch(base({ work, runs, waiting: parked, settings: { engineLanes: ['quick'], pace: { value: pace } } }));
      const limit = Math.max(0, Math.min(pace - running, pace * 2 - running - waits));
      assert.equal(got.start.length, limit, `pace ${pace}, ${running} running, ${waits} waiting`);
      assert.ok(running + got.start.length <= Math.max(running, pace));
    }
  }
});

test('old callers pass neither input, and bad ones read as none', () => {
  const work = Object.fromEntries([piece('a')]);
  assert.deepEqual(dispatch(base({ work, waiting: null, reserved: null })).start.map((s) => s.work), ['a']);
  assert.deepEqual(dispatch(base({ work, waiting: 'a', reserved: [] })).start.map((s) => s.work), ['a']);
});

test('a run at work keeps its place, whatever card is left open', () => {
  // Queued again with a cap card still open: the new run is going, so it fills a place.
  const work = Object.fromEntries(['a', 'b', 'c', 'd'].map((id, n) => piece(id, { place: n })));
  const runs = { a: [runOf('a', 'started')], b: [runOf('b', 'started')], c: [runOf('c', 'started')] };
  assert.deepEqual(dispatch(base({ work, runs, waiting: ['a'] })).hold, [{ work: 'd', why: 'pace' }]);
});

test('a run that went on after its question fills its place again', () => {
  const work = Object.fromEntries(['a', 'b'].map((id, n) => piece(id, { place: n })));
  const runs = { a: [runOf('a', 'paused'), { ...runOf('a', 'started'), at: '2026-10-29T10:05:00.000Z' }] };
  const slow = { engineLanes: ['quick'], pace: { value: 1 } };
  assert.deepEqual(dispatch(base({ work, runs, waiting: ['a'], settings: slow })).hold, [{ work: 'b', why: 'pace' }]);
});

test('a queued piece named as waiting counts once, and its own files hold it not', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const work = Object.fromEntries([...ids.map((id, n) => piece(id, { place: n })), piece('g', { place: 5, files: ['g.js'] })]);
  const runs = Object.fromEntries(ids.map((id) => [id, [runOf(id, 'paused')]]));
  const got = dispatch(base({ work, runs, waiting: [...ids, 'g'] }));
  assert.deepEqual(got.start.map((s) => s.work), ['g']);
});

test('a waiting piece going back counts once against the parked limit', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const work = Object.fromEntries([...ids.map((id, n) => piece(id, { place: n })), piece('g', { place: 5 })]);
  const runs = Object.fromEntries(ids.map((id) => [id, [runOf(id, id === 'a' ? 'ended' : 'paused', id === 'a' ? { outcome: 'completed', pr: 3 } : {})]]));
  const got = dispatch(base({ work, runs, waiting: ids, sentBack: [{ work: 'a', times: 1 }] }));
  assert.deepEqual(got.requeue.map((r) => r.work), ['a']);
  assert.deepEqual(got.start.map((s) => s.work), ['g']);
});

test('the director\'s pace holds, however far the settings are read down', () => {
  const work = Object.fromEntries(['a', 'b', 'c'].map((id, n) => piece(id, { place: n })));
  assert.equal(dispatch(base({ work, settings: { engineLanes: ['quick'], pace: 1 } })).start.length, 1);
  assert.equal(dispatch(base({ work, settings: { engineLanes: ['quick'], pace: { value: 2 } } })).start.length, 2);
  assert.equal(dispatch(base({ work, settings: { engineLanes: ['quick'], pace: 9 } })).start.length, 3);
});
