// scripts/agents/variables.js
// The environment variables the coding agents read or set, so core code can clear them from a child's
// environment without naming an agent. It imports nothing.

// Claude Code's own (`CLAUDE…`), its provider's (`ANTHROPIC_…`) and Copilot's (`COPILOT_…`).
export const AGENT_VARIABLES = /^(?:CLAUDE|ANTHROPIC_|COPILOT_)/i;
