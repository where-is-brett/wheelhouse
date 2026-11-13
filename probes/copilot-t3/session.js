// probes/copilot-t3/session.js
// One `copilot -p` run of the trial, started from a call the Copilot adapter built (adapters/copilot/sessions.js): its output
// goes to the call's activity file, so the run can be watched while it goes, killed, and read afterwards with the same readers
// the waker uses (scripts/agents/copilot/run-output.js).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { eventsOf, sessionUsage } from '../../scripts/agents/copilot/run-output.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Starts `call` ({ file, args, env, input, verbatim, output, usageFile, sessionId }) in `cwd`. Resolves at once with a handle:
// `done` settles with { code, signal, killed } when the process ends; `read()` is what it has written so far.
// On Windows a run is started through cmd.exe, so ending the direct child leaves Copilot running: the whole tree of the process
// the runner itself started goes, by its id.
export function killTreeOnWindows(pid) {
  const got = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  return got.status === 0;
}

export function startRun(call, { cwd, platform = process.platform, killTree = killTreeOnWindows }) {
  fs.mkdirSync(path.dirname(call.output), { recursive: true });
  const out = fs.openSync(call.output, 'w');
  const child = spawn(call.file, call.args, { cwd, env: call.env, stdio: ['pipe', out, out], windowsVerbatimArguments: call.verbatim === true });
  fs.closeSync(out);
  let killed = false;
  const done = new Promise((resolve) => {
    child.on('error', () => resolve({ code: null, signal: null, killed, failed: true }));
    child.on('close', (code, signal) => resolve({ code, signal, killed }));
  });
  child.stdin.on('error', () => {});
  child.stdin.end(call.input ?? '');
  return {
    pid: child.pid,
    sessionId: call.sessionId,
    usageFile: call.usageFile,
    output: call.output,
    done,
    read: () => { try { return fs.readFileSync(call.output, 'utf8'); } catch { return ''; } },
    kill() {
      killed = true;
      if (platform === 'win32' && child.pid !== undefined && killTree(child.pid)) return;
      try { child.kill('SIGKILL'); } catch { /* already ended */ }
    },
  };
}

// The tool calls a run's output shows as ended: the sign a task is under way, not only started.
export const toolsEnded = (stdout) => eventsOf(stdout).filter((e) => e.type === 'tool.execution_complete').length;

// Waits until the run has finished `after` tool calls (mid-task), or ends, or `timeoutMs` passes. Resolves with
// { reached, ended, tools }.
export async function waitMidTask(handle, { after = 1, timeoutMs = 10 * 60 * 1000, pollMs = 500 } = {}) {
  let ended = false;
  handle.done.then(() => { ended = true; });
  const stop = Date.now() + timeoutMs;
  for (;;) {
    const tools = toolsEnded(handle.read());
    if (tools >= after) return { reached: true, ended, tools };
    if (ended || Date.now() >= stop) return { reached: false, ended, tools };
    await sleep(pollMs);
  }
}

// What a finished (or killed) run says: the session's figure as the CLI counts it (null when it left none), and its events.
export function readRun(handle) {
  const stdout = handle.read();
  const usage = sessionUsage({ usageFile: handle.usageFile, stdout });
  const events = eventsOf(stdout);
  return {
    cumulative: usage.premiumRequests ?? liveRequests(stdout) ?? usage.totalPremiumRequestCost ?? null,
    finished: events.some((e) => e.type === 'result'),
    events,
    // Tool calls to the `task` tool start a subagent (check 96); the run's own count says whether those were charged.
    subagents: events.filter((e) => e.type === 'tool.execution_start' && e.data?.toolName === 'task').length,
    tools: toolsEnded(stdout),
  };
}

// The requests a run has spent so far, as its own output says: the latest usage checkpoint's premium request cost, or the result's
// count once it ends. null while the output holds neither.
export function liveRequests(stdout) {
  let spent = null;
  for (const e of eventsOf(stdout)) {
    const n = e.type === 'result' ? e.usage?.premiumRequests : e.type === 'session.usage_checkpoint' ? (e.data?.accountingSnapshot?.totalPremiumRequestCost ?? e.data?.totalPremiumRequestCost) : undefined;
    if (Number.isFinite(n)) spent = n;
  }
  return spent;
}

// Watches a run's spend and kills it when the session's figure reaches `cumulativeCap`. Resolves with { capped } when the run ends.
export async function holdToCap(handle, { cumulativeCap, pollMs = 200 }) {
  let ended = false;
  handle.done.then(() => { ended = true; });
  let capped = false;
  while (!ended) {
    const spent = liveRequests(handle.read());
    if (spent !== null && spent >= cumulativeCap) {
      capped = true;
      handle.kill();
      break;
    }
    await sleep(pollMs);
  }
  return { capped };
}
