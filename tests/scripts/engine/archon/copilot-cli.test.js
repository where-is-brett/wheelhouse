// tests/scripts/engine/archon/copilot-cli.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  COPILOT_CLI_PIN, copilotCliPaths, installCopilotCli, copilotCliInstalled, integrityOf,
} from '../../../../scripts/engine/archon/copilot-cli.js';
import { archonEnv } from '../../../../scripts/engine/archon/env.js';
import { COPILOT_VERSION } from '../../../../scripts/lib/copilot-numbers.js';
import { tempFolder } from '../../../helpers/homes.js';

// A stand-in for the native package's tarball: package/copilot, a script that prints the version.
function standInTarball(root, { version = COPILOT_VERSION, program = 'copilot' } = {}) {
  const src = path.join(root, 'src');
  fs.mkdirSync(path.join(src, 'package'), { recursive: true });
  fs.writeFileSync(path.join(src, 'package', program), `#!/bin/sh\necho "GitHub Copilot CLI ${version}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(src, 'package', 'package.json'), '{}\n');
  const tgz = path.join(root, 'pkg.tgz');
  execFileSync('/usr/bin/tar', ['-czf', tgz, '-C', src, 'package']);
  return fs.readFileSync(tgz);
}

function pinFor(body, { arch = 'arm64' } = {}) {
  const name = `copilot-darwin-${arch}`;
  return {
    version: COPILOT_VERSION,
    packages: { [arch]: { url: `https://registry.npmjs.org/@github/${name}/-/${name}-${COPILOT_VERSION}.tgz`, integrity: integrityOf(body) } },
  };
}

