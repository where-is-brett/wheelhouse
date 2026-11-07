// scripts/agents/usage-words.js
// What the board and the briefing say of an agent's use when its sessions report their own use (ruling P8-21): the
// usage figures (scripts/usage/figures.js) find these by the agent named in a run's record, so core code never names
// an agent. An agent with no entry is said as Claude Code's use always has been, and Claude Code has none.
export const USAGE_WORDS = Object.freeze({});

// The words for `agent`, or null.
export function usageWords(agent) {
  return typeof agent === 'string' && Object.hasOwn(USAGE_WORDS, agent) ? USAGE_WORDS[agent] : null;
}
