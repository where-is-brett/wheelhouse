// tests/scripts/state/signing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeSigningKey, sign, verify, readEnrolled, enrol } from '../../../scripts/state/signing.js';
import { computerId, keysDir, profileDir } from '../../../scripts/lib/paths.js';

function withHome(fn) {
  const home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-sign-')), 'home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    return fn(home);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

function enrolled() {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
  return readEnrolled();
}

test('a signed record verifies against the enrolled key', () => {
  withHome(() => {
    const list = enrolled();
    const record = sign({ kind: 'approval', n: 1, nested: { b: 1, a: 2 } });
    assert.equal(record.sig.computer, computerId());
    assert.equal(verify(record, list), true);
  });
});

test('signing does not alter the record passed in', () => {
  withHome(() => {
    enrolled();
    const input = { a: 1 };
    sign(input);
    assert.deepEqual(input, { a: 1 });
  });
});

test('a record with any field changed no longer verifies', () => {
  withHome(() => {
    const list = enrolled();
    const record = sign({ kind: 'approval', n: 1, nested: { a: 1 } });
    assert.equal(verify({ ...record, n: 2 }, list), false);
    assert.equal(verify({ ...record, extra: true }, list), false);
    assert.equal(verify({ ...record, nested: { a: 2 } }, list), false);
  });
});

test('a record signed by a key that is not enrolled does not verify', () => {
  withHome(() => {
    makeSigningKey();
    const record = sign({ a: 1 });
    assert.equal(verify(record, []), false);
    assert.equal(verify(record, [{ computer: 'ffffffff', publicKey: 'x', enrolledAt: 'y' }]), false);
  });
});

test('a record whose computer is enrolled with a different key does not verify', () => {
  withHome(() => {
    makeSigningKey();
    const record = sign({ a: 1 });
    const other = withHome(() => makeSigningKey().publicKey);
    assert.equal(verify(record, [{ computer: record.sig.computer, publicKey: other, enrolledAt: 'y' }]), false);
  });
});

test('an unsigned or malformed signature does not verify, and never throws', () => {
  withHome(() => {
    const list = enrolled();
    const record = sign({ a: 1 });
    assert.equal(verify({ a: 1 }, list), false);
    assert.equal(verify(null, list), false);
    assert.equal(verify({ a: 1, sig: 'nope' }, list), false);
    assert.equal(verify({ a: 1, sig: { computer: record.sig.computer } }, list), false);
    assert.equal(verify({ a: 1, sig: { computer: record.sig.computer, value: '!!!not base64!!!' } }, list), false);
    assert.equal(verify({ a: 1, sig: { computer: record.sig.computer, value: 42 } }, list), false);
    assert.equal(verify(record, undefined), false);
    assert.equal(verify(record, [{ computer: record.sig.computer, publicKey: 'garbage', enrolledAt: 'y' }]), false);
    assert.equal(verify({ a: undefined, sig: record.sig }, list), false);
  });
});

test('makeSigningKey refuses to replace an existing key', () => {
  withHome(() => {
    makeSigningKey();
    const file = path.join(keysDir(), 'signing.pem');
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => makeSigningKey(), (e) => !e.message.includes('PRIVATE'));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
});

test('makeSigningKey returns the computer ID and a base64 public key, and keeps the key private', () => {
  withHome(() => {
    const result = makeSigningKey();
    assert.equal(result.computer, computerId());
    assert.match(result.publicKey, /^[A-Za-z0-9+/]+=*$/);
    assert.deepEqual(Object.keys(result).sort(), ['computer', 'publicKey']);
    const file = path.join(keysDir(), 'signing.pem');
    assert.match(fs.readFileSync(file, 'utf8'), /BEGIN PRIVATE KEY/);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });
});

test('sign without a key says so without exposing anything', () => {
  withHome(() => {
    assert.throws(() => sign({ a: 1 }), /signing key/i);
  });
});

test('readEnrolled is empty when nothing is enrolled', () => {
  withHome(() => assert.deepEqual(readEnrolled(), []));
});

test('enrol creates folders, keeps entries, and replaces the same computer', () => {
  withHome(() => {
    enrol({ computer: 'aaaaaaaa', publicKey: 'k1', enrolledAt: 't1' });
    enrol({ computer: 'bbbbbbbb', publicKey: 'k2', enrolledAt: 't2' });
    enrol({ computer: 'aaaaaaaa', publicKey: 'k3', enrolledAt: 't3' });
    assert.ok(fs.existsSync(path.join(profileDir(), 'keys', 'enrolled.json')));
    assert.deepEqual(readEnrolled(), [
      { computer: 'bbbbbbbb', publicKey: 'k2', enrolledAt: 't2' },
      { computer: 'aaaaaaaa', publicKey: 'k3', enrolledAt: 't3' },
    ]);
  });
});
