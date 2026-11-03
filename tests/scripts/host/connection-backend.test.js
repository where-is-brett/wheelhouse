// tests/scripts/host/connection-backend.test.js
// The backend the connection records ('cli' or 'rest'), and keys read from and kept in the computer's store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childEnv, renewalDue, backendOf, readEnv } from '../../../scripts/host/connection.js';

const NOW = new Date('2026-10-18T01:00:00.000Z');
const now = () => NOW;
const MINUTE = 60 * 1000;
const at = (ms) => new Date(NOW.getTime() + ms).toISOString();

const GITHUB = { host: 'github', mode: 'narrow', project: 'a-director/product' };
const GITLAB = { host: 'gitlab', mode: 'narrow', project: 'a-director/product', projectId: 4242 };

test('a record with no backend reads as cli; rest is read as rest', () => {
  assert.equal(backendOf({ host: 'gitlab', mode: 'quick', project: 'a/b' }), 'cli');
  assert.equal(backendOf({ host: 'gitlab', mode: 'quick', project: 'a/b', backend: 'cli' }), 'cli');
  assert.equal(backendOf({ host: 'gitlab', mode: 'as-is', project: 'a/b', backend: 'rest' }), 'rest');
  assert.equal(backendOf(undefined), 'cli');
});

test('a backend other than cli or rest is refused, and a switch names only the backend it left', async () => {
  const base = { host: 'gitlab', mode: 'as-is', project: 'a/b' };
  assert.deepEqual(await childEnv({ ...base, backend: 'rest', switched: 'cli' }), {});
  await assert.rejects(childEnv({ ...base, backend: 'ssh' }), /backend must be cli or rest/);
  await assert.rejects(childEnv({ ...base, backend: 'rest', switched: 'rest' }), /switched must name the backend it left/);
});

test('keys are read from the computer\'s store first, and a renewed key is saved to it', async () => {
  const kept = new Map();
  const store = {
    readKey: async (name) => kept.get(name) ?? null,
    storeKey: async (name, value) => { kept.set(name, structuredClone(value)); },
  };
  kept.set('github-app', {
    clientId: 'Iv1.abc', installationId: 99, accessToken: 'ghu_CURRENT', accessExpiresAt: at(MINUTE),
    refreshToken: 'ghr_CURRENT', refreshExpiresAt: at(180 * 24 * 60 * MINUTE),
  });
  const fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ access_token: 'ghu_RENEWED', expires_in: 28800, refresh_token: 'ghr_RENEWED', refresh_token_expires_in: 15811200, token_type: 'bearer' }),
  });
  const env = await childEnv(GITHUB, { fetch, now, keys: { store } });
  assert.equal(env.GH_TOKEN, 'ghu_RENEWED');
  assert.equal(kept.get('github-app').accessToken, 'ghu_RENEWED');
  assert.equal((await renewalDue(GITHUB, now, { store })).due, false);
  kept.set('gitlab-project-4242', { kind: 'project-key', token: 'stand-in-X', expiresAt: '2026-10-30' });
  assert.deepEqual(await renewalDue(GITLAB, now, { store }), { due: true, on: '2026-10-30' });
});

// --- Git's reads on the as-is connection without a tool ---

test('as-is with the web API lends a borrowed key to git\'s reads as a header, and says nothing of it elsewhere', async () => {
  const lent = [];
  const borrow = async (args) => { lent.push(args); return { username: 'oauth2', key: 'stand-in-BORROWED0123456789ab' }; };
  const connection = { host: 'gitlab', mode: 'as-is', project: 'team/product', baseUrl: 'https://gitlab.example.org', backend: 'rest' };
  const env = await readEnv(connection, { borrow });
  assert.deepEqual(lent, [{ host: 'gitlab.example.org', base: 'https://gitlab.example.org', repoPath: 'team/product' }]);
  assert.equal(env.GIT_CONFIG_COUNT, '1');
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://gitlab.example.org/.extraheader');
  assert.equal(env.GIT_CONFIG_VALUE_0, `AUTHORIZATION: basic ${Buffer.from('oauth2:stand-in-BORROWED0123456789ab').toString('base64')}`);
  assert.ok(!('GITLAB_TOKEN' in env) && !('GH_TOKEN' in env), 'the tool\'s own variables carry nothing');
  const github = await readEnv({ host: 'github', mode: 'as-is', project: 'a/b', backend: 'rest' }, { borrow });
  assert.equal(github.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
});

test('reads need no key from the web API on any other connection, or when git has none to lend', async () => {
  const never = async () => { throw new Error('nothing should be borrowed'); };
  assert.deepEqual(await readEnv({ host: 'gitlab', mode: 'as-is', project: 'a/b' }, { borrow: never }), {});
  assert.deepEqual(await readEnv({ host: 'gitlab', mode: 'as-is', project: 'a/b', backend: 'cli' }, { borrow: never }), {});
  assert.deepEqual(await readEnv({ host: 'gitlab', mode: 'quick', project: 'a/b', backend: 'rest' }, { borrow: never }), {});
  assert.deepEqual(await readEnv({ host: 'gitlab', mode: 'as-is', project: 'a/b', backend: 'rest' }, { borrow: async () => null }), {});
});
