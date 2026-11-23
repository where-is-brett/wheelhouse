// tests/vscode/resolver.test.js
// The add-on's copies of core's helper address and project id match core's own, on macOS and Windows inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { helperAddress as coreAddress } from '../../scripts/lib/paths.js';
import { projectOf } from '../../scripts/hooks/kit.js';
import { writeProject } from '../../scripts/lib/projects.js';
import { canonicalJson as coreCanonical } from '../../scripts/lib/canonical.js';
import { as, shortHome } from '../helpers/homes.js';

const require = createRequire(import.meta.url);
const { helperAddress, projectIdFor } = require('../../vscode/resolver.cjs');
const { canonicalJson } = require('../../vscode/key.cjs');

test('the resolver\'s helper address matches core\'s on macOS and on Windows', () => {
  const mac = { platform: 'darwin', home: '/Users/director/.wheelhouse', user: 'director' };
  assert.equal(helperAddress(mac), coreAddress(mac));
  assert.equal(helperAddress(mac), '/Users/director/.wheelhouse/helper.sock');
  const own = path.join(os.homedir(), '.wheelhouse');
  for (const input of [
    { platform: 'win32', home: own, user: 'Dir Ector' },
    { platform: 'win32', home: 'C:\\Temp\\Test Home', user: 'director' },
    { platform: 'win32', home: 'C:\\Users\\Director\\.wheelhouse', user: 'director' },
  ]) {
    assert.equal(helperAddress(input), coreAddress(input), JSON.stringify(input));
  }
  assert.match(helperAddress({ platform: 'win32', home: own, user: 'Dir Ector' }), /^\\\\\.\\pipe\\wheelhouse-Dir_Ector-helper$/);
});

test('the resolver\'s project id matches core\'s for a project folder and a folder inside it', () => {
  const home = shortHome();
  return as(home, async () => {
    const repo = path.join(home, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeProject('owner__name', { folder: repo, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });
    for (const folder of [repo, path.join(repo, 'src', 'deep')]) {
      assert.equal(projectIdFor(folder), projectOf(folder).project);
      assert.equal(projectIdFor(folder), 'owner__name');
    }
    const outside = path.join(home, 'elsewhere');
    fs.mkdirSync(path.join(outside, '.git'), { recursive: true });
    assert.equal(projectIdFor(outside), null);
    assert.equal(projectOf(outside), null);
    assert.equal(projectIdFor('relative/path'), null);
  });
});

test('the add-on\'s canonical JSON matches core\'s', () => {
  const value = { b: [1, { z: null, a: 'x' }], a: true, c: 'é"' };
  assert.equal(canonicalJson(value), coreCanonical(value));
});
