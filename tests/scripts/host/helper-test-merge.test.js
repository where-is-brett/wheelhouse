// tests/scripts/host/helper-test-merge.test.js
// /test-merge: two branches merged in the helper's own mirror with
// `git merge-tree`, which checks nothing out and runs nothing from either
// branch (design section 12).
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { run } from '../../../scripts/lib/run.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { makeBareRemote, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const fakeAdapter = () => ({
  defaultBranch: async () => 'main',
  prState: async () => ({ headSha: 'a'.repeat(40), mergeable: 'yes', state: 'open' }),
  ciState: async (sha) => ({ sha, state: 'success' }),
});

function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

// A remote whose main holds `base`, and a branch per entry of `branches`, each
// main plus that entry's files.
async function remoteWith({ base, branches }) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const work = tempFolder('wh-work-');
  await g(work, 'init', '-q', '-b', 'main');
  write(work, base);
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Base');
  await g(work, 'remote', 'add', 'origin', remote.url);
  await g(work, 'push', '-q', 'origin', 'main');
  for (const [name, files] of Object.entries(branches)) {
    await g(work, 'checkout', '-q', '-b', name, 'main');
    write(work, files);
    await g(work, 'add', '-A');
    await g(work, 'commit', '-q', '-m', `Change on ${name}`);
    await g(work, 'push', '-q', 'origin', name);
  }
  return remote;
}

async function project(remote) {
  const home = shortHome();
  await as(home, async () => {
    writeProject('o__p', {
      folder: path.join(home, 'work'), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
  });
  return home;
}

async function withHelper(home, fn, { env = {} } = {}) {
  return as(home, async () => {
    const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => fakeAdapter(), envFor: async () => env });
    try {
      return await fn(helperClient({ address: helper.address }));
    } finally {
      await helper.close();
    }
  });
}

const mirrorOf = () => path.join(stateDir('o__p'), '..', 'mirror.git');
const workingRefs = async () => (await run('git', ['for-each-ref', '--format=%(refname)', 'refs/wheelhouse/tm/'], { cwd: mirrorOf() })).stdout.trim();

test('/test-merge reports a clean pair and a conflicting pair, naming the files', async () => {
  const remote = await remoteWith({
    base: { 'app.js': 'one\ntwo\nthree\n', 'notes/a b.md': 'x\n', 'README.md': 'r\n' },
    branches: {
      'login-page': { 'app.js': 'one\nTWO\nthree\n', 'notes/a b.md': 'login\n' },
      'feature/search': { 'app.js': 'one\n2\nthree\n', 'notes/a b.md': 'search\n' },
      'docs-only': { 'README.md': 'docs\n' },
    },
  });
  try {
    const home = await project(remote);
    await withHelper(home, async (client) => {
      const clean = await client.testMerge({ project: 'o__p', a: 'login-page', b: 'docs-only' });
      assert.deepEqual(clean, { ok: true, clean: true, conflicts: [] });

      const clash = await client.testMerge({ project: 'o__p', a: 'login-page', b: 'feature/search' });
      assert.deepEqual(clash, { ok: true, clean: false, conflicts: ['app.js', 'notes/a b.md'] });

      // The working refs are dropped after each answer.
      assert.equal(await workingRefs(), '');

      // A branch the host does not have is refused, and the working refs are dropped too.
      const missing = await client.testMerge({ project: 'o__p', a: 'login-page', b: 'no-such-branch' });
      assert.equal(missing.ok, false);
      assert.match(missing.refused, /fetching the branches failed/);
      assert.equal(await workingRefs(), '');

      // Names are checked as a push's are: nothing git could read as an option or a ref.
      for (const bad of ['-x', 'refs/heads/main', 'HEAD', 'a..b', '../x', 'a b', '', 7, undefined]) {
        const answer = await client.testMerge({ project: 'o__p', a: 'login-page', b: bad });
        assert.equal(answer.ok, false, String(bad));
        assert.equal(answer.refused, 'the branch name is not valid', String(bad));
      }
    });
  } finally { remote.cleanup(); }
});

