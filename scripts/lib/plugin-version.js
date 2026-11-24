// scripts/lib/plugin-version.js
// The version a Wheelhouse folder says it is. A tagged release names it in .claude-plugin/plugin.json;
// main names none, so Claude Code keys each install by its commit and no build overwrites another's
// plugin folder. Every reader of that version goes through here.
import fs from 'node:fs';
import path from 'node:path';

// What a folder without a version in its plugin.json is: a build between releases.
export const DEV_VERSION = 'dev';

// The version in `root`'s .claude-plugin/plugin.json: the release's, DEV_VERSION where the file names none,
// and null where it can't be read.
export function pluginVersion(root) {
  let found;
  try {
    found = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  } catch {
    return null;
  }
  return typeof found?.version === 'string' && found.version !== '' ? found.version : DEV_VERSION;
}

// The same, but null for a build between releases: for what needs a real release (a tag to name, a number to compare).
export function releaseVersion(root) {
  const version = pluginVersion(root);
  return version === DEV_VERSION ? null : version;
}
