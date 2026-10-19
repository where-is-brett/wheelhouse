// tests/helpers/lineage.js
// A made-up Wheelhouse root with a manifest for one small upstream, a Claude folder whose
// record of installs points at a copy of it for a project, and ways to change that copy.
import fs from 'node:fs';
import path from 'node:path';
import { buildManifest } from '../../scripts/lineage/manifest.js';
import { tempFolder } from './homes.js';

export const SHA = 'a'.repeat(40);
export const UPSTREAM = {
  name: 'superpowers',
  plugin: 'superpowers',
  repo: 'https://example.invalid/superpowers.git',
  ref: 'v1.0.0',
  sha: SHA,
  folders: ['skills/brainstorming', 'skills/writing-plans'],
  files: ['LICENSE'],
};
const COPY = { 'skills/brainstorming/SKILL.md': 'brainstorm\n', 'skills/writing-plans/SKILL.md': 'plan\n', LICENSE: 'licence\n' };

export function writeFiles(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, ...name.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

// { root, claudeHome, installed, put(files), restore() } for the project in `projectDir`.
export function lineageFixture(projectDir, { version = '1.2.3', register = '0.4.0' } = {}) {
  const pristine = tempFolder('wh-upstream-');
  writeFiles(pristine, COPY);
  const root = tempFolder('wh-root-');
  writeFiles(root, {
    'lineage/manifest.json': JSON.stringify(buildManifest({ roots: { superpowers: pristine }, version, upstreams: [UPSTREAM] })),
    'lineage/register.json': JSON.stringify({ v: 1, version: register, overrides: [], carried: [], assumptions: [] }),
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'wheelhouse', version }),
  });
  const installed = tempFolder('wh-installed-');
  writeFiles(installed, COPY);
  const claudeHome = tempFolder('wh-claude-');
  writeFiles(claudeHome, {
    'plugins/installed_plugins.json': JSON.stringify({
      version: 2,
      plugins: { 'superpowers@wheelhouse': [{ scope: 'project', projectPath: projectDir, installPath: installed, version: '1.0.0', gitCommitSha: SHA }] },
    }),
  });
  return {
    root,
    claudeHome,
    installed,
    put: (files) => writeFiles(installed, files),
    restore: () => writeFiles(installed, COPY),
  };
}