test('/test-merge runs nothing from either branch', async () => {
  // Every way git could run a command during a fetch or a merge, set up as if
  // the director's own git configuration named them: a hooks folder, a filter
  // and a merge driver, attributes that name both, and attributes read from
  // the branch's own tree. Each command leaves a mark.
  const outside = tempFolder('wh-evil-');
  const marks = path.join(outside, 'marks');
  const script = path.join(outside, 'mark.sh');
  const slash = (p) => p.split(path.sep).join('/');
  fs.writeFileSync(script, `#!/bin/sh\necho "$1" >> "${slash(marks)}"\nexit 0\n`, { mode: 0o755 });
  const hooks = path.join(outside, 'hooks');
  fs.mkdirSync(hooks);
  for (const hook of ['reference-transaction', 'post-merge', 'post-checkout', 'pre-merge-commit']) {
    fs.writeFileSync(path.join(hooks, hook), `#!/bin/sh\necho "hook ${hook}" >> "${slash(marks)}"\n`, { mode: 0o755 });
  }
  const attributes = path.join(outside, 'attributes');
  fs.writeFileSync(attributes, '* merge=evil filter=evil\n');
  const config = path.join(outside, 'gitconfig');
  fs.writeFileSync(config, [
    '[core]', `\thooksPath = ${slash(hooks)}`, `\tattributesFile = ${slash(attributes)}`,
    '[filter "evil"]', `\tclean = ${slash(script)} clean`, `\tsmudge = ${slash(script)} smudge`,
    '[merge "evil"]', `\tdriver = ${slash(script)} driver %O %A %B`,
    '[attr]', '\ttree = refs/wheelhouse/tm/a',
    '',
  ].join('\n'));

  // Each branch carries a hook and a .gitattributes naming the filter and the driver.
  const branchFiles = (word) => ({
    'app.js': `${word}\n`,
    '.gitattributes': '* merge=evil filter=evil\n',
    '.githooks/post-merge': `#!/bin/sh\necho "branch hook" >> "${slash(marks)}"\n`,
  });
  const remote = await remoteWith({
    base: { 'app.js': 'base\n' },
    branches: { 'evil-a': branchFiles('a'), 'evil-b': branchFiles('b') },
  });
  try {
    // The control: with that configuration, git does run something for this pair.
    const control = path.join(outside, 'control.git');
    await run('git', ['init', '-q', '--bare', control]);
    await run('git', ['fetch', '-q', remote.url, '+refs/heads/evil-a:refs/wheelhouse/tm/a', '+refs/heads/evil-b:refs/wheelhouse/tm/b'], { cwd: control, env: { GIT_CONFIG_GLOBAL: config } });
    await run('git', ['merge-tree', '--write-tree', 'refs/wheelhouse/tm/a', 'refs/wheelhouse/tm/b'], { cwd: control, env: { GIT_CONFIG_GLOBAL: config } });
    const control_ = fs.readFileSync(marks, 'utf8');
    assert.match(control_, /hook reference-transaction/, 'the control should run the hook');
    assert.match(control_, /driver/, 'the control should run the merge driver');
    fs.rmSync(marks);

    const home = await project(remote);
    // The quick connection's environment carries the director's configuration to every keyed git call.
    await withHelper(home, async (client) => {
      const answer = await client.testMerge({ project: 'o__p', a: 'evil-a', b: 'evil-b' });
      assert.deepEqual(answer, { ok: true, clean: false, conflicts: ['app.js'] });
      assert.equal(fs.existsSync(marks), false, fs.existsSync(marks) ? fs.readFileSync(marks, 'utf8') : '');
      // Nothing was checked out: the mirror is bare, with no other worktree and no working refs left.
      const listed = await run('git', ['worktree', 'list', '--porcelain'], { cwd: mirrorOf() });
      assert.equal(listed.stdout.split('\n').filter((l) => l.startsWith('worktree ')).length, 1);
      assert.equal(await workingRefs(), '');
    }, { env: { GIT_CONFIG_GLOBAL: config } });
  } finally { remote.cleanup(); }
});

test('/test-merge refuses when the mirror\'s own configuration names a filter or a merge driver', async () => {
  const remote = await remoteWith({ base: { 'app.js': 'base\n' }, branches: { a: { 'app.js': 'a\n' }, b: { 'app.js': 'b\n' } } });
  try {
    const home = await project(remote);
    await withHelper(home, async (client) => {
      assert.equal((await client.testMerge({ project: 'o__p', a: 'a', b: 'b' })).ok, true);
      await run('git', ['config', 'merge.evil.driver', 'false'], { cwd: mirrorOf() });
      const answer = await client.testMerge({ project: 'o__p', a: 'a', b: 'b' });
      assert.equal(answer.ok, false);
      assert.match(answer.refused, /merge\.evil\.driver/);
      assert.equal(await workingRefs(), '');
    });
  } finally { remote.cleanup(); }
});

