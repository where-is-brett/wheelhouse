// probes/12-locked/locked-hook.js
// Check 12: a PreToolUse hook for the computer-wide settings file. It acts
// only in a folder marked as a Locked probe project, and there refuses one
// harmless command. Everywhere else it does nothing.
import fs from 'node:fs';
import path from 'node:path';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

const input = JSON.parse(raw);
const marked = typeof input.cwd === 'string' && fs.existsSync(path.join(input.cwd, '.wheelhouse-locked-probe'));
const command = input.tool_input?.command ?? '';

if (marked && command.startsWith('echo locked-probe')) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'probe: refused by the managed hook',
    },
  }));
}
