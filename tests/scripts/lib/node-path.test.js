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
  assert.equal(pathWithNode(env, { platform: 'win32', exists: () => false, execPath: 'C:\\n\\node.exe' }), env);
  assert.equal(pathWithNode(env, { platform: 'darwin', exists: () => false, execPath: 'node' }), env);
});
