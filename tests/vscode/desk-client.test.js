// tests/vscode/desk-client.test.js
// The add-on's desk/1 client against a stand-in helper on a socket in the test's home.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
import { canonicalJson } from '../../scripts/lib/canonical.js';
import { as, shortHome, testAddress } from '../helpers/homes.js';

const require = createRequire(import.meta.url);
const { deskClient } = require('../../vscode/desk-client.cjs');
const { loadKey } = require('../../vscode/key.cjs');

const servers = [];
after(() => { for (const s of servers) s.close(); });

// A stand-in helper that keeps what it was sent and answers as `answer(route, body)` says.
async function standIn(answer) {
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
      res.end(JSON.stringify(answer(req.url, body)));
    });
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(address, resolve));
  return { address, seen, home };
}

const memory = () => { const kept = new Map(); return { get: async (k) => kept.get(k), store: async (k, v) => { kept.set(k, v); } }; };
const NOW = new Date('2026-11-23T01:00:00.000Z');
const ok = (extra = {}) => ({ ok: true, v: 'desk/1', ...extra });

async function client(helper) {
  const key = await loadKey(memory(), { now: () => NOW });
  return { key, desk: deskClient({ address: helper.address, sign: key.sign, project: 'owner__name' }) };
}

test('read posts the view with the project and no signature', async () => {
  const helper = await standIn(() => ok({ view: 'glance', data: {} }));
  const { desk } = await client(helper);
  assert.equal((await desk.read('glance')).ok, true);
  assert.deepEqual(helper.seen[0].body, { v: 'desk/1', project: 'owner__name', view: 'glance', args: {} });
  assert.equal(helper.seen[0].route, '/desk/read');
});

test('act signs the command, its arguments and the time', async () => {
  const helper = await standIn(() => ok({ changed: [] }));
  const { desk, key } = await client(helper);
  await desk.act('not-now', { card: 'c1' });
  const { evidence } = helper.seen[0].body;
  assert.equal(evidence.form, 'client');
  assert.equal(evidence.client, key.client);
  assert.equal(evidence.at, NOW.toISOString());
  const text = canonicalJson({ command: 'not-now', args: { card: 'c1' }, at: evidence.at });
  const publicKey = crypto.createPublicKey({ key: Buffer.from(key.publicKey, 'base64'), format: 'der', type: 'spki' });
  assert.equal(crypto.verify(null, Buffer.from(text), publicKey, Buffer.from(evidence.sig, 'base64')), true);
  const other = canonicalJson({ command: 'not-now', args: { card: 'c2' }, at: evidence.at });
  assert.equal(crypto.verify(null, Buffer.from(other), publicKey, Buffer.from(evidence.sig, 'base64')), false);
});

test('watch signs { command: watch, args: { cursor } }', async () => {
  const helper = await standIn(() => ok({ events: [], cursor: 'k2' }));
  const { desk, key } = await client(helper);
  const got = await desk.watch('k1');
  assert.equal(got.cursor, 'k2');
  assert.equal(helper.seen[0].route, '/desk/watch');
  assert.equal(helper.seen[0].body.cursor, 'k1');
  const { evidence } = helper.seen[0].body;
  const publicKey = crypto.createPublicKey({ key: Buffer.from(key.publicKey, 'base64'), format: 'der', type: 'spki' });
  const text = canonicalJson({ command: 'watch', args: { cursor: 'k1' }, at: evidence.at });
  assert.equal(crypto.verify(null, Buffer.from(text), publicKey, Buffer.from(evidence.sig, 'base64')), true);
});

test('a helper that answers another version asks for an update', async () => {
  const helper = await standIn(() => ({ ok: true, v: 'desk/2' }));
  const { desk } = await client(helper);
  assert.deepEqual([(await desk.read('glance')).ok, (await desk.read('glance')).update], [false, true]);
});

test('a helper that doesn\'t know a command asks for an update', async () => {
  const helper = await standIn(() => ({ ok: false, v: 'desk/1', refused: 'Wheelhouse can\'t "unpair"' }));
  const { desk } = await client(helper);
  const got = await desk.act('unpair', { client: 'x' });
  assert.deepEqual([got.ok, got.update], [false, true]);
  const other = await standIn(() => ({ ok: false, v: 'desk/1', refused: 'That app was never paired with Wheelhouse' }));
  const refused = await (await client(other)).desk.act('answer', { card: 'c' });
  assert.equal(refused.update, undefined);
  assert.match(refused.refused, /never paired/);
});

test('a helper without the route, or one calling it an unknown request, asks for an update', async () => {
  const missing = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.statusCode = 404; res.end('{"ok":false,"refused":"not found"}'); }); });
  servers.push(missing);
  const address = testAddress(shortHome());
  await new Promise((resolve) => missing.listen(address, resolve));
  const key = await loadKey(memory(), { now: () => NOW });
  const got = await deskClient({ address, sign: key.sign, project: 'owner__name' }).watch(null);
  assert.deepEqual([got.ok, got.update, got.down], [false, true, undefined]);
  const odd = await standIn(() => ({ ok: false, refused: 'unknown request /desk/watch' }));
  assert.equal((await (await client(odd)).desk.watch(null)).update, true);
});

test('no helper answers as down, not as an update', async () => {
  const home = shortHome();
  await as(home, async () => {
    const key = await loadKey(memory());
    const desk = deskClient({ address: testAddress(home), sign: key.sign, project: 'owner__name' });
    const got = await desk.read('glance');
    assert.deepEqual([got.ok, got.down, got.update], [false, true, undefined]);
  });
});
