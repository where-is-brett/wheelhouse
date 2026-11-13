// tests/probes/copilot-t3/grandchild.js
// A stand-in run that starts a grandchild of its own: `node grandchild.js <file for the grandchild's pid>`. Both wait to be killed.
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
fs.writeFileSync(process.argv[2], String(child.pid));
process.stdout.write(`${JSON.stringify({ type: 'tool.execution_complete', data: { toolCallId: 'a', success: true } })}\n`);
setInterval(() => {}, 1000);
