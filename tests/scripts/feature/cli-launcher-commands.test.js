// tests/scripts/feature/cli-launcher-commands.test.js
// The feature command's own git steps, for a session run by launcher whose shell allows no git: `commit`, `head` and `diff`,
// and a push, pull or open-pr that commits first. A session not run by launcher (Claude Code's) is not committed for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main, push } from '../../../scripts/feature/cli.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { LAUNCHED } from '../../../scripts/lib/launchers.js';
import { briefFields, briefText } from '../../helpers/foreman.js';

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();

// A project repository with a default branch the worktree is cut from, and a feature worktree with its brief.
function feature() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-feature-cmds-'));
  const main = path.join(root, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.name', 'Owner');
  git(main, 'config', 'user.email', 'owner@example.test');
  fs.writeFileSync(path.join(main, 'readme.md'), 'start\n');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'Start');
  git(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const tree = path.join(root, 'tree');
  git(main, 'worktree', 'add', '-q', '-b', 'feature/login', tree);
  fs.mkdirSync(featurePaths(tree).dir, { recursive: true });
  fs.writeFileSync(featurePaths(tree).brief, briefText(briefFields('login')));
  return { root, main, tree, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

async function run(tree, argv, { launched = true, client = {} } = {}) {
  const was = process.env[LAUNCHED];
  if (launched) process.env[LAUNCHED] = '1';
  else delete process.env[LAUNCHED];
  let text = '';
  let errors = '';
  try {
    const code = await main(argv, { cwd: tree, find: () => ({ root: tree }), out: (t) => { text += t; }, err: (t) => { errors += t; }, client });
    return { code, text, errors };
  } finally {
    if (was === undefined) delete process.env[LAUNCHED];
    else process.env[LAUNCHED] = was;
  }
}

test('commit commits what the session changed, prints the hash, and a second run finds nothing to commit', async () => {
  const f = feature();
  try {
    fs.writeFileSync(path.join(f.tree, 'a.js'), 'a\n');
    const first = await run(f.tree, ['commit']);
    assert.equal(first.code, 0, first.errors);
    assert.equal(first.text, `Committed ${git(f.tree, 'rev-parse', 'HEAD')}\n`);
    assert.equal(git(f.tree, 'log', '-1', '--format=%B').trim(), 'Work on login');
    const second = await run(f.tree, ['commit']);
    assert.match(second.text, /Nothing to commit \(nothing has changed\)\. The head is [0-9a-f]{40}/);
    assert.equal((await run(f.tree, ['commit', 'now'])).code, 1);
  } finally {
    f.done();
  }
});

test('head prints the full hash of the head', async () => {
  const f = feature();
  try {
    const got = await run(f.tree, ['head']);
    assert.equal(got.text, `${git(f.tree, 'rev-parse', 'HEAD')}\n`);
  } finally {
    f.done();
  }
});

test('diff writes what the branch adds to the review folder, committing first, and prints the head it holds', async () => {
  const f = feature();
  try {
    fs.writeFileSync(path.join(f.tree, 'a.js'), 'export const a = 1;\n');
    const got = await run(f.tree, ['diff', '1']);
    assert.equal(got.code, 0, got.errors);
    const head = git(f.tree, 'rev-parse', 'HEAD');
    assert.equal(got.text, `Wrote .wheelhouse/feature/review/1.diff. The head it holds is ${head}\n`);
    const diff = fs.readFileSync(path.join(featurePaths(f.tree).dir, 'review', '1.diff'), 'utf8');
    assert.match(diff, /\+\+\+ b\/a\.js/);
    assert.match(diff, /\+export const a = 1;/);
    assert.ok(!diff.includes('readme.md'), 'only what the branch adds');
    assert.equal(git(f.tree, 'status', '--porcelain', '--untracked-files=no'), '', 'what the session wrote is committed');
  } finally {
    f.done();
  }
});

test('diff takes one review number and nothing else', async () => {
  const f = feature();
  try {
    for (const argv of [['diff'], ['diff', 'x'], ['diff', '0'], ['diff', '1', '2'], ['diff', '../x'], ['diff', '--output=/x']]) {
      const got = await run(f.tree, argv);
      assert.equal(got.code, 1, argv.join(' '));
      assert.match(got.errors, /Give the review number/);
    }
  } finally {
    f.done();
  }
});

test('a push by a session run by launcher commits first, so the work goes up; Claude Code\'s own push does not', async () => {
  const f = feature();
  try {
    const pushed = [];
    const client = { push: async (body) => { pushed.push(body.refspec); return { ok: true }; } };
    fs.writeFileSync(path.join(f.tree, 'a.js'), 'a\n');
    const before = git(f.tree, 'rev-parse', 'HEAD');
    await push({ client, worktree: f.tree });
    assert.equal(git(f.tree, 'rev-parse', 'HEAD'), before, 'not committed for a session that commits itself');
    await push({ client, worktree: f.tree, commitFirst: true });
    assert.notEqual(git(f.tree, 'rev-parse', 'HEAD'), before);
    assert.equal(git(f.tree, 'status', '--porcelain', '--untracked-files=no'), '');
    assert.deepEqual(pushed, ['feature/login', 'feature/login']);
    fs.writeFileSync(path.join(f.tree, 'b.js'), 'b\n');
    const viaCommand = await run(f.tree, ['push'], { client });
    assert.equal(viaCommand.code, 0, viaCommand.errors);
    assert.equal(git(f.tree, 'log', '-1', '--format=%s'), 'Work on login', 'the push command commits first when run by launcher');
    fs.writeFileSync(path.join(f.tree, 'c.js'), 'c\n');
    await run(f.tree, ['push'], { client, launched: false });
    assert.equal(git(f.tree, 'status', '--porcelain'), '?? .wheelhouse/\n?? c.js','not committed for a session that commits itself');
  } finally {
    f.done();
  }
});

test('a push stops, naming why, when the work cannot be committed', async () => {
  const f = feature();
  try {
    fs.writeFileSync(path.join(f.tree, 'a.js'), 'a\n');
    git(f.main, 'config', 'filter.x.clean', 'cat');
    let reached = false;
    await assert.rejects(push({ client: { push: async () => { reached = true; return { ok: true }; } }, worktree: f.tree, commitFirst: true }), /Nothing was pushed: the work in this worktree could not be committed/);
    assert.equal(reached, false);
  } finally {
    f.done();
  }
});

test('commit finishes a merge whose clashes are resolved, and refuses one that still holds a conflict marker', async () => {
  const f = feature();
  try {
    fs.writeFileSync(path.join(f.tree, 'readme.md'), 'ours\n');
    git(f.tree, 'commit', '-q', '-am', 'Ours');
    git(f.main, 'checkout', '-q', '-b', 'other');
    fs.writeFileSync(path.join(f.main, 'readme.md'), 'theirs\n');
    git(f.main, 'commit', '-q', '-am', 'Theirs');
    try {
      git(f.tree, 'merge', '-q', '--no-edit', 'other');
    } catch { /* the clash is the point */ }
    const marked = await run(f.tree, ['commit']);
    assert.equal(marked.code, 1);
    assert.match(marked.errors, /conflict marker is still in readme\.md/);
    fs.writeFileSync(path.join(f.tree, 'readme.md'), 'both\n');
    const done = await run(f.tree, ['commit']);
    assert.equal(done.code, 0, done.errors);
    assert.equal(git(f.tree, 'rev-parse', '-q', '--verify', 'HEAD^2').length, 40, 'a merge commit');
    assert.match(git(f.tree, 'log', '-1', '--format=%s'), /^Merge/);
  } finally {
    f.done();
  }
});
