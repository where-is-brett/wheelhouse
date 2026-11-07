// scripts/agents/index.js
// Which coding agent a piece of input or a project belongs to, and the adapter for each agent. Claude Code is the
// only agent; the seam (scripts/agents/contract.js) stays so another agent could be plugged in later.
import claudeCode from '../../adapters/claude-code/index.js';
import { noAdapter } from './project-agent.js';

export { ADAPTER_PARTS, checkAdapter } from './contract.js';
export { AGENTS, agentOfConfig, agentOfProject, parkedAgentOf } from './project-agent.js';
export { agentOfInput } from './of-input.js';
// The script a sign-in start runs to start the helper.
export { START_SCRIPT as HELPER_START_SCRIPT } from '../host/start-helper.js';

const ADAPTERS = Object.freeze({ 'claude-code': claudeCode });

export function adapterFor(name) {
  if (typeof name !== 'string' || !Object.hasOwn(ADAPTERS, name)) throw noAdapter(name);
  return ADAPTERS[name];
}