const fetchOf = (body, calls = [], { url } = {}) => async (asked) => {
  calls.push(asked);
  return { ok: true, status: 200, url: url ?? asked, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
};

test('the pin is Copilot CLI at the version Wheelhouse names, for both Macs, from the npm registry with sha512 integrity', () => {
  assert.equal(COPILOT_CLI_PIN.version, COPILOT_VERSION);
  for (const arch of ['arm64', 'x64']) {
    const p = COPILOT_CLI_PIN.packages[arch];
    assert.match(p.url, new RegExp(`^https://registry\\.npmjs\\.org/@github/copilot-darwin-${arch}/-/copilot-darwin-${arch}-${COPILOT_VERSION.replaceAll('.', '\\.')}\\.tgz$`));
    assert.match(p.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  }
});

test('installCopilotCli puts the pinned program in the engine folder and records the change first', async () => {
  const root = tempFolder('wh-copilot-cli-');
  const body = standInTarball(root);
  const engine = path.join(root, 'engine');
  const records = [];
  const calls = [];
  const got = await installCopilotCli({ engine, arch: 'arm64', platform: 'darwin', pin: pinFor(body), fetch: fetchOf(body, calls), record: (c) => records.push({ ...c, there: fs.existsSync(copilotCliPaths(engine).bin) }) });
  assert.deepEqual(got, { ok: true, bin: copilotCliPaths(engine).bin });
  assert.equal(calls.length, 1);
  assert.equal(execFileSync(got.bin, ['--version'], { encoding: 'utf8' }).trim(), `GitHub Copilot CLI ${COPILOT_VERSION}`);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'folder');
  assert.equal(records[0].target, path.join(engine, 'copilot', 'bin'));
  assert.deepEqual(records[0].after, { tool: 'copilot', version: COPILOT_VERSION });
  assert.equal(records[0].there, false, 'recorded before the program was moved in');
  assert.equal(copilotCliInstalled(engine), true);
  // Nothing of the download is left beside the program.
  assert.deepEqual(fs.readdirSync(path.join(engine, 'copilot')), ['bin']);
  assert.deepEqual(fs.readdirSync(path.join(engine, 'copilot', 'bin')), ['copilot']);
});

test('a checksum that differs from the pin is refused, and nothing is put in the engine folder', async () => {
  const root = tempFolder('wh-copilot-cli-');
  const body = standInTarball(root);
  const engine = path.join(root, 'engine');
  const pin = pinFor(body);
  pin.packages.arm64.integrity = `sha512-${crypto.createHash('sha512').update('something else').digest('base64')}`;
  const got = await installCopilotCli({ engine, arch: 'arm64', platform: 'darwin', pin, fetch: fetchOf(body), record: () => assert.fail('nothing is recorded') });
  assert.equal(got.ok, false);
  assert.match(got.refused, /checksum/);
  assert.equal(fs.existsSync(path.join(engine, 'copilot')), false);
});

test('an address off the npm registry, before or after a redirect, is refused', async () => {
  const root = tempFolder('wh-copilot-cli-');
  const body = standInTarball(root);
  const engine = path.join(root, 'engine');
  const pin = pinFor(body);
  const sent = await installCopilotCli({ engine, arch: 'arm64', platform: 'darwin', pin, fetch: fetchOf(body, [], { url: 'https://example.com/x.tgz' }) });
  assert.equal(sent.ok, false);
  assert.match(sent.refused, /npm registry/);
  pin.packages.arm64.url = 'http://registry.npmjs.org/@github/copilot-darwin-arm64/-/copilot-darwin-arm64-1.0.101.tgz';
  const calls = [];
  const plain = await installCopilotCli({ engine, arch: 'arm64', platform: 'darwin', pin, fetch: fetchOf(body, calls) });
  assert.equal(plain.ok, false);
  assert.equal(calls.length, 0, 'never asked');
  assert.equal(fs.existsSync(path.join(engine, 'copilot')), false);
});

test('a tarball without the one program, or with the program as a link, is refused', async () => {
  const root = tempFolder('wh-copilot-cli-');
  const body = standInTarball(root, { program: 'other' });
  const engine = path.join(root, 'engine');
  const got = await installCopilotCli({ engine, arch: 'arm64', platform: 'darwin', pin: pinFor(body), fetch: fetchOf(body) });
  assert.equal(got.ok, false);
  assert.match(got.refused, /no Copilot CLI program/);

  const linked = path.join(root, 'linked');
  fs.mkdirSync(path.join(linked, 'src', 'package'), { recursive: true });
  fs.symlinkSync('/bin/sh', path.join(linked, 'src', 'package', 'copilot'));
  const tgz = path.join(linked, 'pkg.tgz');
  execFileSync('/usr/bin/tar', ['-czf', tgz, '-C', path.join(linked, 'src'), 'package']);
  const linkBody = fs.readFileSync(tgz);
  const viaLink = await installCopilotCli({ engine, arch: 'arm64', platform: 'darwin', pin: pinFor(linkBody), fetch: fetchOf(linkBody) });
  assert.equal(viaLink.ok, false);
  assert.match(viaLink.refused, /no Copilot CLI program/);
  assert.equal(fs.existsSync(path.join(engine, 'copilot')), false);
});

test('only a Mac with a pinned package is served', async () => {
  const root = tempFolder('wh-copilot-cli-');
  const engine = path.join(root, 'engine');
  const fetch = async () => assert.fail('never fetched');
  assert.equal((await installCopilotCli({ engine, arch: 'arm64', platform: 'linux', fetch })).ok, false);
  assert.equal((await installCopilotCli({ engine, arch: 'ia32', platform: 'darwin', fetch })).ok, false);
});

test('a CLI already there is replaced only once the new one is checked, and the old one kept aside until then', async () => {
  const root = tempFolder('wh-copilot-cli-');
  const engine = path.join(root, 'engine');
  const { bin } = copilotCliPaths(engine);
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, '#!/bin/sh\necho old\n', { mode: 0o755 });
  const body = standInTarball(root);
  const pin = pinFor(body);
  pin.packages.arm64.integrity = integrityOf(Buffer.from('no'));
  assert.equal((await installCopilotCli({ engine, arch: 'arm64', platform: 'darwin', pin, fetch: fetchOf(body) })).ok, false);
  assert.equal(fs.readFileSync(bin, 'utf8'), '#!/bin/sh\necho old\n');
  const records = [];
  assert.equal((await installCopilotCli({ engine, arch: 'arm64', platform: 'darwin', pin: pinFor(body), fetch: fetchOf(body), record: (c) => records.push(c) })).ok, true);
  assert.match(fs.readFileSync(bin, 'utf8'), /GitHub Copilot CLI/);
  assert.deepEqual(records[0].before, {});
});

test('archonEnv names the engine\'s Copilot CLI and its clean home only when they are there', () => {
  const root = tempFolder('wh-copilot-cli-');
  const engine = path.join(root, 'engine');
  const nodeDir = path.join(root, 'nodes');
  fs.mkdirSync(nodeDir);
  const env = () => archonEnv({ engine, home: path.join(root, 'h'), nodeDir, baseEnv: {} });
  assert.equal(env().COPILOT_BIN_PATH, undefined);
  assert.equal(env().COPILOT_HOME, undefined);
  const { bin, home } = copilotCliPaths(engine);
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, '', { mode: 0o755 });
  assert.equal(env().COPILOT_BIN_PATH, bin);
  assert.equal(env().COPILOT_HOME, undefined);
  fs.mkdirSync(home, { recursive: true });
  assert.equal(env().COPILOT_HOME, home);
  // One given by the caller wins, and the caller's own COPILOT_HOME never passes.
  assert.equal(archonEnv({ engine, home: path.join(root, 'h'), nodeDir, copilotBin: '/x/copilot', baseEnv: { COPILOT_HOME: '/mine' } }).COPILOT_BIN_PATH, '/x/copilot');
  assert.equal(archonEnv({ engine, home: path.join(root, 'h'), nodeDir, baseEnv: { COPILOT_HOME: '/mine' } }).COPILOT_HOME, home);
});
