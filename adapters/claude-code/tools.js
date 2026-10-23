// adapters/claude-code/tools.js
// The names Claude Code gives its tools, in the shape the adapter contract asks of the `tools` part.
// It imports nothing, so the hook kit and the guards can read it without a cycle.
export default Object.freeze({
  read: Object.freeze(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'AskUserQuestion', 'TodoWrite', 'ToolSearch']),
  halt: Object.freeze(['TaskStop', 'KillShell']),
  notify: Object.freeze(['PushNotification']),
  ask: 'AskUserQuestion',
  shell: Object.freeze(['Bash', 'PowerShell']),
});
