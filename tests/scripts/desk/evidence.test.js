// tests/scripts/desk/evidence.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { checkEvidence, CLIENT_WINDOW_MS } from '../../../scripts/desk/evidence.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled, sign } from '../../../scripts/state/signing.js';
import { canonicalJson } from '../../../scripts/lib/canonical.js';
import { as, shortHome } from '../../helpers/homes.js';
import { CARD, NOW, now } from './fixture.js';

const views = { waiting: [{ id: 'c1', at: '2026-10-29T09:00:00.000Z', data: CARD }, { id: 'c2', at: '2026-10-29T09:01:00.000Z', data: { ...CARD, question: 'Another question?' } }] };
const approve = (question = CARD.question) => makeEvent({ kind: 'action', data: { action: 'approve-work', work: 'export-csv', lane: 'feature', hash: 'a'.repeat(64), shownFirst: false, question, label: 'Approve' }, now });

function withKey(fn) {
  return as(shortHome(), async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-01T00:00:00.000Z' });
    return fn({ enrolled: readEnrolled() });
  });
}
const context = (enrolled, extra = {}) => ({ enrolled, clients: [], views, events: [], now, ...extra });
const answer = { card: 'c1', option: 'Approve' };

test('a record signed by this computer for the card is accepted', () => withKey(async ({ enrolled }) => {
  const got = checkEvidence('answer', answer, { form: 'signed', records: [approve()] }, context(enrolled));
  assert.equal(got.ok, true, got.refused);
  assert.equal(got.records.length, 1);
}));

test('a record signed by another computer\'s key is refused', () => withKey(async ({ enrolled }) => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const record = approve();
  const { sig, ...body } = record;
  const forged = { ...body, sig: { computer: sig.computer, value: crypto.sign(null, Buffer.from(canonicalJson(body)), privateKey).toString('base64') } };
  const got = checkEvidence('answer', answer, { form: 'signed', records: [forged] }, context(enrolled));
  assert.equal(got.ok, false);
  assert.match(got.refused, /signed/);
}));

test('a record for another card is refused', () => withKey(async ({ enrolled }) => {
  const got = checkEvidence('answer', answer, { form: 'signed', records: [approve('Another question?')] }, context(enrolled));
  assert.equal(got.ok, false);
  assert.match(got.refused, /card/);
}));

test('a record already held is refused', () => withKey(async ({ enrolled }) => {
  const record = approve();
  const got = checkEvidence('answer', answer, { form: 'signed', records: [record] }, context(enrolled, { events: [record] }));
  assert.equal(got.ok, false);
  assert.match(got.refused, /already/);
}));

test('a chat click on a signed label is refused', () => withKey(async ({ enrolled }) => {
  const got = checkEvidence('answer', answer, { form: 'chat-click', proof: 'chat-click' }, context(enrolled));
  assert.equal(got.ok, false);
  assert.match(got.refused, /chat/);
}));

test('a chat click on Not now is accepted', () => withKey(async ({ enrolled }) => {
  const got = checkEvidence('answer', { card: 'c1', option: 'Not now' }, { form: 'chat-click', proof: 'chat-click' }, context(enrolled));
  assert.equal(got.ok, true, got.refused);
}));

// A later app's key and its signature over the act, as Task 10's pairing enrols one.
function client(id = 'app-1') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const entry = { id, name: 'An app', publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), pairedAt: NOW };
  const signs = (command, args, at) => crypto.sign(null, Buffer.from(canonicalJson({ command, args, at })), privateKey).toString('base64');
  return { entry, signs };
}

test('a paired client\'s signature is accepted', () => withKey(async ({ enrolled }) => {
  const app = client();
  const at = NOW;
  const got = checkEvidence('answer', answer, { form: 'client', client: 'app-1', at, sig: app.signs('answer', answer, at) }, context(enrolled, { clients: [app.entry] }));
  assert.equal(got.ok, true, got.refused);
}));

test('a client id that was never paired is refused', () => withKey(async ({ enrolled }) => {
  const app = client();
  const got = checkEvidence('answer', answer, { form: 'client', client: 'app-2', at: NOW, sig: app.signs('answer', answer, NOW) }, context(enrolled, { clients: [app.entry] }));
  assert.equal(got.ok, false);
  assert.match(got.refused, /paired/);
}));

test('a client signature older than five minutes is refused', () => withKey(async ({ enrolled }) => {
  assert.equal(CLIENT_WINDOW_MS, 5 * 60 * 1000);
  const app = client();
  const at = new Date(Date.parse(NOW) - CLIENT_WINDOW_MS - 1000).toISOString();
  const got = checkEvidence('answer', answer, { form: 'client', client: 'app-1', at, sig: app.signs('answer', answer, at) }, context(enrolled, { clients: [app.entry] }));
  assert.equal(got.ok, false);
  assert.match(got.refused, /old|minutes/);
}));

test('a client signature over other words is refused', () => withKey(async ({ enrolled }) => {
  const app = client();
  const got = checkEvidence('answer', answer, { form: 'client', client: 'app-1', at: NOW, sig: app.signs('answer', { card: 'c2', option: 'Approve' }, NOW) }, context(enrolled, { clients: [app.entry] }));
  assert.equal(got.ok, false);
}));

test('an evidence form the desk doesn\'t know is refused', () => withKey(async ({ enrolled }) => {
  assert.equal(checkEvidence('answer', answer, { form: 'trust-me' }, context(enrolled)).ok, false);
  assert.equal(checkEvidence('answer', answer, { form: 'signed', records: [] }, context(enrolled)).ok, false);
}));
