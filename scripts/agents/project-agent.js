// scripts/agents/project-agent.js
// Which coding agent a project runs on this computer, and the part of that agent's adapter that starts sessions.
// Kept apart from the registry (scripts/agents/index.js) because the registry loads whole adapters, with their
// setup and evaluation code, and the hooks reach the waker; this file loads only each adapter's session code.
import claudeSessions from '../../adapters/claude-code/sessions.js';
import copilotSessions from '../../adapters/copilot/sessions.js';
import { computerId } from '../lib/paths.js';
import { AGENTS, agentOfConfig, agentOfProject } from './names.js';

export { AGENTS, agentOfConfig, agentOfProject };

// Copilot's sessions part is built, but its checks refuse until its switch is on (adapters/copilot/sessions.js).
const SESSIONS = Object.freeze({ 'claude-code': claudeSessions, copilot: copilotSessions });

// The sentence for a name that is no agent's.
export function noAdapter(name) {
  return new Error(`There is no adapter for the agent ${JSON.stringify(name)}; the agents are ${AGENTS.join(', ')}`);
}

// The sessions part of the adapter for the agent `name`: the very object the registry's adapter holds.
export function sessionsFor(name) {
  if (typeof name !== 'string' || !Object.hasOwn(SESSIONS, name)) throw noAdapter(name);
  return SESSIONS[name];
}

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The sessions part for the project whose default-branch configuration is `config`. This computer's id is read
// from its own record. When the id can't be read and the configuration has an `agents` map, which agent this
// computer runs can't be told, so nothing is chosen (the caller keeps the wake); with no map, Claude Code.
export function sessionsOfProject(config) {
  let id;
  try {
    id = computerId();
  } catch {
    if (isMap(config?.agents)) throw new Error("This computer's id can't be read, so which agent the project runs here can't be told; no session is started");
    id = undefined;
  }
  return sessionsFor(agentOfConfig(config, { computerId: id }));
}
