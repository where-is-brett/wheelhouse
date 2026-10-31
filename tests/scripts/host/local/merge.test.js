// tests/scripts/host/local/merge.test.js
// A local change reaching the main version (spec 7.4), its undo, and clean-up behind the helper's own look (check 83).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { localChanges } from '../../../../scripts/host/local/changes.js';
import { bringFolderUp, compareFolder, addFolderRemote, FOLDER_REMOTE } from '../../../../scripts/host/local/folder.js';
import { homeDir, makeHome } from '../../../../scripts/host/local/home.js';
import { carriesFolderWork, cleanMerged, dropNextMain, finishMerge, keepSeenMain, mergeChange, nextMain, revertOnHome, seenMain } from '../../../../scripts/host/local/merge.js';
import { commitIn, git, projectFolderWith, withKeyedHome } from '../../../helpers/local-home.js';
import { tempFolder } from '../../../helpers/homes.js';

const P = 'shop';
async function world(fn) {
  return withKeyedHome(async () => {
    const folder = await projectFolderWith();
    await git(folder, ['config', 'user.name', 'Pat']);
    await git(folder, ['config', 'user.email', 'pat@example.com']);
    await makeHome({ project: P, folder });
    const home = homeDir(P);
    const mirror = path.join(tempFolder('wh-mirror-'), 'mirror.git');
    await addFolderRemote({ folder, mirror });
    const changes = localChanges({ project: P });
    // A branch in the folder, reaching the home, with an open change.
    const change = async (branch, file, { title = `Add ${file}`, from = 'main' } = {}) => {
      await git(folder, ['branch', '--no-track', branch, from]);
      await git(folder, ['switch', '-q', branch]);
      const head = await commitIn(folder, file);
      await git(folder, ['switch', '-q', 'main']);
      await git(home, ['fetch', '-q', folder, `+refs/heads/${branch}:refs/heads/${branch}`]);
      return changes.openChange({ branch, base: 'main', title, head });
    };
    return fn({ folder, home, changes, change, main: () => git(home, ['rev-parse', 'refs/heads/main']) });
  });
}

test('a merge squashes with the title as its message', () => world(async ({ home, change, changes, main }) => {
  const c = await change('wh/a', 'a2.txt', { title: 'Add a second file' });
  const was = await main();
  const got = await mergeChange({ project: P, n: c.n, head: c.head });
  assert.equal(got.merged, true);
  assert.equal(await main(), got.commit);
  assert.notEqual(got.commit, c.head);
  assert.equal(await git(home, ['log', '-1', '--format=%s', 'refs/heads/main']), 'Add a second file');
  assert.equal(await git(home, ['rev-parse', 'refs/heads/main^']), was, 'one parent');
  assert.equal(await git(home, ['show', 'refs/heads/main:a2.txt']), 'a2.txt');
  assert.deepEqual([changes.changeOf(c.n).state, changes.changeOf(c.n).mergeCommit], ['merged', got.commit]);
  assert.equal(seenMain(P), got.commit);
}));

test('commits as the folder\'s git identity', () => world(async ({ folder, home, change }) => {
  const c = await change('wh/a', 'a2.txt');
  await mergeChange({ project: P, n: c.n, head: c.head, folder });
  assert.equal(await git(home, ['log', '-1', '--format=%an %ae', 'refs/heads/main']), 'Pat pat@example.com');
}));

test('no identity commits as Wheelhouse', () => world(async ({ home, change }) => {
  const c = await change('wh/a', 'a2.txt');
  await mergeChange({ project: P, n: c.n, head: c.head });
  assert.equal(await git(home, ['log', '-1', '--format=%an', 'refs/heads/main']), 'Wheelhouse');
}));

test('the head moved after review is refused', () => world(async ({ change, main, changes }) => {
  const c = await change('wh/a', 'a2.txt');
  const was = await main();
  const got = await mergeChange({ project: P, n: c.n, head: 'b'.repeat(40) });
  assert.equal(got.merged, false);
  assert.match(got.reason, /moved after it was reviewed/);
  assert.equal(await main(), was);
  assert.equal(changes.changeOf(c.n).state, 'open');
}));

