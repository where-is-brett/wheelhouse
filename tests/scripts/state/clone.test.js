// tests/scripts/state/clone.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cloneState } from '../../../scripts/state/clone.js';
import { run } from '../../../scripts/lib/run.js';
import { makeBareRemote } from '../../helpers/git-fixture.js';

async function withHome(fn) {
  const home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-cl-')), 'Zoë home');
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
      const dir = await cloneState({ project: 'o__p', remoteUrl: remote.url });
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
      const first = await cloneState({ project: 'o__p', remoteUrl: remote.url });
      fs.writeFileSync(path.join(first, 'marker'), 'x');
      const second = await cloneState({ project: 'o__p', remoteUrl: remote.url });
      assert.equal(second, first);
      assert.ok(fs.existsSync(path.join(second, 'marker')));
    });
    await withHome(async () => {
      const dir = await cloneState({ project: 'o__p', remoteUrl: remote.url }); // now a real clone
      const branches = await run('git', ['branch', '-a'], { cwd: dir });
      assert.ok(!/main|master/.test(branches.stdout));
    });
  } finally { remote.cleanup(); }
});

test('cloneState fails plainly when the remote cannot be reached', async () => {
  await withHome(async () => {
    await assert.rejects(cloneState({ project: 'o__p', remoteUrl: path.join(os.tmpdir(), 'wh-no-such-remote.git') }), /reach/);
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
      await assert.rejects(cloneState({ project: 'o__p', remoteUrl: remote.url }), /started/);
      assert.equal(fs.existsSync(path.join(home, 'projects', 'o__p', 'state')), false);
    });
  } finally { remote.cleanup(); }
});

test('after a lost first push, cloneState starts over and succeeds', async () => {
  const remote = await hookedRemote('if [ -f seen ]; then exit 0; fi\ntouch seen\nexit 1');
  try {
    await withHome(async () => {
      const dir = await cloneState({ project: 'o__p', remoteUrl: remote.url });
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
      const dir = await cloneState({ project: 'o__p', remoteUrl: one.url });
      fs.writeFileSync(path.join(dir, 'unpushed.txt'), 'x');
      await run('git', ['add', '--', 'unpushed.txt'], { cwd: dir });
      await run('git', ['-c', 'user.name=W', '-c', 'user.email=w@invalid', 'commit', '-m', 'work'], { cwd: dir });
      await assert.rejects(cloneState({ project: 'o__p', remoteUrl: two.url }), /left alone/);
      const log = await run('git', ['log', '--format=%s'], { cwd: dir });
      assert.match(log.stdout, /work/);
      assert.ok(fs.existsSync(path.join(dir, 'unpushed.txt')));
    });
  } finally { one.cleanup(); two.cleanup(); }
});

test('an interrupted rebase is aborted and the clone reused', async () => {
  const remote = await makeBareRemote();
  const other = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-other-')), 'o');
  try {
    await withHome(async () => {
      const dir = await cloneState({ project: 'o__p', remoteUrl: remote.url });
      const id = ['-c', 'user.name=W', '-c', 'user.email=w@invalid'];
      await run('git', ['clone', '--branch', 'wheelhouse-state', remote.url, other]);
      fs.writeFileSync(path.join(other, 'README.md'), 'theirs\n');
      await run('git', [...id, 'commit', '-am', 'theirs'], { cwd: other });
      await run('git', ['push', 'origin', 'wheelhouse-state'], { cwd: other });
      fs.writeFileSync(path.join(dir, 'README.md'), 'ours\n');
      await run('git', [...id, 'commit', '-am', 'ours'], { cwd: dir });
      await run('git', [...id, 'pull', '--rebase', 'origin', 'wheelhouse-state'], { cwd: dir });
      assert.ok(fs.existsSync(path.join(dir, '.git', 'rebase-merge')) || fs.existsSync(path.join(dir, '.git', 'rebase-apply')));
      assert.equal(await cloneState({ project: 'o__p', remoteUrl: remote.url }), dir);
      assert.ok(!fs.existsSync(path.join(dir, '.git', 'rebase-merge')));
      const log = await run('git', ['log', '--format=%s'], { cwd: dir });
      assert.match(log.stdout, /ours/);
    });
  } finally { remote.cleanup(); fs.rmSync(path.dirname(other), { recursive: true, force: true }); }
});
