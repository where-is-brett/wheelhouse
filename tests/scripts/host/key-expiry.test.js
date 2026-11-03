// tests/scripts/host/key-expiry.test.js
// When the board raises a GitLab key's renewal (design section 6): from the expiry kept with a narrow key, else
// from GitLab's own answer for the key, asked once a day; and a key GitLab refuses, or none at all, said at once.
// A stand-in curl and a stand-in lender: no test reaches GitLab, the keychain or the credential store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renewalDue } from '../../../scripts/host/connection.js';
import { withHome } from '../../helpers/homes.js';
import { makeRoutedCurl } from '../../helpers/fake-curl.js';

const NOW = new Date('2026-11-04T01:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const clockAt = (ms) => () => new Date(NOW.getTime() + ms);
const BASE = 'https://gitlab.example.org';
const KEY = 'stand-in-OWN0123456789abcdefg';

const NARROW = { host: 'gitlab', mode: 'narrow', project: 'team/product', projectId: 4242, baseUrl: BASE };
const ASIS = { host: 'gitlab', mode: 'as-is', project: 'team/product', baseUrl: BASE, backend: 'rest' };

const storeWith = (value) => ({ store: { readKey: async (name) => (value && name === 'gitlab-project-4242' ? value : null) } });

function stands(answer) {
  const curl = makeRoutedCurl((call) => answer(call));
  let lent = 0;
  const borrow = async () => { lent += 1; return { username: 'oauth2', key: KEY }; };
  const noKey = async () => null;
  return {
    curl, lent: () => lent, borrow, noKey,
    via: (extra = {}) => ({ run: curl.run, curl: '/usr/bin/curl', proxy: null, caFile: null, platform: 'linux', baseEnv: {}, borrow, ...extra }),
  };
}

test('a narrow key with an expiry kept is judged from it, and GitLab is not asked', async () => {
  await withHome(async () => {
    const s = stands(() => ({ status: 500 }));
    const keys = storeWith({ kind: 'project-key', token: 'stand-in-X', expiresAt: '2026-11-10' });
    assert.deepEqual(await renewalDue(NARROW, () => NOW, keys, s.via()), { due: true, on: '2026-11-10' });
    assert.equal(s.curl.calls.length, 0);
  });
});

test('a narrow key with no expiry kept is asked of GitLab, with the key in a header and not in the address', async () => {
  await withHome(async () => {
    const s = stands(() => ({ status: 200, body: { expires_at: '2026-11-12' } }));
    const keys = storeWith({ kind: 'pasted-token', token: 'stand-in-PASTED', expiresAt: null });
    assert.deepEqual(await renewalDue(NARROW, () => NOW, keys, s.via()), { due: true, on: '2026-11-12' });
    assert.equal(s.curl.calls.length, 1);
    const [call] = s.curl.calls;
    assert.equal(call.url, `${BASE}/api/v4/personal_access_tokens/self`);
    assert.equal(call.method, 'GET');
    assert.ok(call.headers.includes('PRIVATE-TOKEN: stand-in-PASTED'));
    assert.ok(!call.args.join(' ').includes('stand-in-PASTED'), 'the key is not an argument');
  });
});

test('the director\'s own key (as-is) is borrowed, asked of GitLab, and the answer kept for a day', async () => {
  await withHome(async () => {
    const s = stands(() => ({ status: 200, body: { expires_at: '2026-11-09' } }));
    assert.deepEqual(await renewalDue(ASIS, () => NOW, undefined, s.via()), { due: true, on: '2026-11-09' });
    assert.equal(s.curl.calls.length, 1);
    // An hour later: the kept answer, no lending and no call.
    assert.deepEqual(await renewalDue(ASIS, clockAt(60 * 60 * 1000), undefined, s.via()), { due: true, on: '2026-11-09' });
    assert.equal(s.curl.calls.length, 1);
    assert.equal(s.lent(), 1);
    // A day and an hour later: asked again.
    assert.deepEqual(await renewalDue(ASIS, clockAt(DAY + 60 * 60 * 1000), undefined, s.via()), { due: true, on: '2026-11-09' });
    assert.equal(s.curl.calls.length, 2);
  });
});

test('a key with no expiry, or an expiry far off, is not due', async () => {
  await withHome(async () => {
    const none = stands(() => ({ status: 200, body: { expires_at: null } }));
    assert.deepEqual(await renewalDue(ASIS, () => NOW, undefined, none.via()), { due: false });
  });
  await withHome(async () => {
    const far = stands(() => ({ status: 200, body: { expires_at: '2027-03-01' } }));
    assert.deepEqual(await renewalDue(ASIS, () => NOW, undefined, far.via()), { due: false });
  });
});

test('GitLab refusing the key (401) is said at once, and not kept for a day', async () => {
  await withHome(async () => {
    let status = 401;
    const s = stands(() => ({ status, body: status === 401 ? { message: '401 Unauthorized' } : { expires_at: '2027-03-01' } }));
    assert.deepEqual(await renewalDue(ASIS, () => NOW, undefined, s.via()), { due: false, key: 'refused' });
    status = 200;
    assert.deepEqual(await renewalDue(ASIS, () => NOW, undefined, s.via()), { due: false });
    assert.equal(s.curl.calls.length, 2, 'the refusal was not kept');
  });
});

test('a narrow GitLab connection with no key kept says the key is missing', async () => {
  await withHome(async () => {
    const s = stands(() => ({ status: 500 }));
    assert.deepEqual(await renewalDue(NARROW, () => NOW, storeWith(null), s.via()), { due: false, key: 'missing' });
    assert.equal(s.curl.calls.length, 0);
  });
});

test('the director\'s own key missing is said only when Wheelhouse has no tool to use instead', async () => {
  await withHome(async () => {
    const s = stands(() => ({ status: 500 }));
    assert.deepEqual(await renewalDue(ASIS, () => NOW, undefined, s.via({ borrow: s.noKey })), { due: false, key: 'missing' });
    assert.deepEqual(await renewalDue({ ...ASIS, backend: 'cli' }, () => NOW, undefined, s.via({ borrow: s.noKey })), { due: false });
    assert.equal(s.curl.calls.length, 0);
  });
});

test('a GitLab that cannot be reached, or answers oddly, is not a renewal', async () => {
  await withHome(async () => {
    const down = stands(() => ({ exit: 7 }));
    assert.deepEqual(await renewalDue(ASIS, () => NOW, undefined, down.via()), { due: false });
    const odd = stands(() => ({ status: 200, body: 'not json' }));
    assert.deepEqual(await renewalDue(ASIS, () => NOW, undefined, odd.via()), { due: false });
    const gone = stands(() => ({ status: 404, body: {} }));
    assert.deepEqual(await renewalDue(ASIS, () => NOW, undefined, gone.via()), { due: false });
  });
});

test('a narrow key with no expiry is asked of GitLab once a day, not on every load', async () => {
  await withHome(async () => {
    const s = stands(() => ({ status: 200, body: { expires_at: '2026-11-12' } }));
    const keys = storeWith({ kind: 'pasted-token', token: 'stand-in-PASTED', expiresAt: null });
    await renewalDue(NARROW, () => NOW, keys, s.via());
    assert.deepEqual(await renewalDue(NARROW, clockAt(3600 * 1000), keys, s.via()), { due: true, on: '2026-11-12' });
    assert.equal(s.curl.calls.length, 1);
    // A new token is not judged by the old one's answer.
    const other = storeWith({ kind: 'pasted-token', token: 'stand-in-NEWTOKEN', expiresAt: null });
    await renewalDue(NARROW, clockAt(3600 * 1000), other, s.via());
    assert.equal(s.curl.calls.length, 2);
  });
});

test('a call that failed is not repeated for fifteen minutes, and a refusal is never kept', async () => {
  await withHome(async () => {
    const down = stands(() => ({ exit: 7 }));
    const keys = storeWith({ kind: 'pasted-token', token: 'stand-in-PASTED', expiresAt: null });
    assert.deepEqual(await renewalDue(NARROW, () => NOW, keys, down.via()), { due: false });
    assert.deepEqual(await renewalDue(NARROW, clockAt(10 * 60 * 1000), keys, down.via()), { due: false });
    assert.equal(down.curl.calls.length, 1);
    await renewalDue(NARROW, clockAt(16 * 60 * 1000), keys, down.via());
    assert.equal(down.curl.calls.length, 2);
    const odd = stands(() => ({ status: 200, body: 'not json' }));
    await renewalDue(ASIS, () => NOW, undefined, odd.via());
    await renewalDue(ASIS, clockAt(60 * 1000), undefined, odd.via());
    assert.equal(odd.curl.calls.length, 1);
    const refused = stands(() => ({ status: 401, body: {} }));
    const other = { ...NARROW, projectId: 4243, project: 'team/other' };
    const otherKeys = { store: { readKey: async () => ({ token: 'stand-in-Z', expiresAt: null }) } };
    assert.equal((await renewalDue(other, () => NOW, otherKeys, refused.via())).key, 'refused');
    assert.equal((await renewalDue(other, clockAt(1000), otherKeys, refused.via())).key, 'refused');
    assert.equal(refused.curl.calls.length, 2);
  });
});

test('GitHub as-is and quick connections have nothing to renew', async () => {
  await withHome(async () => {
    const s = stands(() => ({ status: 500 }));
    assert.deepEqual(await renewalDue({ host: 'github', mode: 'as-is', project: 'a/b', backend: 'rest' }, () => NOW, undefined, s.via()), { due: false });
    assert.deepEqual(await renewalDue({ host: 'gitlab', mode: 'quick', project: 'a/b' }, () => NOW, undefined, s.via()), { due: false });
    assert.equal(s.curl.calls.length, 0);
  });
});
