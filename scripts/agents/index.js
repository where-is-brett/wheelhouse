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

// Claude Code's hook input carries `hook_event_name`. Copilot's camelCase input carries `toolName` or
// `sessionId` and no `hook_event_name`. Wheelhouse registers Copilot's hooks in camelCase only, since
// the same event registered under two spellings runs twice, so anything with `hook_event_name` is
// Claude Code's, including a PascalCase payload. Anything else is null.
export function agentOfInput(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Object.hasOwn(raw, 'hook_event_name')) return 'claude-code';
  if (Object.hasOwn(raw, 'toolName') || Object.hasOwn(raw, 'sessionId')) return 'copilot';
  return null;
}

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
