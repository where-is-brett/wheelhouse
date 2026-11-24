// tests/scripts/plugin-manifest.test.js
// Installing Wheelhouse installs the pinned Superpowers: plugin.json declares the dependency, and the marketplace entry it
// resolves in is pinned to the commit the lineage manifest tests against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

test('plugin.json lists superpowers in dependencies, by bare name and with no version range', () => {
  const { dependencies } = json('.claude-plugin/plugin.json');
  assert.deepEqual(dependencies, ['superpowers']);
});

test('the marketplace\'s superpowers entry is pinned to the lineage manifest\'s commit', () => {
  const entry = json('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'superpowers');
  const upstream = json('lineage/manifest.json').upstreams.find((u) => u.name === 'superpowers');
  assert.match(entry.source.sha, /^[0-9a-f]{40}$/);
  assert.equal(entry.source.sha, upstream.sha);
});
