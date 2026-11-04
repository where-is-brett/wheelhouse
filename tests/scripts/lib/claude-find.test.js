// tests/scripts/lib/claude-find.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveClaude, resolveCommand, recordClaudePath, pathWithClaude } from '../../../scripts/lib/claude.js';

const has = (...files) => (file) => files.includes(file);

test('a bare PATH finds claude in ~/.local/bin by its full path', () => {
  const env = { PATH: '/usr/bin:/bin', HOME: '/Users/x' };
  assert.deepEqual(resolveClaude({ platform: 'darwin', env, exists: has('/Users/x/.local/bin/claude') }), { kind: 'direct', file: '/Users/x/.local/bin/claude' });
});

test('it also looks in /opt/homebrew/bin, /usr/local/bin and ~/.claude/local, in that order of folders', () => {
  const env = { PATH: '/usr/bin', HOME: '/Users/x' };
  assert.equal(resolveClaude({ platform: 'linux', env, exists: has('/opt/homebrew/bin/claude') }).file, '/opt/homebrew/bin/claude');
  assert.equal(resolveClaude({ platform: 'linux', env, exists: has('/usr/local/bin/claude') }).file, '/usr/local/bin/claude');
  assert.equal(resolveClaude({ platform: 'linux', env, exists: has('/Users/x/.claude/local/claude') }).file, '/Users/x/.claude/local/claude');
});

test('claude on the PATH stays the bare name', () => {
  const env = { PATH: '/usr/bin:/opt/bin', HOME: '/Users/x' };
  assert.deepEqual(resolveClaude({ platform: 'darwin', env, exists: has('/opt/bin/claude', '/Users/x/.local/bin/claude') }), { kind: 'direct', file: 'claude' });
});

test('a path recorded by a session is used when it still exists, and ignored when it does not', () => {
  const env = { PATH: '/usr/bin', HOME: '/Users/x' };
  const recorded = () => '/Users/x/tools/claude';
  assert.equal(resolveClaude({ platform: 'darwin', env, exists: has('/Users/x/tools/claude'), recorded }).file, '/Users/x/tools/claude');
  assert.deepEqual(resolveClaude({ platform: 'darwin', env, exists: () => false, recorded }), { kind: 'direct', file: 'claude' });
});

test('a recorded path that is not absolute, or is inside the project folder, is not used', () => {
  const env = { PATH: '/usr/bin', HOME: '/Users/x' };
  assert.deepEqual(resolveClaude({ platform: 'darwin', env, exists: has('/opt/homebrew/bin/claude'), recorded: () => 'claude', inside: '/Users/x/proj' }).file, '/opt/homebrew/bin/claude');
  assert.equal(resolveClaude({ platform: 'darwin', env, exists: has('/Users/x/proj/bin/claude'), recorded: () => '/Users/x/proj/bin/claude', inside: '/Users/x/proj' }).file, 'claude');
});

test('nothing found anywhere leaves the bare name, and other programs are unchanged', () => {
  assert.deepEqual(resolveClaude({ platform: 'darwin', env: {}, exists: () => false }), { kind: 'direct', file: 'claude' });
  assert.deepEqual(resolveCommand({ name: 'copilot', platform: 'darwin', env: { PATH: '/usr/bin', HOME: '/Users/x' }, exists: () => true }), { kind: 'direct', file: 'copilot' });
});

test('recordClaudePath keeps the full path a session sees, and nothing when the project holds it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-find-'));
  try {
    const env = { PATH: '/a:/b', HOME: '/Users/x', WHEELHOUSE_HOME: home };
    assert.equal(recordClaudePath({ platform: 'darwin', env, exists: has('/b/claude') }), '/b/claude');
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'claude-path.json'), 'utf8')).path, '/b/claude');
    // The default reader finds it again.
    assert.equal(resolveClaude({ platform: 'darwin', env: { PATH: '/usr/bin', WHEELHOUSE_HOME: home }, exists: has('/b/claude') }).file, '/b/claude');
    fs.rmSync(path.join(home, 'claude-path.json'));
    assert.equal(recordClaudePath({ platform: 'darwin', env, exists: has('/b/claude'), inside: '/b' }), null);
    assert.equal(fs.existsSync(path.join(home, 'claude-path.json')), false);
    assert.equal(recordClaudePath({ platform: 'win32', env, exists: () => true }), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('pathWithClaude puts the folder of a found claude on the PATH, and leaves the environment alone otherwise', () => {
  const env = { PATH: '/usr/bin', HOME: '/Users/x', KEEP: '1' };
  const got = pathWithClaude(env, { platform: 'darwin', exists: has('/Users/x/.local/bin/claude') });
  assert.equal(got.PATH, '/Users/x/.local/bin:/usr/bin');
  assert.equal(got.KEEP, '1');
  assert.deepEqual(pathWithClaude(env, { platform: 'darwin', exists: () => false }), env);
  const onPath = { PATH: '/opt/bin:/usr/bin', HOME: '/Users/x' };
  assert.deepEqual(pathWithClaude(onPath, { platform: 'darwin', exists: has('/opt/bin/claude') }), onPath);
  assert.deepEqual(pathWithClaude(env, { platform: 'win32', exists: () => true }), env);
});
