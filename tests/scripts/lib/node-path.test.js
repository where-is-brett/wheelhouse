// tests/scripts/lib/node-path.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathWithNode } from '../../../scripts/lib/claude.js';

const has = (...files) => (file) => files.includes(file);

test('pathWithNode puts the running node folder on a PATH that has no node', () => {
  const execPath = '/Users/x/.nvm/versions/node/v22.22.1/bin/node';
  const out = pathWithNode({ PATH: '/usr/bin:/bin', HOME: '/Users/x' }, { platform: 'darwin', exists: () => false, execPath });
  assert.equal(out.PATH, '/Users/x/.nvm/versions/node/v22.22.1/bin:/usr/bin:/bin');
  assert.equal(out.HOME, '/Users/x');
  assert.equal(pathWithNode({}, { platform: 'darwin', exists: () => false, execPath }).PATH, '/Users/x/.nvm/versions/node/v22.22.1/bin');
});

test('pathWithNode leaves a PATH that already has node, and Windows, alone', () => {
  const env = { PATH: '/opt/bin:/usr/bin' };
  assert.equal(pathWithNode(env, { platform: 'darwin', exists: has('/opt/bin/node'), execPath: '/x/node' }), env);
  assert.equal(pathWithNode(env, { platform: 'darwin', exists: () => false, execPath: 'node' }), env);
});

test('pathWithNode adds the running node folder on Windows, under the PATH key the environment uses', () => {
  const execPath = 'C:\\Program Files\\nodejs\\node.exe';
  const out = pathWithNode({ Path: 'C:\\Windows;C:\\Windows\\System32', X: '1' }, { platform: 'win32', exists: () => false, execPath });
  assert.equal(out.Path, 'C:\\Program Files\\nodejs;C:\\Windows;C:\\Windows\\System32');
  assert.equal(out.X, '1');
  assert.equal(Object.keys(out).filter((k) => k.toLowerCase() === 'path').length, 1);
  const has = { Path: 'C:\\n' };
  assert.equal(pathWithNode(has, { platform: 'win32', exists: (f) => f === 'C:\\n\\node.exe', execPath }), has);
});
