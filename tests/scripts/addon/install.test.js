// tests/scripts/addon/install.test.js
// Installing the Wheelhouse panel from the release's .vsix: the file's hash is checked first, VS Code's own command line does the
// install, and with no `code` on the path the answer is the clicks and the file. Part 7's packing and hashing modules are stand-ins
// here (a loader) for most tests; one test packs the real release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { install, installPanel, loadPackage, MISMATCH, UNRELEASED, REFUSED, INSTALLED, SILENT, clicksFor, unsafeFor } from '../../../scripts/addon/install.js';
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
const recorded = (expected, ok = true, seen = []) => async () => ({ vsixName: (v) => `wheelhouse-panel-${v}.vsix`, pack: async () => ({}), checkHash: (given) => { seen.push(given); return { ok, expected, actual: expected }; } });
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
  assert.match(got.says, /fault to report/);
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

test('with no code on the path or in VS Code\'s own folders, the install line gives the clicks and names the file', async () => {
  const file = vsix();
  const got = await install({ file, run: async () => { throw new Error('never reached'); }, platform: 'darwin', env: {}, exists: () => false, load: recorded(sha('panel bytes')) });
  assert.equal(got.ok, false);
  assert.equal(got.says, clicksFor(file, 'darwin'));
  assert.match(got.says, /^Wheelhouse couldn't add the panel for you, so here is how to add it: /);
  assert.match(got.says, /Install from VSIX\u2026/);
  assert.ok(got.says.includes(file));
  assert.match(got.says, /Cmd\+Shift\+G and paste this path: /);
  assert.doesNotMatch(got.says, /command line|\bpath\b.*PATH/);
  assert.ok(fs.existsSync(file), 'the file stays for the director to pick');
  assert.doesNotMatch(clicksFor(file, 'win32'), /Cmd/);
});

test('on Windows with no code.cmd on the path or in VS Code\'s folders, it is the same clicks', async () => {
  const file = vsix();
  const got = await install({ file, run: async () => { throw new Error('never reached'); }, platform: 'win32', env: { Path: 'C:\\nowhere' }, exists: () => false, load: recorded(sha('panel bytes')) });
  assert.equal(got.says, clicksFor(file, 'win32'));
});

test('VS Code\'s own copy runs when none is on the path', async () => {
  const calls = [];
  const mac = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
  const got = await install({ file: vsix(), run: runOf(calls), platform: 'darwin', env: { PATH: '/usr/bin' }, home: '/Users/p', exists: (f) => f === mac || fs.existsSync(f), load: recorded(sha('panel bytes')) });
  assert.equal(got.ok, true);
  assert.equal(calls[0][0], 'code');
});

test('a name cmd.exe can\'t be given safely, and a VS Code that goes quiet, each get their own line', async () => {
  const file = vsix();
  const cmd = 'C:\\Users\\p\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd';
  const unsafe = await install({ file: `${path.dirname(file)}/50%.vsix`, run: async () => ({ code: 0 }), platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local', Path: '' }, exists: (f) => f === cmd, load: async () => ({ checkHash: () => ({ ok: true, expected: sha('x') }) }) });
  assert.equal(unsafe.says, MISMATCH, 'a file that is not there is a file that differs, before any command');
  fs.writeFileSync(`${path.dirname(file)}/50%.vsix`, 'x');
  const named = await install({ file: `${path.dirname(file)}/50%.vsix`, run: async () => ({ code: 0 }), platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local', Path: '' }, exists: (f) => f === cmd, load: recorded(sha('x')) });
  assert.match(named.says, /^The panel's file name has a character Wheelhouse can't safely pass to VS Code/);
  assert.equal(named.says, unsafeFor(named.file, 'win32'));
  const quiet = await install({ file, run: async () => { throw new Error('timed out'); }, platform: 'darwin', env: withCode(), load: recorded(sha('panel bytes')) });
  assert.ok(quiet.says.startsWith(SILENT));
  assert.match(quiet.says, /how to add it/);
});

test('VS Code refusing the file says it may be the company\'s list, and installs nothing more', async () => {
  const got = await install({ file: vsix(), run: runOf([], 1), platform: 'darwin', env: withCode(), load: recorded(sha('panel bytes')) });
  assert.equal(got.ok, false);
  assert.equal(got.says, REFUSED);
  assert.match(got.says, /IT can allow wheelhouse\.wheelhouse/);
});

test('the check is given the release\'s folder, and the file is checked again just before code runs', async () => {
  const seen = [];
  const root = tempFolder('wh-root-');
  await install({ file: vsix(), root, run: runOf([]), platform: 'darwin', env: withCode(), load: recorded(sha('panel bytes'), true, seen) });
  assert.deepEqual(seen, [{ root }]);
});

test('installPanel packs into Downloads under the plugin\'s version, installs that file, and removes it once VS Code has it', async () => {
  const root = tempFolder('wh-root-');
  fs.mkdirSync(path.join(root, '.claude-plugin'));
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '0.3.1' }));
  const home = tempFolder('wh-home-');
  fs.mkdirSync(path.join(home, 'Downloads'));
  const calls = [];
  const packed = [];
  const part = {
    vsixName: (v) => `wheelhouse-panel-${v}.vsix`,
    pack: async ({ root: r, out }) => { packed.push([r, out]); fs.writeFileSync(out, 'panel bytes'); return { file: out, sha256: sha('panel bytes') }; },
    checkHash: () => ({ ok: true, expected: sha('panel bytes'), actual: sha('panel bytes') }),
  };
  const got = await installPanel({ root, home, run: runOf(calls), platform: 'darwin', env: withCode(), load: async () => part });
  assert.equal(got.ok, true, got.says);
  assert.deepEqual(packed[0], [root, path.join(home, 'Downloads', 'wheelhouse-panel-0.3.1.vsix')]);
  assert.equal(calls[0][2], packed[0][1]);
  assert.equal(fs.existsSync(packed[0][1]), false, 'removed once installed');
  // With no code, the file stays in Downloads, where the director can find it, and the line names it.
  const stuck = await installPanel({ root, home, run: runOf([]), platform: 'darwin', env: {}, exists: () => false, load: async () => part });
  assert.equal(stuck.file, path.join(home, 'Downloads', 'wheelhouse-panel-0.3.1.vsix'));
  assert.ok(fs.existsSync(stuck.file));
  assert.ok(stuck.says.includes(stuck.file));
});

test('installPanel on this release\'s real files: the pack matches the recorded hash and installs', async () => {
  const home = tempFolder('wh-home-');
  const calls = [];
  const got = await installPanel({ home, run: runOf(calls), platform: 'darwin', env: withCode() });
  assert.equal(got.ok, true, got.says);
  assert.match(path.basename(calls[0][2]), /^wheelhouse-panel-\d+\.\d+\.\d+.*\.vsix$/);
  assert.deepEqual(fs.readdirSync(home), [], 'nothing is left behind');
});

test('installPanel on a release without the modules, or a plugin with no version, installs nothing', async () => {
  const calls = [];
  assert.equal((await installPanel({ root: tempFolder('wh-root-'), home: tempFolder('wh-h-'), run: runOf(calls), load: async () => null })).says, UNRELEASED);
  assert.equal((await installPanel({ root: tempFolder('wh-root-'), home: tempFolder('wh-h-'), run: runOf(calls), load: recorded('a') })).says, UNRELEASED);
  assert.deepEqual(calls, []);
});