test('a lost compare-and-swap merges nothing and tries next sweep', () => world(async ({ home, folder, change, changes, main }) => {
  const c = await change('wh/a', 'a2.txt');
  const other = await git(home, ['rev-parse', 'refs/heads/main']);
  // The main version moves between the merge being worked out and the move: the run that does it stands in.
  const racing = async (file, args, options) => {
    if (args.includes('update-ref') && args.some((a) => a === 'refs/heads/main')) {
      await git(home, ['update-ref', 'refs/heads/main', await git(home, ['commit-tree', '-p', other, '-m', 'x', `${other}^{tree}`])]);
    }
    const { run } = await import('../../../../scripts/lib/run.js');
    return run(file, args, options);
  };
  const got = await mergeChange({ project: P, n: c.n, head: c.head, run: racing });
  assert.equal(got.merged, false);
  assert.match(got.reason, /moved while/);
  assert.equal(changes.changeOf(c.n).state, 'open');
  assert.notEqual(await main(), other);
  void folder;
}));

test('a clash merges nothing and says so', () => world(async ({ home, folder, change, changes }) => {
  const c = await change('wh/a', 'same.txt');
  await git(folder, ['switch', '-q', '-c', 'wh/b']);
  await commitIn(folder, 'same.txt', 'other\n');
  await git(folder, ['switch', '-q', 'main']);
  await git(home, ['fetch', '-q', folder, '+refs/heads/wh/b:refs/heads/main']);
  assert.deepEqual(await mergeChange({ project: P, n: c.n, head: c.head }), { merged: false, reason: 'clash' });
  assert.equal(changes.changeOf(c.n).state, 'open');
}));

test('All stop just before the move leaves the main version whole', () => world(async ({ change, changes, main }) => {
  const c = await change('wh/a', 'a2.txt');
  const was = await main();
  const got = await mergeChange({ project: P, n: c.n, head: c.head, stopped: () => true });
  assert.deepEqual(got, { merged: false, reason: 'All stop is on' });
  assert.equal(await main(), was);
  assert.equal(changes.changeOf(c.n).state, 'open');
}));

test('undo reverts on the home with a new commit, and nothing is deleted', () => world(async ({ home, change, main }) => {
  const c = await change('wh/a', 'a2.txt');
  const { commit } = await mergeChange({ project: P, n: c.n, head: c.head });
  const undone = await revertOnHome({ project: P, branch: 'main', commits: [commit] });
  assert.equal(await main(), undone);
  assert.equal(seenMain(P), undone);
  assert.equal(await git(home, ['rev-parse', 'refs/heads/main^']), commit);
  assert.equal(await git(home, ['ls-tree', '--name-only', 'refs/heads/main']), 'a.txt');
}));

// --- a hand-made change ---

test('a hand-made change on top of the main version fast-forwards, and the folder stays in step', () => world(async ({ folder, home, changes, main }) => {
  const tip = await commitIn(folder, 'by-hand.txt');
  const branch = `feature/by-hand-${tip.slice(0, 12)}`;
  await git(home, ['fetch', '-q', folder, `+refs/heads/main:refs/heads/${branch}`]);
  const c = await changes.openChange({ branch, base: 'main', title: 'By hand', head: tip });
  const keepHistory = await carriesFolderWork({ project: P, folder, branch: 'main', change: c });
  assert.equal(keepHistory, true);
  const got = await mergeChange({ project: P, n: c.n, head: tip, keepHistory });
  assert.equal(got.commit, tip);
  assert.equal(await main(), tip);
  assert.equal(await compareFolder({ project: P, folder, branch: 'main' }), 'same');
}));

test('a hand-made change behind a moved main version merges with both parents, and the folder comes up', () => world(async ({ folder, home, change, changes, main }) => {
  const made = await change('wh/first', 'first.txt');
  const tip = await commitIn(folder, 'by-hand.txt');
  const branch = `feature/by-hand-${tip.slice(0, 12)}`;
  await git(home, ['fetch', '-q', folder, `+refs/heads/main:refs/heads/${branch}`]);
  const c = await changes.openChange({ branch, base: 'main', title: 'By hand', head: tip });
  await mergeChange({ project: P, n: made.n, head: made.head });
  dropNextMain(P);
  assert.equal(await compareFolder({ project: P, folder, branch: 'main' }), 'parted');
  const got = await mergeChange({ project: P, n: c.n, head: tip, keepHistory: true });
  assert.equal(got.merged, true);
  assert.equal((await git(home, ['rev-list', '--parents', '-n', '1', await main()])).split(' ').length, 3);
  assert.equal(await compareFolder({ project: P, folder, branch: 'main' }), 'home-ahead');
  assert.deepEqual(await bringFolderUp({ project: P, folder, branch: 'main' }), { moved: true });
  assert.equal(await git(folder, ['rev-parse', 'HEAD']), await main());
}));

