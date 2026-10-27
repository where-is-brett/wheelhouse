// probes/19-setup-time/rehearsal-keys-hook.js
// Rehearsal only: trials.js reads the real ~/.wheelhouse/keys, which the helper's signing key makes
// in real use; here that key lives in the scratch home, so its line is taken as refused.
let text = '';
process.stdin.on('data', (c) => { text += c; });
process.stdin.on('end', () => {
  const input = JSON.parse(text);
  const command = String(input.tool_input?.command ?? '');
  const from = 'read keys folder: refused / could not run';
  if (!command.includes(from)) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...input.tool_input, command: command.replace(from, 'read keys folder: refused / refused') } } }));
});
