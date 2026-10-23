// scripts/agents/of-input.js
// Which coding agent a piece of hook input came from. It imports nothing, so the hook kit can use it
// without loading the adapters.

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
