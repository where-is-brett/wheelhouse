// tests/vscode/key.test.js
// The add-on's key: made once, kept in SecretStorage and nowhere else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fakeContext, require } from './helpers.js';
import { fingerprintOf as coreFingerprint } from '../../scripts/desk/clients.js';
import { APP_ID } from '../../scripts/state/card-lines.js';
import { canonicalJson } from '../../scripts/lib/canonical.js';

const { loadKey, SECRET_NAME } = require('../../vscode/key.cjs');

test('the key is made once and kept in SecretStorage, never in a file', async () => {
  const { secrets, stored } = fakeContext();
  const first = await loadKey(secrets);
  const second = await loadKey(secrets);
  assert.deepEqual(stored, [SECRET_NAME]);
  assert.equal(first.publicKey, second.publicKey);
  assert.match(first.client, /^vscode-panel-[0-9a-f]{8}$/);
  assert.equal(APP_ID.test(first.client), true);
  assert.equal(first.fingerprint, coreFingerprint(first.publicKey));
  assert.equal(first.client, `vscode-panel-${first.fingerprint.slice(0, 8)}`);
  assert.ok((await secrets.get(SECRET_NAME)).length > 0);
  const source = fs.readFileSync(path.join(import.meta.dirname, '../../vscode/key.cjs'), 'utf8');
  assert.equal(/writeFile|createWriteStream|\.wheelhouse/.test(source), false);
});

test('a signature from the kept key checks against its public key', async () => {
  const { secrets } = fakeContext();
  const key = await loadKey(secrets);
  const again = await loadKey(secrets);
  const evidence = again.sign('request', { text: 'x' });
  assert.equal(evidence.client, key.client);
  const publicKey = crypto.createPublicKey({ key: Buffer.from(key.publicKey, 'base64'), format: 'der', type: 'spki' });
  const text = canonicalJson({ command: 'request', args: { text: 'x' }, at: evidence.at });
  assert.equal(crypto.verify(null, Buffer.from(text), publicKey, Buffer.from(evidence.sig, 'base64')), true);
});
