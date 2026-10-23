// scripts/agents/names.js
// The names of the coding agents Wheelhouse knows, named once, and which of them a project runs on this computer.
// It imports only Node.js, so core code that checks a name (the configuration's reader, the lineage hold) can load it
// without loading any adapter.
import fs from 'node:fs';
import path from 'node:path';

export const AGENTS = Object.freeze(['claude-code', 'copilot']);

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

// The configuration in a project's folder (`folder`'s .claude/wheelhouse.json), or null when it is missing or can't
// be read.
function folderConfig(folder) {
  try {
    return JSON.parse(fs.readFileSync(path.join(folder, '.claude', 'wheelhouse.json'), 'utf8'));
  } catch {
    return null;
  }
}

// The same, read from the working copy: the `agents` map in `project`'s (a folder) .claude/wheelhouse.json.
// For a caller that holds no configuration from the default branch (setup). A missing or unreadable file gives
// 'claude-code'. The waker and the foreman's start never use this: they take the agent from the default
// branch's configuration, as they take the mode and the models, never from the working copy.
export function agentOfProject(project, options = {}) {
  return agentOfConfig(folderConfig(project), options);
}

// The agent the project in `folder` runs on this computer, as its working copy's configuration names it, or null
// when that can't be told: a configuration that is missing or can't be read is null here, not 'claude-code', for a
// caller that must fail closed (ruling P8-33).
export function agentInFolder(folder, options = {}) {
  if (typeof folder !== 'string' || folder === '') return null;
  const config = folderConfig(folder);
  return config === null ? null : agentOfConfig(config, options);
}
