// tests/scripts/host/connection.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { childEnv, installationCovers, renewalDue } from '../../../scripts/host/connection.js';
import { readKey, writeKey } from '../../../scripts/host/keys.js';
import { makeAdapter } from '../../../scripts/host/adapter.js';

const NOW = new Date('2026-10-18T01:00:00.000Z');
const now = () => NOW;
const at = (ms) => new Date(NOW.getTime() + ms).toISOString();
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

async function withHome(fn) {
  const home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-conn-')), 'home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    return await fn(home);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

// A fake fetch: records each request and answers from a queue.
function fakeFetch(...answers) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const form = typeof options.body === 'string' ? Object.fromEntries(new URLSearchParams(options.body)) : undefined;
    calls.push({ url: String(url), method: options.method ?? 'GET', headers: options.headers ?? {}, body: options.body, form });
    const answer = answers.shift() ?? { status: 500, body: {} };
    const status = answer.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => answer.body, text: async () => JSON.stringify(answer.body) };
  };
  return { fetch, calls };
}

const noFetch = async () => { throw new Error('nothing should be fetched'); };

const GITHUB = { host: 'github', mode: 'narrow', project: 'a-director/product' };
const GITLAB = { host: 'gitlab', mode: 'narrow', project: 'a-director/product', projectId: 4242 };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function githubKeys(overrides = {}) {
  return {
    clientId: 'Iv1.abc',
    installationId: 99,
    accessToken: 'ghu_CURRENT',
    accessExpiresAt: at(8 * 60 * MINUTE),
    refreshToken: 'ghr_CURRENT',
    refreshExpiresAt: at(180 * DAY),
    ...overrides,
  };
}

const renewed = {
  access_token: 'ghu_RENEWED',
  expires_in: 28800,
  refresh_token: 'ghr_RENEWED',
  refresh_token_expires_in: 15811200,
  token_type: 'bearer',
};

// --- childEnv ---

test('quick gives the tools nothing, so they use the existing sign-in', async () => {
  await withHome(async () => {
    for (const host of ['github', 'gitlab']) {
      assert.deepEqual(await childEnv({ host, mode: 'quick', project: 'a-director/product' }, { fetch: noFetch, now }), {});
    }
  });
});

test('a Locked project refuses quick', async () => {
  await withHome(async () => {
    await assert.rejects(
      childEnv({ host: 'github', mode: 'quick', project: 'a-director/product', locked: true }, { fetch: noFetch, now }),
      /Locked needs the narrow connection/,
    );
  });
});

