// tests/scripts/lib/local-git.test.js
// The git steps Lean's store and a project's home share (spec 5.1): each takes the repository and the branch, and refuses
// with a code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempFolder } from '../../helpers/homes.js';
import { run, withoutGitVars } from '../../../scripts/lib/run.js';
import { moveHead, headOf, inTempTree, revertOn, lookAtHead, updateCopy, withLocalLock, LocalRefusal } from '../../../scripts/lib/local-git.js';

const WHO = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' };
async function git(cwd, args) {
  const got = await run('git', args, { cwd, baseEnv: withoutGitVars(process.env), env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...WHO } });
  assert.equal(got.code, 0, got.stderr);
  return got.stdout.trim();
}

// A bare repository on `branch` with two commits: { dir, first, second }.
async function repository(branch = 'trunk') {
  const root = tempFolder('wh-local-git-');
  const work = path.join(root, 'work');
  fs.mkdirSync(work);
  await git(work, ['init', '-q', '-b', branch]);
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\n');
  await git(work, ['add', 'a.txt']);
  await git(work, ['commit', '-q', '-m', 'first']);
  const first = await git(work, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(work, 'b.txt'), 'two\n');
  await git(work, ['add', 'b.txt']);
  await git(work, ['commit', '-q', '-m', 'second']);
  const second = await git(work, ['rev-parse', 'HEAD']);
  const dir = path.join(root, 'repo.git');
  await git(root, ['clone', '-q', '--bare', '--no-hardlinks', work, dir]);
  return { root, dir, first, second };
}

const refusedWith = (code) => (error) => error instanceof LocalRefusal && error.code === code;

test('moveHead refuses when the branch has moved', async () => {
  const { dir, first, second } = await repository();
  await assert.rejects(moveHead({ dir, branch: 'trunk', to: first, from: first, run }), refusedWith('moved'));
  assert.equal(await headOf({ dir, branch: 'trunk', run }), second);
  await moveHead({ dir, branch: 'trunk', to: first, from: second, run });
  assert.equal(await headOf({ dir, branch: 'trunk', run }), first);
});

test('a branch not called main works', async () => {
  const { dir, first, second } = await repository('develop');
  const made = await inTempTree({ dir, at: second, env: WHO, run }, async (tree, inTree) => {
    fs.writeFileSync(path.join(tree, 'c.txt'), 'three\n');
    await inTree.must(['add', 'c.txt'], 'unread');
    await git(tree, ['commit', '-q', '-m', 'third']);
    return inTree.must(['rev-parse', 'HEAD'], 'unread');
  });
  await moveHead({ dir, branch: 'develop', to: made, from: second, run });
  const undone = await revertOn({ dir, at: made, commits: [made], env: WHO, run });
  await moveHead({ dir, branch: 'develop', to: undone, from: made, run });
  assert.equal(await git(dir, ['rev-parse', 'develop^']), made);
  assert.deepEqual((await git(dir, ['ls-tree', '--name-only', 'develop'])).split('\n'), ['a.txt', 'b.txt']);
  assert.equal(fs.readdirSync(path.dirname(dir)).filter((n) => n.startsWith('work-')).length, 0, 'the temporary worktree went');
  assert.notEqual(first, made);
});

test('two callers of withLocalLock go one at a time', async () => {
  const dir = tempFolder('wh-local-lock-');
  const order = [];
  let free;
  let inside;
  const entered = new Promise((resolve) => { inside = resolve; });
  const held = withLocalLock({ dir }, () => new Promise((resolve) => { free = resolve; order.push('one in'); inside(); }));
  await entered;
  const waiting = withLocalLock({ dir }, async () => { order.push('two in'); }, { pollMs: 5 });
  await assert.rejects(withLocalLock({ dir }, async () => {}, { waitMs: 20, pollMs: 5 }), refusedWith('busy'));
  order.push('one out');
  free();
  await Promise.all([held, waiting]);
  assert.deepEqual(order, ['one in', 'one out', 'two in']);
});

test('lookAtHead reads a head moved outside the helper and raises the card', async () => {
  const { dir, first, second } = await repository();
  const raised = [];
  assert.deepEqual(await lookAtHead({ dir, branch: 'trunk', expected: second, run, record: async () => assert.fail('no card') }), { recorded: second, current: second, moved: false });
  const moved = await lookAtHead({ dir, branch: 'trunk', expected: () => first, run, record: async (card) => { raised.push(card); return 'card-id'; } });
  assert.deepEqual(moved, { recorded: first, current: second, moved: true, card: 'card-id' });
  assert.equal(raised[0].header, 'Main moved');
});

test('updateCopy fetches into a repository of its own, and leaves a folder that is none', async () => {
  const { root, dir, second } = await repository();
  const copy = path.join(root, 'copy.git');
  await git(root, ['init', '-q', '--bare', copy]);
  assert.deepEqual(await updateCopy({ dir, branch: 'trunk', copy, run }), { pushed: true, commit: second });
  assert.equal(await git(copy, ['rev-parse', 'refs/heads/trunk']), second);
  const plain = path.join(root, 'work');
  fs.mkdirSync(path.join(plain, 'inside'));
  assert.equal((await updateCopy({ dir, branch: 'trunk', copy: path.join(plain, 'inside'), run })).pushed, false);
  assert.equal((await updateCopy({ dir, branch: 'trunk', copy: path.join(root, 'gone'), run })).pushed, false);
});