test('a lane carrying the folder\'s work on keeps its history, and an ordinary one squashes', () => world(async ({ folder, home, change, changes }) => {
  const plain = await change('wh/plain', 'plain.txt');
  assert.equal(await carriesFolderWork({ project: P, folder, branch: 'main', change: plain }), false);
  await commitIn(folder, 'by-hand.txt');
  const carried = await change('wh/carried', 'carried.txt');
  assert.equal(await carriesFolderWork({ project: P, folder, branch: 'main', change: carried }), true);
  assert.equal(await git(folder, ['for-each-ref', `refs/remotes/${FOLDER_REMOTE}/pull`]), '', 'nothing left behind');
  void home; void changes;
}));

test('a fast-forward\'s head pass leaves the main line unchecked', async () => {
  const { makeLocalAdapter } = await import('../../../../scripts/host/local/adapter.js');
  const { commandDigest, writeCheck } = await import('../../../../scripts/checks/record.js');
  const { openProjectRecord } = await import('../../../../scripts/state/record.js');
  const { writeEvent } = await import('../../../../scripts/state/events.js');
  await world(async ({ folder, home, changes }) => {
    await openProjectRecord(P, {});
    const tip = await commitIn(folder, 'by-hand.txt');
    await git(home, ['fetch', '-q', folder, '+refs/heads/main:refs/heads/feature/by-hand-abc']);
    const c = await changes.openChange({ branch: 'feature/by-hand-abc', base: 'main', title: 'By hand', head: tip });
    await writeCheck(P, { commit: tip, command: commandDigest('npm test'), result: 'passed', minutes: 0, tail: '' }, { write: ({ event }) => writeEvent({ project: P, event }) });
    const adapter = makeLocalAdapter({ project: P });
    assert.equal((await adapter.ciState(tip)).state, 'success', 'a head\'s pass, while it is a head');
    await mergeChange({ project: P, n: c.n, head: tip, keepHistory: true });
    assert.equal((await adapter.ciState(tip)).state, 'none', 'the same commit as the main line has had no clean run');
    await writeCheck(P, { commit: tip, command: commandDigest('npm test'), result: 'passed', minutes: 0, tail: '', clean: true }, { write: ({ event }) => writeEvent({ project: P, event }) });
    assert.equal((await adapter.ciState(tip)).state, 'success');
  });
});

// --- clean-up, behind the look ---

async function merged({ folder, home, changes }) {
  const tree = path.join(folder, '.wheelhouse', 'worktrees', 'wh-a');
  await git(folder, ['worktree', 'add', '-q', '-b', 'wh/a', tree]);
  const head = await commitIn(tree, 'a2.txt');
  await git(home, ['fetch', '-q', folder, '+refs/heads/wh/a:refs/heads/wh/a']);
  const c = await changes.openChange({ branch: 'wh/a', base: 'main', title: 'A', head });
  await mergeChange({ project: P, n: c.n, head });
  return { tree, change: changes.changeOf(c.n) };
}
function completing() {
  const calls = [];
  return { calls, complete: async (args) => { calls.push(args); return { ok: true }; } };
}

test('a squashed branch with nothing left in it is cleaned up', () => world(async (w) => {
  const { change } = await merged(w);
  const { calls, complete } = completing();
  assert.equal(await cleanMerged({ project: P, folder: w.folder, change, complete }), 'removed');
  assert.deepEqual(calls, [{ folder: w.folder, branch: 'wh/a' }]);
}));

for (const [what, leave] of [
  ['a commit after the merge', async (tree) => { await commitIn(tree, 'later.txt'); }],
  ['a change not committed', async (tree) => { fs.writeFileSync(path.join(tree, 'a.txt'), 'changed\n'); }],
  ['a file git doesn\'t track', async (tree) => { fs.writeFileSync(path.join(tree, 'new.txt'), 'new\n'); }],
]) {
  test(`${what} keeps the worktree`, () => world(async (w) => {
    const { tree, change } = await merged(w);
    await leave(tree);
    const { calls, complete } = completing();
    assert.equal(await cleanMerged({ project: P, folder: w.folder, change, complete }), 'kept');
    assert.deepEqual(calls, []);
  }));
}

