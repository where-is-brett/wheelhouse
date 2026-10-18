// tests/probes/lib/marketplace.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeScratchMarketplace } from '../../../probes/lib/marketplace.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = '0123456789abcdef0123456789abcdef01234567';

test('makeScratchMarketplace writes a committed marketplace with each plugin pinned by ref and sha', async () => {
  const marketplace = await makeScratchMarketplace({
    name: 'pins',
    plugins: [
      { name: 'one', repo: 'owner/one', ref: 'v1.0.0', sha: SHA_A },
      { name: 'two', repo: 'owner/two', ref: 'main', sha: SHA_B },
    ],
  });
  try {
    const file = path.join(marketplace.dir, '.claude-plugin', 'marketplace.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(parsed.plugins.length, 2);
    for (const entry of parsed.plugins) {
      assert.equal(entry.source.source, 'github');
      assert.ok(entry.source.ref);
      assert.match(entry.source.sha, /^[0-9a-f]{40}$/);
    }
    assert.deepEqual(parsed.plugins[0], {
      name: 'one',
      source: { source: 'github', repo: 'owner/one', ref: 'v1.0.0', sha: SHA_A },
    });
    assert.equal(typeof parsed.name, 'string');
    assert.ok(parsed.owner && parsed.owner.name);

    const log = execFileSync('git', ['log', '--oneline'], { cwd: marketplace.dir, encoding: 'utf8' });
    assert.equal(log.trim().split('\n').length, 1);
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: marketplace.dir, encoding: 'utf8' });
    assert.equal(status.trim(), '');

    assert.ok(marketplace.url.startsWith('file://'));
    assert.ok(fs.existsSync(new URL(marketplace.url)));
  } finally {
    await marketplace.cleanup();
  }
  assert.equal(fs.existsSync(marketplace.dir), false);
});

test('makeScratchMarketplace refuses a sha that is not 40 lowercase hex characters', async () => {
  await assert.rejects(
    makeScratchMarketplace({ name: 'bad', plugins: [{ name: 'x', repo: 'o/x', ref: 'v1', sha: 'ABC' }] }),
    /sha/,
  );
});

test('makeScratchMarketplace refuses a plugin with no ref', async () => {
  await assert.rejects(
    makeScratchMarketplace({ name: 'bad', plugins: [{ name: 'x', repo: 'o/x', sha: SHA_A }] }),
    /ref/,
  );
});

test('makeScratchMarketplace lists a plugin given as a source object, checking its ref and sha', async () => {
  const source = { source: 'url', url: 'file:///tmp/example', ref: 'v1', sha: SHA_A };
  const marketplace = await makeScratchMarketplace({ name: 'objects', plugins: [{ name: 'one', source }] });
  try {
    const file = path.join(marketplace.dir, '.claude-plugin', 'marketplace.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).plugins, [{ name: 'one', source }]);
  } finally {
    await marketplace.cleanup();
  }
  await assert.rejects(makeScratchMarketplace({ name: 'bad', plugins: [{ name: 'x', source: { ...source, sha: 'ABC' } }] }), /sha/);
  await assert.rejects(makeScratchMarketplace({ name: 'bad', plugins: [{ name: 'x', source: { ...source, ref: undefined } }] }), /ref/);
});

test('cleanup refuses a folder outside the temp folder', async () => {
  const marketplace = await makeScratchMarketplace({ name: 'guard', plugins: [] });
  const real = marketplace.dir;
  try {
    marketplace.dir = path.join(os.homedir(), 'not-a-temp-folder');
    await assert.rejects(marketplace.cleanup(), /outside the temporary folder/);
  } finally {
    marketplace.dir = real;
    await marketplace.cleanup();
  }
  assert.equal(fs.existsSync(real), false);
});
