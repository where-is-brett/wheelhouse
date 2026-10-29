// adapters/claude-code/answers.js
// The answers a Claude Code hook writes: the JSON shapes Claude Code reads back.
// It imports nothing, so the hook kit can read it without a cycle.
export const answer = {
  deny: (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }),
  allow: (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: reason } }),
  context: (event, text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }),
  block: (reason) => ({ decision: 'block', reason }),
};
