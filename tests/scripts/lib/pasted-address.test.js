// tests/scripts/lib/pasted-address.test.js
// The reading of a pasted project address, the list of token variables, and what is kept of an address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pastedAddress, withoutSecrets } from '../../../scripts/lib/pasted-address.js';
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

test('one list of token variables serves the survey, the foreman, glab, git and the store', () => {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GL_TOKEN', 'GLAB_TOKEN', 'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN', 'GH_ENTERPRISE_TOKEN']) assert.ok(TOKEN_NAMES.includes(name), name);
  const out = withoutTokens();
  for (const name of TOKEN_NAMES) assert.equal(Object.hasOwn(out, name) && out[name] === undefined, true, name);
});
