// tests/scripts/agents/copilot/commit-work.test.js
// What Wheelhouse commits for a Copilot feature session once its run has ended: the whole worktree but the feature's own
// folder, with git's hooks off, no co-author line, and the hash read from the commit it made.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { commitWork } from '../../../../scripts/agents/copilot/commit-work.js';
import { recordPlan } from '../../../../scripts/feature/cli.js';

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();

// A repository with one commit, and the worktree a feature session works in, as a linked worktree of it.
function worktreeOf() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-commit-work-'));
  const main = path.join(root, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.name', 'Project Owner');
  git(main, 'config', 'user.email', 'owner@example.test');
  fs.writeFileSync(path.join(main, 'readme.md'), 'start\n');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'Start');
  const tree = path.join(root, 'tree');
  git(main, 'worktree', 'add', '-q', '-b', 'feature/login', tree);
  return { root, main, tree, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('commits the session\'s files, a plan at the worktree\'s root included, and takes the hash from that commit', async () => {
  const w = worktreeOf();
  try {
    fs.writeFileSync(path.join(w.tree, 'login.js'), 'export const login = true;\n');
    fs.writeFileSync(path.join(w.tree, 'login-plan.md'), '# Plan\n');
    const before = git(w.tree, 'rev-parse', 'HEAD');
    const made = await commitWork({ worktree: w.tree, work: 'login' });
    assert.equal(made.commit, git(w.tree, 'rev-parse', 'HEAD'));
    assert.equal(made.head, made.commit);
    assert.notEqual(made.commit, before);
    assert.equal(git(w.tree, 'log', '-1', '--format=%s'), 'Work on login');
    assert.deepEqual(git(w.tree, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['login-plan.md', 'login.js']);
    assert.equal(git(w.tree, 'status', '--porcelain'), '');
  } finally {
    w.done();
  }
});

test('the commit carries no co-author line, whatever the session wrote, and no sign of who helped', async () => {
  const w = worktreeOf();
  try {
    fs.writeFileSync(path.join(w.tree, 'a.js'), '// Co-authored-by: someone <a@b.test>\n');
    await commitWork({ worktree: w.tree, work: 'login' });
    const message = git(w.tree, 'log', '-1', '--format=%B');
    assert.equal(message.trim(), 'Work on login');
    assert.ok(!/co-authored-by/i.test(message), message);
    assert.ok(!/signed-off-by/i.test(message), message);
    assert.equal(git(w.tree, 'log', '-1', '--format=%an <%ae>'), 'Project Owner <owner@example.test>');
  } finally {
    w.done();
  }
});

test('a project\'s git hooks do not run, and the author is Wheelhouse where the worktree names none', async () => {
  const w = worktreeOf();
  try {
    const marker = path.join(w.root, 'hook-ran');
    const hooks = path.join(w.main, '.git', 'hooks');
    for (const hook of ['pre-commit', 'commit-msg', 'prepare-commit-msg', 'post-commit']) {
      fs.writeFileSync(path.join(hooks, hook), `#!/bin/sh\necho ran > "${marker}"\nexit 1\n`, { mode: 0o755 });
    }
    git(w.main, 'config', '--unset', 'user.name');
    git(w.main, 'config', '--unset', 'user.email');
    fs.writeFileSync(path.join(w.tree, 'a.js'), 'a\n');
    const made = await commitWork({ worktree: w.tree, work: 'login' });
    assert.ok(made.commit, JSON.stringify(made));
    assert.ok(!fs.existsSync(marker), 'a hook ran');
    assert.equal(git(w.tree, 'log', '-1', '--format=%an <%ae>'), 'Wheelhouse <wheelhouse@localhost>');
  } finally {
    w.done();
  }
});

test('the feature\'s own folder is never committed', async () => {
  const w = worktreeOf();
  try {
    fs.mkdirSync(path.join(w.tree, '.wheelhouse', 'feature'), { recursive: true });
    fs.writeFileSync(path.join(w.tree, '.wheelhouse', 'feature', 'report.md'), 'report\n');
    fs.writeFileSync(path.join(w.tree, 'a.js'), 'a\n');
    await commitWork({ worktree: w.tree, work: 'login' });
    assert.equal(git(w.tree, 'show', '--name-only', '--format=', 'HEAD'), 'a.js');
  } finally {
    w.done();
  }
});

test('a plan at the root is recorded by the plan command and then committed', async () => {
  const w = worktreeOf();
  try {
    fs.mkdirSync(path.join(w.tree, '.wheelhouse', 'feature'), { recursive: true });
    fs.writeFileSync(path.join(w.tree, 'login-plan.md'), '# Plan\n\n## Task 1\n');
    assert.deepEqual(recordPlan({ worktree: w.tree, argv: ['login-plan.md'] }), { plan: 'login-plan.md' });
    const made = await commitWork({ worktree: w.tree, work: 'login' });
    assert.ok(made.commit);
    assert.equal(git(w.tree, 'show', '--name-only', '--format=', 'HEAD'), 'login-plan.md');
  } finally {
    w.done();
  }
});

test('nothing changed makes no commit and gives the head as it is', async () => {
  const w = worktreeOf();
  try {
    const before = git(w.tree, 'rev-parse', 'HEAD');
    const made = await commitWork({ worktree: w.tree, work: 'login' });
    assert.deepEqual(made, { head: before, skipped: 'nothing has changed' });
    fs.mkdirSync(path.join(w.tree, '.wheelhouse'));
    fs.writeFileSync(path.join(w.tree, '.wheelhouse', 'x'), 'x\n');
    assert.equal((await commitWork({ worktree: w.tree, work: 'login' })).commit, undefined);
    assert.equal(git(w.tree, 'rev-parse', 'HEAD'), before);
  } finally {
    w.done();
  }
});

test('a merge left half done is not committed over', async () => {
  const w = worktreeOf();
  try {
    fs.writeFileSync(path.join(w.tree, 'readme.md'), 'ours\n');
    git(w.tree, 'commit', '-q', '-am', 'Ours');
    git(w.main, 'checkout', '-q', '-b', 'other', 'HEAD~0');
    fs.writeFileSync(path.join(w.main, 'readme.md'), 'theirs\n');
    git(w.main, 'commit', '-q', '-am', 'Theirs');
    try {
      git(w.tree, 'merge', '-q', '--no-edit', 'other');
    } catch { /* the clash is the point */ }
    const made = await commitWork({ worktree: w.tree, work: 'login' });
    assert.equal(made.commit, undefined);
    assert.equal(made.skipped, 'a merge is not finished');
  } finally {
    w.done();
  }
});

test('a folder that is not a worktree, or a work name that is not a name, fails in words', async () => {
  const w = worktreeOf();
  try {
    assert.match((await commitWork({ worktree: 'relative', work: 'login' })).failed, /whole path/);
    assert.match((await commitWork({ worktree: w.tree, work: 'Login; rm' })).failed, /name/);
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-commit-bare-'));
    try {
      assert.match((await commitWork({ worktree: bare, work: 'login' })).failed, /not a git working tree/);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  } finally {
    w.done();
  }
});
