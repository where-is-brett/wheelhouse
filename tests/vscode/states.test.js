// tests/vscode/states.test.js
// The panel's states: no helper, update, unpaired, pairing, live and stopped; and the signed watch loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDesk, start, settle, require } from './helpers.js';

const { WATCH_MS } = require('../../vscode/extension.cjs');
const modelOf = (view) => JSON.parse(view.html);
const acts = (desk, command) => desk.calls.filter((c) => c[0] === 'act' && c[1] === command);

test('an unpaired add-on asks to pair once and shows the fingerprint the card shows', async () => {
  const desk = fakeDesk({ paired: false });
  const { view, every, add, vscode } = await start({ desk });
  assert.equal(acts(desk, 'pair').length, 1);
  const [, , args] = acts(desk, 'pair')[0];
  assert.equal(args.client.id, add.key.client);
  assert.equal(args.client.publicKey, add.key.publicKey);
  assert.equal(modelOf(view).state, 'pairing');
  assert.equal(modelOf(view).fingerprint, 'abc123abc123');
  assert.equal(vscode.seen.items[0].text, 'Wheelhouse · pairing');
  await every.run();
  await settle();
  assert.equal(acts(desk, 'pair').length, 1, 'it does not ask again while it waits');
  assert.equal(modelOf(view).state, 'pairing');
});

test('once the director has paired it, the panel goes live and reads the desk', async () => {
  const desk = fakeDesk({ paired: false });
  desk.state.views = { waiting: { numbered: [{ n: 1 }, { n: 2 }] }, glance: { glance: 'Two cards wait' }, work: {} };
  const { view, every, vscode } = await start({ desk });
  desk.state.paired = true;
  await every.run();
  await settle();
  assert.equal(modelOf(view).state, 'live');
  assert.equal(modelOf(view).count, 2);
  assert.equal(vscode.seen.items[0].text, 'Wheelhouse · 2 need you');
});

test('after an Unpair the panel says it is unpaired and does not ask again by itself', async () => {
  const desk = fakeDesk();
  const { view, every } = await start({ desk });
  assert.equal(modelOf(view).state, 'live');
  desk.state.paired = false;
  await every.run();
  await settle();
  assert.equal(modelOf(view).state, 'unpaired');
  assert.equal(acts(desk, 'pair').length, 0);
});

test('while paired and visible it watches every 10 seconds, signed', async () => {
  const desk = fakeDesk();
  const { every } = await start({ desk });
  assert.equal(every.timers.length, 1);
  assert.equal(every.timers[0].ms, WATCH_MS);
  assert.equal(WATCH_MS, 10000);
  const before = desk.calls.filter((c) => c[0] === 'watch').length;
  await every.run();
  await settle();
  const watches = desk.calls.filter((c) => c[0] === 'watch');
  assert.equal(watches.length, before + 1);
  assert.equal(watches.at(-1)[1], 'k1', 'the last cursor goes back');
});

test('when hidden it stops watching, so the panel stops being live; showing it starts again', async () => {
  const desk = fakeDesk();
  const { every, view } = await start({ desk });
  view.show(false);
  assert.equal(every.timers[0].live, false);
  const n = desk.calls.length;
  await every.run();
  await settle();
  assert.equal(desk.calls.length, n);
  view.show(true);
  await settle();
  assert.equal(every.timers.length, 2);
  assert.equal(every.timers[1].live, true);
  view.dispose();
  assert.equal(every.timers[1].live, false);
});

test('a panel that starts hidden does not watch', async () => {
  const desk = fakeDesk();
  const { every } = await start({ desk, visible: false });
  assert.equal(every.timers.length, 0);
  assert.equal(desk.calls.length, 0);
});

test('with no helper it says so and starts nothing', async () => {
  const desk = fakeDesk({ helper: 'down' });
  const { view, vscode } = await start({ desk });
  assert.equal(modelOf(view).state, 'no-helper');
  assert.match(modelOf(view).says, /isn't running/);
  assert.equal(vscode.seen.items[0].text, 'Wheelhouse · not running');
  assert.deepEqual(desk.calls.filter((c) => c[0] === 'act' && c[1] !== 'answer'), []);
});

test('a folder that is not a Wheelhouse project is said so, and nothing is sent', async () => {
  const desk = fakeDesk();
  const { view } = await start({ desk, project: null });
  assert.equal(modelOf(view).state, 'no-helper');
  assert.match(modelOf(view).says, /isn't a Wheelhouse project/);
  assert.equal(desk.calls.length, 0);
});

test('on another desk version it shows Update Wheelhouse and decides nothing', async () => {
  const desk = fakeDesk({ helper: 'update' });
  const { view, vscode } = await start({ desk });
  assert.equal(modelOf(view).state, 'update');
  assert.match(modelOf(view).says, /Update Wheelhouse/);
  assert.equal(vscode.seen.items[0].text, 'Wheelhouse · update');
  const acted = desk.calls.filter((c) => c[0] === 'act');
  assert.deepEqual(acted.map((c) => c[1]), ['answer'], 'only the pairing check, which decides nothing');
  assert.equal(acted[0][2].card, 'wheelhouse-pair-check');
});

test('All stop on draws the stopped state, and off draws live', async () => {
  const desk = fakeDesk();
  desk.state.events = [{ type: 'all-stop', on: true, at: 'x' }];
  const { view, every } = await start({ desk });
  assert.equal(modelOf(view).state, 'stopped');
  desk.state.events = [{ type: 'all-stop', on: false, at: null }];
  desk.state.cursor = 'k2';
  await every.run();
  await settle();
  assert.equal(modelOf(view).state, 'live');
});
