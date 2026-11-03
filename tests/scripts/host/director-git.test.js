// tests/scripts/host/director-git.test.js
// The proxy for an address is read from the director's own git settings, through a runner that is given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askDirectorGit, directorProxy } from '../../../scripts/host/director-git.js';
import { PROXY_HAS_PASSWORD } from '../../../scripts/host/proxy.js';

test('askDirectorGit runs git with the arguments given, never prompting, and gives the code and output', async () => {
  const seen = [];
  const run = async (file, args, options) => { seen.push({ file, args, options }); return { code: 0, stdout: 'http://proxy.example.org:8080\n', stderr: 'ignored' }; };
  const got = await askDirectorGit(['config', '--get-urlmatch', 'http.proxy', 'https://gitlab.example.org'], { run, env: { PATH: '/bin' } });
  assert.deepEqual(got, { code: 0, stdout: 'http://proxy.example.org:8080\n' });
  assert.equal(seen[0].file, 'git');
  assert.equal(seen[0].options.env.GIT_TERMINAL_PROMPT, '0');
  assert.deepEqual(seen[0].options.baseEnv, { PATH: '/bin' });
});

test('directorProxy reads http.proxy from the director\'s git, and the environment when git has none', async () => {
  const git = (value) => async (args) => ({ code: value === null ? 1 : 0, stdout: args[2] === 'http.proxy' ? `${value}\n` : 'ntlm\n' });
  const named = await directorProxy('https://gitlab.example.org/api/v4', { ask: git('proxy.example.org:8080'), env: {} });
  assert.deepEqual([named.proxy, named.auth, named.user, named.source], ['http://proxy.example.org:8080', 'ntlm', ':', 'git']);
  const fromEnvironment = await directorProxy('https://gitlab.example.org', { ask: git(null), env: { HTTPS_PROXY: 'http://env.example.org:3128' } });
  assert.equal(fromEnvironment.source, 'environment');
  assert.equal(await directorProxy('https://gitlab.example.org', { ask: git(null), env: {} }), null);
});

test('a proxy address that holds a password is refused with its own line', async () => {
  const ask = async () => ({ code: 0, stdout: 'http://dir:hunter2@proxy.example.org:8080\n' });
  await assert.rejects(directorProxy('https://gitlab.example.org', { ask, env: {} }), (error) => {
    assert.equal(error.code, 'PROXY_HAS_PASSWORD');
    assert.equal(error.message, PROXY_HAS_PASSWORD);
    assert.doesNotMatch(error.message, /hunter2/);
    return true;
  });
});
