// tests/scripts/watcher/recover.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecovery, recoverable } from '../../../scripts/watcher/recover.js';
import { withHome } from '../../helpers/homes.js';

const w = (key, data, approved) => ({ key, work: { key, at: '2026-11-03T00:00:00Z', data: { id: key, lane: 'small', ...data } }, approved });
const views = (over = {}) => ({
  work: { a: w('a', {}, true), b: w('b', {}, false), c: w('c', { dependsOn: ['z'] }, true) },
  features: {}, reports: {}, incidents: { open: [] }, settings: {}, ...over,
});

test('approved, unstarted work is recovered; unapproved and dependent work is not', () => {
  assert.deepEqual(recoverable(views(), { stopped: () => false }), ['a']);
});

test('work with a feature, or anything under stop or an incident, is not recovered', () => {
  assert.deepEqual(recoverable(views({ features: { a: { key: 'a', at: 'x', data: { step: 'building' } } } }), { stopped: () => false }), []);
  assert.deepEqual(recoverable(views(), { stopped: () => true }), []);
  assert.deepEqual(recoverable(views({ incidents: { open: [{ id: 'i1' }] } }), { stopped: () => false }), []);
});

// The recovery keeps its time in the watcher's folder, so these run in a home of their own.
test('recovery raises work-ready at once, then only after its time, and not the same work again soon', () => withHome(async () => {
  let t = Date.parse('2026-11-05T09:00:00Z');
  const client = { state: { views: async () => ({ ok: true, views: views() }) } };
  const r = makeRecovery({ project: 'o__p', client, now: () => new Date(t), stopped: () => false });
  const first = await r.check();
  assert.equal(first.length, 1);
  assert.equal(first[0].type, 'work-ready');
  assert.equal(first[0].work, 'a');
  assert.deepEqual(await r.check(), [], 'debounced');
  t += 11 * 60 * 1000;
  assert.deepEqual(await r.check(), [], 'raised again no sooner than half an hour');
  t += 25 * 60 * 1000;
  assert.equal((await r.check()).length, 1);
}));

test('recovery gives nothing when the views can not be had', () => withHome(async () => {
  const r = makeRecovery({ project: 'o__p', client: { state: { views: async () => { throw new Error('no helper'); } } } });
  assert.deepEqual(await r.check(), []);
}));

test('work approved long enough ago that still has not started is recorded as lost, once', () => withHome(async () => {
  let t = Date.parse('2026-11-05T09:00:00Z');
  const old = views({ work: { a: { ...w('a', {}, true), since: '2026-11-05T08:00:00Z' }, d: { ...w('d', {}, true), since: '2026-11-05T08:59:00Z' } } });
  const client = { state: { views: async () => ({ ok: true, views: old }) } };
  const recorded = [];
  const r = makeRecovery({ project: 'o__p', client, now: () => new Date(t), stopped: () => false, record: (i) => recorded.push(i) });
  assert.equal((await r.check()).length, 2);
  assert.deepEqual(recorded.map((i) => [i.kind, i.work]), [['lost', 'a']], 'd was approved a minute ago, so it is not lost yet');
  t += 40 * 60 * 1000;
  await r.check();
  assert.equal(new Set(recorded.map((i) => i.key)).size, 2, 'both are lost by now, each with its own key');
}));
