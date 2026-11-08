// tests/scripts/foreman/queue-pace.test.js
// The pace setting (one, two or three at once) holds the queue's building slots, in the queue itself and in the foreman's
// own reading of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextWork } from '../../../scripts/foreman/queue.js';
import { queueToStart } from '../../../scripts/foreman/wake.js';
import { PACE, paceOf } from '../../../scripts/lib/build-loop.js';

const T = (n) => `2026-11-08T02:00:${String(n).padStart(2, '0')}.000Z`;
const NOW = '2026-11-08T05:00:00.000Z';
const workOf = (id, n) => ({ work: { key: id, at: T(n), data: { lane: 'small' } }, approved: true, since: T(n) });

// Six approved pieces of small work, none started.
function sixWaiting() {
  const work = {};
  for (let i = 1; i <= 6; i += 1) work[`w-tide-${i}`] = workOf(`w-tide-${i}`, i);
  return work;
}

// Starts pieces one at a time, as the script does, and says how many were allowed to build. With `pace` null the queue reads the
// pace from the views' settings, as the foreman's does.
function buildUp(pace, settings = {}) {
  const work = sixWaiting();
  const features = {};
  for (let guard = 0; guard < 10; guard += 1) {
    const q = pace === null
      ? queueToStart({ work, features, reports: {}, incidents: { open: [] }, settings }, { now: NOW })
      : nextWork({ work, features, reports: {}, now: NOW, fiveHourTight: false, pace });
    const next = q.start[0];
    if (next === undefined) break;
    features[next] = { key: next, at: T(30), data: { step: 'building', lane: 'small' } };
  }
  return Object.keys(features).length;
}

test('pace 3 keeps at most three pieces building', () => {
  assert.equal(buildUp(paceOf({ pace: 3 })), 3);
});

test('pace 1 keeps one', () => {
  assert.equal(buildUp(paceOf({ pace: 1 })), 1);
});

test('pace 2 keeps two, and the effective-settings shape is read as well as the plain one', () => {
  assert.equal(buildUp(paceOf({ pace: { value: 2 } })), 2);
});

test('with no pace set, or one that is not 1, 2 or 3, three build', () => {
  assert.equal(buildUp(paceOf({})), PACE.building);
  assert.equal(buildUp(paceOf({ pace: 9 })), PACE.building);
});

test('the foreman\'s queue reads the pace from the views\' settings', () => {
  assert.equal(buildUp(null, { pace: 1 }), 1);
  assert.equal(buildUp(null, { pace: { value: 2 } }), 2);
  assert.equal(buildUp(null, {}), 3);
});

test('the builder cap still never raises pace', () => {
  const got = nextWork({ work: sixWaiting(), features: {}, reports: {}, now: NOW, fiveHourTight: false, pace: paceOf({ pace: 1 }), builderCap: 3 });
  assert.deepEqual(got.start, ['w-tide-1']);
});
