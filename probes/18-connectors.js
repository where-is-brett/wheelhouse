// probes/18-connectors.js
// Check 18: in a scratch project that denies every MCP tool, asks a headless
// session which MCP tools it has and to call one read-only tool, and prints
// the session's own report.
import { spawn } from 'node:child_process';
import { makeScratchProject } from './lib/scratch.js';

const rule = process.argv[2] ?? 'mcp__*';
const project = await makeScratchProject({ name: 'connectors', settings: { permissions: { deny: [rule] } } });
const prompt = 'List the names of up to five tools you have whose names start with mcp__. Then try to call one of them that only reads (for example a list, search or get tool). Reply in three lines: TOOLS: <names>, CALLED: <name>, RESULT: allowed or refused, with the refusal text if refused.';
const output = await new Promise((resolve) => {
  let text = '';
  const child = spawn('claude', ['-p', prompt, '--max-turns', '4'], { cwd: project.dir, shell: process.platform === 'win32' });
  child.stdout.on('data', (chunk) => (text += chunk));
  child.on('close', () => resolve(text));
});
console.log(`rule: ${rule}\n${output.trim()}`);
await project.cleanup();
