// tests/vscode/states.test.js
// The panel's states: no helper, update, unpaired, pairing, live and stopped; and the signed watch loop.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fakeDesk, fakeContext, waitingView, start, settle, require } from './helpers.js';
import { canonicalJson } from '../../scripts/lib/canonical.js';
import { shortHome, testAddress } from '../helpers/homes.js';

const { WATCH_MS } = require('../../vscode/extension.cjs');
const modelOf = (view) => JSON.parse(view.html);
const acts = (desk, command) => desk.calls.filter((c) => c[0] === 'act' && c[1] === command);

const servers = [];
after(() => { for (const s of servers) s.close(); });

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
  desk.state.views = { waiting: waitingView([{ id: 'c1', data: { question: 'Q1', options: ['Approve'] } }, { id: 'merge-12', data: { question: 'Q2', kind: 'approval' } }]), glance: { glance: 'Two cards wait' }, work: {} };
  const { view, every, vscode } = await start({ desk });
  desk.state.paired = true;
  await every.run();
  await settle();
  assert.equal(modelOf(view).state, 'live');
  assert.equal(modelOf(view).cards.length, 2);
  assert.equal(modelOf(view).project, 'name');
  assert.equal(vscode.seen.items[0].text, 'Wheelhouse · 2 need you');
});

test('a card that has been answered is neither drawn nor counted', async () => {
  const desk = fakeDesk();
  const answered = { id: 'old', data: { question: 'Done?', options: ['Approve'] } };
  desk.state.views = { waiting: waitingView([{ id: 'c1', data: { question: 'Q1', options: ['Approve'] } }], [answered]), glance: {}, work: {} };
  const { view, vscode } = await start({ desk });
  assert.deepEqual(modelOf(view).cards.map((c) => c.id), ['c1']);
  assert.equal(vscode.seen.items[0].text, 'Wheelhouse · 1 needs you');
});

test('after an Unpair it asks to pair again once, and not again while that waits', async () => {
  const desk = fakeDesk();
  const { view, every } = await start({ desk });
  assert.equal(modelOf(view).state, 'live');
  desk.state.paired = false;
  await every.run();
  await settle();
  assert.equal(acts(desk, 'pair').length, 1);
  assert.equal(modelOf(view).state, 'pairing');
  await every.run();
  await settle();
  assert.equal(acts(desk, 'pair').length, 1);
});

test('a refused ask shows unpaired, and asks again only after the helper has gone and come back', async () => {
  const desk = fakeDesk({ paired: false });
  desk.state.pairRefused = true;
  const { view, every } = await start({ desk });
  assert.equal(modelOf(view).state, 'unpaired');
  await every.run();
  await settle();
  assert.equal(acts(desk, 'pair').length, 1);
  desk.state.helper = 'down';
  await every.run();
  await settle();
  assert.equal(modelOf(view).state, 'no-helper');
  desk.state.helper = 'up';
  await every.run();
  await settle();
  assert.equal(acts(desk, 'pair').length, 2);
});

test('a watch answer that does not say whether it is paired keeps the last state and sends nothing', async () => {
  const desk = fakeDesk();
  desk.state.paired = undefined;
  const { view, every } = await start({ desk });
  assert.equal(modelOf(view).state, 'no-helper');
  await every.run();
  await settle();
  assert.deepEqual([...new Set(desk.calls.map((c) => c[0]))], ['watch']);
  desk.state.paired = true;
  await every.run();
  await settle();
  assert.equal(modelOf(view).state, 'live');
  desk.state.paired = undefined;
  await every.run();
  await settle();
  assert.equal(modelOf(view).state, 'live', 'the last state stays');
  assert.equal(acts(desk, 'pair').length, 0);
});

