// scripts/agents/names.js
// The names of the coding agents Wheelhouse knows, named once, and which of them a project runs on this computer.
// It imports only Node.js, so core code that checks a name (the configuration's reader, the lineage hold) can load it
// without loading any adapter.
import fs from 'node:fs';
import path from 'node:path';
import { withoutBom } from '../gate/guardrails.js';

export const AGENTS = Object.freeze(['claude-code', 'copilot']);
// The agents a project can run today. Copilot has an adapter but is switched on for a project only by the last part of its
// build (docs/specs/2026-11-10-copilot-return-design.md, section 8, part 11), so a project that names it is still told
// it is parked.
const SWITCHED_ON = Object.freeze(['claude-code']);
// The agents whose steps read Wheelhouse's own skill copies rather than the kits, so a project's hold goes by those
// copies.
const READ_OWN_COPIES = Object.freeze(['copilot']);
export const readsOwnCopies = (agent) => READ_OWN_COPIES.includes(agent);

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The agent a project runs: Claude Code, whatever the `agents` map of its configuration holds. A project that was
// set to run on a parked agent keeps its map, which is read only by parkedAgentOf and is otherwise ignored.
export function agentOfConfig() {
  return 'claude-code';
}

// The name of a parked agent the configuration's `agents` map gives this computer (for example 'copilot'), or null.
// Only the update reads it, to tell the director that agent is parked.
export function parkedAgentOf(config, { computerId: id } = {}) {
  const agents = config?.agents;
  if (isMap(agents) && typeof id === 'string' && Object.hasOwn(agents, id)) {
    const name = agents[id];
    if (typeof name === 'string' && name !== '' && !SWITCHED_ON.includes(name)) return name;
  }
  return null;
}

// The configuration in a project's folder (`folder`'s .claude/wheelhouse.json), or null when it is missing or can't
// be read.
function folderConfig(folder) {
  try {
    return JSON.parse(withoutBom(fs.readFileSync(path.join(folder, '.claude', 'wheelhouse.json'), 'utf8')));
  } catch {
    return null;
  }
}

// The `agents` map in `folder`'s configuration, or the nearest above it (a command may be run in a project's subfolder),
// with no computer's id needed; null when there is no configuration or it can't be read.
export function agentsNamedAbove(folder) {
  for (let dir = folder; ;) {
    const config = folderConfig(dir);
    if (config !== null) return isMap(config.agents) ? config.agents : {};
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// The same, read from the working copy: the `agents` map in `project`'s (a folder) .claude/wheelhouse.json.
// For a caller that holds no configuration from the default branch (setup). A missing or unreadable file gives
// 'claude-code'. The waker and the foreman's start never use this: they take the agent from the default
// branch's configuration, as they take the mode and the models, never from the working copy.
export function agentOfProject() {
  return 'claude-code';
}

// The same for a folder's own configuration: the parked agent's name, or null.
export function parkedAgentOfProject(project, options = {}) {
  return parkedAgentOf(folderConfig(project), options);
}

// The agent the project in `folder` runs on this computer, as its working copy's configuration names it, or null
// when that can't be told: a configuration that is missing or can't be read is null here, not 'claude-code', for a
// caller that must fail closed (ruling P8-33).
export function agentInFolder(folder, options = {}) {
  if (typeof folder !== 'string' || folder === '') return null;
  const config = folderConfig(folder);
  return config === null ? null : agentOfConfig(config, options);
}
