// tests/scripts/host/keys.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readKey, writeKey, findKey, saveKey, removeKey, moveKeysToStore } from '../../../scripts/host/keys.js';
import { withHome } from '../../helpers/homes.js';
import { keysDir } from '../../../scripts/lib/paths.js';

test('writeKey keeps a key in keys/<name>.json and readKey reads it back', () => {
  withHome(() => {
    const value = { clientId: 'Iv1.abc', installationId: 42, accessToken: 'ghu_A', accessExpiresAt: null, refreshToken: null, refreshExpiresAt: null };
    writeKey('github-app', value);
    assert.deepEqual(readKey('github-app'), value);
    const file = path.join(keysDir(), 'github-app.json');
    assert.ok(fs.existsSync(file));
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    writeKey('gitlab-project-4242', { kind: 'pasted-token', token: 'glpat-X', expiresAt: null });
    assert.equal(readKey('gitlab-project-4242').kind, 'pasted-token');
    assert.deepEqual(fs.readdirSync(keysDir()).sort(), ['github-app.json', 'gitlab-project-4242.json'], 'no temporary file is left');
  });
});

test('writeKey replaces an existing key', () => {
  withHome(() => {
    writeKey('github-app', { accessToken: 'one' });
    writeKey('github-app', { accessToken: 'two' });
    assert.equal(readKey('github-app').accessToken, 'two');
  });
});

test('readKey returns null when there is no such key', () => {
  withHome(() => {
    assert.equal(readKey('github-app'), null);
  });
});

test('only github-app and gitlab-project-<digits> are allowed', () => {
  withHome(() => {
    for (const name of ['signing', '../github-app', 'gitlab-project-', 'gitlab-project-12a', 'gitlab-project-1/2', 'GITHUB-APP', '', undefined]) {
      assert.throws(() => writeKey(name, {}), /key name/, String(name));
      assert.throws(() => readKey(name), /key name/, String(name));
    }
  });
});

test('a damaged key file is named, and its contents are not repeated', () => {
  withHome(() => {
    fs.mkdirSync(keysDir(), { recursive: true });
    fs.writeFileSync(path.join(keysDir(), 'github-app.json'), '{"accessToken":"ghu_LEAKED"');
    assert.throws(() => readKey('github-app'), (error) => {
      assert.match(error.message, /github-app\.json/);
      assert.doesNotMatch(error.message, /LEAKED/);
      return true;
    });
    fs.writeFileSync(path.join(keysDir(), 'github-app.json'), '"ghu_LEAKED"');
    assert.throws(() => readKey('github-app'), /github-app\.json/);
  });
});

test('writeKey refuses something that is not an object', () => {
  withHome(() => {
    for (const value of [null, 'ghu_X', 5, ['a']]) assert.throws(() => writeKey('github-app', value), /object/);
  });
});

// A stand-in for the computer's store, kept in memory.
function memoryStore({ failWrite = false, misread = false } = {}) {
  const kept = new Map();
  return {
    kept,
    async storeKey(name, value) {
      if (failWrite) throw new Error('no');
      kept.set(name, JSON.stringify(value));
    },
    async readKey(name) {
      if (!kept.has(name)) return null;
      return misread ? { other: true } : JSON.parse(kept.get(name));
    },
  };
}

test('findKey reads the store first and the key file while a key has not moved', async () => {
  await withHome(async () => {
    const store = memoryStore();
    assert.equal(await findKey('github-app', { store }), null);
    writeKey('github-app', { accessToken: 'from-file' });
    assert.equal((await findKey('github-app', { store })).accessToken, 'from-file');
    await saveKey('github-app', { accessToken: 'from-store' }, { store });
    assert.equal((await findKey('github-app', { store })).accessToken, 'from-store');
  });
});

test('moveKeysToStore deletes each file only after reading the key back', async () => {
  await withHome(async () => {
    const store = memoryStore();
    writeKey('github-app', { accessToken: 'ghu_A' });
    writeKey('gitlab-project-9', { kind: 'project-key', token: 'glpat-B', expiresAt: null });
    const result = await moveKeysToStore({ store });
    assert.deepEqual(result, { moved: ['github-app', 'gitlab-project-9'], failed: [] });
    assert.deepEqual(fs.readdirSync(keysDir()), []);
    assert.equal((await store.readKey('gitlab-project-9')).token, 'glpat-B');
  });
});

test('a move that fails or reads back differently leaves the file for the next start', async () => {
  await withHome(async () => {
    writeKey('github-app', { accessToken: 'ghu_A' });
    for (const options of [{ failWrite: true }, { misread: true }]) {
      const result = await moveKeysToStore({ store: memoryStore(options) });
      assert.deepEqual(result, { moved: [], failed: ['github-app'] });
      assert.equal(readKey('github-app').accessToken, 'ghu_A');
    }
    assert.deepEqual(await moveKeysToStore({ store: memoryStore() }), { moved: ['github-app'], failed: [] });
  });
});

test('moveKeysToStore with no keys folder moves nothing', async () => {
  await withHome(async () => {
    assert.deepEqual(await moveKeysToStore({ store: memoryStore() }), { moved: [], failed: [] });
  });
});

test('removeKey clears the store and the key file, and a key that is not there is already gone', async () => {
  await withHome(async () => {
    const kept = new Map([['github-app', { accessToken: 'from-store' }]]);
    const store = { readKey: async (name) => kept.get(name) ?? null, deleteKey: async (name) => { kept.delete(name); } };
    writeKey('github-app', { accessToken: 'from-file' });
    await removeKey('github-app', { store });
    assert.equal(kept.size, 0, 'the store holds none');
    assert.equal(readKey('github-app'), null, 'the file is gone');
    assert.equal(await findKey('github-app', { store }), null);
    await removeKey('github-app', { store });
    await assert.rejects(removeKey('signing', { store }), /key name/);
  });
});

test('removeKey names the key, not its value, when the store cannot delete it', async () => {
  await withHome(async () => {
    writeKey('github-app', { accessToken: 'ghu_LEAKED' });
    const store = { deleteKey: async () => { throw new Error('boom ghu_LEAKED'); } };
    await assert.rejects(removeKey('github-app', { store }), (error) => {
      assert.match(error.message, /github-app/);
      assert.doesNotMatch(error.message, /LEAKED/);
      return true;
    });
    assert.equal(readKey('github-app').accessToken, 'ghu_LEAKED', 'the file stays when the store could not clear');
  });
});
