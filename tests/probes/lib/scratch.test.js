// tests/probes/lib/scratch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeScratchProject, assertUnderTmp } from '../../../probes/lib/scratch.js';

test('makeScratchProject makes a git repository under the temp folder with the settings given', async () => {
  const settings = { permissions: { deny: ['Read(.env*)'] } };
  const project = await makeScratchProject({
    name: 'scratch-test',
    settings,
    files: { 'notes/hello.txt': 'hello' },
  });
  try {
    assert.ok(project.dir.startsWith(fs.realpathSync(os.tmpdir())) || project.dir.startsWith(os.tmpdir()));
    assert.ok(fs.existsSync(path.join(project.dir, '.git')));
    const written = JSON.parse(fs.readFileSync(path.join(project.dir, '.claude', 'settings.json'), 'utf8'));
    assert.deepEqual(written, settings);
    assert.equal(fs.readFileSync(path.join(project.dir, 'notes', 'hello.txt'), 'utf8'), 'hello');
    const log = execFileSync('git', ['log', '--oneline'], { cwd: project.dir, encoding: 'utf8' });
    assert.equal(log.trim().split('\n').length, 1);
  } finally {
    await project.cleanup();
  }
});

test('cleanup removes the folder', async () => {
  const project = await makeScratchProject({ name: 'cleanup-test' });
  await project.cleanup();
  assert.equal(fs.existsSync(project.dir), false);
});

test('cleanup refuses a folder outside the temp folder', () => {
  assert.throws(() => assertUnderTmp(path.join(os.homedir(), 'x')), /outside the temporary folder/);
});
