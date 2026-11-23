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

test('read posts the view with the project, signed over the view and its arguments', async () => {
  const helper = await standIn(() => ok({ view: 'glance', data: {} }));
  const { desk, key } = await client(helper);
  assert.equal((await desk.read('waiting', { askHere: true })).ok, true);
  const { evidence, ...rest } = helper.seen[0].body;
  assert.deepEqual(rest, { v: 'desk/1', project: 'owner__name', view: 'waiting', args: { askHere: true } });
  assert.equal(helper.seen[0].route, '/desk/read');
  assert.deepEqual([evidence.form, evidence.client, evidence.at], ['client', key.client, NOW.toISOString()]);
  // Core's own check takes it for this project and these arguments only, so a read of other arguments is not the panel's.
  const { checkClient } = await import('../../scripts/desk/evidence.js');
  const paired = [{ id: key.client, name: 'The panel', publicKey: key.publicKey }];
  const now = () => NOW;
  const read = { view: 'waiting', args: { askHere: true } };
  assert.equal(checkClient('read', read, evidence, { clients: paired, now, project: 'owner__name' }).ok, true);
  assert.equal(checkClient('read', { view: 'waiting', args: {} }, evidence, { clients: paired, now, project: 'owner__name' }).ok, false);
  assert.equal(checkClient('read', read, evidence, { clients: paired, now, project: 'owner__other' }).ok, false);
  assert.equal(checkClient('read', read, evidence, { clients: [], now, project: 'owner__name' }).ok, false, 'an unpaired key signs nothing the helper takes');
});

test('act signs the command, its arguments, the time and the project', async () => {
  const helper = await standIn(() => ok({ changed: [] }));
  const { desk, key } = await client(helper);
  await desk.act('not-now', { card: 'c1' });
  const { evidence } = helper.seen[0].body;
  assert.equal(evidence.form, 'client');
  assert.equal(evidence.client, key.client);
  assert.equal(evidence.at, NOW.toISOString());
  const text = canonicalJson({ command: 'not-now', args: { card: 'c1' }, at: evidence.at, project: 'owner__name' });
  const publicKey = crypto.createPublicKey({ key: Buffer.from(key.publicKey, 'base64'), format: 'der', type: 'spki' });
  assert.equal(crypto.verify(null, Buffer.from(text), publicKey, Buffer.from(evidence.sig, 'base64')), true);
  const other = canonicalJson({ command: 'not-now', args: { card: 'c2' }, at: evidence.at, project: 'owner__name' });
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
  const text = canonicalJson({ command: 'watch', args: { cursor: 'k1' }, at: evidence.at, project: 'owner__name' });
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

// The add-on's signer against core's own check: what the add-on signs, the helper accepts, and no more.
test('core\'s checkClient verifies what the add-on signs, for its project only, and an answer carries its hash', async () => {
  const { checkClient, checkEvidence, clearUsedSignatures } = await import('../../scripts/desk/evidence.js');
  const { composeCard } = await import('../../scripts/cards/compose.js');
  clearUsedSignatures();
  const helper = await standIn(() => ok({ changed: [] }));
  const { desk, key } = await client(helper);
  const paired = [{ id: key.client, name: 'The panel', publicKey: key.publicKey }];
  const now = () => NOW;
  await desk.watch('k1');
  const watch = helper.seen.at(-1).body.evidence;
  assert.equal(checkClient('watch', { cursor: 'k1' }, watch, { clients: paired, now, project: 'owner__name' }).ok, true);
  assert.equal(checkClient('watch', { cursor: 'k1' }, watch, { clients: paired, now, project: 'owner__other' }).ok, false, 'another project');
  // A merge approval answered through the add-on's answer(): the helper's whole evidence check passes, and it needs the hash.
  const card = composeCard({
    kind: 'approval', level: 3, recommend: 'Approve', what: 'Pull request #12 has everything else it needs to merge.', why: 'It changes what users see.',
    because: 'the checks passed.', meanwhile: 'Nothing is released.', options: [{ label: 'Approve', says: 'It merges.' }], target: { pr: 12, sha: 'a'.repeat(40) },
  }).card;
  const id = crypto.randomUUID();
  const views = { waiting: [{ id, at: NOW.toISOString(), data: card }] };
  await desk.answer(id, 'Approve', 'c'.repeat(64), { commit: 'a'.repeat(40) });
  const { args, evidence, command } = helper.seen.at(-1).body;
  assert.equal(command, 'answer');
  assert.equal(args.hash, 'c'.repeat(64));
  const got = checkEvidence('answer', args, evidence, { clients: paired, views, now, project: 'owner__name', events: [], enrolled: [] });
  assert.deepEqual([got.ok, got.decides], [true, true], got.refused);
  const before = helper.seen.length;
  const none = await desk.answer(id, 'Approve', '');
  assert.equal(none.ok, false);
  assert.equal(helper.seen.length, before, 'with no hash nothing is sent');
});
