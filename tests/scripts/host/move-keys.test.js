// tests/scripts/host/move-keys.test.js
// The move of key files into the computer's store, where two helpers may start together or the store may hold a newer
// key than the file (design section 14). A stand-in store: no test reaches the real keychain or credential store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readKey, writeKey, saveKey, moveKeysToStore } from '../../../scripts/host/keys.js';
import { startRealHelper } from '../../../scripts/host/helper-main.js';
import { as, shortHome, testAddress, withHome } from '../../helpers/homes.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';
import { keysDir } from '../../../scripts/lib/paths.js';

waitLongerOnTheHelper();

function memoryStore() {
  const kept = new Map();
  return {
    kept,
    async storeKey(name, value) { kept.set(name, JSON.stringify(value)); },
    async readKey(name) { return kept.has(name) ? JSON.parse(kept.get(name)) : null; },
    async deleteKey(name) { kept.delete(name); },
  };
}

test('a key the store already holds is kept as it is, and only its file goes', async () => {
  await withHome(async () => {
    const store = memoryStore();
    writeKey('github-app', { accessToken: 'stand-in-OLD', refreshToken: 'stand-in-SPENT' });
    await saveKey('github-app', { accessToken: 'stand-in-NEWER', refreshToken: 'stand-in-NEXT' }, { store });
    const before = store.kept.get('github-app');
    assert.deepEqual(await moveKeysToStore({ store }), { moved: ['github-app'], failed: [] });
    assert.equal(store.kept.get('github-app'), before, 'the store is unchanged');
    assert.equal((await store.readKey('github-app')).accessToken, 'stand-in-NEWER');
    assert.equal(readKey('github-app'), null, 'the file is gone');
  });
});

test('an empty file is skipped, and a file gone by the time it is read is never stored as null', async () => {
  await withHome(async () => {
    const store = memoryStore();
    fs.mkdirSync(keysDir(), { recursive: true });
    fs.writeFileSync(path.join(keysDir(), 'github-app.json'), '{}');
    assert.deepEqual(await moveKeysToStore({ store }), { moved: [], failed: [] });
    assert.equal(store.kept.size, 0);
    // Another helper moves the file after this one listed the folder.
    writeKey('gitlab-project-9', { token: 'stand-in-B' });
    const listed = fs.readdirSync;
    fs.readdirSync = (...args) => {
      const names = listed(...args);
      fs.rmSync(path.join(keysDir(), 'gitlab-project-9.json'), { force: true });
      return names;
    };
    try {
      await moveKeysToStore({ store });
    } finally { fs.readdirSync = listed; }
    assert.equal(store.kept.size, 0, 'nothing was stored over the real key');
  });
});

test('a second helper that cannot bind moves nothing', async () => {
  const home = shortHome();
  await as(home, async () => {
    const first = await startRealHelper({ address: testAddress(home), onStop: () => {}, keyDeps: { store: memoryStore() } });
    try {
      fs.mkdirSync(`${home}/keys`, { recursive: true });
      const file = `${home}/keys/github-app.json`;
      fs.writeFileSync(file, JSON.stringify({ accessToken: 'stand-in-A' }));
      const store = memoryStore();
      await assert.rejects(startRealHelper({ address: first.address, onStop: () => {}, keyDeps: { store }, moveKeys: true, recordBackend: true }));
      assert.equal(store.kept.size, 0);
      assert.equal(fs.existsSync(file), true);
    } finally { await first.close(); }
  });
});
