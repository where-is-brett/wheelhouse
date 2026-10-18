// tests/scripts/host/push-rules.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { checkPush, startHelper, PUSH_REFUSALS } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { helperAddress } from '../../../scripts/lib/paths.js';
import { run } from '../../../scripts/lib/run.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { makeBareRemote, push as plainPush } from '../../helpers/git-fixture.js';

// A run that must not be called: the spelling alone decides these.
const noRun = async () => {
  throw new Error('git should not run for this refspec');
};

async function g(dir, ...args) {
  const r = await run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@invalid', ...args], { cwd: dir, env: { GIT_TERMINAL_PROMPT: '0' } });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function write(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}

// A working clone on `branch`, with origin pointing at a fresh bare remote.
async function workOn(branch) {
  const remote = await makeBareRemote();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-pr-'));
  await g(dir, 'init', '-q');
  await g(dir, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`);
  await g(dir, 'remote', 'add', 'origin', remote.url);
  return {
    dir,
    remote,
    commit: async (message) => {
      await g(dir, 'add', '-A');
      await g(dir, 'commit', '-q', '--allow-empty', '-m', message);
    },
    pushPlain: () => g(dir, 'push', '-q', 'origin', branch),
    cleanup: () => {
      remote.cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const check = (refspec, extra = {}) => checkPush({ refspec, dir: os.tmpdir(), defaultBranch: 'main', run: noRun, ...extra });

const SPELLINGS = {
  main: PUSH_REFUSALS.defaultBranch,
  'HEAD:main': PUSH_REFUSALS.plain,
  'refs/heads/main': PUSH_REFUSALS.plain,
  '+feature': PUSH_REFUSALS.force,
  '+feature:feature': PUSH_REFUSALS.force,
  ':main': PUSH_REFUSALS.remove,
  ':feature': PUSH_REFUSALS.remove,
  'feature:main': PUSH_REFUSALS.same,
  'feature:refs/heads/main': PUSH_REFUSALS.same,
  'feature:other': PUSH_REFUSALS.same,
};
for (const [refspec, rule] of Object.entries(SPELLINGS)) {
  test(`checkPush refuses ${refspec}`, async () => {
    assert.deepEqual(await check(refspec), { allowed: false, refused: rule });
  });
}

test('checkPush refuses names that are not plain branch names', async () => {
  for (const refspec of ['', '-f', '--force', 'HEAD', 'feat ure', 'a..b', 'feature/', '/feature', 'x.lock', 'a:b:c', 'feature\n']) {
    assert.equal((await check(refspec)).allowed, false, refspec);
  }
  assert.equal((await check(42)).allowed, false);
});

test('checkPush allows feature and feature:feature', async () => {
  const work = await workOn('feature');
  try {
    write(work.dir, 'a.txt', 'a\n');
    await work.commit('First');
    for (const refspec of ['feature', 'feature:feature']) {
      const r = await checkPush({ refspec, dir: work.dir, defaultBranch: 'main', run });
      assert.equal(r.allowed, true, refspec);
      assert.equal(r.branch, 'feature');
      assert.match(r.sha, /^[0-9a-f]{40}$/);
    }
    const nested = await checkPush({ refspec: 'wh/task-14.b', dir: work.dir, defaultBranch: 'main', run });
    assert.equal(nested.allowed, false, 'a branch that does not exist here is refused');
  } finally { work.cleanup(); }
});

test('a state push that changes an existing event is refused', async () => {
  const work = await workOn('wheelhouse-state');
  try {
    write(work.dir, 'events/2026/10/one.json', '{"id":"1"}\n');
    await work.commit('Add one');
    await work.pushPlain();
    write(work.dir, 'events/2026/10/one.json', '{"id":"1","changed":true}\n');
    await work.commit('Change one');
    const r = await checkPush({ refspec: 'wheelhouse-state', dir: work.dir, defaultBranch: 'main', run });
    assert.equal(r.allowed, false);
    assert.match(r.refused, /events\//);

    // Deleting an event is refused too.
    await g(work.dir, 'reset', '-q', '--hard', 'origin/wheelhouse-state');
    fs.rmSync(path.join(work.dir, 'events/2026/10/one.json'));
    await work.commit('Delete one');
    assert.equal((await checkPush({ refspec: 'wheelhouse-state', dir: work.dir, defaultBranch: 'main', run })).allowed, false);

    // So is a new file outside events/.
    await g(work.dir, 'reset', '-q', '--hard', 'origin/wheelhouse-state');
    write(work.dir, 'notes.txt', 'hello\n');
    await work.commit('Add notes');
    assert.equal((await checkPush({ refspec: 'wheelhouse-state', dir: work.dir, defaultBranch: 'main', run })).allowed, false);
  } finally { work.cleanup(); }
});

test('a state push that only adds event files is allowed', async () => {
  const work = await workOn('wheelhouse-state');
  try {
    // The first push: the remote has no state branch, so every commit is checked, the root included.
    write(work.dir, 'events/2026/10/one.json', '{"id":"1"}\n');
    await work.commit('Add one');
    assert.equal((await checkPush({ refspec: 'wheelhouse-state', dir: work.dir, defaultBranch: 'main', run })).allowed, true);
    await work.pushPlain();

    write(work.dir, 'events/2026/10/two.json', '{"id":"2"}\n');
    await work.commit('Add two');
    write(work.dir, 'events/2026/11/three.json', '{"id":"3"}\n');
    await work.commit('Add three');
    assert.equal((await checkPush({ refspec: 'wheelhouse-state', dir: work.dir, defaultBranch: 'main', run })).allowed, true);
  } finally { work.cleanup(); }
});

test('a state push whose root commit adds anything outside events/ is refused', async () => {
  const work = await workOn('wheelhouse-state');
  try {
    write(work.dir, 'README.md', 'hello\n');
    await work.commit('Start');
    assert.equal((await checkPush({ refspec: 'wheelhouse-state', dir: work.dir, defaultBranch: 'main', run })).allowed, false);
  } finally { work.cleanup(); }
});

test('a lock push that changes anything but lock.json is refused', async () => {
  const work = await workOn('wheelhouse-lock');
  try {
    write(work.dir, 'lock.json', '{"counter":1}\n');
    await work.commit('Take the lock');
    assert.equal((await checkPush({ refspec: 'wheelhouse-lock', dir: work.dir, defaultBranch: 'main', run })).allowed, true);
    await work.pushPlain();

    write(work.dir, 'lock.json', '{"counter":2}\n');
    write(work.dir, 'other.txt', 'x\n');
    await work.commit('Take the lock again');
    const r = await checkPush({ refspec: 'wheelhouse-lock', dir: work.dir, defaultBranch: 'main', run });
    assert.equal(r.allowed, false);
    assert.match(r.refused, /lock\.json/);

    await g(work.dir, 'reset', '-q', '--hard', 'origin/wheelhouse-lock');
    write(work.dir, 'lock.json', '{"counter":2}\n');
    await work.commit('Take the lock again');
    assert.equal((await checkPush({ refspec: 'wheelhouse-lock', dir: work.dir, defaultBranch: 'main', run })).allowed, true);

    await g(work.dir, 'reset', '-q', '--hard', 'origin/wheelhouse-lock');
    fs.rmSync(path.join(work.dir, 'lock.json'));
    await work.commit('Drop the lock');
    assert.equal((await checkPush({ refspec: 'wheelhouse-lock', dir: work.dir, defaultBranch: 'main', run })).allowed, false);
  } finally { work.cleanup(); }
});

test('a state push may add only plain files: no symlinks or executables', async () => {
  const work = await workOn('wheelhouse-state');
  try {
    write(work.dir, 'events/2026/10/one.json', '{"id":"1"}\n');
    await work.commit('Add one');
    await work.pushPlain();
    // A symlink, made in the index so it works on every system.
    write(work.dir, 'target.txt', '../../../secret.txt');
    const blob = (await g(work.dir, 'hash-object', '-w', 'target.txt')).trim();
    fs.rmSync(path.join(work.dir, 'target.txt'));
    await g(work.dir, 'update-index', '--add', '--cacheinfo', `120000,${blob},events/2026/10/link.json`);
    await g(work.dir, 'commit', '-q', '-m', 'Add a link');
    assert.deepEqual(await checkPush({ refspec: 'wheelhouse-state', dir: work.dir, defaultBranch: 'main', run }),
      { allowed: false, refused: PUSH_REFUSALS.state });

    await g(work.dir, 'reset', '-q', '--hard', 'origin/wheelhouse-state');
    write(work.dir, 'events/2026/10/run.json', '{}\n');
    await g(work.dir, 'add', '-A');
    await g(work.dir, 'update-index', '--chmod=+x', 'events/2026/10/run.json');
    await g(work.dir, 'commit', '-q', '-m', 'Add an executable');
    assert.equal((await checkPush({ refspec: 'wheelhouse-state', dir: work.dir, defaultBranch: 'main', run })).allowed, false);
  } finally { work.cleanup(); }
});

test('the default branch is read from the host, not assumed to be main', async () => {
  assert.equal((await check('trunk', { defaultBranch: 'trunk' })).allowed, false);
  assert.equal((await check('main', { defaultBranch: undefined })).allowed, false, 'an unknown default branch refuses');

  // Through the helper: the adapter says the default branch is trunk, asked once per project.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  const work = await workOn('main');
  let asked = 0;
  const adapter = { defaultBranch: async () => { asked += 1; return 'trunk'; } };
  let helper;
  try {
    await cloneState({ project: 'o__p', remoteUrl: work.remote.url });
    assert.equal((await takeLock({ project: 'o__p', push: plainPush })).taken, true);
    write(work.dir, 'a.txt', 'a\n');
    await work.commit('First');
    await g(work.dir, 'branch', 'trunk');
    const address = process.platform === 'win32'
      ? helperAddress({ platform: 'win32', user: `test-${crypto.randomBytes(4).toString('hex')}` })
      : path.join(home, 'helper.sock');
    helper = await startHelper({ address, adapterFor: async () => adapter, envFor: async () => ({}) });
    const client = helperClient({ address: helper.address });
    const refused = await client.push({ project: 'o__p', dir: work.dir, refspec: 'trunk' });
    assert.deepEqual(refused, { ok: false, refused: PUSH_REFUSALS.defaultBranch });
    assert.deepEqual(await client.push({ project: 'o__p', dir: work.dir, refspec: 'main' }), { ok: true });
    assert.equal(asked, 1);
    const listed = await run('git', ['ls-remote', '--heads', work.remote.url], {});
    assert.match(listed.stdout, /refs\/heads\/main/);
    assert.doesNotMatch(listed.stdout, /refs\/heads\/trunk/);
  } finally {
    await helper?.close();
    work.cleanup();
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
