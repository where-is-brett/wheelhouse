// tests/scripts/protection/managed.test.js
// Where the computer-wide settings live, and what is read from them where there is no such folder: Locked
// runs on macOS, and Windows runs Standard with the Guarded build commands, so Windows has no managed folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { managedDir, lockedProjects } from '../../../scripts/protection/managed.js';

test('managedDir names the folder on macOS and Linux, and none anywhere else, Windows included', () => {
  assert.equal(managedDir('darwin'), '/Library/Application Support/ClaudeCode');
  assert.equal(managedDir('linux'), '/etc/claude-code');
  assert.equal(managedDir('win32'), null);
  assert.equal(managedDir('freebsd'), null);
});

test('with no managed folder there are no Locked projects, and nothing is read or thrown', () => {
  assert.deepEqual(lockedProjects({ dir: null }), []);
  assert.deepEqual(lockedProjects({ dir: path.join(os.tmpdir(), 'wh-no-such-managed-dir') }), []);
});

test('lockedProjects reads the list from a managed folder and drops what is not a full path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-managed-'));
  try {
    fs.mkdirSync(path.join(dir, 'wheelhouse'));
    fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), JSON.stringify(['/a/b', 'relative', 7]));
    assert.deepEqual(lockedProjects({ dir }), ['/a/b']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
