// scripts/agents/project-agent.js
// Which coding agent a project runs on this computer, and the part of that agent's adapter that starts sessions.
// Kept apart from the registry (scripts/agents/index.js) because the registry loads whole adapters, with their
// setup and evaluation code, and the hooks reach the waker; this file loads only each adapter's session code.
import fs from 'node:fs';
import path from 'node:path';
import claudeSessions from '../../adapters/claude-code/sessions.js';
import copilotSessions from '../../adapters/copilot/sessions.js';
import { computerId } from '../lib/paths.js';
import { AGENTS } from './names.js';

export { AGENTS };

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

// The agent this computer runs, from the `agents` map of a project's configuration ({ "<computer id>":
// "copilot" }). No map, or no entry for the computer, gives 'claude-code'.
export function agentOfConfig(config, { computerId: id } = {}) {
  const agents = config?.agents;
  if (isMap(agents) && typeof id === 'string' && Object.hasOwn(agents, id)) {
    const name = agents[id];
    if (typeof name === 'string' && name !== '') return name;
  }
  return 'claude-code';
}

// The same, read from the working copy: the `agents` map in `project`'s (a folder) .claude/wheelhouse.json.
// For a caller that holds no configuration from the default branch (setup). A missing or unreadable file gives
// 'claude-code'. The waker and the foreman's start never use this: they take the agent from the default
// branch's configuration, as they take the mode and the models, never from the working copy.
export function agentOfProject(project, options = {}) {
  try {
    return agentOfConfig(JSON.parse(fs.readFileSync(path.join(project, '.claude', 'wheelhouse.json'), 'utf8')), options);
  } catch {
    return 'claude-code';
  }
}

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
