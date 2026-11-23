// tests/scripts/addon/install.test.js
// Installing the Wheelhouse panel from the release's .vsix: the file's hash is checked first, VS Code's own command line does the
// install, and with no `code` on the path the answer is the clicks and the file. Part 7's packing and hashing modules are stand-ins
// here (a loader), so these tests hold whether or not those files are in the tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { install, installPanel, loadPackage, MISMATCH, UNRELEASED, REFUSED, INSTALLED, clicksFor } from '../../../scripts/addon/install.js';
import { ADDON_ID } from '../../../scripts/update/addon.js';
import { tempFolder } from '../../helpers/homes.js';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// A .vsix file with these bytes, and a `code` on a scratch path.
function vsix(bytes = 'panel bytes') {
  const file = path.join(tempFolder('wh-vsix-'), 'wheelhouse-panel-0.3.1.vsix');
  fs.writeFileSync(file, bytes);
  return file;
}
const withCode = () => {
  const bin = tempFolder('wh-code-');
  fs.writeFileSync(path.join(bin, 'code'), '#!/bin/sh\n');
  fs.chmodSync(path.join(bin, 'code'), 0o755);
  return { PATH: bin };
};
// The hashing module's answer for a recorded hash.
const recorded = (expected, ok = true) => async () => ({ vsixName: (v) => `wheelhouse-panel-${v}.vsix`, pack: async () => ({}), checkHash: () => ({ ok, expected, actual: expected }) });
const runOf = (calls, code = 0) => async (file, args) => { calls.push([path.basename(file), ...args]); return { code, stdout: '', stderr: '' }; };

test('a file whose hash matches is installed with VS Code\'s own command', async () => {
  const calls = [];
  const file = vsix();
  const got = await install({ file, run: runOf(calls), platform: 'darwin', env: withCode(), load: recorded(sha('panel bytes')) });
  assert.deepEqual({ ok: got.ok, says: got.says }, { ok: true, says: INSTALLED });
  assert.deepEqual(calls, [['code', '--install-extension', file, '--force']]);
  assert.equal(ADDON_ID, 'wheelhouse.wheelhouse');
});

test('a file whose hash differs is refused, and nothing is installed', async () => {
  const calls = [];
  const got = await install({ file: vsix('another file'), run: runOf(calls), platform: 'darwin', env: withCode(), load: recorded(sha('panel bytes')) });
  assert.equal(got.ok, false);
  assert.equal(got.says, MISMATCH);
  assert.deepEqual(calls, [], 'code was never run');
});

test('a hash that does not hold for a fresh pack, or one that is missing, installs nothing', async () => {
  const calls = [];
  const file = vsix();
  assert.equal((await install({ file, run: runOf(calls), env: withCode(), load: recorded(sha('panel bytes'), false) })).says, MISMATCH);
  assert.equal((await install({ file, run: runOf(calls), env: withCode(), load: async () => ({ checkHash: () => ({ ok: true }) }) })).says, MISMATCH);
  assert.equal((await install({ file: path.join(tempFolder('wh-none-'), 'gone.vsix'), run: runOf(calls), env: withCode(), load: recorded(sha('x')) })).says, MISMATCH);
  assert.deepEqual(calls, []);
});

test('a release without the packing and hashing modules says its package is not in this release, and installs nothing', async () => {
  const calls = [];
  const file = vsix();
  assert.equal((await install({ file, run: runOf(calls), env: withCode(), load: async () => null })).says, UNRELEASED);
  assert.equal((await install({ file, run: runOf(calls), env: withCode(), load: async () => { throw new Error('Cannot find module'); } })).says, UNRELEASED);
  assert.equal((await install({ file, run: runOf(calls), env: withCode(), load: async () => ({ checkHash: () => { throw new Error('no recorded hash'); } }) })).says, UNRELEASED);
  assert.deepEqual(calls, []);
});

test('the real loader never throws, whether or not the modules are in the tree', async () => {
  const got = await loadPackage();
  assert.ok(got === null || (typeof got.vsixName === 'function' && typeof got.checkHash === 'function'));
});

test('with no code on the path, the answer is the clicks and the file\'s name', async () => {
  const file = vsix();
  const got = await install({ file, run: async () => { throw new Error('spawn code ENOENT'); }, platform: 'darwin', env: {}, load: recorded(sha('panel bytes')) });
  assert.equal(got.ok, false);
  assert.equal(got.says, clicksFor(file));
  assert.match(got.says, /Install from VSIX…/);
  assert.ok(got.says.includes(file));
  assert.ok(fs.existsSync(file), 'the file stays for the director to pick');
});

test('on Windows with no code.cmd on the path, it is the same clicks', async () => {
  const file = vsix();
  const got = await install({ file, run: async () => { throw new Error('never reached'); }, platform: 'win32', env: { Path: 'C:\\nowhere' }, load: recorded(sha('panel bytes')) });
  assert.equal(got.says, clicksFor(file));
});

test('VS Code refusing the file says it may be the company\'s list, and installs nothing more', async () => {
  const got = await install({ file: vsix(), run: runOf([], 1), platform: 'darwin', env: withCode(), load: recorded(sha('panel bytes')) });
  assert.equal(got.ok, false);
  assert.equal(got.says, REFUSED);
  assert.match(got.says, /IT can allow wheelhouse\.wheelhouse/);
});

test('installPanel packs the release\'s panel under the plugin\'s own version, then installs that file', async () => {
  const root = tempFolder('wh-root-');
  fs.mkdirSync(path.join(root, '.claude-plugin'));
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '0.3.1' }));
  const calls = [];
  const packed = [];
  const part = {
    vsixName: (v) => `wheelhouse-panel-${v}.vsix`,
    pack: async ({ out }) => { packed.push(out); fs.writeFileSync(out, 'panel bytes'); return { file: out, sha256: sha('panel bytes') }; },
    checkHash: () => ({ ok: true, expected: sha('panel bytes'), actual: sha('panel bytes') }),
  };
  const got = await installPanel({ root, tmp: tempFolder('wh-tmp-'), run: runOf(calls), platform: 'darwin', env: withCode(), load: async () => part });
  assert.equal(got.ok, true, got.says);
  assert.equal(path.basename(packed[0]), 'wheelhouse-panel-0.3.1.vsix');
  assert.equal(calls[0][2], packed[0]);
});

test('installPanel on a release without the modules, or a plugin with no version, installs nothing', async () => {
  const calls = [];
  assert.equal((await installPanel({ root: tempFolder('wh-root-'), tmp: tempFolder('wh-tmp-'), run: runOf(calls), load: async () => null })).says, UNRELEASED);
  assert.equal((await installPanel({ root: tempFolder('wh-root-'), tmp: tempFolder('wh-tmp-'), run: runOf(calls), load: recorded('a') })).says, UNRELEASED);
  assert.deepEqual(calls, []);
});
