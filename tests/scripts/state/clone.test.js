// tests/scripts/state/clone.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cloneState } from '../../../scripts/state/clone.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { run } from '../../../scripts/lib/run.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';

async function withHome(fn) {
  const home = path.join(tempFolder('wh-cl-'), 'Zoë home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try { return await fn(home); } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
  }
}

test('cloneState makes an orphan wheelhouse-state with a README when the remote has none', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      const dir = await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
      assert.ok(readme.startsWith('<!-- README.md -->'));
      const heads = await run('git', ['--git-dir', remote.url, 'branch', '--list']);
      assert.match(heads.stdout, /wheelhouse-state/);
      const parents = await run('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: dir });
      assert.equal(parents.stdout.trim().split('\n').length, 1);
    });
  } finally { remote.cleanup(); }
});

test('cloneState reuses a clone it already made and clones only the state branch', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      const first = await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      fs.writeFileSync(path.join(first, 'marker'), 'x');
      const second = await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      assert.equal(second, first);
      assert.ok(fs.existsSync(path.join(second, 'marker')));
    });
    await withHome(async () => {
      const dir = await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url }); // now a real clone
      const branches = await run('git', ['branch', '-a'], { cwd: dir });
      assert.ok(!/main|master/.test(branches.stdout));
    });
  } finally { remote.cleanup(); }
});

test('cloneState fails plainly when the remote cannot be reached', async () => {
  await withHome(async () => {
    await assert.rejects(cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: path.join(os.tmpdir(), 'wh-no-such-remote.git') }), /reach/);
  });
});

async function hookedRemote(script) {
  const remote = await makeBareRemote();
  const hook = path.join(remote.url, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return remote;
}

test('a refused orphan push leaves no half-made clone behind', async () => {
  const remote = await hookedRemote('exit 1');
  try {
    await withHome(async (home) => {
      await assert.rejects(cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url }), /started/);
      assert.equal(fs.existsSync(path.join(home, 'projects', 'o__p', 'state')), false);
    });
  } finally { remote.cleanup(); }
});

test('after a lost first push, cloneState starts over and succeeds', async () => {
  const remote = await hookedRemote('if [ -f seen ]; then exit 0; fi\ntouch seen\nexit 1');
  try {
    await withHome(async () => {
      const dir = await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const heads = await run('git', ['--git-dir', remote.url, 'branch', '--list']);
      assert.match(heads.stdout, /wheelhouse-state/);
      assert.ok(fs.existsSync(path.join(dir, 'README.md')));
    });
  } finally { remote.cleanup(); }
});

test('a clone with an unpushed commit and a mismatched origin is refused and kept', async () => {
  const one = await makeBareRemote();
  const two = await makeBareRemote();
  try {
    await withHome(async () => {
      const dir = await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: one.url });
      fs.writeFileSync(path.join(dir, 'unpushed.txt'), 'x');
      await run('git', ['add', '--', 'unpushed.txt'], { cwd: dir });
      await run('git', ['-c', 'user.name=W', '-c', 'user.email=w@invalid', 'commit', '-m', 'work'], { cwd: dir });
      await assert.rejects(cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: two.url }), /left alone/);
      const log = await run('git', ['log', '--format=%s'], { cwd: dir });
      assert.match(log.stdout, /work/);
      assert.ok(fs.existsSync(path.join(dir, 'unpushed.txt')));
    });
  } finally { one.cleanup(); two.cleanup(); }
});

test('an interrupted rebase is aborted and the clone reused', async () => {
  const remote = await makeBareRemote();
  const other = path.join(tempFolder('wh-other-'), 'o');
  try {
    await withHome(async () => {
      const dir = await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const id = ['-c', 'user.name=W', '-c', 'user.email=w@invalid'];
      await run('git', ['clone', '--branch', 'wheelhouse-state', remote.url, other]);
      fs.writeFileSync(path.join(other, 'README.md'), 'theirs\n');
      await run('git', [...id, 'commit', '-am', 'theirs'], { cwd: other });
      await run('git', ['push', 'origin', 'wheelhouse-state'], { cwd: other });
      fs.writeFileSync(path.join(dir, 'README.md'), 'ours\n');
      await run('git', [...id, 'commit', '-am', 'ours'], { cwd: dir });
      await run('git', [...id, 'pull', '--rebase', 'origin', 'wheelhouse-state'], { cwd: dir });
      assert.ok(fs.existsSync(path.join(dir, '.git', 'rebase-merge')) || fs.existsSync(path.join(dir, '.git', 'rebase-apply')));
      assert.equal(await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url }), dir);
      assert.ok(!fs.existsSync(path.join(dir, '.git', 'rebase-merge')));
      const log = await run('git', ['log', '--format=%s'], { cwd: dir });
      assert.match(log.stdout, /ours/);
    });
  } finally { remote.cleanup(); fs.rmSync(path.dirname(other), { recursive: true, force: true }); }
});

