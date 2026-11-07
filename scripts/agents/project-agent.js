// scripts/agents/project-agent.js
// Which coding agent a project runs on this computer, and the part of that agent's adapter that starts sessions.
// Kept apart from the registry (scripts/agents/index.js) because the registry loads whole adapters, with their
// setup and evaluation code, and the hooks reach the waker; this file loads only each adapter's session code.
import claudeSessions from '../../adapters/claude-code/sessions.js';
import { AGENTS, agentOfConfig } from './names.js';

export { AGENTS, agentOfConfig, agentOfProject, parkedAgentOf } from './names.js';

const SESSIONS = Object.freeze({ 'claude-code': claudeSessions });

// The sentence for a name that is no agent's.
export function noAdapter(name) {
  return new Error(`There is no adapter for the agent ${JSON.stringify(name)}; the agents are ${AGENTS.join(', ')}`);
}

// The sessions part of the adapter for the agent `name`: the very object the registry's adapter holds.
export function sessionsFor(name) {
  if (typeof name !== 'string' || !Object.hasOwn(SESSIONS, name)) throw noAdapter(name);
  return SESSIONS[name];
}

// The sessions part for the project whose default-branch configuration is `config`: Claude Code's.
export function sessionsOfProject(config) {
  return sessionsFor(agentOfConfig(config));
}
