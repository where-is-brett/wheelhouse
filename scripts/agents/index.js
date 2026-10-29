// scripts/agents/index.js
// Which coding agent a piece of input or a project belongs to, and the adapter for each agent.
import claudeCode from '../../adapters/claude-code/index.js';
import copilot from '../../adapters/copilot/index.js';
import { AGENTS, noAdapter } from './project-agent.js';

export { ADAPTER_PARTS, checkAdapter } from './contract.js';
export { AGENTS, agentOfConfig, agentOfProject } from './project-agent.js';
export { agentOfInput } from './of-input.js';
// The script a sign-in start runs to start the helper; the engine's sign-in start shares it.
export { START_SCRIPT as HELPER_START_SCRIPT } from './copilot/start-helper.js';

const ADAPTERS = Object.freeze({ 'claude-code': claudeCode, copilot });

export function adapterFor(name) {
  if (typeof name !== 'string' || !Object.hasOwn(ADAPTERS, name)) throw noAdapter(name);
  return ADAPTERS[name];
}
