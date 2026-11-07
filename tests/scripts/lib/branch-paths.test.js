// tests/scripts/lib/branch-paths.test.js
// What a parked piece's branch has changed so far, read from a scratch repository through the one git route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeGit } from '../../../scripts/lib/safe-git.js';
import { pathsSoFar } from '../../../scripts/lib/branch-paths.js';

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-facts-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'readme.md'), 'hello\n');
  git('add', '.');
  git('commit', '-qm', 'first');
  git('checkout', '-qb', 'work');
  const put = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
    git('add', '.');
    git('commit', '-qm', `add ${file}`);
    return git('rev-parse', 'HEAD');
  };
  return { dir, git, put };
}

const routed = (dir) => () => ({ call: safeGit({ cwd: dir, look: 'never' }) });
const soFar = (r, over = {}) => pathsSoFar({ folder: r.dir, branch: 'work', git: routed(r.dir), baseCommit: r.git('rev-parse', 'main'), mainBranch: 'main', ...over });

test('what a parked branch has changed: what it committed, what it hasn\'t, and new files whole', async () => {
  const r = repo();
  r.put('src/a.js', 'one\n');
  fs.writeFileSync(path.join(r.dir, 'readme.md'), 'changed\n');
  fs.mkdirSync(path.join(r.dir, 'new/deep'), { recursive: true });
  fs.writeFileSync(path.join(r.dir, 'new/deep/b.js'), 'two\n');
  assert.deepEqual((await soFar(r)).sort(), ['new/deep/b.js', 'readme.md', 'src/a.js']);
});

test('a run\'s own settings overlay isn\'t its work', async () => {
  const r = repo();
  fs.mkdirSync(path.join(r.dir, '.claude'));
  fs.writeFileSync(path.join(r.dir, '.claude/settings.json'), '{}');
  assert.deepEqual(await soFar(r), []);
});

test('a rename reserves both its names', async () => {
  const r = repo();
  r.git('mv', 'readme.md', 'read.md');
  r.git('commit', '-qm', 'move');
  assert.deepEqual((await soFar(r)).sort(), ['read.md', 'readme.md']);
});

test('a main line newer than the folder holds is read from the folder\'s own copy of it', async () => {
  const r = repo();
  r.put('src/a.js', 'one\n');
  assert.deepEqual(await soFar(r, { baseCommit: 'a'.repeat(40) }), ['src/a.js']);
});

test('what can\'t be read gives null', async () => {
  const r = repo();
  assert.equal(await soFar(r, { branch: 'nothing-here' }), null);
  assert.equal(await soFar(r, { branch: '--bad' }), null);
  assert.equal(await soFar(r, { branch: null }), null);
  assert.equal(await soFar(r, { folder: null }), null);
  assert.equal(await soFar(r, { baseCommit: 'a'.repeat(40), mainBranch: 'none' }), null);
  const gone = path.join(r.dir, 'gone');
  assert.equal(await soFar(r, { folder: gone, git: routed(gone) }), null);
});
