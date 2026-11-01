// tests/scripts/engine/stuck.test.js
// What stands behind a project where nothing can run (delegated decisions design, section 8.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topCard, holdsUpCount, noCardBehind } from '../../../scripts/engine/stuck.js';
import { needsYou, PRESENCE_LETS } from '../../../scripts/mod/courier.js';
import { importanceOf, IMPORTANCE, cardsForVisit } from '../../../scripts/cards/visit.js';
import { wayBack, asking, forever } from '../../helpers/way-back.js';

const card = (id, work, rank = 3) => ({ id, work, rank });

test('with nothing running and nothing able to start, the highest card behind a hold rises', () => {
  const hold = [{ work: 'x', why: 'clash', by: ['a', 'b'] }];
  const got = topCard({ hold, running: [], cards: [card('q-a-1', 'a'), card('q-b-1', 'b', 4)] });
  assert.equal(got.card.id, 'q-b-1');
  assert.equal(got.holdsUp, 1);
});

test('it follows parked, clash and dependency back to the card behind', () => {
  const hold = [{ work: 'x', why: 'dependency', by: ['y'] }, { work: 'y', why: 'clash', by: ['z'] }, { work: 'w', why: 'parked', by: ['z'] }];
  const got = topCard({ hold, running: [], cards: [card('q-z-1', 'z')] });
  assert.equal(got.card.id, 'q-z-1');
  assert.equal(got.holdsUp, 3);
});

test('of cards alike in rank, the one holding up most rises, then the oldest', () => {
  const hold = [{ work: 'x', why: 'clash', by: ['a'] }, { work: 'y', why: 'clash', by: ['b'] }, { work: 'z', why: 'clash', by: ['b'] }];
  assert.equal(topCard({ hold, running: [], cards: [card('q-a-1', 'a'), card('q-b-1', 'b')] }).card.id, 'q-b-1');
  assert.equal(topCard({ hold: hold.slice(0, 1).concat({ work: 'y', why: 'clash', by: ['c'] }), running: [], cards: [card('q-a-1', 'a'), card('q-c-1', 'c')] }).card.id, 'q-a-1');
});

test('with anything running there is no top card', () => {
  assert.equal(topCard({ hold: [{ work: 'x', why: 'clash', by: ['a'] }], running: ['r'], cards: [card('q-a-1', 'a')] }), null);
});

test('a hold of its own reason is not followed, and a loop of holds ends', () => {
  assert.equal(topCard({ hold: [{ work: 'x', why: 'unapproved', by: ['a'] }, { work: 'y', why: 'clash', by: ['b'] }], running: [], cards: [card('q-a-1', 'a')] }).holdsUp, 0);
  assert.deepEqual(holdsUpCount({ hold: [{ work: 'x', why: 'dependency', by: ['y'] }, { work: 'y', why: 'dependency', by: ['x'] }] }), { x: 1, y: 1 });
});

test('with pieces only waiting on the director, nothing held, the highest card still rises', () => {
  const got = topCard({ hold: [], running: [], cards: [card('q-a-1', 'a'), card('q-b-1', 'b', 4)] });
  assert.equal(got.card.id, 'q-b-1');
  assert.equal(got.holdsUp, 0);
  assert.equal(topCard({ hold: [], running: [], cards: [] }), null);
});

test('a card holding up others says how many', () => {
  assert.deepEqual(holdsUpCount({ hold: [{ work: 'x', why: 'dependency', by: ['y'] }, { work: 'y', why: 'clash', by: ['z'] }] }), { y: 1, z: 2 });
  assert.deepEqual(holdsUpCount({ hold: [{ work: 'x', why: 'pace' }] }), {});
});

test('a hold names no card only when nothing behind it moves', () => {
  const hold = [{ work: 'x', why: 'clash', by: ['gone'] }, { work: 'y', why: 'clash', by: ['r'] }, { work: 'z', why: 'clash', by: ['a'] }, { work: 'w', why: 'dependency', by: ['q'] }, { work: 'q', why: 'unapproved' }];
  assert.deepEqual(noCardBehind({ hold, running: ['r'], cards: [card('q-a-1', 'a')] }).map((h) => h.work), ['x']);
});

