// probes/29-hold/hold.js
// Check 29: a PreToolUse hook that holds a session. In a folder marked with
// `.hold-probe` it refuses every tool except Read, Grep and Glob, saying
// "probe: held". Everywhere else it says nothing.
import fs from 'node:fs';
import path from 'node:path';

const OPEN_TOOLS = ['Read', 'Grep', 'Glob'];

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

const input = JSON.parse(raw);
const held = typeof input.cwd === 'string' && fs.existsSync(path.join(input.cwd, '.hold-probe'));

if (held && !OPEN_TOOLS.includes(input.tool_name)) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'probe: held',
    },
  }));
}
