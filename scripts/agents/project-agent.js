// scripts/agents/project-agent.js
// Which coding agent a project runs on this computer, and the part of that agent's adapter that starts sessions.
// Kept apart from the registry (scripts/agents/index.js) because the registry loads whole adapters, with their
// setup and evaluation code, and the hooks reach the waker; this file loads only each adapter's session code.
import fs from 'node:fs';
import path from 'node:path';
import claudeSessions from '../../adapters/claude-code/sessions.js';
import { computerId } from '../lib/paths.js';

// Copilot joins in Part 4.
export const AGENTS = Object.freeze(['claude-code']);

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

// The agent this computer runs for `project` (a folder), from the `agents` map in the project's
// .claude/wheelhouse.json ({ "<computer id>": "copilot" }). A missing or unreadable file, or no
// entry for the computer, gives 'claude-code'.
export function agentOfProject(project, { computerId: id } = {}) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(project, '.claude', 'wheelhouse.json'), 'utf8'));
    const agents = config?.agents;
    if (agents !== null && typeof agents === 'object' && !Array.isArray(agents) && typeof id === 'string' && Object.hasOwn(agents, id)) {
      const name = agents[id];
      if (typeof name === 'string' && name !== '') return name;
    }
  } catch {
    // Missing or unreadable: the default.
  }
  return 'claude-code';
}

// The sessions part for the project whose main checkout is `folder` (null when the folder is not known:
// the default agent). This computer's id is read from its own record; one that cannot be read gives the default.
export function sessionsOfProject(folder) {
  let id;
  try {
    id = computerId();
  } catch {
    id = undefined;
  }
  return sessionsFor(typeof folder === 'string' ? agentOfProject(folder, { computerId: id }) : 'claude-code');
}
