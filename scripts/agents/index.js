// scripts/agents/index.js
// Which coding agent a piece of input or a project belongs to, and the adapter for each agent.
import claudeCode from '../../adapters/claude-code/index.js';
import { AGENTS, noAdapter } from './project-agent.js';

export { ADAPTER_PARTS, checkAdapter } from './contract.js';
export { AGENTS, agentOfConfig, agentOfProject } from './project-agent.js';
export { agentOfInput } from './of-input.js';

const ADAPTERS = Object.freeze({ 'claude-code': claudeCode });

export function adapterFor(name) {
  if (typeof name !== 'string' || !Object.hasOwn(ADAPTERS, name)) throw noAdapter(name);
  return ADAPTERS[name];
}
