// tests/scripts/lib/plugin-version.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEV_VERSION, pluginVersion, releaseVersion } from '../../../scripts/lib/plugin-version.js';
import { tempFolder } from '../../helpers/homes.js';

function folderWith(text) {
  const dir = tempFolder('wh-version-');
  if (text !== null) {
    fs.mkdirSync(path.join(dir, '.claude-plugin'));
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), text);
  }
  return dir;
}

test('a release names its version', () => {
  const dir = folderWith('{"name":"wheelhouse","version":"1.2.3"}');
  assert.equal(pluginVersion(dir), '1.2.3');
  assert.equal(releaseVersion(dir), '1.2.3');
});

test('a plugin.json with no version is a build between releases', () => {
  for (const text of ['{"name":"wheelhouse"}', '{"version":""}', '{"version":3}', '[]']) {
    const dir = folderWith(text);
    assert.equal(pluginVersion(dir), DEV_VERSION);
    assert.equal(releaseVersion(dir), null);
  }
});

test('a plugin.json that is missing or unreadable gives null', () => {
  assert.equal(pluginVersion(folderWith(null)), null);
  assert.equal(pluginVersion(folderWith('{not json')), null);
  assert.equal(releaseVersion(folderWith(null)), null);
});

test('the repository\'s own plugin.json and marketplace entry name no version, so Claude Code keys installs by commit', () => {
  const root = new URL('../../../', import.meta.url);
  const plugin = JSON.parse(fs.readFileSync(new URL('.claude-plugin/plugin.json', root), 'utf8'));
  const market = JSON.parse(fs.readFileSync(new URL('.claude-plugin/marketplace.json', root), 'utf8'));
  // A release commit adds the version (docs/lineage/upgrading.md); this holds on every other commit.
  assert.ok(plugin.version === undefined || /^\d+\.\d+\.\d+$/.test(plugin.version));
  for (const entry of market.plugins.filter((p) => p.name === 'wheelhouse')) assert.equal(entry.version, undefined);
});
