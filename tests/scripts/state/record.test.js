// tests/scripts/state/record.test.js
// The private record (design section 24.1): a local git repository with no remote, opened, never
// cloned, for every project and for the director's settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withHome } from '../../helpers/homes.js';
import { run } from '../../../scripts/lib/run.js';
import { stateDir, oldStateDir, profileDir, oldProfileDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { openRecord, openProjectRecord, openSettings, RECORD_BRANCH } from '../../../scripts/state/record.js';

const git = async (dir, args) => (await run('git', args, { cwd: dir })).stdout.trim();

test('the record and the settings live under the home, beside the old folders', () => withHome((home) => {
  assert.equal(stateDir('shop'), path.join(home, 'projects', 'shop', 'record'));
  assert.equal(oldStateDir('shop'), path.join(home, 'projects', 'shop', 'state'));
  assert.equal(profileDir(), path.join(home, 'settings'));
  assert.equal(oldProfileDir(), path.join(home, 'profile'));
  assert.throws(() => oldStateDir('../x'));
}));

test('openProjectRecord makes a repository with no remote on the record branch', () => withHome(async () => {
  const dir = await openProjectRecord('shop');
  assert.equal(dir, stateDir('shop'));
  assert.equal(await git(dir, ['remote']), '');
  assert.equal(await git(dir, ['symbolic-ref', '--short', 'HEAD']), RECORD_BRANCH);
  assert.equal(await git(dir, ['rev-list', '--count', 'HEAD']), '1');
  assert.ok(fs.existsSync(path.join(dir, 'README.md')));
}));

test('openRecord reuses its own repository and adds nothing', () => withHome(async () => {
  const dir = await openProjectRecord('shop');
  fs.writeFileSync(path.join(dir, 'kept.txt'), 'x');
  assert.equal(await openProjectRecord('shop'), dir);
  assert.equal(await git(dir, ['rev-list', '--count', 'HEAD']), '1');
  assert.ok(fs.existsSync(path.join(dir, 'kept.txt')));
}));

test('openRecord leaves alone a repository with a remote', () => withHome(async () => {
  const dir = stateDir('shop');
  fs.mkdirSync(dir, { recursive: true });
  await run('git', ['init', '-q'], { cwd: dir });
  await run('git', ['remote', 'add', 'origin', 'https://example.invalid/x.git'], { cwd: dir });
  await assert.rejects(openProjectRecord('shop'), /has a remote/);
  assert.equal(await git(dir, ['remote']), 'origin');
}));

test('openRecord leaves alone a folder with files but no repository', () => withHome(async () => {
  const dir = stateDir('shop');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mine.txt'), 'x');
  await assert.rejects(openProjectRecord('shop'), /holds files but no repository/);
  assert.deepEqual(fs.readdirSync(dir), ['mine.txt']);
}));

test('openRecord accepts a repository with no remote on the old state branch name', () => withHome(async () => {
  const dir = path.join(wheelhouseHome(), 'elsewhere');
  fs.mkdirSync(dir, { recursive: true });
  await run('git', ['init', '-q'], { cwd: dir });
  await run('git', ['symbolic-ref', 'HEAD', 'refs/heads/wheelhouse-state'], { cwd: dir });
  assert.equal(await openRecord(dir, { what: 'a test record' }), dir);
}));

test('openSettings makes the settings record', () => withHome(async () => {
  const dir = await openSettings();
  assert.equal(dir, profileDir());
  assert.equal(await git(dir, ['remote']), '');
  assert.equal(await git(dir, ['symbolic-ref', '--short', 'HEAD']), RECORD_BRANCH);
}));