test('a clone left half-made by a crash is refused with what to do', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      const dir = stateDir('o__p');
      // a start that stopped after `git init`: no remote
      fs.mkdirSync(dir, { recursive: true });
      await run('git', ['init', '-q'], { cwd: dir });
      await assert.rejects(cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url }), /half-made.*delete the folder and run again/is);
      assert.ok(fs.existsSync(path.join(dir, '.git')), 'nothing was removed');
      // a start that stopped before the push: a remote and a commit, but no remote branch
      await run('git', ['symbolic-ref', 'HEAD', 'refs/heads/wheelhouse-state'], { cwd: dir });
      await run('git', ['remote', 'add', 'origin', remote.url], { cwd: dir });
      fs.writeFileSync(path.join(dir, 'README.md'), 'x');
      await run('git', ['add', '--', 'README.md'], { cwd: dir });
      await run('git', ['-c', 'user.name=W', '-c', 'user.email=w@invalid', 'commit', '-m', 'Start'], { cwd: dir });
      await assert.rejects(cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url }), /delete the folder and run again/i);
      // after the folder is deleted, the next run works
      fs.rmSync(dir, { recursive: true, force: true });
      assert.equal(await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url }), dir);
    });
  } finally { remote.cleanup(); }
});

test('an origin spelled differently but naming the same repository is accepted', async () => {
  const remote = await makeBareRemote({ repo: 'o/p' });
  try {
    await withHome(async () => {
      const dir = await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const setOrigin = (url) => run('git', ['remote', 'set-url', 'origin', url], { cwd: dir });
      await setOrigin('https://GitHub.com/Owner/Name.git');
      for (const same of [
        'https://github.com/owner/name', 'git@github.com:Owner/Name.git', 'ssh://git@GITHUB.COM/owner/name.git',
        'https://github.com/owner/name/', 'https://user@github.com:443/owner/name.git',
      ]) {
        assert.equal(await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: same }), dir, same);
      }
      for (const other of [
        'https://github.com/owner/other.git', 'https://github.com/other/name.git', 'https://gitlab.com/owner/name.git',
        'https://github.com/x/owner/name.git',
      ]) {
        await assert.rejects(cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: other }), /left alone/, other);
      }
      // a port that is not the default names another server; the default port may be written or left out
      await setOrigin('https://github.com:8443/owner/name.git');
      await assert.rejects(cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: 'https://github.com/owner/name.git' }), /left alone/);
      assert.equal(await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: 'https://github.com:8443/Owner/Name' }), dir);
      await setOrigin('https://github.com/owner/name.git');
      assert.equal(await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: 'https://github.com:443/owner/name' }), dir);
      await assert.rejects(cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: 'https://github.com:8443/owner/name' }), /left alone/);
      await setOrigin('ssh://git@github.com/owner/name.git');
      assert.equal(await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: 'ssh://git@github.com:22/owner/name' }), dir);
      assert.equal(await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: 'git@github.com:owner/name.git' }), dir);
      await assert.rejects(cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: 'ssh://git@github.com:2222/owner/name' }), /left alone/);
      // a local path, plain or as a file address
      await setOrigin(remote.url);
      assert.equal(await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: `file://${remote.url}` }), dir);
    });
  } finally { remote.cleanup(); }
});

test('two cloneState calls at once on one computer leave one clone', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async (home) => {
      const results = await Promise.all([1, 2, 3].map(() => cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url })));
      assert.equal(new Set(results).size, 1);
      const roots = await run('git', ['--git-dir', remote.url, 'rev-list', '--max-parents=0', 'wheelhouse-state']);
      assert.equal(roots.stdout.trim().split('\n').length, 1, 'the branch was started once');
      assert.deepEqual(fs.readdirSync(path.join(home, 'projects', 'o__p')), ['state'], 'no lock file is left behind');
    });
  } finally { remote.cleanup(); }
});

test('a clone whose settings cannot be read is not called half-made', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      const dir = await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      fs.appendFileSync(path.join(dir, '.git', 'config'), '\n[remote \"origin\"\n  this is not a setting\n');
      await assert.rejects(cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url }), (e) => {
        assert.match(e.message, /settings can't be read/);
        assert.ok(e.message.includes(dir), 'names the folder');
        assert.doesNotMatch(e.message, /delete|half-made/i);
        return true;
      });
    });
  } finally { remote.cleanup(); }
});

test('a start lock whose process has gone is taken over at once, and a live holder is waited for', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async (home) => {
      const lock = path.join(stateDir('o__p'), '..', 'state.lock');
      fs.mkdirSync(path.dirname(lock), { recursive: true });
      // a process that has exited
      const child = spawnSync(process.execPath, ['-e', '']);
      const gone = child.pid;
      fs.writeFileSync(lock, `${gone}\n`);
      const started = Date.now();
      const dir = await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      // A live holder is waited for six minutes; the clone itself can take seconds on a loaded computer.
      assert.ok(Date.now() - started < 60 * 1000, 'no waiting for a dead holder');
      assert.deepEqual(fs.readdirSync(path.dirname(dir)), ['state'], 'the lock and its taken-over copy are gone');
      // a holder that is alive (this process) is waited for
      fs.writeFileSync(lock, `${process.pid}\n`);
      let done = false;
      const second = cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url }).then(() => { done = true; });
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(done, false);
      fs.rmSync(lock);
      await second;
      assert.equal(done, true);
    });
  } finally { remote.cleanup(); }
});
