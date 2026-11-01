// tests/scripts/desk/watch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotOf, encodeCursor, decodeCursor, changes } from '../../../scripts/desk/watch.js';

const card = (id, question = `Question ${id}?`) => ({ id, at: '2026-10-29T09:00:00.000Z', data: { question, title: question } });
const state = (over = {}) => snapshotOf({
  glance: 'Wheelhouse: 1 waiting', waiting: [card('c1')], work: { 'export-csv': 'building' }, stop: null, notices: [], ...over,
});
const kinds = (got) => got.events.map((e) => e.type);

test('a new card gives card-added', () => {
  const { cursor } = changes(null, state());
  const got = changes(cursor, state({ waiting: [card('c1'), card('c2')] }));
  assert.deepEqual(kinds(got), ['card-added']);
  assert.equal(got.events[0].card, 'c2');
  assert.deepEqual(got.events[0].lines, ['Question c2?']);
});

test('a closed card gives card-closed', () => {
  const { cursor } = changes(null, state());
  assert.deepEqual(changes(cursor, state({ waiting: [] })).events, [{ type: 'card-closed', card: 'c1' }]);
});

test('a card whose text changed gives card-closed then card-added', () => {
  const { cursor } = changes(null, state());
  const got = changes(cursor, state({ waiting: [card('c1', 'A new question?')] }));
  assert.deepEqual(kinds(got), ['card-closed', 'card-added']);
});

test('STOP turning on gives all-stop with its time', () => {
  const { cursor } = changes(null, state());
  const got = changes(cursor, state({ stop: '2026-10-29T10:00:00.000Z' }));
  assert.deepEqual(got.events, [{ type: 'all-stop', on: true, at: '2026-10-29T10:00:00.000Z' }]);
  assert.deepEqual(changes(got.cursor, state()).events, [{ type: 'all-stop', on: false, at: null }]);
});

test('the glance, work and notices give their events', () => {
  const { cursor } = changes(null, state());
  const got = changes(cursor, state({ glance: 'Wheelhouse: nothing waiting', work: { 'export-csv': 'queued' }, notices: [{ id: 'incident:bad-total', lines: ['An incident is open'] }] }));
  assert.deepEqual(kinds(got), ['glance-changed', 'work-changed', 'notice']);
  assert.equal(got.events[2].id, 'incident:bad-total');
});

test('the same snapshot twice gives no events', () => {
  const { cursor } = changes(null, state());
  const got = changes(cursor, state());
  assert.deepEqual(got.events, []);
  assert.equal(got.cursor, cursor);
});

test('a damaged cursor gives the whole state as events', () => {
  assert.equal(decodeCursor('not base64 json'), null);
  const whole = changes(null, state({ stop: '2026-10-29T10:00:00.000Z' }));
  assert.deepEqual(changes('not base64 json', state({ stop: '2026-10-29T10:00:00.000Z' })).events, whole.events);
  assert.deepEqual(kinds(whole), ['card-added', 'glance-changed', 'work-changed', 'all-stop']);
});

test('a cursor from another version gives the whole state as events', () => {
  const other = Buffer.from(JSON.stringify({ v: 'desk/0', cards: {} })).toString('base64url');
  assert.equal(decodeCursor(other), null);
  assert.deepEqual(changes(other, state()).events, changes(null, state()).events);
  assert.equal(decodeCursor(encodeCursor(state())).v, 'desk/1');
});

test('the core\'s watch reads the source and gives card-added for a new card, then nothing for the same cursor', async () => {
  const { deskCore } = await import('../../../scripts/desk/core.js');
  let waiting = [card('c1')];
  const source = {
    project: 'p',
    async views() { return { ok: true, views: { waiting, work: {} } }; },
    async board() { return { none: 'no board here' }; },
    async stop() { return { on: false }; },
  };
  const core = deskCore({ source, recorder: {} });
  const first = await core.watch(null);
  assert.equal(first.ok, true);
  assert.deepEqual(first.events.filter((e) => e.type === 'card-added').map((e) => e.card), ['c1']);
  waiting = [card('c1'), card('c2')];
  const second = await core.watch(first.cursor);
  assert.deepEqual(second.events.map((e) => [e.type, e.card]), [['card-added', 'c2']]);
  assert.deepEqual((await core.watch(second.cursor)).events, []);
});

const running = (over = {}) => ({ id: 'orders-export', hash: 'h1', sheet: { title: 'Orders', until: '2026-10-30T00:00:00.000Z' }, state: 'running', ...over });

test('a goal starting, being narrowed, ending and ending for good give goal-changed', () => {
  const { cursor } = changes(null, state());
  const started = changes(cursor, state({ goal: running() }));
  assert.deepEqual(started.events, [{ type: 'goal-changed', goal: 'orders-export' }]);
  const narrowed = changes(started.cursor, state({ goal: running({ sheet: { title: 'Orders', until: '2026-10-29T20:00:00.000Z' } }) }));
  assert.deepEqual(narrowed.events, [{ type: 'goal-changed', goal: 'orders-export' }]);
  const asked = changes(narrowed.cursor, state({ goal: running({ sheet: { title: 'Orders', until: '2026-10-29T20:00:00.000Z' }, endAsked: { now: true } }) }));
  assert.deepEqual(asked.events, [{ type: 'goal-changed', goal: 'orders-export' }]);
  const ended = changes(asked.cursor, state());
  assert.deepEqual(ended.events, [{ type: 'goal-changed', goal: null }]);
  assert.deepEqual(changes(ended.cursor, state()).events, []);
  assert.deepEqual(changes(started.cursor, state({ goal: running() })).events, []);
});

test('a cursor made before goals existed stays readable, and reads as no goal', () => {
  const older = Buffer.from(JSON.stringify({ v: 'desk/1', glance: 'x', cards: {}, work: {}, stop: null, notices: [] })).toString('base64url');
  assert.notEqual(decodeCursor(older), null);
  assert.equal(decodeCursor(older).goal, null);
  assert.deepEqual(changes(older, state({ glance: 'x', waiting: [], work: {} })).events.map((e) => e.type).filter((t) => t === 'goal-changed'), []);
  assert.deepEqual(changes(older, state({ goal: running() })).events.filter((e) => e.type === 'goal-changed'), [{ type: 'goal-changed', goal: 'orders-export' }]);
});

test('the core\'s watch passes the goal in force from the source', async () => {
  const { deskCore } = await import('../../../scripts/desk/core.js');
  let goals = {};
  const source = {
    project: 'p',
    async views() { return { ok: true, views: { waiting: [], work: {}, goals } }; },
    async board() { return { none: 'no board here' }; },
    async stop() { return { on: false }; },
  };
  const core = deskCore({ source, recorder: {} });
  const first = await core.watch(null);
  assert.equal(first.events.some((e) => e.type === 'goal-changed'), false);
  goals = { 'orders-export': { sheet: { title: 'Orders', until: '2026-10-30T00:00:00.000Z' }, hash: 'h', startedAt: '2026-10-29T10:00:00.000Z', ended: null, endAsked: null } };
  const second = await core.watch(first.cursor);
  assert.deepEqual(second.events, [{ type: 'goal-changed', goal: 'orders-export' }]);
  goals = { 'orders-export': { ...goals['orders-export'], ended: { ending: 'done', at: '2026-10-29T11:00:00.000Z', spent: {} } } };
  assert.deepEqual((await core.watch(second.cursor)).events, [{ type: 'goal-changed', goal: null }]);
});
