// tests/scripts/lib/token-names.test.js
// The token variables taken out of an environment: every spelling on Windows, where names are not case-sensitive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withoutTokens } from '../../../scripts/lib/token-names.js';

test('on Windows a token variable is taken out in any spelling, from the environment given or the process\'s own', () => {
  const env = { Gitlab_Token: 'secret', gh_token: 'secret', PATH: '/bin' };
  const out = withoutTokens({ env, platform: 'win32' });
  assert.ok(Object.hasOwn(out, 'Gitlab_Token') && out.Gitlab_Token === undefined);
  assert.ok(Object.hasOwn(out, 'gh_token'));
  assert.equal(Object.hasOwn(out, 'PATH'), false);
  assert.ok(Object.hasOwn(out, 'GITLAB_TOKEN'), 'the usual spelling goes too');
  const before = process.env.Gitlab_Token;
  process.env.Gitlab_Token = 'secret';
  try {
    assert.ok(Object.hasOwn(withoutTokens({ platform: 'win32' }), 'Gitlab_Token'), 'the process environment is the default');
  } finally {
    if (before === undefined) delete process.env.Gitlab_Token; else process.env.Gitlab_Token = before;
  }
});

test('elsewhere only the usual spellings go, and extra names are taken out the same way', () => {
  const out = withoutTokens({ env: { Gitlab_Token: 'x' }, platform: 'linux', extra: ['GH_HOST'] });
  assert.equal(Object.hasOwn(out, 'Gitlab_Token'), false);
  assert.ok(Object.hasOwn(out, 'GH_HOST'));
  assert.ok(Object.hasOwn(withoutTokens({ env: { gh_host: 'x' }, platform: 'win32', extra: ['GH_HOST'] }), 'gh_host'));
});