test('a merge left half done keeps the worktree', () => world(async (w) => {
  const { tree, change } = await merged(w);
  fs.writeFileSync(path.join(await git(tree, ['rev-parse', '--absolute-git-dir']), 'MERGE_HEAD'), `${change.head}\n`);
  const { calls, complete } = completing();
  assert.equal(await cleanMerged({ project: P, folder: w.folder, change, complete }), 'kept');
  assert.deepEqual(calls, []);
}));

test('a run on the branch waits', () => world(async (w) => {
  const { change } = await merged(w);
  const { calls, complete } = completing();
  assert.equal(await cleanMerged({ project: P, folder: w.folder, change, running: () => true, complete }), 'running');
  assert.deepEqual(calls, []);
}));

test('a branch that has gone needs nothing', () => world(async (w) => {
  const { tree, change } = await merged(w);
  await git(w.folder, ['worktree', 'remove', '--force', tree]);
  await git(w.folder, ['branch', '-qD', 'wh/a']);
  assert.equal(await cleanMerged({ project: P, folder: w.folder, change, complete: async () => assert.fail('nothing to do') }), 'gone');
}));

test('a seen main version is kept beside the home', () => world(async () => {
  assert.equal(seenMain(P), null);
  keepSeenMain(P, 'c'.repeat(40));
  assert.equal(seenMain(P), 'c'.repeat(40));
}));

test('a main version moved outside the helper is built on by no merge', () => world(async ({ folder, home, changes }) => {
  const tree = path.join(folder, '.wheelhouse', 'worktrees', 'wh-a');
  await git(folder, ['worktree', 'add', '-q', '-b', 'wh/a', tree]);
  const head = await commitIn(tree, 'a2.txt');
  await git(home, ['fetch', '-q', folder, '+refs/heads/wh/a:refs/heads/wh/a']);
  const c = await changes.openChange({ branch: 'wh/a', base: 'main', title: 'A', head });
  keepSeenMain(P, 'a'.repeat(40));
  const got = await mergeChange({ project: P, n: c.n, head });
  assert.deepEqual(got, { merged: false, reason: 'The main version moved outside the helper' });
}));

test('a merge a crash left behind is finished once, with its records, and reads as no outside move', () => world(async (w) => {
  const { change } = await merged(w);
  const main = (await git(w.home, ['rev-parse', 'refs/heads/main'])).trim();
  assert.deepEqual(nextMain(P), { n: change.n, commit: main, from: nextMain(P).from, base: 'main' });
  const { from } = nextMain(P);
  keepSeenMain(P, from);
  assert.equal((await finishMerge({ project: P })).commit, main);
  assert.equal(seenMain(P), main);
  assert.equal(w.changes.changeOf(change.n).state, 'merged');
  dropNextMain(P);
  assert.equal(await finishMerge({ project: P }), null);
}));

test('a move that never happened is dropped', () => world(async (w) => {
  const { change } = await merged(w);
  const { from } = nextMain(P);
  await git(w.home, ['update-ref', 'refs/heads/main', from]);
  keepSeenMain(P, from);
  assert.equal(await finishMerge({ project: P }), null);
  assert.equal(nextMain(P), null);
  assert.equal(seenMain(P), from);
  assert.equal(w.changes.changeOf(change.n).state, 'merged', 'the record stands as it was');
}));

test('an ignored file that nothing makes again keeps the worktree, and what a build makes doesn\'t', () => world(async (w) => {
  const { tree, change } = await merged(w);
  const excludes = (await git(tree, ['rev-parse', '--git-path', 'info/exclude'])).trim();
  fs.mkdirSync(path.dirname(path.resolve(tree, excludes)), { recursive: true });
  fs.writeFileSync(path.resolve(tree, excludes), 'node_modules/\n.env\n');
  fs.mkdirSync(path.join(tree, 'node_modules'));
  fs.writeFileSync(path.join(tree, 'node_modules', 'a.js'), 'made\n');
  const { calls, complete } = completing();
  assert.equal(await cleanMerged({ project: P, folder: w.folder, change, complete }), 'removed');
  fs.writeFileSync(path.join(tree, '.env'), 'SECRET=1\n');
  assert.equal(await cleanMerged({ project: P, folder: w.folder, change, complete }), 'kept');
  assert.equal(calls.length, 1);
}));