test('the top card ranks as holding up all work, and passes Away', () => {
  const views = { questions: {}, cardsWaiting: { count: 0, ids: [], pulled: [], top: { id: 'q-a-1', holdsUp: 2 } } };
  const asCard = { id: 'c', at: 't', data: { kind: 'answer', level: 3, line: 'Answer question q-a-1', question: 'x', options: [] } };
  assert.equal(importanceOf(asCard, views), IMPORTANCE.HOLDS_UP_ALL);
  assert.equal(importanceOf({ data: { ...asCard.data, line: 'Answer question q-b-1' } }, views), IMPORTANCE.LEVEL_3);
  assert.equal(importanceOf({ data: { ...asCard.data, level: 4 } }, views), IMPORTANCE.LEVEL_4, 'it never lowers a card');
  assert.equal(cardsForVisit({ ...views, waiting: [{ ...asCard, asked: null }] }).ids[0], 'c');
  const [item] = needsYou({ after: { cards: [{ id: 'c', n: 1, blocking: true }] } });
  assert.equal(PRESENCE_LETS.away(item), true);
});

const clashing = (settings = {}) => {
  const w = wayBack({ recordings: { a: asking('qa'), b: asking('qb', { level: 4 }), c: forever() }, settings: { pace: 2, ...settings } });
  w.put('a', { files: ['one.js'], place: 0 });
  w.put('b', { files: ['two.js'], place: 1 });
  w.put('c', { files: ['one.js', 'two.js'], place: 2 });
  return w;
};
const tops = (w) => w.written.filter((x) => x.kind === 'note' && x.data.about === 'top-card').map((x) => x.data);

test('it is worked out on every tick, not only when a card is written', async () => {
  const w = clashing();
  await w.tick(3);
  assert.equal(tops(w).length, 1);
  assert.equal(tops(w)[0].id, w.cardOf('b').id, 'level 4 stands highest');
  assert.equal(tops(w)[0].holdsUp, 1);
  await w.tick(2);
  assert.equal(tops(w).length, 1, 'written when the answer changes');
  w.answer('b', 'Keep it small');
  w.answer('a', 'Keep it small');
  await w.tick(2);
  assert.equal(tops(w).at(-1).id, null, 'gone once work runs');
});

test('it ignores the budget', async () => {
  const w = clashing({ cardsPerDay: 0 });
  await w.tick(3);
  const id = tops(w).at(-1)?.id;
  assert.ok(id);
  assert.equal(w.views().cardsWaiting.ids.includes(id), false);
  await w.tick(2);
  assert.equal(w.views().cardsWaiting.ids.includes(id), false, 'the router lets it go, as a pull');
  assert.equal(w.views().cardsWaiting.top.id, id);
});

test('nothing rises under All stop', async () => {
  const w = clashing();
  await w.tick(3);
  w.stop = true;
  await w.tick();
  assert.equal(tops(w).at(-1).id, null);
});

test('a hold with no card behind it says so on the Logbook, once', async () => {
  const w = wayBack({ recordings: { a: asking('qa', { pr: 7 }), c: forever() } });
  w.put('a', { files: ['one.js'], place: 0 });
  await w.tick(2);
  w.answer('a', 'Keep it small');
  await w.tick(3);
  assert.equal(w.stateOf('a'), 'ended');
  w.put('c', { files: ['one.js'], place: 1 });
  await w.tick(4);
  assert.deepEqual(w.starts.map((s) => s.order.work), ['a'], 'its pull request is open, so its files stay held');
  const said = w.notes().filter((n) => /no card stands behind/.test(n));
  assert.equal(said.length, 1);
  assert.match(said[0], /^c waits for the files a keeps/);
});

test('a pull request ready on a piece waiting on its card keeps no top card down', async () => {
  const w = wayBack({ recordings: { a: asking('qa'), b: asking('qb', { pr: 7 }) }, settings: { cardsPerDay: 1 } });
  w.put('a', { place: 0 });
  w.put('b', { place: 1 });
  await w.tick(3);
  assert.ok(tops(w).at(-1)?.id);
  w.ready[7] = { work: 'b', head: 'a'.repeat(40) };
  await w.tick(3);
  assert.ok(tops(w).at(-1).id, 'its piece is waiting on the director all the same');
});

test('a start refused keeps no top card down', async () => {
  const w = wayBack({ recordings: { a: asking('qa'), f: forever() } });
  w.put('a', { place: 0 });
  await w.tick(3);
  const { id } = tops(w).at(-1);
  w.refuse = () => 'it names no document';
  w.put('f', { place: 1 });
  await w.tick(2);
  assert.equal(tops(w).at(-1).id, id);
});
