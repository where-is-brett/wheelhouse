// tests/scripts/agents/copilot-seam.test.js
// Copilot's entries in the seam (design section 8, part 1): the adapter holds every part but the sessions and the
// evaluation runner, which are pending, and each registry in scripts/agents/ holds the adapter's own part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import copilot from '../../../adapters/copilot/index.js';
import claudeCode from '../../../adapters/claude-code/index.js';
import { NOT_BUILT_YET, checkAdapter } from '../../../scripts/agents/contract.js';
import { AGENTS, adapterFor, agentOfConfig, agentOfInput, parkedAgentOf } from '../../../scripts/agents/index.js';
import { sessionsFor, sessionsOfProject } from '../../../scripts/agents/project-agent.js';
import { readsOwnCopies } from '../../../scripts/agents/names.js';
import { SAFETY_LINES } from '../../../scripts/agents/safety-lines.js';
import { TOOL_SHEETS } from '../../../scripts/agents/tool-sheets.js';
import { TRANSLATORS } from '../../../scripts/agents/translators.js';
import { usageWords } from '../../../scripts/agents/usage-words.js';

test('the adapter passes checkAdapter with the sessions and evalRunner parts pending', () => {
  assert.deepEqual(copilot.pending, ['sessions', 'evalRunner']);
  assert.deepEqual(checkAdapter(copilot), []);
  assert.deepEqual(checkAdapter({ ...copilot, pending: [] }).length, 2);
  assert.equal(adapterFor('copilot'), copilot);
  assert.ok(AGENTS.includes('copilot'));
});

test('a pending part throws NOT_BUILT_YET when it is used', () => {
  assert.throws(() => copilot.sessions.foremanCall(), { code: NOT_BUILT_YET, part: 'sessions' });
  assert.throws(() => copilot.evalRunner.run(), { code: NOT_BUILT_YET, part: 'evalRunner' });
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
