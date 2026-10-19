// tests/scripts/lineage/pins.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest } from '../../../scripts/lineage/manifest.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const marketplace = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
const entry = (name) => marketplace.plugins.find((p) => p.name === name);

test('the manifest\'s commits are the marketplace\'s pins', () => {
  const manifest = readManifest(root);
  assert.ok(manifest.upstreams.length > 0);
  for (const upstream of manifest.upstreams) {
    const pinned = entry(upstream.plugin);
    assert.ok(pinned, `${upstream.plugin} is listed`);
    assert.deepEqual(pinned.source, { source: 'url', url: upstream.repo, ref: upstream.ref, sha: upstream.sha });
  }
});

test('the marketplace pins each upstream at the manifest\'s commit, with a full sha', () => {
  for (const name of ['superpowers', 'mattpocock-skills']) {
    const { source } = entry(name);
    assert.equal(source.source, 'url');
    assert.match(source.url, /^https:\/\/github\.com\/[^/]+\/[^/]+\.git$/);
    assert.match(source.sha, /^[0-9a-f]{40}$/);
    assert.ok(source.ref.length > 0);
  }
  assert.equal(entry('superpowers').source.url, 'https://github.com/obra/superpowers.git');
  assert.equal(entry('mattpocock-skills').source.url, 'https://github.com/mattpocock/skills.git');
});

test('the marketplace keeps Wheelhouse itself, from its own folder, and lists no plugin twice', () => {
  assert.equal(marketplace.name, 'wheelhouse');
  assert.equal(entry('wheelhouse').source, './');
  const names = marketplace.plugins.map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual([...names].sort(), ['mattpocock-skills', 'superpowers', 'wheelhouse']);
});
