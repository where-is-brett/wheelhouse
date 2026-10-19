// tests/probes/38-host-tools/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickArchive, parseChecksums, verifyChecksum, ChecksumError, tagFromLocation, versionOf, findBinary, binaryName, assertScratch, unpackCommand, archWord } from '../../../probes/38-host-tools/run.js';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// The names in a gh release's checksum list (packages and installers included) and in glab's links.
const ghNames = [
  'gh_2.102.0_linux_amd64.tar.gz', 'gh_2.102.0_linux_amd64.deb',
  'gh_2.102.0_macOS_amd64.zip', 'gh_2.102.0_macOS_arm64.zip', 'gh_2.102.0_macOS_universal.pkg',
  'gh_2.102.0_windows_amd64.msi', 'gh_2.102.0_windows_amd64.zip', 'gh_2.102.0_windows_arm64.msi', 'gh_2.102.0_windows_arm64.zip', 'gh_2.102.0_windows_386.zip',
];
const glabNames = [
  'glab_1.123.0_Windows_x86_64_installer.exe', 'glab_1.123.0_Windows_arm64_installer.exe',
  'glab_1.123.0_darwin_amd64.tar.gz', 'glab_1.123.0_darwin_arm64.tar.gz', 'glab_1.123.0_linux_arm64.tar.gz',
  'glab_1.123.0_windows_amd64.zip', 'glab_1.123.0_windows_arm64.zip', 'glab_1.123.0_windows_386.zip', 'checksums.txt', 'glab_1.123.0_source.tar.gz',
];

test('gh: one zip per system and processor, never the package or the installer', () => {
  assert.equal(pickArchive('gh', ghNames, 'darwin', 'arm64'), 'gh_2.102.0_macOS_arm64.zip');
  assert.equal(pickArchive('gh', ghNames, 'darwin', 'x64'), 'gh_2.102.0_macOS_amd64.zip');
  assert.equal(pickArchive('gh', ghNames, 'win32', 'x64'), 'gh_2.102.0_windows_amd64.zip');
  assert.equal(pickArchive('gh', ghNames, 'win32', 'arm64'), 'gh_2.102.0_windows_arm64.zip');
});

test('glab: a tar.gz on macOS, a zip on Windows, never the installer or the source', () => {
  assert.equal(pickArchive('glab', glabNames, 'darwin', 'arm64'), 'glab_1.123.0_darwin_arm64.tar.gz');
  assert.equal(pickArchive('glab', glabNames, 'darwin', 'x64'), 'glab_1.123.0_darwin_amd64.tar.gz');
  assert.equal(pickArchive('glab', glabNames, 'win32', 'x64'), 'glab_1.123.0_windows_amd64.zip');
  assert.equal(pickArchive('glab', glabNames, 'win32', 'arm64'), 'glab_1.123.0_windows_arm64.zip');
});

test('picking an archive refuses when none or several match, and for systems it does not know', () => {
  assert.throws(() => pickArchive('gh', ['gh_2.102.0_macOS_universal.pkg'], 'darwin', 'arm64'), /found 0/);
  assert.throws(() => pickArchive('gh', [...ghNames, 'gh_2.103.0_macOS_arm64.zip'], 'darwin', 'arm64'), /found 2/);
  assert.throws(() => pickArchive('gh', ghNames, 'linux', 'x64'), /No archive for system/);
  assert.throws(() => pickArchive('gh', ghNames, 'darwin', 'ia32'), /No archive for processor/);
  assert.throws(() => pickArchive('nope', ghNames, 'darwin', 'arm64'), /Unknown tool/);
  assert.equal(archWord('x64'), 'amd64');
});

test('the version comes from the archive name', () => {
  assert.equal(versionOf('gh_2.102.0_macOS_arm64.zip'), '2.102.0');
  assert.equal(versionOf('glab_1.123.0_darwin_arm64.tar.gz'), '1.123.0');
  assert.throws(() => versionOf('checksums.txt'));
});

test('a checksum list reads with Unix or Windows line ends, and a binary-mode star', () => {
  const a = 'a'.repeat(64);
  const b = 'B'.repeat(64);
  const sums = parseChecksums(`${a}  one.zip\r\n${b} *two.tar.gz\n\n`);
  assert.equal(sums.get('one.zip'), a);
  assert.equal(sums.get('two.tar.gz'), 'b'.repeat(64));
  assert.equal(sums.size, 2);
  assert.throws(() => parseChecksums('not a checksum line'), /Unreadable/);
});

test('a matching download passes, and returns its checksum', () => {
  const bytes = Buffer.from('archive bytes');
  const sums = parseChecksums(`${sha(bytes)}  tool.zip\n`);
  assert.equal(verifyChecksum('tool.zip', bytes, sums), sha(bytes));
});

test('a changed byte is refused, and so is a name that is not on the list', () => {
  const bytes = Buffer.from('archive bytes');
  const sums = parseChecksums(`${sha(bytes)}  tool.zip\n`);
  const changed = Buffer.from(bytes);
  changed[0] ^= 1;
  assert.throws(() => verifyChecksum('tool.zip', changed, sums), ChecksumError);
  assert.throws(() => verifyChecksum('tool.zip', changed, sums), /mismatch/);
  assert.throws(() => verifyChecksum('other.zip', bytes, sums), /not on the published checksum list/);
});

test('the latest tag is read from the releases redirect', () => {
  assert.equal(tagFromLocation('https://github.com/cli/cli/releases/tag/v2.102.0'), 'v2.102.0');
  assert.throws(() => tagFromLocation('https://github.com/login'), /Not a release address/);
  assert.throws(() => tagFromLocation(null), /Not a release address/);
});

test('the unpacked tool is found with or without a folder above bin/', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-check38-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'gh_1', 'bin'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'gh_1', 'bin', 'gh'), '');
    fs.writeFileSync(path.join(dir, 'bin', 'glab'), '');
    assert.equal(findBinary(dir, 'gh'), path.join(dir, 'gh_1', 'bin', 'gh'));
    assert.equal(findBinary(dir, 'glab'), path.join(dir, 'bin', 'glab'));
    assert.throws(() => findBinary(dir, 'missing'), /not found/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Windows binaries end in .exe, and Windows unpacks with the System32 tar', () => {
  assert.equal(binaryName('gh', 'win32'), 'gh.exe');
  assert.equal(binaryName('glab', 'darwin'), 'glab');
  const win = unpackCommand('C:\\Temp\\a b\\gh.zip', 'C:\\Temp\\a b\\gh', { platform: 'win32', systemRoot: 'C:\\Windows' });
  assert.equal(win.file, 'C:\\Windows\\System32\\tar.exe');
  assert.deepEqual(win.args, ['-xf', 'C:\\Temp\\a b\\gh.zip', '-C', 'C:\\Temp\\a b\\gh']);
  assert.equal(unpackCommand('/t/gh.zip', '/t/gh', { platform: 'darwin' }).file, 'tar');
});

test('only wheelhouse-check38 folders in the temporary folder may be touched', () => {
  assert.doesNotThrow(() => assertScratch(path.join(os.tmpdir(), 'wheelhouse-check38-abc')));
  assert.throws(() => assertScratch(os.tmpdir()));
  assert.throws(() => assertScratch(path.join(os.tmpdir(), 'other')));
  assert.throws(() => assertScratch(path.join(os.homedir(), '.wheelhouse', 'tools')));
});
