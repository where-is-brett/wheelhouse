// tests/scripts/state/git.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../../scripts/state/git.js';
import { run } from '../../../scripts/lib/run.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';

// A scratch clone with one commit; git's global config is read from `home` for the length of `fn`.
async function inScratch(fn) {
  const root = tempFolder('wh-sgit-');
  const dir = path.join(root, 'clone');
  fs.mkdirSync(dir);
  assert.equal((await run('git', ['init', '-q', dir])).code, 0);
  const keep = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, USERPROFILE: process.env.USERPROFILE };
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  try { return await fn({ root, dir, home }); } finally {
    for (const [k, v] of Object.entries(keep)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

test('every state git call shuts out the global and system config and switches hooks off', async () => {
  await inScratch(async ({ root, dir, home }) => {
    const hooks = path.join(root, 'hooks');
    const marker = path.join(root, 'marker');
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, 'post-commit'), `#!/bin/sh\necho ran > '${marker}'\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(home, '.gitconfig'), `[core]\n\thooksPath = ${hooks.replaceAll('\\', '/')}\n[alias]\n\tghost = status\n`);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    assert.equal((await git(dir, ['add', '--', 'a.txt'])).code, 0);
    const made = await git(dir, ['commit', '-q', '-m', 'x']);
    assert.equal(made.code, 0, made.stderr);
    assert.equal(fs.existsSync(marker), false, 'the director\'s global hooks folder was not used');
    assert.notEqual((await git(dir, ['ghost'])).code, 0, 'the global alias is not read');
  });
});

test('a local remote is reached only when the caller allowed a local path', async () => {
  const remote = await makeBareRemote();
  try {
    await inScratch(async ({ dir }) => {
      const shut = await git(dir, ['ls-remote', remote.url]);
      assert.notEqual(shut.code, 0);
      assert.match(shut.stderr, /not allowed/);
      assert.equal((await git(dir, ['ls-remote', remote.url], LOCAL_PATHS)).code, 0);
      // a caller's own protocol list, without file, does not let a local path through
      assert.notEqual((await git(dir, ['ls-remote', remote.url], { GIT_ALLOW_PROTOCOL: 'ssh:git' })).code, 0);
    });
  } finally { remote.cleanup(); }
});

test('the commit identity stays Wheelhouse <wheelhouse@invalid>', async () => {
  await inScratch(async ({ dir, home }) => {
    fs.writeFileSync(path.join(home, '.gitconfig'), '[user]\n\tname = Someone Else\n\temail = someone@example.com\n');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    await git(dir, ['add', '--', 'a.txt']);
    assert.equal((await git(dir, ['commit', '-q', '-m', 'x'])).code, 0);
    const log = await git(dir, ['log', '-1', '--format=%an|%ae|%cn|%ce']);
    assert.equal(log.stdout.trim(), 'Wheelhouse|wheelhouse@invalid|Wheelhouse|wheelhouse@invalid');
  });
});

test('plain http on loopback is reached only when the caller allowed it', async () => {
  const http = await import('node:http');
  const server = http.createServer((req, res) => { res.statusCode = 404; res.end(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/o/p.git`;
  try {
    await inScratch(async ({ dir }) => {
      const shut = await git(dir, ['ls-remote', url], {});
      assert.notEqual(shut.code, 0);
      assert.match(shut.stderr, /not allowed/);
      const open = await git(dir, ['ls-remote', url], { GIT_ALLOW_PROTOCOL: 'https:http' });
      assert.doesNotMatch(open.stderr, /not allowed/);
    });
  } finally { server.close(); }
});
