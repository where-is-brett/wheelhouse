// tests/scripts/state/signing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeSigningKey, sign, verify, readEnrolled, enrol, enrolledFile } from '../../../scripts/state/signing.js';
import { computerId, keysDir, profileDir } from '../../../scripts/lib/paths.js';
import { withHome } from '../../helpers/homes.js';

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
    assert.ok(fs.existsSync(path.join(keysDir(), 'enrolled.json')));
    assert.deepEqual(readEnrolled(), [
      { computer: 'bbbbbbbb', publicKey: 'k2', enrolledAt: 't2' },
      { computer: 'aaaaaaaa', publicKey: 'k3', enrolledAt: 't3' },
    ]);
  });
});

const enrolledPath = () => path.join(keysDir(), 'enrolled.json');

test('the trusted keys are kept beside this computer\'s own key, never in the profile\'s clone (ruling R105)', () => {
  withHome(() => {
    assert.equal(enrolledFile(), enrolledPath());
    // A list in the profile's clone, where a pull could bring one, is not read, and not moved.
    const old = path.join(profileDir(), 'keys', 'enrolled.json');
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(old, JSON.stringify([{ computer: 'deadbeef', publicKey: 'AAAA', enrolledAt: 't' }]));
    assert.deepEqual(readEnrolled(), []);
    enrol({ computer: 'aaaaaaaa', publicKey: 'k1', enrolledAt: 't1' });
    assert.deepEqual(readEnrolled().map((e) => e.computer), ['aaaaaaaa']);
    assert.equal(JSON.parse(fs.readFileSync(old, 'utf8'))[0].computer, 'deadbeef', 'left as it was');
  });
});
const entry = (computer) => ({ computer, publicKey: 'AAAA', enrolledAt: '2026-10-18T00:00:00.000Z' });

test('enrol refuses to write when enrolled.json is damaged, and writes atomically', () => {
  withHome(() => {
    fs.mkdirSync(path.dirname(enrolledPath()), { recursive: true });
    for (const damaged of ['{ not json', '{"computer":"aaaaaaaa"}', '[1, 2]', '[{"computer":"aaaaaaaa"}]', 'null']) {
      fs.writeFileSync(enrolledPath(), damaged);
      assert.throws(() => enrol(entry('bbbbbbbb')), /enrolled\.json/);
      assert.equal(fs.readFileSync(enrolledPath(), 'utf8'), damaged, 'the damaged file was left as it was');
    }
    fs.rmSync(enrolledPath());
    enrol(entry('aaaaaaaa'));
    enrol(entry('bbbbbbbb'));
    enrol(entry('aaaaaaaa'));
    assert.deepEqual(readEnrolled().map((e) => e.computer).sort(), ['aaaaaaaa', 'bbbbbbbb']);
    // a temporary file, then a rename: nothing else is left in the folder
    assert.deepEqual(fs.readdirSync(path.dirname(enrolledPath())), ['enrolled.json']);
    // a failed write leaves the earlier list whole
    const before = fs.readFileSync(enrolledPath(), 'utf8');
    const spy = fs.renameSync;
    fs.renameSync = () => { throw new Error('disk full'); };
    try {
      assert.throws(() => enrol(entry('cccccccc')), /disk full/);
    } finally {
      fs.renameSync = spy;
    }
    assert.equal(fs.readFileSync(enrolledPath(), 'utf8'), before);
    assert.deepEqual(fs.readdirSync(path.dirname(enrolledPath())), ['enrolled.json']);
  });
});

test('enrol refuses an entry without a computer id and a public key', () => {
  withHome(() => {
    for (const bad of [undefined, null, {}, { computer: 'aaaaaaaa' }, { publicKey: 'AAAA' }, { computer: '', publicKey: 'AAAA' },
      { computer: 'aaaaaaaa', publicKey: '' }, { computer: 5, publicKey: 'AAAA' }, { computer: 'aaaaaaaa', publicKey: 7 }]) {
      assert.throws(() => enrol(bad), /computer/i);
    }
    assert.equal(fs.existsSync(enrolledPath()), false, 'nothing was written');
  });
});

test('a record with its sig removed does not verify, and a missing enrolled list verifies nothing', () => {
  withHome(() => {
    const list = enrolled();
    const record = sign({ kind: 'review', n: 1 });
    const { sig, ...bare } = record; // eslint-disable-line no-unused-vars
    assert.equal(verify(bare, list), false);
    assert.equal(verify({ ...record, sig: undefined }, list), false);
    for (const missing of [undefined, null, {}, 'x']) assert.equal(verify(record, missing), false);
    assert.equal(verify(record, list), true);
  });
});
