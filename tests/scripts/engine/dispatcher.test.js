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

test('running and paused runs hold their slots, and work that already ran isn\'t started again', () => {
  const work = Object.fromEntries(['a', 'b', 'c', 'd'].map((id, n) => piece(id, { place: n })));
  const runs = { a: [runOf('a', 'started')], b: [runOf('b', 'paused')], c: [runOf('c', 'ended', { outcome: 'cancelled' })] };
  const got = dispatch(base({ work, runs }));
  assert.deepEqual(got.start.map((s) => s.work), ['d']);
  assert.ok(!got.hold.some((h) => ['a', 'b', 'c'].includes(h.work)), 'running or stopped work isn\'t queued again');
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
  assert.deepEqual(got.hold, [{ work: 'b', why: 'clash' }]);
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

test('a pull request sent back for a clash is started again to bring it up to date; a second clash raises a card', () => {
  const work = Object.fromEntries([piece('a', { place: 0 }), piece('b', { place: 1 })]);
  const runs = { a: [runOf('a', 'ended', { outcome: 'completed', pr: 3 })], b: [runOf('b', 'ended', { outcome: 'completed', pr: 4 })] };
  const got = dispatch(base({ work, runs, sentBack: [{ work: 'a', times: 1 }, { work: 'b', times: 2 }] }));
  assert.deepEqual(got.requeue, [{ work: 'a', lane: 'quick', branch: null }]);
  assert.deepEqual(got.clashCards, [{ work: 'b' }]);
  assert.deepEqual(got.start, []);
});
