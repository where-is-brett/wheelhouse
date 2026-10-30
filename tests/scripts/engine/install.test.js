// tests/scripts/engine/install.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ENGINE_PINS, PATCH_DIGESTS } from '../../../scripts/engine/pins.js';
import { installEngine, OFFICIAL_HOSTS } from '../../../scripts/engine/install.js';
import { enginePaths } from '../../../scripts/engine/archon/build.js';

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

// A stood-in build: writes the engine's layout under the folder it is given, with a provider and lockfile whose
// digests are the pins' unless told otherwise, and fetches through the fetcher it is given, as buildFromSource does.
function standIn({ provider = 'patched', lockfile = 'lock', fail = null, url = 'https://github.com/oven-sh/bun/releases/download/x.zip', finalUrl } = {}) {
  const calls = [];
  const build = async ({ engine, fetcher }) => {
    calls.push(engine);
    const response = await fetcher(url, { redirect: 'follow', finalUrl });
    await response.arrayBuffer();
    if (fail) throw new Error(fail);
    const p = enginePaths(engine);
    for (const [file, text] of [[p.bunBin, 'bun'], [p.provider, provider], [p.cliResolver, 'resolver'], [path.join(p.src, 'bun.lock'), lockfile], [p.launcher, 'launcher'], [p.bunfig, '']]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    return { archonBin: p.launcher, bunBin: p.bunBin, src: p.src };
  };
  return { build, calls };
}

const pins = { ...ENGINE_PINS, archon: { ...ENGINE_PINS.archon, built: { provider: sha('patched'), lockfile: sha('lock') } } };
const fetch = async (url, init = {}) => ({ ok: true, status: 200, url: init.finalUrl ?? url, arrayBuffer: async () => Buffer.from('zip') });
const folder = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-engine-install-')), 'engine');
const listing = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).sort() : null);

test('the pins name the source tag and commit, the patch digests, the built digests and Bun', () => {
  assert.equal(ENGINE_PINS.archon.tag, 'v0.13.0');
  assert.match(ENGINE_PINS.archon.commit, /^[0-9a-f]{40}$/);
  assert.match(ENGINE_PINS.archon.built.provider, /^[0-9a-f]{64}$/);
  assert.match(ENGINE_PINS.archon.built.lockfile, /^[0-9a-f]{64}$/);
  assert.equal(ENGINE_PINS.bun.version, '1.4.3');
  assert.match(ENGINE_PINS.bun.sums['bun-darwin-aarch64.zip'], /^[0-9a-f]{64}$/);
  // Each patch file is the one pinned: a changed patch changes the build, so it changes the pin.
  for (const [name, digest] of Object.entries(PATCH_DIGESTS)) {
    const file = path.join('scripts', 'engine', 'archon', 'patch', name);
    assert.equal(sha(fs.readFileSync(file)), digest, `${name} is not the pinned patch`);
  }
});

test('a matching checksum installs into the engine folder', async () => {
  const target = folder();
  const { build } = standIn();
  const records = [];
  const got = await installEngine({ platform: 'darwin', arch: 'arm64', fetch, build, record: (c) => records.push(c), folder: target, pins });
  assert.equal(got.ok, true);
  const p = enginePaths(target);
  assert.equal(got.archonBin, p.launcher);
  assert.equal(got.bunBin, p.bunBin);
  assert.equal(fs.readFileSync(p.provider, 'utf8'), 'patched');
  // The launcher is written again for the folder it now lives in, since it names its own paths.
  assert.match(fs.readFileSync(p.launcher, 'utf8'), new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.deepEqual(records.map((c) => [c.kind, c.target, c.before, c.after.tool]), [
    ['folder', path.join(target, 'bun'), null, 'bun'],
    ['folder', path.join(target, 'archon'), null, 'archon'],
  ]);
  // Nothing is left beside the folder.
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['engine']);
});

test('a mismatched checksum is refused and the folder is unchanged', async () => {
  const target = folder();
  fs.mkdirSync(path.join(target, 'broker', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(target, 'broker', 'bin', 'gh'), 'broker');
  const before = listing(target);
  const records = [];
  const got = await installEngine({ platform: 'darwin', arch: 'arm64', fetch, build: standIn({ provider: 'something else' }).build, record: (c) => records.push(c), folder: target, pins });
  assert.equal(got.ok, false);
  assert.match(got.refused, /isn't the pinned build/);
  assert.deepEqual(listing(target), before);
  assert.deepEqual(records, []);
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['engine']);
});

test('a download whose checksum the build refuses leaves the folder as it was, saying why', async () => {
  const target = folder();
  const got = await installEngine({ platform: 'darwin', arch: 'arm64', fetch, build: standIn({ fail: 'bun-darwin-aarch64.zip: checksum 00 is not the pinned 11' }).build, folder: target, pins });
  assert.equal(got.ok, false);
  assert.match(got.refused, /checksum 00 is not the pinned 11/);
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(fs.readdirSync(path.dirname(target)), []);
});

test('a URL off the official host is refused', async () => {
  for (const [url, finalUrl] of [['https://example.com/bun.zip'], ['https://github.com/oven-sh/bun/releases/download/x.zip', 'https://proxy.example.com/x.zip']]) {
    const target = folder();
    const got = await installEngine({ platform: 'darwin', arch: 'arm64', fetch, build: standIn({ url, finalUrl }).build, folder: target, pins });
    assert.equal(got.ok, false, url);
    assert.match(got.refused, /not from an official release/);
    assert.equal(fs.existsSync(target), false);
  }
  assert.ok(OFFICIAL_HOSTS.includes('github.com'));
});

test('an install replaces an earlier engine only once the new one is checked', async () => {
  const target = folder();
  await installEngine({ platform: 'darwin', arch: 'arm64', fetch, build: standIn().build, folder: target, pins });
  const records = [];
  const got = await installEngine({ platform: 'darwin', arch: 'arm64', fetch, build: standIn().build, record: (c) => records.push(c), folder: target, pins });
  assert.equal(got.ok, true);
  assert.deepEqual(records.map((c) => c.before), [{}, {}]);
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['engine']);
});

test('the engine is installed on the Mac only', async () => {
  const got = await installEngine({ platform: 'win32', arch: 'x64', fetch, build: standIn().build, folder: folder(), pins });
  assert.equal(got.ok, false);
  assert.match(got.refused, /Mac/);
});
