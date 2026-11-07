// tests/scripts/foreman/queue-slots.test.js
// A piece that asked keeps its slot; only one that has reached a step it can't undo and said so (wait-for) gives it up
// (design section 6.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextWork } from '../../../scripts/foreman/queue.js';
import { markStopped } from '../../../scripts/foreman/wake.js';
import { PACE } from '../../../scripts/lib/build-loop.js';
import { featurePaths } from '../../../scripts/feature/files.js';
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

test('wait-for marks a piece, at any step, whose questions file says it waits on a decision the director has not answered', () => {
  const dirs = Object.fromEntries(['w-tide-1', 'w-tide-2', 'w-tide-3', 'w-tide-4', 'w-tide-5'].map((w) => [w, fs.realpathSync.native(tempFolder('wh-stopped-'))]));
  const lines = {
    'w-tide-1': [{ waitFor: 'q-w-tide-1-1', at: T(1) }],
    'w-tide-2': [{ what: 'asked, not waiting' }],
    'w-tide-3': [{ waitFor: 'q-w-tide-3-1', at: T(1) }],
    'w-tide-4': [{ waitFor: 'q-w-tide-4-1', at: T(1) }],
    'w-tide-5': [{ waitFor: 'q-w-tide-5-1', at: T(1) }],
  };
  for (const [work, dir] of Object.entries(dirs)) {
    fs.mkdirSync(featurePaths(dir).dir, { recursive: true });
    fs.writeFileSync(featurePaths(dir).questions, `${lines[work].map((l) => JSON.stringify(l)).join('\n')}\n`);
  }
  const features = {
    'w-tide-1': building('w-tide-1', 1),
    'w-tide-2': building('w-tide-2', 2),
    // A piece still at the started step waits the same way.
    'w-tide-3': { key: 'w-tide-3', at: T(3), data: { step: 'started', lane: 'small' } },
    'w-tide-4': building('w-tide-4', 4),
    'w-tide-5': { key: 'w-tide-5', at: T(5), data: { step: 'closed' } },
  };
  // w-tide-4's question is answered: it builds on.
  const views = { features, questions: { 'q-w-tide-1-1': { answer: null }, 'q-w-tide-4-1': { answer: { label: 'Daily', at: T(9) } } } };
  markStopped(views, (work) => {
    if (!dirs[work]) throw new Error('none');
    return dirs[work];
  });
  assert.equal(features['w-tide-1'].stopped, true, 'an open decision it waits on');
  assert.equal(features['w-tide-2'].stopped, undefined, 'only asked: it keeps its slot');
  assert.equal(features['w-tide-3'].stopped, true, 'a piece at the started step, a question the view has no answer for');
  assert.equal(features['w-tide-4'].stopped, undefined, 'answered: it builds on');
  assert.equal(features['w-tide-5'].stopped, undefined, 'a closed piece is never marked');
});
