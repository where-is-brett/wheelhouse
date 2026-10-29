// probes/74-archon-copilot/hook-wrap.js
// Check 74's hook: runs the Lean kit's guard on the hook input, passes its answer and exit code back to Copilot
// unchanged, and appends one line to a log saying what the guard answered. A guard that can't be run is
// logged and the call is refused, as the guard itself would.
// Run as: node hook-wrap.js <log file> <guard.sh>
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const [log, guard] = process.argv.slice(2);
let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

let input;
try { input = JSON.parse(raw); } catch { input = { unparsed: raw }; }

const result = spawnSync('/bin/sh', [guard], { input: raw, encoding: 'utf8', timeout: 110000 });
const code = result.status ?? 2;
let stdout = result.stdout ?? '';
let answer;
try { answer = JSON.parse(stdout).permissionDecision; } catch { /* no JSON answer */ }
if (result.error) {
  stdout = JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: 'The guard could not be run' });
  answer = 'deny';
}
answer ??= code === 0 ? 'allow' : 'deny';

try {
  fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), event: 'preToolUse', input, code, answer, stderr: (result.stderr ?? '').slice(0, 500) }) + '\n');
} catch { /* logging never changes the answer */ }

process.stdout.write(stdout);
process.exit(result.error ? 2 : code);
