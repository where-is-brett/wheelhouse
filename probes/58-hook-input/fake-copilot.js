// probes/58-hook-input/fake-copilot.js
// A stand-in for Copilot CLI, used only by `run.js --dry-run` so the probe's plumbing (the hook files, the
// prompts, the extra runs, the file checks, the results file) can be tested where the real Copilot can't run.
// Its rules are made up and are not evidence of anything:
//   - it reads $COPILOT_HOME/hooks/*.json (flat camelCase, flat PascalCase and Claude's nested form)
//   - it decides which tools to use from words in the prompt, and runs sessionStart, preToolUse, then the tool,
//     then postToolUse for each
//   - a preToolUse hook that exits non-zero, or prints permissionDecision deny, stops the tool; one that runs
//     past its timeoutSec is killed and the tool goes ahead
//   - PascalCase registrations get snake_case input and Claude's tool names
//   - the tools really read and write files in the folder it was started in (view reads README.md, create
//     writes out.txt), so the probe's file checks have something to see
// Environment: WHEELHOUSE_FAKE_FAIL=1 makes a prompt run exit 1 without running any hook.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const home = process.env.COPILOT_HOME;
const cwd = process.cwd();

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const CLAUDE_NAMES = { bash: 'Bash', view: 'Read', edit: 'Edit', create: 'Write', grep: 'Grep', glob: 'Glob', web_fetch: 'WebFetch', task: 'Agent', ask_user: 'AskUserQuestion' };
const WORDS = [
  ['shell', /shell tool/i, 'bash', { command: 'echo probe58-shell' }],
  ['powershell', /powershell tool/i, 'powershell', { command: 'Write-Output probe58-powershell' }],
  ['view', /view tool/i, 'view', { path: 'README.md' }],
  ['edit', /edit tool/i, 'edit', { path: 'edit-me.txt', old_str: 'alpha', new_str: 'beta' }],
  ['create', /create tool/i, 'create', { path: 'out.txt', file_text: 'went-through' }],
  ['grep', /grep tool/i, 'grep', { pattern: 'secret' }],
  ['glob', /glob tool/i, 'glob', { pattern: '*.md' }],
  ['web_fetch', /web fetch tool/i, 'web_fetch', { url: 'http://127.0.0.1/' }],
  ['task', /task tool/i, 'task', { agent_type: 'probe-agent', prompt: 'ok' }],
  ['ask_user', /ask_user tool/i, 'ask_user', { question: 'colour?' }],
  ['echo', /echo tool/i, 'probe58-echo', { text: 'probe58' }],
];

function registrations() {
  const dir = path.join(home ?? '', 'hooks');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { return []; }
  const found = [];
  for (const name of names) {
    const data = readJson(path.join(dir, name));
    for (const [event, list] of Object.entries(data?.hooks ?? {})) {
      for (const item of Array.isArray(list) ? list : []) {
        if (item.hooks) for (const hook of item.hooks) found.push({ event, command: hook.command, timeoutSec: hook.timeout ?? 30 });
        else found.push({ event, command: item.bash ?? item.command, timeoutSec: item.timeoutSec ?? 30 });
      }
    }
  }
  return found.filter((r) => r.command);
}

// Runs every hook registered for `event` (either spelling); returns whether any denied.
function fire(event, tool, toolArgs) {
  let denied = false;
  for (const r of registrations()) {
    const pascal = r.event[0] === r.event[0].toUpperCase();
    if (r.event.toLowerCase() !== event.toLowerCase()) continue;
    const base = { sessionId: 'stand-in', timestamp: 1, cwd };
    const input = !tool ? base
      : pascal ? { session_id: 'stand-in', cwd, hook_event_name: r.event, tool_name: CLAUDE_NAMES[tool] ?? tool, tool_input: toolArgs }
        : { ...base, toolName: tool, toolArgs: JSON.stringify(toolArgs) };
    const out = spawnSync(r.command, { shell: true, input: JSON.stringify(input), cwd, env: process.env, encoding: 'utf8', timeout: r.timeoutSec * 1000 });
    if (!/^pre/i.test(event)) continue;
    if (out.error || out.signal) continue; // a time-out lets the call through
    if (out.status !== 0) denied = true;
    try { if (JSON.parse(out.stdout || '{}').permissionDecision === 'deny') denied = true; } catch { /* not JSON */ }
  }
  return denied;
}

function useTool(tool, toolArgs) {
  if (tool === 'view') return fs.readFileSync(path.join(cwd, 'README.md'), 'utf8');
  if (tool === 'create') { fs.writeFileSync(path.join(cwd, 'out.txt'), toolArgs.file_text); return 'created'; }
  return 'ok';
}

const [first] = args;
if (first === '--version' || first === '-v') {
  console.log('GitHub Copilot CLI 0.0.0-stand-in.');
} else if (args.includes('-p')) {
  if (process.env.WHEELHOUSE_FAKE_FAIL === '1') {
    console.error('Not signed in (stand-in).');
    process.exit(1);
  }
  const prompt = args[args.indexOf('-p') + 1];
  fire('sessionStart');
  for (const [, pattern, tool, toolArgs] of WORDS) {
    if (!pattern.test(prompt)) continue;
    if (tool === 'ask_user' && args.includes('--no-ask-user')) continue;
    const denied = fire('preToolUse', tool, toolArgs);
    const output = denied ? '' : useTool(tool, toolArgs);
    console.log(JSON.stringify({ type: 'tool.execution_complete', data: { toolName: tool, success: !denied, result: output } }));
    if (!denied) fire('postToolUse', tool, toolArgs);
  }
  console.log(JSON.stringify({ type: 'assistant.message', data: { content: 'done' } }));
  console.log(JSON.stringify({ type: 'result', sessionId: 'stand-in', exitCode: 0, usage: { premiumRequests: 0 } }));
} else {
  console.error(`The stand-in does not know: ${args.join(' ')}`);
  process.exit(2);
}
