// scripts/agents/usage-words.js
// What the board and the briefing say of an agent's use when its sessions report their own use (ruling P8-21): the
// usage figures (scripts/usage/figures.js) find these by the agent named in a run's record, so core code never names
// an agent. An agent with no entry is said as Claude Code's use always has been.
//
// On Copilot only each session's own use can be read (check 64): the month's total isn't reachable with the
// person's sign-in, and sessions the person starts by hand aren't counted. So nothing here claims a month's total or
// an allowance.
export const USAGE_WORDS = Object.freeze({
  copilot: Object.freeze({
    // In place of the allowance line: why no allowance or month's total is shown.
    allowance: "Copilot's use is counted session by session: this session's use, summed over the sessions Wheelhouse started. Sessions you start yourself aren't counted, and no month's total or allowance is shown, as Copilot doesn't give one to read",
    // The usage section's note.
    note: "Each part's credits are the sessions Wheelhouse started, each counted as this session's use; sessions you start yourself aren't in them",
  }),
});

// The words for `agent`, or null.
export function usageWords(agent) {
  return typeof agent === 'string' && Object.hasOwn(USAGE_WORDS, agent) ? USAGE_WORDS[agent] : null;
}
