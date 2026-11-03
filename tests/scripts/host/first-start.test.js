// tests/scripts/host/first-start.test.js
// What the helper does once at its first start after this work (design section 14): records `backend: 'cli'` on a
// hosted project set up before backends were chosen (no card), and moves the old key files into the computer's
// store, reading each back before the file goes. A move that fails leaves the file and tries again at the next
// start. A stand-in store throughout: no test reaches the real keychain or credential store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { startRealHelper, recordBackends } from '../../../scripts/host/helper-main.js';
import { writeProject, readProject } from '../../../scripts/lib/projects.js';
import { findKey, saveKey, removeKey, readKey, writeKey } from '../../../scripts/host/keys.js';
import { childEnv } from '../../../scripts/host/connection.js';
import { as, shortHome, testAddress, withHome } from '../../helpers/homes.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';

waitLongerOnTheHelper();

const BASE = 'https://gitlab.example.org';
const gitlab = (connection) => ({
  folder: os.tmpdir(), remoteUrl: `${BASE}/team/product.git`, host: 'gitlab', repo: 'team/product',
  connection: { host: 'gitlab', project: 'team/product', baseUrl: BASE, ...connection },
});
const memoryStore = ({ failStore = false } = {}) => {
  const kept = new Map();
  return {
    kept,
    readKey: async (name) => kept.get(name) ?? null,
    storeKey: async (name, value) => { if (failStore) throw new Error('the store is locked'); kept.set(name, value); },
    deleteKey: async (name) => { kept.delete(name); },
  };
};

test('a project set up before backends were chosen is recorded as cli, with no other change', async () => {
  await withHome(async () => {
    writeProject('team__old', gitlab({ mode: 'quick' }));
    writeProject('team__asis', gitlab({ mode: 'as-is', backend: 'rest', switched: 'cli' }));
    writeProject('team__local', { folder: os.tmpdir(), host: 'local', repo: 'local/team__local', remoteUrl: null, connection: { mode: 'none' } });
    const before = readProject('team__old');
    const done = recordBackends();
    assert.deepEqual(done, ['team__old']);
    assert.deepEqual(readProject('team__old'), { ...before, connection: { ...before.connection, backend: 'cli' } });
    assert.equal(readProject('team__asis').connection.backend, 'rest', 'a recorded backend is left');
    assert.equal(readProject('team__asis').connection.switched, 'cli');
    assert.equal(readProject('team__local').connection.backend, undefined);
    assert.deepEqual(recordBackends(), [], 'a second start has nothing to record');
  });
});

test('the first start of the real helper records the backend and moves the key files, once asked to', async () => {
  const store = memoryStore();
  const home = shortHome();
  await as(home, async () => {
    fs.mkdirSync(`${home}/keys`, { recursive: true });
    fs.writeFileSync(`${home}/keys/gitlab-project-5.json`, JSON.stringify({ token: 'stand-in-X', expiresAt: '2027-01-01' }));
    writeProject('team__old', gitlab({ mode: 'quick' }));
    const helper = await startRealHelper({ address: testAddress(home), onStop: () => {}, keyDeps: { store }, moveKeys: true, recordBackend: true });
    try {
      await helper.firstStart;
      assert.equal(readProject('team__old').connection.backend, 'cli');
      assert.equal(store.kept.has('gitlab-project-5'), true);
      assert.equal(fs.existsSync(`${home}/keys/gitlab-project-5.json`), false);
    } finally { await helper.close(); }
  });
});

test('a failed move leaves the file, and the next start moves it', async () => {
  const home = shortHome();
  await as(home, async () => {
    fs.mkdirSync(`${home}/keys`, { recursive: true });
    const file = `${home}/keys/github-app.json`;
    fs.writeFileSync(file, JSON.stringify({ clientId: 'Iv1.abc', accessToken: 'stand-in-A' }));
    const locked = memoryStore({ failStore: true });
    let helper = await startRealHelper({ address: testAddress(home), onStop: () => {}, keyDeps: { store: locked }, moveKeys: true });
    try {
      await helper.firstStart;
      assert.equal(fs.existsSync(file), true, 'the file stays');
      assert.equal(locked.kept.size, 0);
    } finally { await helper.close(); }

    const store = memoryStore();
    helper = await startRealHelper({ address: testAddress(home), onStop: () => {}, keyDeps: { store }, moveKeys: true });
    try {
      await helper.firstStart;
      assert.equal(store.kept.get('github-app').accessToken, 'stand-in-A');
      assert.equal(fs.existsSync(file), false);
    } finally { await helper.close(); }
  });
});

test('a helper started without being asked moves nothing and records nothing', async () => {
  const store = memoryStore();
  const home = shortHome();
  await as(home, async () => {
    fs.mkdirSync(`${home}/keys`, { recursive: true });
    fs.writeFileSync(`${home}/keys/gitlab-project-5.json`, JSON.stringify({ token: 'stand-in-X' }));
    writeProject('team__old', gitlab({ mode: 'quick' }));
    const helper = await startRealHelper({ address: testAddress(home), onStop: () => {}, keyDeps: { store } });
    try {
      await helper.firstStart;
      assert.equal(store.kept.size, 0);
      assert.equal(readProject('team__old').connection.backend, undefined);
    } finally { await helper.close(); }
  });
});

test('a renewed GitHub key is kept in the store, and removing it leaves nothing for findKey to see', async () => {
  await withHome(async () => {
    const store = memoryStore();
    const deps = { store };
    const NOW = new Date('2026-11-04T01:00:00.000Z');
    const at = (ms) => new Date(NOW.getTime() + ms).toISOString();
    // A key file left from before the move, and the store holding the same keys.
    const old = {
      clientId: 'Iv1.abc', installationId: 99, accessToken: 'stand-in-CURRENT', accessExpiresAt: at(60 * 1000),
      refreshToken: 'stand-in-REFRESH', refreshExpiresAt: at(180 * 24 * 60 * 60 * 1000),
    };
    writeKey('github-app', old);
    await saveKey('github-app', old, deps);
    const fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ access_token: 'stand-in-RENEWED', expires_in: 28800, refresh_token: 'stand-in-REFRESH2', refresh_token_expires_in: 15811200, token_type: 'bearer' }),
    });
    const env = await childEnv({ host: 'github', mode: 'narrow', project: 'a-director/product' }, { fetch, now: () => NOW, keys: deps });
    assert.equal(env.GH_TOKEN, 'stand-in-RENEWED');
    assert.equal(store.kept.get('github-app').accessToken, 'stand-in-RENEWED', 'the renewal went to the store');
    assert.equal((await findKey('github-app', deps)).accessToken, 'stand-in-RENEWED', 'the store wins over the old file');
    await removeKey('github-app', deps);
    assert.equal(await findKey('github-app', deps), null, 'no live key and no stale one is left');
    assert.equal(readKey('github-app'), null);
    assert.equal(store.kept.size, 0);
  });
});