test('while paired and visible it watches every 10 seconds, signed with the key', async () => {
  const home = shortHome();
  const address = testAddress(home);
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      seen.push({ route: req.url, body });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, v: 'desk/1', paired: true, events: [], cursor: 'k1', data: {} }));
    });
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(address, resolve));
  const { every, add } = await start({ address });
  assert.equal(every.timers.length, 1);
  assert.equal(every.timers[0].ms, WATCH_MS);
  assert.equal(WATCH_MS, 10000);
  // The first look finishes (its watch and three reads) before the next tick, which a busy look would skip.
  for (let i = 0; i < 100 && seen.length < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await every.run();
  for (let i = 0; i < 100 && seen.filter((s) => s.route === '/desk/watch').length < 2; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  const watches = seen.filter((s) => s.route === '/desk/watch');
  assert.ok(watches.length >= 2);
  assert.equal(watches.at(-1).body.cursor, 'k1', 'the last cursor goes back');
  const publicKey = crypto.createPublicKey({ key: Buffer.from(add.key.publicKey, 'base64'), format: 'der', type: 'spki' });
  for (const { body } of watches) {
    assert.equal(body.evidence.client, add.key.client);
    const text = canonicalJson({ command: 'watch', args: { cursor: body.cursor }, at: body.evidence.at, project: 'owner__name' });
    assert.equal(crypto.verify(null, Buffer.from(text), publicKey, Buffer.from(body.evidence.sig, 'base64')), true);
  }
});

test('when hidden it stops watching and shows no count; showing it starts again', async () => {
  const desk = fakeDesk();
  desk.state.views = { waiting: waitingView([{ id: 'c1', data: { question: 'Q1' } }]), glance: {}, work: {} };
  const { every, view, vscode } = await start({ desk });
  assert.equal(vscode.seen.items[0].text, 'Wheelhouse · 1 needs you');
  view.show(false);
  assert.equal(every.timers[0].live, false);
  assert.equal(vscode.seen.items[0].text, 'Wheelhouse');
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

test('the status bar is neutral before the first look', async () => {
  const { vscode } = await start({ desk: fakeDesk(), visible: false });
  assert.equal(vscode.seen.items[0].text, 'Wheelhouse');
});

test('a panel that starts hidden does not watch', async () => {
  const desk = fakeDesk();
  const { every } = await start({ desk, visible: false });
  assert.equal(every.timers.length, 0);
  assert.equal(desk.calls.length, 0);
});

test('with no helper it says so, starts no helper and sends no act', async () => {
  const desk = fakeDesk({ helper: 'down' });
  const { view, vscode, every } = await start({ desk });
  assert.equal(modelOf(view).state, 'no-helper');
  assert.match(modelOf(view).notice, /isn't running/);
  assert.equal(vscode.seen.items[0].text, 'Wheelhouse · not running');
  assert.deepEqual(desk.calls.filter((c) => c[0] === 'act'), []);
  // The one timer is the watch that notices the helper coming back; the add-on never starts a program.
  assert.equal(every.timers.length, 1);
  const source = fs.readFileSync(path.join(import.meta.dirname, '../../vscode/extension.cjs'), 'utf8');
  assert.equal(/child_process|spawn|exec\(/.test(source), false);
});

test('a folder that is not a Wheelhouse project is said so, and nothing is sent', async () => {
  const desk = fakeDesk();
  const { view } = await start({ desk, project: null });
  assert.equal(modelOf(view).state, 'no-helper');
  assert.match(modelOf(view).notice, /isn't a Wheelhouse project/);
  assert.equal(desk.calls.length, 0);
});

test('on another desk version it shows Update Wheelhouse and decides nothing', async () => {
  const desk = fakeDesk({ helper: 'update' });
  const { view, vscode } = await start({ desk });
  assert.equal(modelOf(view).state, 'update');
  assert.match(modelOf(view).notice, /Update Wheelhouse/);
  assert.equal(vscode.seen.items[0].text, 'Wheelhouse · update');
  assert.deepEqual(desk.calls.filter((c) => c[0] === 'act'), []);
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

test('notices from the watch are drawn', async () => {
  const desk = fakeDesk();
  desk.state.events = [{ type: 'notice', id: 'incident:1', lines: ['Main is red.'] }];
  const { view } = await start({ desk });
  assert.deepEqual(modelOf(view).notices, ['Main is red.']);
  assert.equal(modelOf(view).notice, 'Main is red.');
});

test('a key that can\'t be read leaves the panel unpaired, sending nothing', async () => {
  const context = fakeContext();
  context.secrets.get = async () => { throw new Error('locked'); };
  const desk = fakeDesk();
  const { view } = await start({ desk, context });
  assert.equal(modelOf(view).state, 'unpaired');
  assert.match(modelOf(view).notice, /secret storage/);
  assert.equal(desk.calls.length, 0);
  assert.deepEqual(context.stored, []);
});
