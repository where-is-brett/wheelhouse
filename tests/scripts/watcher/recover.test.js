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

test('a piece that waited for a dependency, was freed and then raised is not lost', () => withHome(async () => {
  let t = Date.parse('2026-11-05T09:00:00Z');
  const current = { v: views({ work: { c: { ...w('c', { dependsOn: ['z'] }, true), since: '2026-11-01T08:00:00Z' } } }) };
  const client = { state: { views: async () => ({ ok: true, views: current.v }) } };
  const recorded = [];
  const r = makeRecovery({ project: 'o__p', client, now: () => new Date(t), stopped: () => false, record: (i) => recorded.push(i) });
  assert.deepEqual(await r.check(), [], 'held for its dependency');
  t += 3 * 24 * 60 * 60 * 1000;
  current.v = views({ work: { c: { ...w('c', {}, true), since: '2026-11-01T08:00:00Z' } }, reports: { z: { data: { outcome: 'merged' } } } });
  assert.equal((await r.check()).length, 1, 'freed, so raised');
  assert.deepEqual(recorded, [], 'it was queued for days, but nothing was lost');
}));

const MIN = 60 * 1000;

test('a piece that stays unstarted is recorded as lost once, however many times it is raised again', () => withHome(async () => {
  let t = Date.parse('2026-11-05T09:00:00Z');
  const client = { state: { views: async () => ({ ok: true, views: views() }) } };
  const recorded = [];
  const r = makeRecovery({ project: 'o__p', client, now: () => new Date(t), stopped: () => false, record: (i) => recorded.push(i) });
  await r.check();
  assert.deepEqual(recorded, [], 'the first raise is not a loss');
  for (let i = 0; i < 14; i += 1) {
    t += 11 * MIN;
    await r.check();
  }
  assert.deepEqual(recorded.map((i) => [i.kind, i.work]), [['lost', 'a']]);
}));

test('a piece that stops waiting to start has its raise forgotten, so queuing it again is not a loss', () => withHome(async () => {
  let t = Date.parse('2026-11-05T09:00:00Z');
  const current = { v: views() };
  const client = { state: { views: async () => ({ ok: true, views: current.v }) } };
  const recorded = [];
  const r = makeRecovery({ project: 'o__p', client, now: () => new Date(t), stopped: () => false, record: (i) => recorded.push(i) });
  assert.equal((await r.check()).length, 1);
  t += 25 * MIN;
  current.v = views({ work: { a: w('a', { dependsOn: ['z'] }, true) } });
  assert.deepEqual(await r.check(), [], 'held for a dependency');
  t += 25 * MIN;
  current.v = views();
  assert.equal((await r.check()).length, 1, 'raised afresh');
  assert.deepEqual(recorded, [], 'fifty minutes after the first raise, but only just raised again');
}));

test('after downtime or a long sleep the raise clock starts again, so the wait is not counted as a loss', () => withHome(async () => {
  let t = Date.parse('2026-11-05T09:00:00Z');
  const client = { state: { views: async () => ({ ok: true, views: views() }) } };
  const recorded = [];
  const r = makeRecovery({ project: 'o__p', client, now: () => new Date(t), stopped: () => false, record: (i) => recorded.push(i) });
  await r.check();
  t += 3 * 60 * MIN;
  assert.equal((await r.check()).length, 1, 'raised again after the gap');
  assert.deepEqual(recorded, [], 'the gap was the watcher\'s, not the engine\'s');
  for (let i = 0; i < 3; i += 1) {
    t += 11 * MIN;
    await r.check();
  }
  assert.deepEqual(recorded.map((i) => i.kind), ['lost'], 'but a piece still unstarted half an hour into a run that stayed up is lost');
}));

test('a piece that leaves the queue and comes back can be lost again', () => withHome(async () => {
  let t = Date.parse('2026-11-05T09:00:00Z');
  const current = { v: views() };
  const client = { state: { views: async () => ({ ok: true, views: current.v }) } };
  const recorded = [];
  const r = makeRecovery({ project: 'o__p', client, now: () => new Date(t), stopped: () => false, record: (i) => recorded.push(i) });
  const steps = async (n) => { for (let i = 0; i < n; i += 1) { t += 11 * MIN; await r.check(); } };
  await r.check();
  await steps(3);
  assert.equal(recorded.length, 1, 'lost the first time');
  current.v = views({ work: { a: w('a', { dependsOn: ['z'] }, true) } });
  await steps(1);
  current.v = views();
  await steps(4);
  assert.equal(recorded.length, 2, 'and again, once it has been back in the queue half an hour');
  assert.equal(new Set(recorded.map((i) => i.key)).size, 2);
}));
