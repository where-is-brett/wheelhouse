// scripts/agents/setup-parts.js
// What setup asks and does for the coding agent a computer runs, so setup's own steps never name an agent (the
// core-neutral guard). Claude Code's part of setup is the plugin and its settings, which setup already makes; another
// agent brings its own changes to this computer through its entry in SETUPS (design section 8, part 11).
//
// The choice is asked in step 6, once per computer, and only where another agent's command line is installed: a
// computer with none asks nothing and runs Claude Code. The answer reaches the project's configuration in step 7 as this
// computer's entry in the `agents` map (agentEntries).
import { computerId } from '../lib/paths.js';
import { adapterFor, AGENTS } from './index.js';
import copilotSetup from './copilot/setup.js';

const DEFAULT = 'claude-code';

// The agents with a part of their own in setup.
const SETUPS = Object.freeze({ copilot: copilotSetup });

export const AGENT_ASK_ID = 'agent';
export const AGENT_ANSWER = `6.${AGENT_ASK_ID}`;

// The agents other than Claude Code whose command line is on this computer: [{ name, label }].
export function otherAgentsFound({ platform = process.platform, env = process.env, exists } = {}) {
  return AGENTS.filter((name) => name !== DEFAULT && Object.hasOwn(SETUPS, name)).map((name) => adapterFor(name))
    .filter((adapter) => adapter.identity.find({ platform, env, ...(exists === undefined ? {} : { exists }) }).found === true)
    .map((adapter) => ({ name: adapter.identity.name, label: adapter.identity.label }));
}

const labelOf = (name) => (name === DEFAULT ? adapterFor(DEFAULT).identity.label : adapterFor(name).identity.label);

// The question: which agent this computer's crew builds with. Claude Code first, since it is the default.
export function agentAsk({ found, project }) {
  const names = [DEFAULT, ...found.map((f) => f.name)];
  const labels = names.map(labelOf);
  const others = found.map((f) => f.label).join(' and ');
  return {
    id: AGENT_ASK_ID,
    card: {
      level: 3,
      what: `${others} is installed on this computer as well as Claude Code. Which should build ${project ?? 'this project'} here?`,
      why: 'It is chosen for each computer, and it can be changed later from the First Mate. The same chat, cards and checks apply either way.',
      options: names.map((name, i) => ({
        label: labels[i],
        says: name === DEFAULT ? 'Claude Code does the building on this computer, as it does by default.' : `${labels[i]} does the building on this computer. Setup adds its checks and reads your plan from your GitHub account.`,
      })),
      recommend: labels[0],
      because: 'it is the default, and nothing about it changes',
      meanwhile: 'Setup waits at this step; nothing changes.',
    },
  };
}

// The agent an answer chose, or null when none was asked or the label is not one of the agents' labels.
export function agentChosen(answers) {
  const label = answers?.[AGENT_ANSWER]?.label;
  if (typeof label !== 'string') return null;
  return AGENTS.find((name) => labelOf(name) === label) ?? null;
}

// The `agents` map entries this run sets, for the project's configuration: { "<computer id>": name } for a chosen agent
// other than Claude Code, and { "<computer id>": null } for a Claude Code answer, which takes this computer's entry
// out. An empty object where the director was not asked.
export function agentEntries(answers) {
  const chosen = agentChosen(answers);
  if (chosen === null) return {};
  return { [computerId()]: chosen === DEFAULT ? null : chosen };
}

const setupOf = (name) => (typeof name === 'string' && Object.hasOwn(SETUPS, name) ? SETUPS[name] : null);

// Whether the agent is signed in on this computer, with the words to wait with when it is not: null when there is nothing
// to wait for.
export function signInWait(name, options) {
  const part = setupOf(name);
  if (part === null || part.signedIn(options) === true) return null;
  return { wait: part.SIGN_IN_WAIT_MS, why: part.SIGN_IN_WHY };
}

// The changes setup makes on this computer for the agent, to join step 6's list; each has `what: 'agent'`, its card `line`
// and the agent's `label`.
export function agentComputerChanges(name, options) {
  return setupOf(name)?.computerChanges(options) ?? [];
}

// Makes those changes, then reads what the agent's account shows. Resolves the line to say, or null.
export async function applyAgentComputer(name, changes, { record, newId, run, at, env }) {
  const part = setupOf(name);
  if (part === null) return null;
  part.applyComputer(changes, { record, newId });
  return part.afterApply({ run, at, env });
}

// After an update: each agent's changes to this computer made to point at the new release's folder. Resolves the lines to
// say (none where nothing changed). One that can't be written is said, never thrown: the update informs.
export function refreshAgentComputer(options) {
  const lines = [];
  for (const [name, part] of Object.entries(SETUPS)) {
    try {
      const line = part.refresh(options);
      if (typeof line === 'string') lines.push(line);
    } catch (error) {
      lines.push(`${part.label}'s hook file could not be updated (${String(error?.message ?? error).replace(/\s+/g, ' ')}); run setup again to write it (${name}).`);
    }
  }
  return lines;
}
