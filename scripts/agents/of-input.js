// scripts/agents/of-input.js
// Which coding agent a piece of hook input came from. It imports nothing, so the hook kit can use it
// without loading the adapters.

// Claude Code's hook input carries `hook_event_name`. Anything else is null.
export function agentOfInput(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Object.hasOwn(raw, 'hook_event_name')) return 'claude-code';
  return null;
}
