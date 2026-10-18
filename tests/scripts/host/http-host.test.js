// tests/scripts/host/http-host.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../../scripts/lib/run.js';
import { makeBareRemote } from '../../helpers/git-fixture.js';
import { startHttpHost } from '../../helpers/http-host.js';

const TOKEN = 'ghs_STANDINTOKEN0123456789';

test('the stand-in host refuses a request without the key and serves one with it', async () => {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const host = await startHttpHost({ root: remote.root, token: TOKEN });
  const url = `${host.url}/o/p.git`;
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`;
  const env = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  try {
    const without = await run('git', ['ls-remote', url], { env });
    assert.notEqual(without.code, 0);
    assert.ok(host.refusedCount() > 0);
    const before = host.refusedCount();
    const wrong = await run('git', ['-c', `http.extraHeader=AUTHORIZATION: basic ${Buffer.from('x-access-token:nope').toString('base64')}`, 'ls-remote', url], { env });
    assert.notEqual(wrong.code, 0);
    const withKey = await run('git', ['-c', `http.extraHeader=${header}`, 'ls-remote', url], { env });
    assert.equal(withKey.code, 0, withKey.stderr);
    assert.ok(host.refusedCount() > before, 'the wrong key was counted');
  } finally {
    await host.close();
    remote.cleanup();
  }
});
