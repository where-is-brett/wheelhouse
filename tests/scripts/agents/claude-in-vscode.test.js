// tests/scripts/agents/claude-in-vscode.test.js
// VS Code's Claude harness as a front end (plan Part A, Task A4): offered only where check 54 passed and the company allows
// it, and with a safety line that says what differs from Claude Code. Builds stay on Archon.
import '../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapterFor, checkAdapter, claudeHarnessOffered, claudeHarnessRoute, claudeInVscodeLine, CLAUDE_IN_VSCODE, AGENTS } from '../../../scripts/agents/index.js';
import claudeCode from '../../../adapters/claude-code/index.js';
import { companyPlaces } from '../../../scripts/agents/copilot/company.js';
import { CLAUDE_HARNESS_CHECKED } from '../../../scripts/lib/copilot-numbers.js';

const managedByCompany = { read: (f) => (f === companyPlaces('darwin').managed ? '{"sandbox":{"enabled":true}}' : null), list: () => [] };
const unmanaged = { read: () => null, list: () => [] };

test('the switch starts off', () => {
  assert.equal(CLAUDE_HARNESS_CHECKED, false);
  assert.equal(claudeHarnessOffered(), false);
  assert.deepEqual(claudeHarnessRoute({ platform: 'darwin', company: unmanaged }), { offered: false });
});

test('setup offers it only where the check passed and the company allows it', () => {
  assert.equal(claudeHarnessOffered({ checked: true, company: false }), true);
  assert.equal(claudeHarnessOffered({ checked: true, company: true }), false);
  assert.equal(claudeHarnessOffered({ checked: false, company: false }), false);
  assert.equal(claudeHarnessOffered({ checked: 'yes', company: false }), false, 'only true switches it on');
  assert.deepEqual(claudeHarnessRoute({ platform: 'darwin', company: unmanaged, checked: true }), { offered: true });
  assert.deepEqual(claudeHarnessRoute({ platform: 'darwin', company: managedByCompany, checked: true }), { offered: false });
});

test('its safety line names what differs from Claude Code', () => {
  const adapter = adapterFor(CLAUDE_IN_VSCODE);
  assert.deepEqual(checkAdapter(adapter), []);
  assert.equal(adapter.identity.name, 'claude-in-vscode');
  assert.equal(adapter.identity.label, 'Claude in VS Code');
  assert.equal(adapter.identity.floor, claudeCode.identity.floor);
  assert.deepEqual(adapter.safetyLine(), claudeInVscodeLine());
  const text = adapter.safetyLine().join(' ');
  assert.match(text, /Copilot's subscription/);
  assert.match(text, /switch it off/);
  assert.match(text, /build engine/);
  assert.deepEqual(claudeCode.safetyLine(), [], 'Claude Code\'s own line is as it was');
  // It shares Claude Code's guards: the same hooks, tools and translation.
  for (const part of ['hooks', 'tools', 'translate', 'settings', 'sessions']) assert.equal(adapter[part], claudeCode[part], part);
  // It is a front end, not an agent a project can name.
  assert.deepEqual(AGENTS, ['claude-code', 'copilot']);
});
