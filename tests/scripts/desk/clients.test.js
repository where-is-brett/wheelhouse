// tests/scripts/desk/clients.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { askToPair, pairClient, pairedClients, unpairClient, fingerprintOf } from '../../../scripts/desk/clients.js';
import { runAct } from '../../../scripts/desk/acts.js';
import { checkEvidence } from '../../../scripts/desk/evidence.js';
import { earned } from '../../../scripts/hooks/prompt-record.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { pairLine, unpairLine } from '../../../scripts/state/card-lines.js';
import { canonicalJson } from '../../../scripts/lib/canonical.js';
import { as, shortHome } from '../../helpers/homes.js';
import { NOW, now } from './fixture.js';

function app(id = 'phone-app') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const signs = (command, args, at = NOW) => ({ form: 'client', client: id, at, sig: crypto.sign(null, Buffer.from(canonicalJson({ command, args, at })), privateKey).toString('base64') });
  return { client: { id, name: 'The phone app', publicKey: key }, fingerprint: fingerprintOf(key), signs };
}

function withKey(fn) {
  return as(shortHome(), async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-01T00:00:00.000Z' });
    return fn();
  });
}

// The action the director's click on the card's Pair it (or Unpair it) earns, as the prompt record makes it.
async function clicked(line, label) {
  const got = await earned({ project: 'p', question: line, label, now });
  assert.ok(got, `${label} earns a record`);
  return makeEvent({ ...got.made, now });
}

const answer = { card: 'c1', option: 'Not now' };
const context = (extra) => ({ enrolled: [], views: {}, events: [], now, clients: pairedClients(), ...extra });

test('pair raises one Pair this app card naming the key\'s fingerprint', () => withKey(async () => {
  const phone = app();
  const written = [];
  const recorder = {
    askPair: async (client) => ({ ok: true, ...askToPair(client, { now }) }),
    write: async (event) => { written.push(event); return { ok: true, id: 'card-1' }; },
  };
  const got = await runAct('pair', { client: phone.client }, { ok: true, records: [] }, { recorder, now });
  assert.equal(got.ok, true, got.refused);
  assert.equal(written.length, 1);
  assert.equal(written[0].kind, 'card');
  assert.equal(written[0].data.line, pairLine('phone-app', phone.fingerprint));
  assert.deepEqual(written[0].data.options, ['Pair it', 'Not now']);
  assert.equal(written[0].data.level, 4);
  assert.deepEqual(pairedClients(), [], 'nothing is paired by asking');
}));

test('the click on Pair it enrols the key', () => withKey(async () => {
  const phone = app();
  askToPair(phone.client, { now });
  const record = await clicked(pairLine('phone-app', phone.fingerprint), 'Pair it');
  assert.deepEqual(pairClient({ id: 'phone-app' }, record, { now }), { ok: true });
  assert.deepEqual(pairedClients().map((c) => [c.id, c.publicKey]), [['phone-app', phone.client.publicKey]]);
  const other = app('phone-app');
  askToPair(other.client, { now });
  assert.equal(pairClient({ id: 'phone-app' }, record, { now }).ok, false, 'a click names one key only');
}));

test('an act signed by the paired key is accepted', () => withKey(async () => {
  const phone = app();
  askToPair(phone.client, { now });
  pairClient({ id: 'phone-app' }, await clicked(pairLine('phone-app', phone.fingerprint), 'Pair it'), { now });
  assert.equal(checkEvidence('answer', answer, phone.signs('answer', answer), context()).ok, true);
}));

test('an act signed by an unpaired key is refused', () => withKey(async () => {
  const stranger = app('stranger');
  assert.equal(checkEvidence('answer', answer, stranger.signs('answer', answer), context()).ok, false);
}));

test('unpair removes it, and its next act is refused', () => withKey(async () => {
  const phone = app();
  askToPair(phone.client, { now });
  pairClient({ id: 'phone-app' }, await clicked(pairLine('phone-app', phone.fingerprint), 'Pair it'), { now });
  assert.equal(unpairClient('phone-app', await clicked(pairLine('phone-app', phone.fingerprint), 'Pair it')).ok, false, 'Pair it doesn\'t unpair');
  assert.deepEqual(unpairClient('phone-app', await clicked(unpairLine('phone-app', phone.fingerprint), 'Unpair it')), { ok: true });
  assert.deepEqual(pairedClients(), []);
  assert.equal(checkEvidence('answer', answer, phone.signs('answer', answer), context()).ok, false);
}));
