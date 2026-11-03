// tests/scripts/host/proxy.test.js
// The director's proxy, read from their git settings and then the environment (host-access part 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProxy } from '../../../scripts/host/proxy.js';

const ADDRESS = 'https://gitlab.example.org';
// A stand-in for git: answers `config --get-urlmatch <name> <address>` from a table of settings.
const gitWith = (settings) => {
  const asked = [];
  const run = async (file, args) => {
    asked.push([file, ...args]);
    const name = args[args.indexOf('--get-urlmatch') + 1];
    return name in settings ? { code: 0, stdout: `${settings[name]}\n`, stderr: '' } : { code: 1, stdout: '', stderr: '' };
  };
  return { run, asked };
};

test('no proxy anywhere gives null', async () => {
  assert.equal(await readProxy({ address: ADDRESS, run: gitWith({}).run, env: {} }), null);
});

test('git settings are asked for the host address, by get-urlmatch', async () => {
  const git = gitWith({ 'http.proxy': 'http://proxy.example.org:8080' });
  await readProxy({ address: ADDRESS, run: git.run, env: {} });
  assert.deepEqual(git.asked[0].slice(1, 4), ['config', '--get-urlmatch', 'http.proxy']);
  assert.ok(git.asked.some((call) => call.includes(ADDRESS)));
});

test('each sign-in method maps to its curl option', async () => {
  const cases = { ntlm: 'ntlm', NTLM: 'ntlm', negotiate: 'negotiate', basic: 'anyauth', digest: 'anyauth', anyauth: 'anyauth', whatever: 'anyauth' };
  for (const [method, auth] of Object.entries(cases)) {
    const got = await readProxy({ address: ADDRESS, run: gitWith({ 'http.proxy': 'http://p.example.org:80', 'http.proxyAuthMethod': method }).run, env: {} });
    assert.equal(got.auth, auth, method);
  }
  const unset = await readProxy({ address: ADDRESS, run: gitWith({ 'http.proxy': 'http://p.example.org:80' }).run, env: {} });
  assert.equal(unset.auth, 'anyauth');
});

test('an address that names no user signs in as the computer\'s user', async () => {
  const got = await readProxy({ address: ADDRESS, run: gitWith({ 'http.proxy': 'http://p.example.org:80' }).run, env: {} });
  assert.equal(got.user, ':');
  assert.equal(got.proxy, 'http://p.example.org:80');
  assert.equal(got.source, 'git');
});

test('an address that names a user but no password keeps the user', async () => {
  const got = await readProxy({ address: ADDRESS, run: gitWith({ 'http.proxy': 'http://dir@p.example.org:80' }).run, env: {} });
  assert.equal(got.user, null);
  assert.match(got.proxy, /dir@p\.example\.org/);
});

test('an address holding a password is refused, in git or in the environment, without quoting it', async () => {
  for (const [git, env] of [[{ 'http.proxy': 'http://dir:hunter2@p.example.org:80' }, {}], [{}, { HTTPS_PROXY: 'http://dir:hunter2@p.example.org:80' }]]) {
    await assert.rejects(readProxy({ address: ADDRESS, run: gitWith(git).run, env }), (error) => {
      assert.equal(error.code, 'PROXY_HAS_PASSWORD');
      assert.match(error.message, /keep your proxy password in plain text/);
      assert.doesNotMatch(error.message, /hunter2/);
      return true;
    });
  }
});

test('with no git setting the environment is used, HTTPS_PROXY before ALL_PROXY, either case', async () => {
  const none = gitWith({}).run;
  assert.equal((await readProxy({ address: ADDRESS, run: none, env: { ALL_PROXY: 'http://a.example.org:1', https_proxy: 'http://b.example.org:2' } })).proxy, 'http://b.example.org:2');
  assert.equal((await readProxy({ address: ADDRESS, run: none, env: { ALL_PROXY: 'http://a.example.org:1' } })).proxy, 'http://a.example.org:1');
  assert.equal((await readProxy({ address: ADDRESS, run: none, env: { HTTPS_PROXY: 'http://b.example.org:2' } })).source, 'environment');
});

test('git\'s setting outranks the environment', async () => {
  const got = await readProxy({ address: ADDRESS, run: gitWith({ 'http.proxy': 'http://g.example.org:1' }).run, env: { HTTPS_PROXY: 'http://e.example.org:2' } });
  assert.equal(got.proxy, 'http://g.example.org:1');
});

test('NO_PROXY is carried, and a host it names gets no proxy', async () => {
  const env = { HTTPS_PROXY: 'http://e.example.org:2', NO_PROXY: 'example.com,.internal' };
  const got = await readProxy({ address: ADDRESS, run: gitWith({}).run, env });
  assert.equal(got.noProxy, 'example.com,.internal');
  assert.equal(await readProxy({ address: 'https://gitlab.internal', run: gitWith({}).run, env }), null);
  assert.equal(await readProxy({ address: 'https://example.com', run: gitWith({}).run, env }), null);
});

test('an empty git setting means no proxy at all', async () => {
  assert.equal(await readProxy({ address: ADDRESS, run: gitWith({ 'http.proxy': '' }).run, env: { HTTPS_PROXY: 'http://e.example.org:2' } }), null);
});

test('an address without a scheme is read as http, and git failing to run is no proxy', async () => {
  const got = await readProxy({ address: ADDRESS, run: gitWith({ 'http.proxy': 'p.example.org:8080' }).run, env: {} });
  assert.equal(got.proxy, 'http://p.example.org:8080');
  const broken = async () => { throw new Error('no git'); };
  assert.equal(await readProxy({ address: ADDRESS, run: broken, env: {} }), null);
});
