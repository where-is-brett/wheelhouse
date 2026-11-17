// tests/scripts/lib/pasted-address.test.js
// The reading of a pasted project address, the list of token variables, and what is kept of an address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pastedAddress, withoutSecrets, pinOf, hostOfAddress } from '../../../scripts/lib/pasted-address.js';
import { TOKEN_NAMES, withoutTokens } from '../../../scripts/lib/token-names.js';
import { repoNamed } from '../../../scripts/setup/host.js';

test('what is kept of a pasted address has no user, token or query, and reads as the same address', () => {
  for (const text of [
    'https://oauth2:glpat-SECRET@gitlab.company.example/ann/x', 'https://SECRET@gitlab.company.example/ann/x?private_token=SECRET',
    'ssh://git@gitlab.company.example/ann/x.git', 'git@gitlab.company.example:ann/x.git', 'https://github.com/ann/x/pulls#SECRET', 'github.com/ann/x',
  ]) {
    const kept = withoutSecrets(text);
    assert.equal(/SECRET/.test(kept), false, kept);
    assert.equal(repoNamed(kept), repoNamed(text), text);
    assert.deepEqual(pastedAddress(kept), pastedAddress(text), text);
  }
});

test('a backslash cannot turn one host into another in what is kept', () => {
  for (const [text, host] of [['https://github.com\\@evil.example.com/a/b', 'github.com'], ['https://evil.example.com\\@github.com/a/b', 'evil.example.com']]) {
    const kept = withoutSecrets(text);
    assert.equal(new URL(kept).hostname, host, kept);
    assert.equal(pastedAddress(kept).hostname, host, kept);
    assert.equal(new URL(kept).username, '');
  }
});

test('a user and password before an scp-form address are not kept, but git@ is', () => {
  assert.equal(withoutSecrets('oauth2:S3cret@gitlab.example.com:a/b'), 'gitlab.example.com:a/b');
  assert.equal(withoutSecrets('S3cret@gitlab.example.com:a/b'), 'gitlab.example.com:a/b');
  assert.equal(withoutSecrets('git@gitlab.example.com:a/b'), 'git@gitlab.example.com:a/b');
});

test('a host written with its root dot is read as the host', () => {
  for (const bare of ['https://localhost./a/b', 'https://foo.localhost./a/b', 'https://127.0.0.1./a/b']) assert.deepEqual(pastedAddress(bare), { unreadable: true }, bare);
  assert.deepEqual(pinOf('https://gitlab.com./a/b'), { host: 'gitlab', company: { base: 'https://gitlab.com' } });
  assert.deepEqual(pinOf('https://github.com./a/b'), { host: 'github' });
  assert.equal(hostOfAddress(pastedAddress('https://www.github.com./a/b')), 'github');
  // Any other host with a root dot stays refused.
  assert.deepEqual(pinOf('https://gitlab.example.org./a/b'), { unreadable: true });
  assert.deepEqual(pastedAddress('https://bitbucket.org./a/b'), { forge: true });
});

test('one list of token variables serves the survey, the foreman, glab, git and the store', () => {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GL_TOKEN', 'GLAB_TOKEN', 'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN', 'GH_ENTERPRISE_TOKEN']) assert.ok(TOKEN_NAMES.includes(name), name);
  const out = withoutTokens();
  for (const name of TOKEN_NAMES) assert.equal(Object.hasOwn(out, name) && out[name] === undefined, true, name);
});
