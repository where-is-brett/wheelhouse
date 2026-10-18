// tests/scripts/host/github-app.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDeviceSignIn, waitForSignIn, renewKeys, installUrl } from '../../../scripts/host/github-app.js';

const NOW = new Date('2026-10-18T01:00:00.000Z');
const now = () => NOW;

// A fake fetch: records each request and answers from a queue of canned bodies.
function fakeFetch(...answers) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, method: options.method, headers: options.headers, form: Object.fromEntries(new URLSearchParams(options.body)) });
    const answer = answers.shift();
    const status = answer.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => answer.body, text: async () => JSON.stringify(answer.body) };
  };
  return { fetch, calls };
}

const tokens = {
  access_token: 'ghu_ACCESS',
  expires_in: 28800,
  refresh_token: 'ghr_RENEW',
  refresh_token_expires_in: 15811200,
  token_type: 'bearer',
};

test('startDeviceSignIn asks GitHub for a code and returns it', async () => {
  const { fetch, calls } = fakeFetch({
    body: { device_code: 'dev123', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 },
  });
  const result = await startDeviceSignIn({ clientId: 'Iv1.abc', fetch });
  assert.deepEqual(result, {
    userCode: 'ABCD-1234',
    verificationUri: 'https://github.com/login/device',
    deviceCode: 'dev123',
    interval: 5,
    expiresIn: 900,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://github.com/login/device/code');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Accept, 'application/json');
  assert.deepEqual(calls[0].form, { client_id: 'Iv1.abc' });
});

test('waitForSignIn waits while pending, slows down when told, and returns the keys', async () => {
  const { fetch, calls } = fakeFetch(
    { body: { error: 'authorization_pending' } },
    { body: { error: 'slow_down', interval: 10 } },
    { body: tokens },
  );
  const sleeps = [];
  const keys = await waitForSignIn({ clientId: 'Iv1.abc', deviceCode: 'dev123', interval: 5, fetch, sleep: async (s) => sleeps.push(s), now });
  assert.deepEqual(sleeps, [5, 10]);
  assert.deepEqual(keys, {
    accessToken: 'ghu_ACCESS',
    accessExpiresAt: '2026-10-18T09:00:00.000Z',
    refreshToken: 'ghr_RENEW',
    refreshExpiresAt: '2027-04-19T01:00:00.000Z',
  });
  assert.equal(calls[0].url, 'https://github.com/login/oauth/access_token');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Accept, 'application/json');
  assert.deepEqual(calls[0].form, {
    client_id: 'Iv1.abc',
    device_code: 'dev123',
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
});

test('waitForSignIn stops when the code expires or is refused', async () => {
  for (const error of ['expired_token', 'access_denied']) {
    const { fetch } = fakeFetch({ body: { error } });
    await assert.rejects(
      waitForSignIn({ clientId: 'Iv1.abc', deviceCode: 'dev123', interval: 5, fetch, sleep: async () => {}, now }),
      /not completed/,
    );
  }
});

test('renewKeys exchanges the renewal key with the client ID alone, never a secret', async () => {
  const { fetch, calls } = fakeFetch({ body: tokens }, { body: tokens });
  const keys = await renewKeys({ clientId: 'Iv1.abc', refreshToken: 'ghr_OLD', fetch, now });
  assert.equal(keys.accessToken, 'ghu_ACCESS');
  assert.equal(keys.refreshToken, 'ghr_RENEW');
  assert.equal(calls[0].url, 'https://github.com/login/oauth/access_token');
  assert.deepEqual(calls[0].form, { client_id: 'Iv1.abc', grant_type: 'refresh_token', refresh_token: 'ghr_OLD' });

  await renewKeys({ clientId: 'Iv1.abc', clientSecret: 'shh', refreshToken: 'ghr_OLD', fetch, now });
  assert.deepEqual(calls[1].form, { client_id: 'Iv1.abc', grant_type: 'refresh_token', refresh_token: 'ghr_OLD' });
});

test('keys with expiry switched off come back with null expiries and no renewal key', async () => {
  const { fetch } = fakeFetch({ body: { access_token: 'ghu_FOREVER', token_type: 'bearer' } });
  const keys = await waitForSignIn({ clientId: 'Iv1.abc', deviceCode: 'dev123', interval: 5, fetch, sleep: async () => {}, now });
  assert.deepEqual(keys, { accessToken: 'ghu_FOREVER', accessExpiresAt: null, refreshToken: null, refreshExpiresAt: null });
});

test('waitForSignIn waits five seconds when GitHub gave no interval', async () => {
  for (const interval of [undefined, null, 0, NaN, 'x']) {
    const { fetch } = fakeFetch({ body: { error: 'authorization_pending' } }, { body: { error: 'slow_down' } }, { body: tokens });
    const sleeps = [];
    await waitForSignIn({ clientId: 'Iv1.abc', deviceCode: 'dev123', interval, fetch, sleep: async (s) => sleeps.push(s), now });
    assert.deepEqual(sleeps, [5, 10], String(interval));
  }
});

test('an answer that is not JSON, or is null, is named without quoting it', async () => {
  const notJson = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token g in "ghu_LEAKED"'); } });
  const nullBody = async () => ({ ok: true, status: 200, json: async () => null });
  for (const fetch of [notJson, nullBody]) {
    for (const attempt of [
      () => startDeviceSignIn({ clientId: 'Iv1.abc', fetch }),
      () => waitForSignIn({ clientId: 'Iv1.abc', deviceCode: 'dev123', interval: 5, fetch, sleep: async () => {}, now }),
      () => renewKeys({ clientId: 'Iv1.abc', refreshToken: 'ghr_OLD', fetch, now }),
    ]) {
      await assert.rejects(attempt(), (error) => {
        assert.ok(!(error instanceof SyntaxError));
        assert.doesNotMatch(error.message, /LEAKED|ghr_OLD/);
        assert.match(error.message, /GitHub/);
        return true;
      });
    }
  }
});

test('no function puts a key in a thrown message', async () => {
  const leaky = 'ghu_LEAKED ghr_LEAKED shh';
  const failures = [
    () => startDeviceSignIn({ clientId: 'Iv1.abc', fetch: fakeFetch({ status: 500, body: { message: leaky } }).fetch }),
    () => waitForSignIn({ clientId: 'Iv1.abc', deviceCode: 'dev123', interval: 5, fetch: fakeFetch({ status: 500, body: { access_token: leaky } }).fetch, sleep: async () => {} }),
    () => waitForSignIn({ clientId: 'Iv1.abc', deviceCode: 'dev123', interval: 5, fetch: fakeFetch({ body: { error: leaky } }).fetch, sleep: async () => {} }),
    () => renewKeys({ clientId: 'Iv1.abc', clientSecret: 'shh', refreshToken: 'ghr_OLD', fetch: fakeFetch({ status: 500, body: { refresh_token: leaky } }).fetch }),
    () => renewKeys({ clientId: 'Iv1.abc', clientSecret: 'shh', refreshToken: 'ghr_OLD', fetch: fakeFetch({ body: { error: leaky } }).fetch }),
  ];
  for (const attempt of failures) {
    await assert.rejects(attempt(), (error) => {
      assert.doesNotMatch(error.message, /LEAKED|shh|ghr_OLD/);
      return true;
    });
  }
});

test('installUrl points at the install page for the app', () => {
  assert.equal(installUrl('wheelhouse-check-1a2b'), 'https://github.com/apps/wheelhouse-check-1a2b/installations/new');
  assert.throws(() => installUrl('../evil?x=1'), /app name/);
});
