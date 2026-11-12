// tests/scripts/agents/copilot-seam.test.js
// Copilot's entries in the seam (design section 8, parts 1, 7 and 10): the adapter holds every part, and each registry in scripts/agents/ holds the adapter's own part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import copilot from '../../../adapters/copilot/index.js';
import claudeCode from '../../../adapters/claude-code/index.js';
import { checkAdapter } from '../../../scripts/agents/contract.js';
import { AGENTS, adapterFor, agentOfConfig, agentOfInput, parkedAgentOf } from '../../../scripts/agents/index.js';
import { sessionsFor, sessionsOfProject } from '../../../scripts/agents/project-agent.js';
import { readsOwnCopies } from '../../../scripts/agents/names.js';
import { SAFETY_LINES } from '../../../scripts/agents/safety-lines.js';
import { TOOL_SHEETS } from '../../../scripts/agents/tool-sheets.js';
import { TRANSLATORS } from '../../../scripts/agents/translators.js';
import { usageWords } from '../../../scripts/agents/usage-words.js';

test('the adapter passes checkAdapter with no part pending', () => {
  assert.deepEqual(copilot.pending, []);
  assert.deepEqual(checkAdapter(copilot), []);
  assert.equal(typeof copilot.evalRunner.run, 'function');
  assert.equal(adapterFor('copilot'), copilot);
  assert.ok(AGENTS.includes('copilot'));
});

test('the sessions part is the one the registry gives', () => {
  assert.equal(sessionsFor('copilot'), copilot.sessions);
});

test("each registry holds the adapter's own part", () => {
  assert.equal(TRANSLATORS.copilot.translate, copilot.translate);
  assert.equal(TRANSLATORS.copilot.writes, 'helper');
  assert.equal(TOOL_SHEETS.copilot, copilot.toolSheet);
  assert.equal(SAFETY_LINES.copilot.label, copilot.identity.label);
  assert.equal(SAFETY_LINES.copilot.safetyLine, copilot.safetyLine);
  assert.ok(usageWords('copilot'));
  assert.equal(usageWords('claude-code'), null);
  assert.equal(readsOwnCopies('copilot'), true);
  assert.equal(readsOwnCopies('claude-code'), false);
});

test("Copilot's input is told apart, and a project that names it still runs on Claude Code", () => {
  assert.equal(agentOfInput({ toolName: 'bash', sessionId: 's' }), 'copilot');
  assert.equal(agentOfInput({ hook_event_name: 'PreToolUse', toolName: 'bash' }), 'claude-code');
  const config = { agents: { c1: 'copilot' } };
  assert.equal(agentOfConfig(config, { computerId: 'c1' }), 'claude-code');
  assert.equal(parkedAgentOf(config, { computerId: 'c1' }), 'copilot');
  assert.equal(sessionsOfProject(config), claudeCode.sessions);
});