test('narrow on GitHub uses a current access key as it is', async () => {
  await withHome(async () => {
    writeKey('github-app', githubKeys());
    const env = await childEnv({ ...GITHUB, locked: true }, { fetch: noFetch, now });
    assert.deepEqual(env, {
      GH_TOKEN: 'ghu_CURRENT',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${b64('x-access-token:ghu_CURRENT')}`,
    });
  });
});

test('narrow on GitHub renews an access key with under ten minutes left, and saves it', async () => {
  await withHome(async () => {
    writeKey('github-app', githubKeys({ accessExpiresAt: at(10 * MINUTE - 1) }));
    const { fetch, calls } = fakeFetch({ body: renewed });
    const env = await childEnv(GITHUB, { fetch, now });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://github.com/login/oauth/access_token');
    assert.equal(env.GH_TOKEN, 'ghu_RENEWED');
    assert.equal(env.GIT_CONFIG_VALUE_0, `AUTHORIZATION: basic ${b64('x-access-token:ghu_RENEWED')}`);
    const saved = readKey('github-app');
    assert.equal(saved.accessToken, 'ghu_RENEWED');
    assert.equal(saved.accessExpiresAt, '2026-10-18T09:00:00.000Z');
    assert.equal(saved.refreshToken, 'ghr_RENEWED');
    assert.equal(saved.clientId, 'Iv1.abc');
    assert.equal(saved.installationId, 99);
  });
});

test('an access key with ten minutes or more left is not renewed', async () => {
  await withHome(async () => {
    writeKey('github-app', githubKeys({ accessExpiresAt: at(10 * MINUTE) }));
    const env = await childEnv(GITHUB, { fetch: noFetch, now });
    assert.equal(env.GH_TOKEN, 'ghu_CURRENT');
  });
});

test('renewing sends the client ID and no client secret', async () => {
  await withHome(async () => {
    writeKey('github-app', githubKeys({ accessExpiresAt: at(-MINUTE), clientSecret: 'shh' }));
    const { fetch, calls } = fakeFetch({ body: renewed });
    await childEnv(GITHUB, { fetch, now });
    assert.deepEqual(calls[0].form, { client_id: 'Iv1.abc', grant_type: 'refresh_token', refresh_token: 'ghr_CURRENT' });
    assert.ok(!('client_secret' in calls[0].form));
    assert.doesNotMatch(calls[0].body, /secret|shh/);
  });
});

test('an access key with no expiry is used as it is, and never renewed', async () => {
  await withHome(async () => {
    writeKey('github-app', githubKeys({ accessExpiresAt: null, refreshToken: null, refreshExpiresAt: null }));
    const env = await childEnv(GITHUB, { fetch: noFetch, now });
    assert.equal(env.GH_TOKEN, 'ghu_CURRENT');
  });
});

test('a failed renewal throws a plain error with no key in it', async () => {
  await withHome(async () => {
    writeKey('github-app', githubKeys({ accessExpiresAt: at(MINUTE) }));
    const failures = [
      fakeFetch({ status: 500, body: { access_token: 'ghu_LEAKED' } }).fetch,
      fakeFetch({ body: { error: 'bad_refresh_token', refresh_token: 'ghr_LEAKED' } }).fetch,
      async () => { throw new Error('socket closed holding ghr_CURRENT'); },
    ];
    for (const fetch of failures) {
      await assert.rejects(childEnv(GITHUB, { fetch, now }), (error) => {
        assert.match(error.message, /renew/);
        assert.doesNotMatch(error.message, /LEAKED|CURRENT/);
        return true;
      });
    }
    assert.equal(readKey('github-app').accessToken, 'ghu_CURRENT', 'nothing is saved');
  });
});

test('narrow with no keys says so plainly', async () => {
  await withHome(async () => {
    await assert.rejects(childEnv(GITHUB, { fetch: noFetch, now }), /no keys|sign in/i);
    await assert.rejects(childEnv(GITLAB, { fetch: noFetch, now }), /no key|GitLab/i);
  });
});

test('narrow on GitLab gives a pasted token the same environment as a project key', async () => {
  await withHome(async () => {
    const expected = (key) => ({
      GITLAB_TOKEN: key,
      GITLAB_HOST: 'gitlab.com',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://gitlab.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${b64(`oauth2:${key}`)}`,
    });
    writeKey('gitlab-project-4242', { kind: 'project-key', token: 'glpat-PROJECTKEY', expiresAt: '2027-10-01' });
    assert.deepEqual(await childEnv(GITLAB, { fetch: noFetch, now }), expected('glpat-PROJECTKEY'));
    writeKey('gitlab-project-4242', { kind: 'pasted-token', token: 'glpat-PASTED', expiresAt: null });
    assert.deepEqual(await childEnv(GITLAB, { fetch: noFetch, now }), expected('glpat-PASTED'));
  });
});

test('narrow on a self-managed GitLab names its host and its own header', async () => {
  await withHome(async () => {
    writeKey('gitlab-project-4242', { kind: 'project-key', token: 'glpat-PROJECTKEY', expiresAt: '2027-10-01' });
    const env = await childEnv({ ...GITLAB, baseUrl: 'https://git.example.org:8443/' }, { fetch: noFetch, now });
    assert.equal(env.GITLAB_HOST, 'git.example.org:8443');
    assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://git.example.org:8443/.extraheader');
    await assert.rejects(childEnv({ ...GITLAB, baseUrl: 'http://git.example.org' }, { fetch: noFetch, now }), /https/);
  });
});

test('the key reaches git through the environment, never an argument', async () => {
  await withHome(async () => {
    writeKey('github-app', githubKeys());
    writeKey('gitlab-project-4242', { kind: 'project-key', token: 'glpat-PROJECTKEY', expiresAt: '2027-10-01' });
    for (const connection of [GITHUB, GITLAB]) {
      const env = await childEnv(connection, { fetch: noFetch, now });
      const key = connection.host === 'github' ? 'ghu_CURRENT' : 'glpat-PROJECTKEY';
      // The returned object is plain strings, and is the only thing carrying the key.
      for (const value of Object.values(env)) assert.equal(typeof value, 'string');
      assert.equal(env[connection.host === 'github' ? 'GH_TOKEN' : 'GITLAB_TOKEN'], key);

      const calls = [];
      const run = async (file, args, options = {}) => {
        calls.push({ file, args, env: options.env });
        return { code: 0, stdout: connection.host === 'github' ? '{"defaultBranchRef":{"name":"main"}}' : '{"default_branch":"main"}', stderr: '' };
      };
      const adapter = makeAdapter({ host: connection.host, repo: connection.project, run, env });
      await adapter.defaultBranch().catch(() => {});
      assert.ok(calls.length >= 1);
      for (const call of calls) {
        assert.equal(call.env, env);
        for (const arg of call.args) {
          for (const value of Object.values(env)) {
            if (value.length >= 8) assert.ok(!arg.includes(value), `${call.file} ${call.args.join(' ')}`);
          }
          assert.ok(!arg.includes(key));
        }
      }
    }
  });
});

