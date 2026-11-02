// tests/scripts/agents/copilot-company.test.js
// The baseline a company applies to Copilot, and the reading of what a company has set (plan Part A, Task A2).
import '../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { baselineSettings, baselineHooks, readCompanySettings, companyManages, companyPlaces, OWN_MARK, POLICY_FILE } from '../../../scripts/agents/copilot/company.js';
import { credentialPaths } from '../../../scripts/lib/credentials.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const published = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'copilot', 'baseline', name), 'utf8'));

test('the baseline holds every rule the spec names', () => {
  const b = published('managed-settings.json');
  assert.deepEqual(b, baselineSettings());
  assert.deepEqual(published('policy-hooks.json'), baselineHooks());
  assert.equal(b.sandbox.enabled, true);
  assert.equal(b.sandbox.failIfUnavailable, true, 'the sandbox fails closed');
  assert.equal(b.sandbox.allowBypass, false, 'no command outside it');
  assert.equal(b.permissions.disableBypassPermissionsMode, 'disable', 'no Allow all');
  assert.equal(b.forceRemoteSettingsRefresh, true);
  assert.equal(b.wheelhouse.realUsers, 'all');
  const deny = b.permissions.deny;
  for (const p of ['.wheelhouse/keys', '.copilot', '.agents', ...credentialPaths('darwin')]) {
    assert.ok(deny.includes(`Read(~/${p})`), p);
    assert.ok(b.sandbox.userPolicy.filesystem.deniedPaths.includes(`~/${p}`), p);
  }
  assert.ok(deny.includes('Edit(~/.copilot/**)') && deny.includes('Edit(~/.agents/**)'));
  // The policy hook file runs the guards for each event Wheelhouse registers.
  const hooks = published('policy-hooks.json').hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['preCompact', 'preToolUse', 'sessionStart', 'userPromptSubmitted']);
  for (const entries of Object.values(hooks)) assert.match(entries[0].command, /hook-entry\.js/);
});

test('company settings found means no Locked offer', () => {
  const places = companyPlaces('darwin');
  const files = { [places.managed]: JSON.stringify({ sandbox: { enabled: true } }) };
  const found = readCompanySettings({ platform: 'darwin', read: (f) => files[f] ?? null, list: () => [] });
  assert.deepEqual(found.managed, { sandbox: { enabled: true } });
  assert.equal(companyManages(found), true);
  const hooksOnly = readCompanySettings({ platform: 'darwin', read: () => null, list: () => ['it-hooks.json'] });
  assert.equal(hooksOnly.managed, null);
  assert.deepEqual(hooksOnly.policyHooks, ['it-hooks.json']);
  assert.equal(companyManages(hooksOnly), true);
  // A file that can't be read as an object is still the company's.
  assert.equal(companyManages(readCompanySettings({ platform: 'darwin', read: () => 'not json', list: () => [] })), true);
  assert.equal(companyManages(readCompanySettings({ platform: 'darwin', read: () => null, list: () => [] })), false);
});

test('Wheelhouse\'s own file isn\'t read as the company\'s', () => {
  const places = companyPlaces('darwin');
  const own = JSON.stringify({ ...baselineSettings(), wheelhouse: { ...OWN_MARK } });
  const found = readCompanySettings({ platform: 'darwin', read: (f) => (f === places.managed ? own : null), list: () => [POLICY_FILE] });
  assert.deepEqual(found, { managed: null, policyHooks: [] });
  assert.equal(companyManages(found), false);
});

test('the places follow the system', () => {
  assert.equal(companyPlaces('darwin').policyDir, '/etc/github-copilot/policy.d');
  assert.equal(companyPlaces('win32', { ProgramFiles: 'D:\\Programs' }).managed, 'D:\\Programs\\GitHubCopilot\\managed-settings.json');
  assert.equal(companyPlaces('win32', {}).policyDir, 'C:\\ProgramData\\GitHub\\Copilot\\policy.d');
});

test('the IT note fits one page (60 lines)', () => {
  const note = fs.readFileSync(path.join(ROOT, 'docs', 'copilot', 'it-note.md'), 'utf8');
  assert.ok(note.split('\n').length <= 60, `${note.split('\n').length} lines`);
  assert.match(note.split('\n')[0], /^<!-- docs\/copilot\/it-note\.md -->$/);
  for (const word of ['Archon', 'Bun', 'clean home', 'helper', 'baseline']) assert.match(note, new RegExp(word, 'i'));
  assert.doesNotMatch(note, /Claude|Opus|Sonnet|Fable|Haiku/);
});
