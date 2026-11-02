// scripts/agents/sandbox-line.js
// The board's line for an agent's sandbox on this computer, { level, text }, or null for an agent without one. Kept
// apart from the registry (scripts/agents/index.js), which loads whole adapters, so the board's hook reads it light.
import { sandboxLine } from '../../adapters/copilot/sandbox.js';
import { sandboxNow } from './copilot/sandbox-test.js';

export function agentSandboxLine(agent) {
  return agent === 'copilot' ? sandboxLine(sandboxNow().state) : null;
}
