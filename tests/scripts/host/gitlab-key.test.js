// tests/scripts/host/gitlab-key.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProjectKey, gitlabApi } from '../../../scripts/host/gitlab-key.js';

const NOW = new Date('2026-10-18T01:00:00.000Z');
const now = () => NOW;

// A fake api: records each call and answers from a queue.
function fakeApi(...answers) {
  const calls = [];
  const call = (method) => async (path, body) => {
    calls.push({ method, path, body });
    return answers.shift();
  };
  return { api: { get: call('GET'), post: call('POST'), put: call('PUT'), delete: call('DELETE') }, calls };
}

const created = { status: 201, body: { id: 77, token: 'glpat-PROJECTKEY', expires_at: '2026-11-17', scopes: ['api', 'write_repository'] } };

test('makeProjectKey asks for a Developer key with api and write_repository, expiring within 365 days', async () => {
  const { api, calls } = fakeApi(created);
  const key = await makeProjectKey({ api, projectId: 'group/sub/my project', name: 'wheelhouse', days: 30, now });
  assert.deepEqual(key, { token: 'glpat-PROJECTKEY', expiresAt: '2026-11-17', id: 77 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].path, '/projects/group%2Fsub%2Fmy%20project/access_tokens');
  assert.deepEqual(calls[0].body, {
    name: 'wheelhouse',
    scopes: ['api', 'write_repository'],
    access_level: 30,
    expires_at: '2026-11-17',
  });
});

test('makeProjectKey accepts a numeric project and the longest expiry', async () => {
  const { api, calls } = fakeApi(created);
  await makeProjectKey({ api, projectId: 4242, name: 'wheelhouse', days: 365, now });
  assert.equal(calls[0].path, '/projects/4242/access_tokens');
  assert.equal(calls[0].body.expires_at, '2027-10-18');
});

test('makeProjectKey can ask for a Maintainer key, and refuses any other level', async () => {
  const { api, calls } = fakeApi(created);
  await makeProjectKey({ api, projectId: 1, name: 'w', days: 30, accessLevel: 40, now });
  assert.equal(calls[0].body.access_level, 40);
  for (const accessLevel of [50, 20, 0, '40']) {
    await assert.rejects(makeProjectKey({ api: fakeApi().api, projectId: 1, name: 'w', days: 30, accessLevel, now }), /Developer/);
  }
});

test('makeProjectKey refuses more than 365 days, and nonsense', async () => {
  for (const days of [366, 400, 0, -1, 1.5, NaN, undefined, '30']) {
    const { api, calls } = fakeApi(created);
    await assert.rejects(makeProjectKey({ api, projectId: 1, name: 'w', days, now }), /days/, `days = ${days}`);
    assert.equal(calls.length, 0, 'nothing is sent');
  }
});

test('makeProjectKey explains the common refusals without echoing GitLab\'s body', async () => {
  const cases = [
    [{ status: 401, body: {} }, /sign-in/],
    [{ status: 403, body: {} }, /Maintainer/],
    [{ status: 404, body: {} }, /project/],
    [{ status: 400, body: {} }, /refused/],
  ];
  for (const [answer, pattern] of cases) {
    const { api } = fakeApi(answer);
    await assert.rejects(makeProjectKey({ api, projectId: 1, name: 'w', days: 30, now }), pattern);
  }
});

test('errors from GitLab never include the key', async () => {
  const leaky = 'glpat-LEAKED';
  const bodies = [
    { status: 400, body: { message: leaky, token: leaky } },
    { status: 201, body: { id: 1, message: leaky } }, // answered, but no key came back
    { status: 201, body: { token: 5, message: leaky } },
  ];
  for (const answer of bodies) {
    const { api } = fakeApi(answer);
    await assert.rejects(makeProjectKey({ api, projectId: 1, name: 'w', days: 30, now }), (error) => {
      assert.doesNotMatch(error.message, /LEAKED/);
      return true;
    });
  }
});

// A fake fetch for gitlabApi.
function fakeFetch(...answers) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, method: options.method, headers: options.headers, body: options.body });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    const text = answer.text ?? JSON.stringify(answer.body ?? {});
    return { status: answer.status ?? 200, text: async () => text };
  };
  return { fetch, calls };
}

test('gitlabApi sends the key in the PRIVATE-TOKEN header, to the v4 API', async () => {
  const { fetch, calls } = fakeFetch({ body: { a: 1 } }, { status: 201, body: { b: 2 } }, { body: {} }, { status: 204, text: '' });
  const api = gitlabApi({ baseUrl: 'https://gitlab.example.com/', token: 'glpat-SECRET', fetch });
  assert.deepEqual(await api.get('/projects/1'), { status: 200, body: { a: 1 } });
  assert.deepEqual(await api.post('/projects/1/access_tokens', { name: 'x' }), { status: 201, body: { b: 2 } });
  await api.put('/projects/1', { only_allow_merge_if_pipeline_succeeds: true });
  assert.deepEqual(await api.delete('/projects/1/access_tokens/9'), { status: 204, body: null });

  assert.equal(calls[0].url, 'https://gitlab.example.com/api/v4/projects/1');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers['PRIVATE-TOKEN'], 'glpat-SECRET');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].headers['Content-Type'], 'application/json');
  assert.equal(calls[1].body, JSON.stringify({ name: 'x' }));
  assert.equal(calls[2].method, 'PUT');
  assert.equal(calls[3].method, 'DELETE');
});

test('gitlabApi can send a sign-in token as a bearer token instead', async () => {
  const { fetch, calls } = fakeFetch({ body: {} });
  const api = gitlabApi({ token: 'oauth-SECRET', bearer: true, fetch });
  await api.get('/user');
  assert.equal(calls[0].url, 'https://gitlab.com/api/v4/user');
  assert.equal(calls[0].headers.Authorization, 'Bearer oauth-SECRET');
  assert.equal(calls[0].headers['PRIVATE-TOKEN'], undefined);
});

test('gitlabApi never puts the key in a thrown message', async () => {
  const { fetch } = fakeFetch(new Error('connect failed with header PRIVATE-TOKEN: glpat-SECRET'));
  const api = gitlabApi({ token: 'glpat-SECRET', fetch });
  await assert.rejects(api.get('/user'), (error) => {
    assert.doesNotMatch(error.message, /SECRET/);
    assert.match(error.message, /reach GitLab/);
    return true;
  });
});

test('gitlabApi refuses a base URL that is not https, except on localhost', () => {
  assert.throws(() => gitlabApi({ baseUrl: 'http://gitlab.example.com', token: 't', fetch: async () => {} }), /https/);
  assert.doesNotThrow(() => gitlabApi({ baseUrl: 'http://localhost:8080', token: 't', fetch: async () => {} }));
});

test('gitlabApi says so when no key is given', () => {
  for (const token of [undefined, '', null, 5]) {
    assert.throws(() => gitlabApi({ token, fetch: async () => {} }), /sign-in is missing/);
  }
});
