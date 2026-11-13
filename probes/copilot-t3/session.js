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

// Whether any process of the group `pgid` is still there. Only ever asked of a group the runner started itself.
const groupAlive = (pgid) => {
  try { process.kill(-pgid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

// Ends the process group `pgid` (a child the runner spawned detached, so it leads its own group): SIGTERM, then SIGKILL once
// `graceMs` has passed with the group still there. Resolves when no process of the group is left (or `waitMs` has run out).
export async function endGroup(pgid, { graceMs = 1500, waitMs = 5000, pollMs = 25 } = {}) {
  if (!Number.isInteger(pgid) || pgid <= 1) return;
  try { process.kill(-pgid, 'SIGTERM'); } catch { return; }
  const stop = Date.now() + waitMs;
  let killedHard = false;
  const termBy = Date.now() + graceMs;
  while (groupAlive(pgid) && Date.now() < stop) {
    if (!killedHard && Date.now() >= termBy) {
      try { process.kill(-pgid, 'SIGKILL'); } catch { /* already gone */ }
      killedHard = true;
    }
    await sleep(pollMs);
  }
}

export function startRun(call, { cwd, platform = process.platform, killTree = killTreeOnWindows, graceMs }) {
  fs.mkdirSync(path.dirname(call.output), { recursive: true });
  const out = fs.openSync(call.output, 'w');
  // Off Windows the run leads its own process group, so a kill reaches whatever it started too.
  const grouped = platform !== 'win32';
  const child = spawn(call.file, call.args, { cwd, env: call.env, stdio: ['pipe', out, out], detached: grouped, windowsVerbatimArguments: call.verbatim === true });
  fs.closeSync(out);
  let killed = false;
  let ended = false;
  let ending = null;
  // `done` settles only once the killed run's whole group has gone, so a resume never starts beside the first run's leftovers.
  const done = new Promise((resolve) => {
    child.on('error', () => { ended = true; resolve({ code: null, signal: null, killed, failed: true }); });
    child.on('close', async (code, signal) => {
      ended = true;
      if (ending !== null) await ending;
      resolve({ code, signal, killed });
    });
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
      if (ended || child.pid === undefined) return;
      killed = true;
      if (!grouped) {
        if (killTree(child.pid)) return;
        try { child.kill('SIGKILL'); } catch { /* already ended */ }
        return;
      }
      ending ??= endGroup(child.pid, { graceMs });
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
    // The larger of the result's count and the checkpoints' cost, the figure the mid-run cap reads too, so a run is never settled
    // above the cap it was held to.
    cumulative: largest(usage.premiumRequests, liveRequests(stdout)) ?? usage.totalPremiumRequestCost ?? null,
    // Whether any usage checkpoint was seen: without one the cap could not be enforced while the run went.
    checkpoints: events.some((e) => e.type === 'session.usage_checkpoint'),
    finished: events.some((e) => e.type === 'result'),
    events,
    // Tool calls to the `task` tool start a subagent (check 96); the run's own count says whether those were charged.
    subagents: events.filter((e) => e.type === 'tool.execution_start' && e.data?.toolName === 'task').length,
    tools: toolsEnded(stdout),
  };
}

const largest = (...values) => {
  const counts = values.filter((n) => Number.isFinite(n));
  return counts.length === 0 ? null : Math.max(...counts);
};

// The requests a run has spent so far, as its own output says: the largest of the usage checkpoints' premium request costs and the
// result's count. null while the output holds neither.
export function liveRequests(stdout) {
  let spent = null;
  for (const e of eventsOf(stdout)) {
    const n = e.type === 'result' ? e.usage?.premiumRequests : e.type === 'session.usage_checkpoint' ? (e.data?.accountingSnapshot?.totalPremiumRequestCost ?? e.data?.totalPremiumRequestCost) : undefined;
    if (Number.isFinite(n)) spent = spent === null ? n : Math.max(spent, n);
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
