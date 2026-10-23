// tests/scripts/agents/claude-registration.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import claudeCode from '../../../adapters/claude-code/index.js';
import settings from '../../../adapters/claude-code/settings.js';
import hooks from '../../../adapters/claude-code/hooks.js';
import packaging, { SETUP_FILES as ADAPTER_SETUP_FILES } from '../../../adapters/claude-code/packaging.js';
import { projectSettings, localSettings } from '../../../scripts/protection/settings.js';
import { resolveClaude } from '../../../scripts/lib/claude.js';
import { CLAUDE_CODE_FLOOR } from '../../../scripts/lib/build-loop.js';
import { SETUP_FILES } from '../../../scripts/setup/project-files.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('hooks/hooks.json is exactly what the adapter\'s registration gives', () => {
  const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(claudeCode.hooks.registration(), onDisk);
  assert.equal(claudeCode.hooks, hooks);
  assert.equal(hooks.file(), 'hooks/hooks.json');
  assert.ok(fs.existsSync(path.join(ROOT, hooks.file())));
});

test('the registration given out cannot change the adapter\'s own', () => {
  const first = hooks.registration();
  first.hooks.PreToolUse.length = 0;
  assert.ok(hooks.registration().hooks.PreToolUse.length > 0);
});

test('the settings are the protection module\'s own, unchanged', () => {
  assert.equal(claudeCode.settings, settings);
  assert.equal(settings.project, projectSettings);
  assert.equal(settings.local, localSettings);
});

test('the identity holds the floor and finds claude the way resolveClaude does', () => {
  assert.equal(claudeCode.identity.floor, CLAUDE_CODE_FLOOR);
  assert.equal(claudeCode.identity.name, 'claude-code');
  assert.equal(claudeCode.identity.label, 'Claude Code');
  const env = { Path: '' };
  let resolves = true;
  try { resolveClaude({ platform: 'win32', env }); } catch { resolves = false; }
  assert.equal(claudeCode.identity.find({ platform: 'win32', env }).found, resolves);
  assert.deepEqual(claudeCode.identity.find({ platform: 'win32', env }).version, null);
});

test('SETUP_FILES keeps its value', () => {
  assert.deepEqual(SETUP_FILES, ['.claude/settings.json', '.claude/wheelhouse.json', 'CLAUDE.md']);
  assert.ok(Object.isFrozen(SETUP_FILES));
  assert.equal(SETUP_FILES, ADAPTER_SETUP_FILES);
  assert.deepEqual(claudeCode.packaging.files(), [...SETUP_FILES]);
  assert.equal(claudeCode.packaging, packaging);
  const given = packaging.files();
  given.push('x');
  assert.equal(packaging.files().length, 3);
});

test('the packaging module imports nothing, so the setup step and the hooks can both reach it', () => {
  const text = fs.readFileSync(path.join(ROOT, 'adapters', 'claude-code', 'packaging.js'), 'utf8');
  assert.doesNotMatch(text, /^\s*import\s/m);
});
