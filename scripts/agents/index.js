// scripts/agents/index.js
// Which coding agent a piece of input or a project belongs to, and the adapter for each agent.
import fs from 'node:fs';
import path from 'node:path';
import claudeCode from '../../adapters/claude-code/index.js';

export { ADAPTER_PARTS, checkAdapter } from './contract.js';

// Copilot joins in Part 4.
export const AGENTS = Object.freeze(['claude-code']);

const ADAPTERS = Object.freeze({ 'claude-code': claudeCode });

export function adapterFor(name) {
  if (typeof name !== 'string' || !Object.hasOwn(ADAPTERS, name)) {
    throw new Error(`There is no adapter for the agent ${JSON.stringify(name)}; the agents are ${AGENTS.join(', ')}`);
  }
  return ADAPTERS[name];
}

export { agentOfInput } from './of-input.js';

// The agent this computer runs for `project` (a folder), from the `agents` map in the project's
// .claude/wheelhouse.json ({ "<computer id>": "copilot" }). A missing or unreadable file, or no
// entry for the computer, gives 'claude-code'.
export function agentOfProject(project, { computerId } = {}) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(project, '.claude', 'wheelhouse.json'), 'utf8'));
    const agents = config?.agents;
    if (agents !== null && typeof agents === 'object' && !Array.isArray(agents) && typeof computerId === 'string' && Object.hasOwn(agents, computerId)) {
      const name = agents[computerId];
      if (typeof name === 'string' && name !== '') return name;
    }
  } catch {
    // Missing or unreadable: the default.
  }
  return 'claude-code';
}