test('childEnv refuses a connection it does not understand', async () => {
  await withHome(async () => {
    const bad = [
      { host: 'bitbucket', mode: 'quick', project: 'a/b' },
      { host: 'github', mode: 'wide', project: 'a/b' },
      { host: 'gitlab', mode: 'narrow', project: 'a/b' }, // no projectId
      null,
    ];
    for (const connection of bad) await assert.rejects(childEnv(connection, { fetch: noFetch, now }));
  });
});

// --- installationCovers ---

function repos(names) {
  return { total_count: names.length, repositories: names.map((full_name) => ({ full_name })) };
}

test('installationCovers returns the settings page when the project is not in the installation', async () => {
  await withHome(async () => {
    writeKey('github-app', githubKeys());
    const { fetch, calls } = fakeFetch({ body: repos(['a-director/profile']) });
    const result = await installationCovers(GITHUB, { fetch, now });
    assert.deepEqual(result, { covered: false, settingsUrl: 'https://github.com/settings/installations/99' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url, 'https://api.github.com/user/installations/99/repositories?per_page=100&page=1');
    assert.equal(calls[0].headers.Authorization, 'Bearer ghu_CURRENT');
  });
});

test('installationCovers follows the pages, and matches the project whatever its case', async () => {
  await withHome(async () => {
    writeKey('github-app', githubKeys());
    const first = Array.from({ length: 100 }, (_, i) => `a-director/repo-${i}`);
    const { fetch, calls } = fakeFetch({ body: repos(first) }, { body: repos(['A-Director/Product']) });
    assert.deepEqual(await installationCovers(GITHUB, { fetch, now }), { covered: true });
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /page=2$/);
    for (const call of calls) assert.equal(call.method, 'GET', 'it never tries to add the repository');
  });
});

test('installationCovers is for GitHub narrow only, and its errors hold no key', async () => {
  await withHome(async () => {
    writeKey('github-app', githubKeys());
    await assert.rejects(installationCovers({ ...GITHUB, mode: 'quick' }, { fetch: noFetch, now }), /narrow/);
    await assert.rejects(installationCovers(GITLAB, { fetch: noFetch, now }), /GitHub/);
    const { fetch } = fakeFetch({ status: 401, body: { message: 'ghu_LEAKED' } });
    await assert.rejects(installationCovers(GITHUB, { fetch, now }), (error) => {
      assert.doesNotMatch(error.message, /LEAKED|CURRENT/);
      return true;
    });
  });
});

// --- renewalDue ---

test('renewalDue is true fourteen days before the renewal key expires', async () => {
  await withHome(async () => {
    writeKey('github-app', githubKeys({ refreshExpiresAt: at(14 * DAY) }));
    assert.deepEqual(renewalDue(GITHUB, now), { due: true, on: '2026-11-01' });
    writeKey('github-app', githubKeys({ refreshExpiresAt: at(14 * DAY + 1) }));
    assert.deepEqual(renewalDue(GITHUB, now), { due: false });
    writeKey('github-app', githubKeys({ refreshExpiresAt: null, refreshToken: null }));
    assert.deepEqual(renewalDue(GITHUB, now), { due: false });
  });
});

test('renewalDue uses the GitLab project key or pasted token expiry', async () => {
  await withHome(async () => {
    writeKey('gitlab-project-4242', { kind: 'project-key', token: 'glpat-X', expiresAt: '2026-10-30' });
    assert.deepEqual(renewalDue(GITLAB, now), { due: true, on: '2026-10-30' });
    writeKey('gitlab-project-4242', { kind: 'project-key', token: 'glpat-X', expiresAt: '2027-10-01' });
    assert.deepEqual(renewalDue(GITLAB, now), { due: false });
    writeKey('gitlab-project-4242', { kind: 'pasted-token', token: 'glpat-X', expiresAt: '2026-10-25' });
    assert.deepEqual(renewalDue(GITLAB, NOW), { due: true, on: '2026-10-25' });
    writeKey('gitlab-project-4242', { kind: 'pasted-token', token: 'glpat-X', expiresAt: null });
    assert.deepEqual(renewalDue(GITLAB, now), { due: false });
  });
});

test('renewalDue is false for quick', async () => {
  await withHome(async () => {
    assert.deepEqual(renewalDue({ host: 'github', mode: 'quick', project: 'a/b' }, now), { due: false });
  });
});
