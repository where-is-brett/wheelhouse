// tests/scripts/foreman/queue-slots.test.js
// A piece that asked keeps its slot; only one that has reached a step it can't undo and said so (wait-for) gives it up
// (design section 6.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextWork } from '../../../scripts/foreman/queue.js';
import { markStopped } from '../../../scripts/foreman/wake.js';
import { PACE } from '../../../scripts/lib/build-loop.js';
import { featurePaths, writeStatus } from '../../../scripts/feature/files.js';
import { tempFolder } from '../../helpers/homes.js';

const T = (n) => `2026-11-08T02:00:${String(n).padStart(2, '0')}.000Z`;
const NOW = '2026-11-08T05:00:00.000Z';
// Small work, so the feature lane's own pace of one at a time doesn't hide what the building slots do.
const workOf = (id, n) => ({ work: { key: id, at: T(n), data: { lane: 'small' } }, approved: true, since: T(n) });
const building = (id, n, extra = {}) => ({ key: id, at: T(n), data: { step: 'building', lane: 'small' }, ...extra });

// As many pieces building as the pace allows, so one more can only start if a slot is free.
function fullHouse(extra = {}) {
  const work = { 'w-next': workOf('w-next', 50) };
  const features = {};
  for (let i = 0; i < PACE.building; i += 1) {
    const id = `w-tide-${i + 1}`;
    work[id] = workOf(id, i);
    features[id] = building(id, i, extra[id] ?? {});
  }
  return { work, features };
}

test('a piece that asked keeps its slot', () => {
  // `ask` records a question and nothing about the feature's step: the piece still builds, so it holds its slot.
  const { work, features } = fullHouse();
  const got = nextWork({ work, features, reports: {}, now: NOW, fiveHourTight: false });
  assert.deepEqual(got.start, []);
  assert.deepEqual(got.hold, [{ work: 'w-next', why: 'pace' }]);
});

test('a piece that has said wait-for frees its slot, and is not started a second time', () => {
  const { work, features } = fullHouse({ 'w-tide-1': { stopped: true } });
  const got = nextWork({ work, features, reports: {}, now: NOW, fiveHourTight: false });
  assert.deepEqual(got.start, ['w-next']);
  assert.ok(!got.hold.some((h) => h.work === 'w-tide-1'), 'a stopped piece is still running, never queued again');
});

test('wait-for marks only a building piece whose own status says it waits on a decision', () => {
  const tree = fs.realpathSync.native(tempFolder('wh-stopped-'));
  const other = fs.realpathSync.native(tempFolder('wh-stopped-'));
  const status = (work, waitingOn) => ({
    v: 1, work, lane: 'feature', phase: waitingOn === null ? 'building' : 'waiting', task: null, fixRound: null, waitingOn,
    head: null, pr: null, slice: null, tokens: null, updatedAt: NOW,
  });
  for (const [dir, s] of [[tree, status('w-tide-1', 'decision')], [other, status('w-tide-2', 'question')]]) {
    fs.mkdirSync(featurePaths(dir).dir, { recursive: true });
    writeStatus(featurePaths(dir).status, s);
  }
  const views = { features: { 'w-tide-1': building('w-tide-1', 1), 'w-tide-2': building('w-tide-2', 2), 'w-tide-3': { key: 'w-tide-3', at: T(3), data: { step: 'closed' } } } };
  const trees = { 'w-tide-1': tree, 'w-tide-2': other };
  markStopped(views, (work) => {
    if (!trees[work]) throw new Error('none');
    return trees[work];
  });
  assert.equal(views.features['w-tide-1'].stopped, true);
  assert.equal(views.features['w-tide-2'].stopped, undefined, 'a wait for a build command still holds the slot');
  assert.equal(views.features['w-tide-3'].stopped, undefined);
});
