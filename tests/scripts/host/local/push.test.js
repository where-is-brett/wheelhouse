// tests/scripts/host/local/push.test.js
// A run's work reaching a project's home (spec 5.3): the same push as a hosted project's, with the home as its target, and
// then the engine's mirror. The default branch stays out of reach, and an agent's writes to the mirror don't last.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL_P as P, gitAloneWorld } from '../../../helpers/engine-e2e.js';
import { checksWorld } from '../../../helpers/checks-world.js';
import { g } from '../../../helpers/git-fixture.js';
import { waitLongerOnTheHelper } from '../../../helpers/until.js';
import { localChanges } from '../../../../scripts/host/local/changes.js';
import { makeLocalAdapter } from '../../../../scripts/host/local/adapter.js';
import { homeDir } from '../../../../scripts/host/local/home.js';
import { wheelhouseHome } from '../../../../scripts/lib/paths.js';
import { run } from '../../../../scripts/lib/run.js';
import { workOrder } from '../../../../scripts/engine/order.js';
import { sandboxDenyPaths } from '../../../../scripts/protection/settings.js';

waitLongerOnTheHelper();

const TEXT = 'export const price = (c) => (c / 100).toFixed(2);\n';
const headIn = async (repo, branch) => {
  const got = await run('git', ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { cwd: repo });
  return got.code === 0 ? got.stdout.trim() : null;
};

test('the adapter names the home as the push target, with no key', async () => {
  await gitAloneWorld(async () => {
    assert.deepEqual(makeLocalAdapter({ project: P }).pushTarget(), { url: homeDir(P), keyed: false });
  });
});

test('a run\'s branch reaches the home and the engine\'s mirror', { timeout: 120000 }, () => gitAloneWorld(async ({ client, home, mirror, worktreeWith, tools }) => {
  const { worktree, head } = await worktreeWith('wh/card-1', TEXT);
  const pushed = await client.push({ project: P, dir: worktree, refspec: 'wh/card-1' });
  assert.equal(pushed.ok, true, pushed.refused);
  assert.equal(await headIn(home, 'wh/card-1'), head);
  assert.equal(await headIn(mirror, 'wh/card-1'), head);
  assert.deepEqual(tools, []);
}));

test('a push moves the open change on its branch', { timeout: 120000 }, () => gitAloneWorld(async ({ client, worktreeWith }) => {
  const first = await worktreeWith('wh/card-2', TEXT);
  await client.push({ project: P, dir: first.worktree, refspec: 'wh/card-2' });
  const { n } = await localChanges({ project: P }).openChange({ branch: 'wh/card-2', base: 'main', title: 'A change', head: first.head });
  const next = await worktreeWith('wh/card-2', `${TEXT}// more\n`);
  const pushed = await client.push({ project: P, dir: first.worktree, refspec: 'wh/card-2' });
  assert.equal(pushed.ok, true, pushed.refused);
  assert.equal(localChanges({ project: P }).changeOf(n).head, next.head);
  assert.equal((await run('git', ['rev-parse', `refs/pull/${n}/head`], { cwd: homeDir(P) })).stdout.trim(), next.head);
}));

test('a push naming the default branch is refused', { timeout: 120000 }, () => gitAloneWorld(async ({ client, folder, home }) => {
  const before = await headIn(home, 'main');
  const pushed = await client.push({ project: P, dir: folder, refspec: 'main' });
  assert.equal(pushed.ok, false);
  assert.match(pushed.refused, /default branch/);
  assert.equal(await headIn(home, 'main'), before);
}));

test('a shallow push rebuilds the mirror, never the home', { timeout: 120000 }, () => gitAloneWorld(async ({ client, home, worktreeWith }) => {
  const { worktree, head } = await worktreeWith('wh/card-3', TEXT);
  await client.push({ project: P, dir: worktree, refspec: 'wh/card-3' });
  const own = path.join(home, '..', 'mirror.git');
  fs.writeFileSync(path.join(own, 'shallow'), `${head}\n`);
  const next = await worktreeWith('wh/card-3', `${TEXT}// more\n`);
  const refused = await client.push({ project: P, dir: worktree, refspec: 'wh/card-3' });
  assert.equal(refused.ok, false);
  assert.equal(fs.existsSync(own), false, 'the mirror goes');
  assert.equal(await headIn(home, 'wh/card-3'), head, 'the home is as it was');
  const again = await client.push({ project: P, dir: worktree, refspec: 'wh/card-3' });
  assert.equal(again.ok, true, again.refused);
  assert.equal(await headIn(home, 'wh/card-3'), next.head);
}));

test('All stop refuses host.push', { timeout: 120000 }, () => gitAloneWorld(async ({ client, home, worktreeWith }) => {
  const { worktree } = await worktreeWith('wh/card-4', TEXT);
  await client.stop({ by: 'helper' });
  const pushed = await client.push({ project: P, dir: worktree, refspec: 'wh/card-4' });
  assert.equal(pushed.ok, false);
  assert.match(pushed.refused, /All stop/);
  assert.equal(await headIn(home, 'wh/card-4'), null);
}));

test('a push by an agent to the wheelhouse remote is denied by the sandbox rules, and the next refresh replaces it', { timeout: 120000 }, () => gitAloneWorld(async ({ client, folder, mirror, worktreeWith }) => {
  assert.ok(sandboxDenyPaths().some((denied) => mirror.startsWith(`${denied}${path.sep}`)), 'the mirror sits under the agents\' denial');
  assert.ok(mirror.startsWith(wheelhouseHome()));
  const { worktree, head } = await worktreeWith('wh/card-5', TEXT);
  await client.push({ project: P, dir: worktree, refspec: 'wh/card-5' });
  // Had a push got through all the same, the mirror would hold it until its next refresh.
  await g(worktree, 'commit', '-q', '--allow-empty', '-m', 'Planted');
  await g(worktree, 'push', '-q', '--force', mirror, 'HEAD:refs/heads/wh/card-5', 'HEAD:refs/heads/planted');
  assert.notEqual(await headIn(mirror, 'wh/card-5'), head);
  const fresh = await client.broker.refresh({ cwd: folder });
  assert.equal(fresh.ok, true, fresh.refused);
  assert.equal(await headIn(mirror, 'wh/card-5'), head);
  assert.equal(await headIn(mirror, 'planted'), null);
}));

test('a hosted project still pushes to its remote', { timeout: 120000 }, () => checksWorld(async ({ helper, remote, open }) => {
  const { runId } = await helper.engine.start({ project: 'o__p', order: workOrder({ work: { id: 'card-6', lane: 'quick', goal: 'A change', done: [{ test: 'prices' }], visible: false }, config: { pages: [] } }) });
  const { head } = await open(runId, 'wh/card-6', TEXT);
  assert.equal(await headIn(remote.url, 'wh/card-6'), head);
}));
