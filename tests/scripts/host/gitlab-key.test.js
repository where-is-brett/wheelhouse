// tests/scripts/host/gitlab-key.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProjectKey, gitlabApi, hostCurl } from '../../../scripts/host/gitlab-key.js';
import { makeFakeCurl } from '../../helpers/fake-curl.js';

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

// gitlabApi goes through curl (a stand-in here), by the proxy it is given and with no certificate file of its own.
const CURL = '/usr/bin/curl';
const via = (fake, more = {}) => ({ run: fake.run, curl: CURL, proxy: null, caFile: null, platform: 'linux', ...more });
const configOf = (call, key) => call.pairs.find(([name]) => name === key)?.[1];
const headersOf = (call) => Object.fromEntries(call.pairs.filter(([name]) => name === 'header').map(([, value]) => value.split(/: (.*)/s).slice(0, 2)));

test('gitlabApi sends the key in the PRIVATE-TOKEN header, to the v4 API', async () => {
  const fake = makeFakeCurl([{ body: '{"a":1}' }, { status: 201, body: '{"b":2}' }, { body: '{}' }, { status: 204, body: '' }]);
  const api = gitlabApi({ baseUrl: 'https://gitlab.example.com/', token: 'glpat-SECRET', ...via(fake) });
  assert.deepEqual(await api.get('/projects/1'), { status: 200, body: { a: 1 } });
  assert.deepEqual(await api.post('/projects/1/access_tokens', { name: 'x' }), { status: 201, body: { b: 2 } });
  await api.put('/projects/1', { only_allow_merge_if_pipeline_succeeds: true });
  assert.deepEqual(await api.delete('/projects/1/access_tokens/9'), { status: 204, body: null });

  const [get, post, put, del] = fake.calls;
  assert.equal(configOf(get, 'url'), 'https://gitlab.example.com/api/v4/projects/1');
  assert.equal(configOf(get, 'request'), 'GET');
  assert.equal(headersOf(get)['PRIVATE-TOKEN'], 'glpat-SECRET');
  assert.equal(headersOf(get).Authorization, undefined);
  assert.equal(configOf(get, 'data-binary'), undefined);
  assert.equal(configOf(post, 'request'), 'POST');
  assert.equal(headersOf(post)['Content-Type'], 'application/json');
  assert.equal(configOf(post, 'data-binary'), JSON.stringify({ name: 'x' }));
  assert.equal(configOf(put, 'request'), 'PUT');
  assert.equal(configOf(del, 'request'), 'DELETE');
  for (const call of fake.calls) assert.ok(!call.args.join(' ').includes('SECRET'), 'the key is not in the arguments');
});

test('gitlabApi can send a sign-in token as a bearer token instead', async () => {
  const fake = makeFakeCurl([{ body: '{}' }]);
  const api = gitlabApi({ token: 'oauth-SECRET', bearer: true, ...via(fake) });
  await api.get('/user');
  assert.equal(configOf(fake.calls[0], 'url'), 'https://gitlab.com/api/v4/user');
  assert.equal(headersOf(fake.calls[0]).Authorization, 'Bearer oauth-SECRET');
  assert.equal(headersOf(fake.calls[0])['PRIVATE-TOKEN'], undefined);
});

test('gitlabApi gives curl the proxy it is given', async () => {
  const proxy = { proxy: 'http://proxy.example.org:8080', auth: 'ntlm', user: ':', noProxy: null, source: 'git' };
  const fake = makeFakeCurl([{ body: '{}' }]);
  await gitlabApi({ token: 't', ...via(fake, { proxy }) }).get('/user');
  assert.equal(configOf(fake.calls[0], 'proxy'), 'http://proxy.example.org:8080');
  assert.ok(fake.calls[0].pairs.some(([name]) => name === 'proxy-ntlm'));
});

test('a client made where tests cannot hand it a stand-in takes the stand-in from hostCurl', async () => {
  const fake = makeFakeCurl([{ body: '{"ok":true}' }]);
  Object.assign(hostCurl, via(fake));
  try {
    assert.deepEqual(await gitlabApi({ token: 't' }).get('/user'), { status: 200, body: { ok: true } });
  } finally {
    for (const name of Object.keys(hostCurl)) delete hostCurl[name];
  }
  assert.equal(fake.calls.length, 1);
});

test('gitlabApi never puts the key in a thrown message, and says why GitLab was not reached', async () => {
  const cases = [
    [{ exit: 7, stderr: 'curl: (7) connect failed with header PRIVATE-TOKEN: glpat-SECRET' }, 'HOST_UNREACHABLE'],
    [{ exit: 60, stderr: 'curl: (60) SSL certificate problem glpat-SECRET' }, 'CERTIFICATE_NOT_TRUSTED'],
    [{ exit: 56, connect: 407, stderr: 'CONNECT tunnel failed, response 407' }, 'PROXY_REFUSED'],
    [{ exit: 28, stderr: 'timed out' }, 'HOST_UNREACHABLE'],
  ];
  for (const [answer, code] of cases) {
    const api = gitlabApi({ token: 'glpat-SECRET', ...via(makeFakeCurl([answer])) });
    await assert.rejects(api.get('/user'), (error) => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /SECRET|PRIVATE-TOKEN|curl/);
      return true;
    });
  }
});

test('a computer with no curl says so', async () => {
  const api = gitlabApi({ token: 'glpat-SECRET', run: async () => assert.fail('nothing was run'), proxy: null, caFile: null, platform: 'win32', curl: '' });
  await assert.rejects(api.get('/user'), (error) => error.code === 'NO_CURL');
});

test('gitlabApi refuses a base URL that is not https, except on localhost', () => {
  assert.throws(() => gitlabApi({ baseUrl: 'http://gitlab.example.com', token: 't' }), /https/);
  assert.doesNotThrow(() => gitlabApi({ baseUrl: 'http://localhost:8080', token: 't' }));
});

test('gitlabApi says so when no key is given', () => {
  for (const token of [undefined, '', null, 5]) {
    assert.throws(() => gitlabApi({ token }), /sign-in is missing/);
  }
});