test('under STOP, /test-merge still answers', async () => {
  const remote = await remoteWith({ base: { 'app.js': 'base\n' }, branches: { a: { 'app.js': 'a\n' }, b: { 'b.js': 'b\n' } } });
  try {
    const home = await project(remote);
    await as(home, () => setStop({ by: 'prompt' }));
    await withHelper(home, async (client) => {
      assert.deepEqual(await client.testMerge({ project: 'o__p', a: 'a', b: 'b' }), { ok: true, clean: true, conflicts: [] });
    });
  } finally { remote.cleanup(); }
});

test('a hook named in git\'s configuration is refused, not run, by /test-merge and by the copy into the mirror', async () => {
  const outside = tempFolder('wh-evil-');
  const marks = path.join(outside, 'marks');
  const slash = (p) => p.split(path.sep).join('/');
  const script = path.join(outside, 'mark.sh');
  fs.writeFileSync(script, `#!/bin/sh\necho "config hook $*" >> "${slash(marks)}"\n`, { mode: 0o755 });
  const hookLines = ['[hook "reference-transaction"]', `\tcommand = ${slash(script)}`, '\tevent = reference-transaction', ''];
  const config = path.join(outside, 'gitconfig');
  fs.writeFileSync(config, hookLines.join('\n'));
  const remote = await remoteWith({ base: { 'app.js': 'base\n' }, branches: { a: { 'app.js': 'a\n' }, b: { 'b.js': 'b\n' } } });
  try {
    // The control: a fetch with that configuration runs the hook, whatever core.hooksPath says.
    const control = path.join(outside, 'control.git');
    await run('git', ['init', '-q', '--bare', control]);
    await run('git', ['-c', 'core.hooksPath=/dev/null', 'fetch', '-q', remote.url, '+refs/heads/a:refs/x/a'], { cwd: control, env: { GIT_CONFIG_GLOBAL: config } });
    assert.match(fs.readFileSync(marks, 'utf8'), /config hook/, 'the control should run the configured hook');
    fs.rmSync(marks);

    const home = await project(remote);
    // In the director's global configuration: shut out of the helper's git in every connection, so the hook neither runs nor needs refusing.
    await withHelper(home, async (client) => {
      const answer = await client.testMerge({ project: 'o__p', a: 'a', b: 'b' });
      assert.deepEqual(answer, { ok: true, clean: true, conflicts: [] });
      assert.equal(fs.existsSync(marks), false);
    }, { env: { GIT_CONFIG_GLOBAL: config } });

    // In the mirror's own configuration: refused by /test-merge, and by a push's copy into the mirror.
    await withHelper(home, async (client) => {
      assert.equal((await client.testMerge({ project: 'o__p', a: 'a', b: 'b' })).ok, true);
      for (const line of [['hook.reference-transaction.command', slash(script)], ['hook.reference-transaction.event', 'reference-transaction']]) {
        await run('git', ['config', ...line], { cwd: mirrorOf() });
      }
      const answer = await client.testMerge({ project: 'o__p', a: 'a', b: 'b' });
      assert.equal(answer.ok, false);
      assert.match(answer.refused, /hook\.reference-transaction\.(command|event)/);
      const written = await client.state.write({ project: 'o__p', kind: 'note', data: { text: 'x' } });
      assert.equal(written.pushed, false, JSON.stringify(written));
      assert.equal(fs.existsSync(marks), false, fs.existsSync(marks) ? fs.readFileSync(marks, 'utf8') : '');
    });
  } finally { remote.cleanup(); }
});

test('a filter or url.insteadOf planted in the mirror\'s config refuses the request, naming it', async () => {
  const remote = await remoteWith({ base: { 'app.js': 'base\n' }, branches: { a: { 'app.js': 'a\n' }, b: { 'b.js': 'b\n' } } });
  try {
    const home = await project(remote);
    await withHelper(home, async (client) => {
      assert.equal((await client.testMerge({ project: 'o__p', a: 'a', b: 'b' })).ok, true);
      for (const [key, value] of [['filter.evil.clean', 'false'], ['url.https://elsewhere.invalid/.insteadOf', 'https://example.invalid/']]) {
        await run('git', ['config', key, value], { cwd: mirrorOf() });
        const answer = await client.testMerge({ project: 'o__p', a: 'a', b: 'b' });
        assert.equal(answer.ok, false);
        assert.ok(answer.refused.toLowerCase().includes(key.toLowerCase()), answer.refused);
        assert.match(answer.refused, /setup doesn't allow/);
        await run('git', ['config', '--unset-all', key], { cwd: mirrorOf() });
      }
      assert.equal((await client.testMerge({ project: 'o__p', a: 'a', b: 'b' })).ok, true);
      assert.equal(await workingRefs(), '');
    });
  } finally { remote.cleanup(); }
});
