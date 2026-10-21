// probes/69-guards-without-node/fake-copilot.js
// A stand-in for Copilot CLI, used only by `run.js --dry-run` so the probe's plumbing (the PATH without Node.js,
// the hook files, the answer server, the verdicts, the results file) can be tested where the real Copilot can't
// run. Its rules are made up from the hooks reference and are not evidence of anything:
//   - it reads $COPILOT_HOME/hooks/*.json and, for a prompt that names the view tool, runs the preToolUse hooks,
//     then reads README.md, then runs the postToolUse hooks
//   - a command hook that exits non-zero, or prints permissionDecision deny, stops the call; one that runs past
//     its timeoutSec is killed and the call goes ahead
//   - an http preToolUse hook is never called (the reference says it must use https); an http postToolUse hook
//     is called only for 127.* and only when COPILOT_HOOK_ALLOW_LOCALHOST=1; a failed call is let through
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const home = process.env.COPILOT_HOME;
const cwd = process.cwd();

function registrations() {
  const dir = path.join(home ?? '', 'hooks');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { return []; }
  const found = [];
  for (const name of names) {
    let data = null;
    try { data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { continue; }
    for (const [event, list] of Object.entries(data?.hooks ?? {})) {
      for (const item of Array.isArray(list) ? list : []) found.push({ event, ...item });
    }
  }
  return found;
}

function post(url, body, seconds) {
  return new Promise((resolve) => {
    const request = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, timeout: seconds * 1000 }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ ok: response.statusCode < 300, text }));
    });
    request.on('error', () => resolve({ ok: false, text: '' }));
    request.on('timeout', () => { request.destroy(); resolve({ ok: false, text: '' }); });
    request.end(body);
  });
}

async function fire(event, input) {
  let denied = false;
  for (const hook of registrations()) {
    if (hook.event !== event) continue;
    const body = JSON.stringify(input);
    if (hook.type === 'http') {
      const local = /^http:\/\/127\./.test(hook.url ?? '');
      if (event === 'preToolUse' || !local || process.env.COPILOT_HOOK_ALLOW_LOCALHOST !== '1') continue;
      await post(hook.url, body, hook.timeoutSec ?? 30);
      continue;
    }
    const out = spawnSync(hook.bash ?? hook.command, { shell: true, input: body, cwd, env: process.env, encoding: 'utf8', timeout: (hook.timeoutSec ?? 30) * 1000 });
    if (event !== 'preToolUse' || out.error || out.signal) continue;
    if (out.status !== 0) denied = true;
    try { if (JSON.parse(out.stdout || '{}').permissionDecision === 'deny') denied = true; } catch { /* not JSON */ }
  }
  return denied;
}

const [first] = args;
if (first === '--version' || first === '-v') {
  console.log('GitHub Copilot CLI 0.0.0-stand-in.');
} else if (args.includes('-p')) {
  const prompt = args[args.indexOf('-p') + 1];
  const toolArgs = { path: 'README.md' };
  const input = { sessionId: 'stand-in', timestamp: 1, cwd, toolName: 'view', toolArgs: JSON.stringify(toolArgs) };
  let text = '';
  if (/view tool/i.test(prompt)) {
    console.log(JSON.stringify({ type: 'tool.execution_start', data: { toolCallId: 'c1', toolName: 'view' } }));
    const denied = await fire('preToolUse', input);
    if (denied) {
      console.log(JSON.stringify({ type: 'tool.execution_complete', data: { toolCallId: 'c1', success: false, error: { message: 'Denied by preToolUse hook: stand-in', code: 'denied' } } }));
    } else {
      text = fs.readFileSync(path.join(cwd, 'README.md'), 'utf8');
      console.log(JSON.stringify({ type: 'tool.execution_complete', data: { toolCallId: 'c1', success: true, result: { content: text } } }));
      await fire('postToolUse', input);
    }
  }
  console.log(JSON.stringify({ type: 'assistant.message', data: { content: text ? `The word: ${text}` : 'I could not read it.' } }));
  console.log(JSON.stringify({ type: 'result', sessionId: 'stand-in', exitCode: 0, usage: { premiumRequests: 0 } }));
} else {
  console.error(`The stand-in does not know: ${args.join(' ')}`);
  process.exit(2);
}
