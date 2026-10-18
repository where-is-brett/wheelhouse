// probes/27-sessions/trials.js
// Check 27: starting and waking sessions from a script. A plain Node.js
// script, outside any session, tries each documented way of starting a session
// and of sending one a one-line message, and times it. For each route:
//   1. start a fresh session in a scratch project: "write pong-1 to pong.txt",
//      permission mode acceptEdits, a named model; time until the file appears.
//   2. start a second session in a separate worktree of that project.
//   3. send the second session a one-line message asking for pong-2; time it.
//   4. start a third fresh session and check from its transcript that it
//      carries nothing of the first two.
// The routes:
//   print   claude -p, one process per message; the wake resumes the session by id.
//   stream  claude -p --input-format stream-json, one process the script holds
//           open; the wake is a line written to its input.
//   bg      claude --bg (the background-session service); the wake is
//           claude --resume <id> --bg "<message>" after claude stop <id>.
//           Extra step: the same wake without stopping first.
// The model is never written into the repository: pass it as --model <name> or
// set WHEELHOUSE_PROBE_MODEL.
// Usage: node probes/27-sessions/trials.js --model <name> [--routes print,stream,bg]
//          [--setting-sources project,local] [--wait-for-trust] [--worktrees-of <repo>] [--pause-at-end] [--inherit-env]
// The bg route needs a folder Claude Code already trusts, and a script cannot accept the
// trust prompt. A scratch folder needs it accepted once by hand (--wait-for-trust waits for
// that); --worktrees-of <repo> instead makes the scratch project a detached worktree of a
// repository that is already trusted (trust is keyed on the main checkout).
// Needs the `claude` command (the harness finds it; on Windows as claude.exe or
// claude.cmd). Prints a line for each trial and a final PASS or FAIL line; the
// log (times, tokens, session ids; no transcript text) goes to
// <home>/.wheelhouse-probes/27-sessions/. Real sessions cost tokens.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from '../../scripts/lib/run.js';
import { resolveClaude, invocation, parseStream, missingFlags } from '../../scripts/eval/harness.js';
import { appendJsonl, probeLogDir } from '../lib/log.js';
import { assertUnderTmp, makeScratchProject } from '../lib/scratch.js';

export const PERMISSION_MODE = 'acceptEdits';
export const ROUTES = ['print', 'stream', 'bg'];
export const MESSAGES = {
  first: 'write pong-1 to pong.txt',
  second: 'write pong-2 to pong.txt',
  third: 'write pong-3 to pong-3.txt',
  extra: 'write pong-2b to pong-2b.txt',
};
const STEP_TIMEOUT_MS = 3 * 60 * 1000;
const POLL_MS = 50;
// --max-turns is left out: Claude Code does not list it in --help yet accepts it (see scripts/eval/harness.js).
const NEEDED_FLAGS = ['--print', '--output-format', '--input-format', '--verbose', '--permission-mode', '--setting-sources', '--model', '--resume', '--bg'];

// ------------------------------------------------------------------ options

export function parseOptions(argv, env = process.env) {
  const options = {
    model: env.WHEELHOUSE_PROBE_MODEL || '',
    routes: ROUTES,
    settingSources: 'project,local',
    waitForTrust: false,
    worktreesOf: '',
    pauseAtEnd: false,
    inheritEnv: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    let arg = argv[i];
    let value;
    const equals = arg.indexOf('=');
    if (arg.startsWith('--') && equals > 0) {
      value = arg.slice(equals + 1);
      arg = arg.slice(0, equals);
    }
    if (arg === '--model') {
      options.model = value ?? argv[++i] ?? '';
    } else if (arg === '--routes') {
      options.routes = (value ?? argv[++i] ?? '').split(',').filter(Boolean);
      const unknown = options.routes.filter((route) => !ROUTES.includes(route));
      if (unknown.length || !options.routes.length) throw new Error(`--routes takes some of ${ROUTES.join(', ')}, not ${unknown.join(', ') || 'nothing'}`);
    } else if (arg === '--setting-sources') {
      options.settingSources = value ?? argv[++i] ?? '';
    } else if (arg === '--wait-for-trust') {
      options.waitForTrust = true;
    } else if (arg === '--worktrees-of') {
      options.worktreesOf = value ?? argv[++i] ?? '';
    } else if (arg === '--pause-at-end') {
      options.pauseAtEnd = true;
    } else if (arg === '--inherit-env') {
      options.inheritEnv = true;
    } else {
      throw new Error(`Unknown option ${arg}`);
    }
  }
  if (!options.model) throw new Error('Name the model: --model <name>, or set WHEELHOUSE_PROBE_MODEL. It is not written into the repository.');
  if (!/^[\w.[\]:-]+$/.test(options.model) || options.model.startsWith('-')) throw new Error(`That does not look like a model name: ${options.model}`);
  if (!/^(user|project|local)(,(user|project|local))*$/.test(options.settingSources)) throw new Error('--setting-sources takes user, project and local, comma-separated');
  return options;
}

// A session started from inside another Claude Code session inherits that
// session's own variables, which change how it behaves (a host-supplied
// gateway, bare mode). The trials start sessions the way a terminal would:
// those variables are taken out, except the one that moves the configuration
// folder. `--inherit-env` keeps them.
export function strippedNames(env) {
  return Object.keys(env).filter((name) => /^(claude|anthropic_base_url)/i.test(name) && name.toUpperCase() !== 'CLAUDE_CONFIG_DIR');
}

export function makeEnv({ inherit = false, base = process.env } = {}) {
  if (inherit) return { overrides: {}, full: { ...base } };
  const drop = new Set(strippedNames(base));
  return {
    overrides: Object.fromEntries([...drop].map((name) => [name, undefined])),
    full: Object.fromEntries(Object.entries(base).filter(([name]) => !drop.has(name))),
  };
}

// ----------------------------------------------------------- files and times

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function readTrimmed(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

// Milliseconds from `startedAt` until `file` holds exactly `expected`; null if
// that does not happen in `timeoutMs`, or once `gaveUp()` says nothing more is coming.
export async function waitForText(file, expected, { startedAt = Date.now(), timeoutMs = STEP_TIMEOUT_MS, gaveUp = () => false } = {}) {
  for (;;) {
    if (readTrimmed(file) === expected) return Date.now() - startedAt;
    if (gaveUp()) return readTrimmed(file) === expected ? Date.now() - startedAt : null;
    if (Date.now() - startedAt > timeoutMs) return null;
    await sleep(POLL_MS);
  }
}

export function seconds(ms) {
  return ms === null || ms === undefined ? 'n/a' : `${(ms / 1000).toFixed(1)} s`;
}

// ----------------------------------------------------------------- transcripts

export function configDir(env = process.env, home = os.homedir()) {
  return env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
}

// The transcript file for a session id, found in whichever project folder holds it.
export function findTranscript(sessionId, dir = configDir()) {
  const projects = path.join(dir, 'projects');
  let folders;
  try {
    folders = fs.readdirSync(projects, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const file = path.join(projects, folder.name, `${sessionId}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

export function parseTranscript(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch { /* a half-written last line */ }
  }
  return entries;
}

// Tokens a session used, summed from its transcript: what it read (fresh,
// cache-written and cache-read input) and what it wrote, once for each model reply.
export function transcriptUsage(entries) {
  const seen = new Set();
  const total = { input: 0, output: 0 };
  for (const entry of entries) {
    if (entry.type !== 'assistant' || !entry.message?.usage) continue;
    const key = entry.message.id ?? entry.uuid;
    if (seen.has(key)) continue;
    seen.add(key);
    const usage = entry.message.usage;
    total.input += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    total.output += usage.output_tokens ?? 0;
  }
  return total;
}

export function subtractUsage(total, before) {
  return { input: Math.max(0, total.input - before.input), output: Math.max(0, total.output - before.output) };
}

function promptText(entry) {
  const content = entry.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.some((block) => block.type === 'tool_result')) return null;
  return content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
}

// The third session must carry nothing of the first two sessions' conversations:
// its own id on every entry that has one, one prompt of its own, and none of the
// other sessions' ids or prompts anywhere in what was said. Files the others left
// in the folder are not conversation: the session may read them.
export function judgeFresh({ entries, sessionId, otherIds, markers, prompt }) {
  if (!entries.length) return { pass: false, why: 'the transcript is empty or missing' };
  const foreign = entries.filter((entry) => entry.sessionId && entry.sessionId !== sessionId);
  if (foreign.length) return { pass: false, why: `${foreign.length} entries belong to another session` };
  const conversation = entries.filter((entry) => entry.type === 'user' || entry.type === 'assistant');
  const prompts = conversation.filter((entry) => entry.type === 'user' && !entry.isMeta).map(promptText).filter((text) => text !== null);
  if (prompts.length !== 1) return { pass: false, why: `${prompts.length} prompts, not 1` };
  if (prompts[0] !== prompt) return { pass: false, why: 'its one prompt is not the one it was given' };
  const said = JSON.stringify(conversation.map((entry) => entry.message));
  const leaked = [...otherIds, ...markers].filter((needle) => said.includes(needle));
  if (leaked.length) return { pass: false, why: `its conversation mentions ${leaked.join(', ')}` };
  return { pass: true, why: 'its own id on every entry, one prompt, and none of the first two sessions\' ids or prompts' };
}

// ----------------------------------------------------------------- running claude

function claudeCall(ctx, { args, prompt }) {
  return invocation(ctx.resolved, [], args, prompt);
}

function runClaude(ctx, { args, prompt, cwd, timeoutMs = 4 * 60 * 1000 }) {
  const call = claudeCall(ctx, { args, prompt });
  return run(call.file, call.args, { cwd, env: ctx.env.overrides, input: call.input, timeoutMs, windowsVerbatimArguments: call.verbatim });
}

function baseFlags(ctx) {
  return ['--permission-mode', PERMISSION_MODE, '--model', ctx.options.model, '--setting-sources', ctx.options.settingSources];
}

function resultUsage(result) {
  const usage = result?.usage ?? {};
  return {
    input: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    output: usage.output_tokens ?? 0,
  };
}

function summarise(result) {
  const events = parseStream(result.stdout);
  const final = events.findLast((event) => event.type === 'result');
  const init = events.find((event) => event.type === 'system' && event.subtype === 'init');
  return {
    exitCode: result.code,
    timedOut: result.timedOut === true,
    sessionId: init?.session_id ?? final?.session_id ?? null,
    usage: resultUsage(final),
    isError: final?.is_error === true,
    stderr: result.stderr.trim().slice(-300),
  };
}

function killTree(child) {
  if (process.platform === 'win32' && Number.isInteger(child.pid)) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
    } catch { /* already gone */ }
  }
  child.kill('SIGKILL');
}

// ------------------------------------------------------------------- the routes

// print: one claude -p process for each message.
const printRoute = {
  name: 'print',
  async start(ctx, { dir, prompt }) {
    const startedAt = Date.now();
    const args = [...baseFlags(ctx), '--output-format', 'stream-json', '--verbose', '--max-turns', '10'];
    const handle = { startedAt, exited: false };
    handle.finished = runClaude(ctx, { args, prompt, cwd: dir }).then((result) => {
      handle.exited = true;
      handle.exitedAt = Date.now();
      return summarise(result);
    });
    handle.gaveUp = () => handle.exited;
    return handle;
  },
  async settle(ctx, handle) {
    const summary = await handle.finished;
    handle.sessionId = summary.sessionId;
    return { sessionId: summary.sessionId, usage: summary.usage, msToExit: handle.exitedAt - handle.startedAt, exitCode: summary.exitCode, note: summary.stderr };
  },
  // Resumes the session by its id with a new -p prompt: a new process, the same session.
  async wake(ctx, handle, { dir, message }) {
    const startedAt = Date.now();
    const args = ['--resume', handle.sessionId, ...baseFlags(ctx), '--output-format', 'stream-json', '--verbose', '--max-turns', '10'];
    const wake = { startedAt, exited: false };
    wake.finished = runClaude(ctx, { args, prompt: message, cwd: dir }).then((result) => {
      wake.exited = true;
      wake.exitedAt = Date.now();
      return summarise(result);
    });
    wake.gaveUp = () => wake.exited;
    wake.settle = async () => {
      const summary = await wake.finished;
      return { sessionId: summary.sessionId, usage: summary.usage, msToExit: wake.exitedAt - startedAt, exitCode: summary.exitCode, sameSession: summary.sessionId === handle.sessionId, note: summary.stderr };
    };
    return wake;
  },
  async finish() {},
};

// stream: one claude -p process the script keeps open; messages go to its input.
const streamRoute = {
  name: 'stream',
  async start(ctx, { dir, prompt }) {
    const startedAt = Date.now();
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', ...baseFlags(ctx), '--max-turns', '10'];
    const call = claudeCall(ctx, { args });
    const child = spawn(call.file, call.args, {
      cwd: dir,
      env: ctx.env.full,
      windowsHide: true,
      windowsVerbatimArguments: call.verbatim,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const handle = { startedAt, child, results: [], sessionId: null, exited: false, stderr: '' };
    let buffered = '';
    child.stdout.on('data', (chunk) => {
      buffered += chunk.toString('utf8');
      let newline;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'system' && event.subtype === 'init') handle.sessionId = event.session_id;
        if (event.type === 'result') handle.results.push({ at: Date.now(), usage: resultUsage(event), isError: event.is_error === true });
      }
    });
    child.stderr.on('data', (chunk) => { handle.stderr = (handle.stderr + chunk.toString('utf8')).slice(-300); });
    handle.closed = new Promise((resolve) => {
      child.on('close', (code) => { handle.exited = true; handle.exitCode = code ?? 1; resolve(); });
      child.on('error', (error) => { handle.exited = true; handle.exitCode = 1; handle.stderr = error.message; resolve(); });
    });
    child.stdin.on('error', () => {});
    handle.send = (text) => child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })}\n`);
    handle.gaveUp = () => handle.exited;
    handle.send(prompt);
    return handle;
  },
  async settle(ctx, handle) {
    const turn = await waitForTurn(handle, 1);
    return { sessionId: handle.sessionId, usage: turn?.usage ?? { input: 0, output: 0 }, msToExit: null, exitCode: null, note: handle.exited ? handle.stderr : '' };
  },
  // Writes one line to the open process's input; the same process, the same session.
  async wake(ctx, handle, { message }) {
    const startedAt = Date.now();
    const turns = handle.results.length;
    handle.send(message);
    const wake = { startedAt, gaveUp: () => handle.exited };
    wake.settle = async () => {
      const turn = await waitForTurn(handle, turns + 1);
      return { sessionId: handle.sessionId, usage: turn?.usage ?? { input: 0, output: 0 }, msToExit: null, exitCode: null, sameSession: true, note: 'a result event usage as reported; it may be the running total' };
    };
    return wake;
  },
  async finish(ctx, handle) {
    handle.child.stdin.end();
    const timer = setTimeout(() => killTree(handle.child), 30000);
    await handle.closed;
    clearTimeout(timer);
  },
};

async function waitForTurn(handle, count) {
  const end = Date.now() + STEP_TIMEOUT_MS;
  while (handle.results.length < count && !handle.exited && Date.now() < end) await sleep(POLL_MS);
  return handle.results[count - 1] ?? null;
}

class NotTrusted extends Error {}

async function agentsJson(ctx) {
  const result = await runClaude(ctx, { args: ['agents', '--json', '--all'], cwd: os.tmpdir(), timeoutMs: 60000 });
  try {
    return JSON.parse(result.stdout);
  } catch {
    return [];
  }
}

// bg: claude --bg starts a session in the background-session service.
const bgRoute = {
  name: 'bg',
  async start(ctx, { dir, prompt, label }) {
    const startedAt = Date.now();
    const name = `probe27-${label}-${process.pid}`;
    const args = ['--bg', '--name', name, ...baseFlags(ctx), prompt];
    let result = await runClaude(ctx, { args, cwd: dir, timeoutMs: 120000 });
    if (result.code !== 0 && /not trusted/i.test(result.stdout + result.stderr) && ctx.options.waitForTrust && process.stdin.isTTY) {
      await askEnter(`Workspace not trusted. In another terminal, run claude in ${fs.realpathSync(dir)}, accept the trust prompt, quit, then press Enter here... `);
      result = await runClaude(ctx, { args, cwd: dir, timeoutMs: 120000 });
    }
    const text = (result.stdout + result.stderr).trim();
    if (result.code !== 0) {
      if (/not trusted/i.test(text)) throw new NotTrusted(text.split('\n')[0]);
      throw new Error(`claude --bg exited ${result.code}: ${text.slice(-300)}`);
    }
    const shortId = /backgrounded\s*·\s*([0-9a-f]{8})/.exec(text)?.[1] ?? null;
    ctx.backgrounded.add(shortId);
    return { startedAt, name, shortId, startCommandMs: Date.now() - startedAt, gaveUp: () => false, text };
  },
  async settle(ctx, handle) {
    const end = Date.now() + STEP_TIMEOUT_MS;
    let entry = null;
    while (Date.now() < end) {
      const entries = await agentsJson(ctx);
      entry = entries.find((candidate) => candidate.id === handle.shortId) ?? null;
      if (entry && ['done', 'failed', 'stopped'].includes(entry.state)) break;
      await sleep(1000);
    }
    handle.sessionId = entry?.sessionId ?? null;
    handle.state = entry?.state ?? null;
    const file = handle.sessionId ? findTranscript(handle.sessionId) : null;
    const usage = file ? transcriptUsage(parseTranscript(fs.readFileSync(file, 'utf8'))) : { input: 0, output: 0 };
    return { sessionId: handle.sessionId, usage, msToExit: null, exitCode: null, note: `start command took ${seconds(handle.startCommandMs)}; state ${handle.state}` };
  },
  // claude stop <id> first, so that the session is not alive; then
  // claude --resume <id> --bg "<message>" with no other flags, which wakes the
  // same session with the options it saved. `stopFirst: false` skips the stop.
  async wake(ctx, handle, { dir, message, stopFirst = true }) {
    const startedAt = Date.now();
    const notes = [];
    const file = handle.sessionId ? findTranscript(handle.sessionId) : null;
    const before = file ? transcriptUsage(parseTranscript(fs.readFileSync(file, 'utf8'))) : { input: 0, output: 0 };
    if (stopFirst) {
      const stopped = await runClaude(ctx, { args: ['stop', handle.shortId], cwd: dir, timeoutMs: 60000 });
      notes.push(`stop: ${(stopped.stdout + stopped.stderr).trim().split('\n')[0]}`);
    }
    const resumed = await runClaude(ctx, { args: ['--resume', handle.sessionId, '--bg', message], cwd: dir, timeoutMs: 120000 });
    const text = (resumed.stdout + resumed.stderr).trim();
    notes.push(`resume: ${text.split('\n').slice(0, 2).join(' / ')}`);
    const newId = /backgrounded\s*·\s*([0-9a-f]{8})/.exec(text)?.[1] ?? null;
    if (newId) ctx.backgrounded.add(newId);
    const wake = { startedAt, gaveUp: () => resumed.code !== 0 };
    wake.settle = async () => {
      const settled = newId ? await bgRoute.settle(ctx, { shortId: newId, startCommandMs: Date.now() - startedAt }) : null;
      // In place, the tokens this wake used are the transcript's growth; a copy carries the whole history, so its total is given.
      const usage = settled ? (newId === handle.shortId ? subtractUsage(settled.usage, before) : settled.usage) : { input: 0, output: 0 };
      return {
        sessionId: newId === handle.shortId ? handle.sessionId : settled?.sessionId ?? null,
        usage,
        msToExit: null,
        exitCode: resumed.code,
        sameSession: newId === handle.shortId,
        note: notes.join('; '),
      };
    };
    return wake;
  },
  async finish() {},
};

function askEnter(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, () => { rl.close(); resolve(); });
  });
}

// ------------------------------------------------------------------- the trials

async function git(dir, ...args) {
  const result = await run('git', args, { cwd: dir, input: '' });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
}

async function makeWorktree(project) {
  const dir = `${project.dir}-second`;
  assertUnderTmp(dir);
  await git(project.dir, 'worktree', 'add', '--detach', dir, 'HEAD');
  return dir;
}

// A scratch project that is a detached worktree of an already-trusted repository.
async function makeProjectFromRepo(repo, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wheelhouse-probe-sessions-${name}-`));
  assertUnderTmp(dir);
  await git(repo, 'worktree', 'add', '--detach', dir, 'HEAD');
  return {
    dir,
    async cleanup() {
      assertUnderTmp(dir);
      try { await git(repo, 'worktree', 'remove', '--force', dir); } catch { /* already gone */ }
      await fs.promises.rm(dir, { recursive: true, force: true });
    },
  };
}

async function removeWorktree(project, dir) {
  assertUnderTmp(dir);
  try { await git(project.dir, 'worktree', 'remove', '--force', dir); } catch { /* already gone */ }
  await fs.promises.rm(dir, { recursive: true, force: true });
}

function record(result) {
  return { ...result, at: new Date().toISOString() };
}

export async function runRoute(ctx, route) {
  const results = [];
  const base = { route: route.name, platform: process.platform, claude: ctx.version };
  const note = async (trial, name, fields) => {
    const entry = record({ ...base, trial, name, ...fields });
    results.push(entry);
    await appendJsonl(ctx.log, entry);
    const detail = [entry.why, trial === 2 && entry.sessionId ? `session ${entry.sessionId}` : null, entry.msToFile !== undefined ? `${seconds(entry.msToFile)} to the file` : null, entry.msToExit ? `${seconds(entry.msToExit)} to exit` : null, entry.usage ? `${entry.usage.input} in / ${entry.usage.output} out` : null].filter(Boolean).join('; ');
    console.log(`${route.name} ${trial} ${name}: ${entry.pass ? 'pass' : 'fail'} (${detail})`);
    return entry;
  };
  const project = ctx.options.worktreesOf
    ? await makeProjectFromRepo(ctx.options.worktreesOf, route.name)
    : await makeScratchProject({ name: `sessions-${route.name}`, files: { 'README.md': 'A scratch project for check 27.\n' } });
  const handles = [];
  let second = null;
  let worktree = null;
  try {
    worktree = await makeWorktree(project);

    // 1. a fresh session in the scratch project
    let first;
    try {
      first = await route.start(ctx, { dir: project.dir, prompt: MESSAGES.first, label: 'one' });
    } catch (error) {
      await note(1, 'start a session', { pass: false, why: error.message, blockedBy: error instanceof NotTrusted ? 'workspace trust' : 'start' });
      for (const [trial, name] of [[2, 'start a second in a worktree'], [3, 'wake it with a message'], [4, 'start a fresh third']]) await note(trial, name, { pass: false, why: 'not run: the first could not start' });
      return results;
    }
    handles.push(first);
    const file1 = path.join(project.dir, 'pong.txt');
    const msToFile1 = await waitForText(file1, 'pong-1', { startedAt: first.startedAt, gaveUp: first.gaveUp });
    const settled1 = await route.settle(ctx, first);
    await note(1, 'start a session', { pass: msToFile1 !== null, why: msToFile1 === null ? 'pong.txt never held pong-1' : 'pong.txt holds pong-1', msToFile: msToFile1, msToExit: settled1.msToExit, usage: settled1.usage, sessionId: settled1.sessionId, startCommandMs: first.startCommandMs, detail: settled1.note });

    // 2. a second session in a separate worktree
    second = await route.start(ctx, { dir: worktree, prompt: MESSAGES.first, label: 'two' });
    handles.push(second);
    const file2 = path.join(worktree, 'pong.txt');
    const msToFile2 = await waitForText(file2, 'pong-1', { startedAt: second.startedAt, gaveUp: second.gaveUp });
    const settled2 = await route.settle(ctx, second);
    await note(2, 'start a second in a worktree', { pass: msToFile2 !== null && worktree !== project.dir, why: msToFile2 === null ? 'the worktree\'s pong.txt never held pong-1' : 'the worktree\'s pong.txt holds pong-1', msToFile: msToFile2, msToExit: settled2.msToExit, usage: settled2.usage, sessionId: settled2.sessionId, startCommandMs: second.startCommandMs, detail: settled2.note });

    // 3. wake the second with a one-line message
    const wake = await route.wake(ctx, second, { dir: worktree, message: MESSAGES.second });
    const msToFile3 = await waitForText(file2, 'pong-2', { startedAt: wake.startedAt, gaveUp: wake.gaveUp });
    const settled3 = await wake.settle();
    const mainUntouched = readTrimmed(file1) === 'pong-1';
    await note(3, 'wake it with a message', {
      pass: msToFile3 !== null && mainUntouched,
      why: msToFile3 === null ? 'the worktree\'s pong.txt never held pong-2' : `the worktree's pong.txt holds pong-2, the project's still holds ${mainUntouched ? 'pong-1' : 'something else'}; ${settled3.sameSession ? 'the same session answered' : 'a different session answered (a copy)'}`,
      msToFile: msToFile3,
      msToExit: settled3.msToExit,
      usage: settled3.usage,
      sessionId: settled3.sessionId ?? second.sessionId,
      sameSession: settled3.sameSession,
      detail: settled3.note,
    });

    // 3b, bg only: the same wake without stopping the session first (once it is idle again)
    if (route.name === 'bg' && second.sessionId) {
      await route.settle(ctx, second);
      const extra = await route.wake(ctx, second, { dir: worktree, message: MESSAGES.extra, stopFirst: false });
      const msToExtra = await waitForText(path.join(worktree, 'pong-2b.txt'), 'pong-2b', { startedAt: extra.startedAt, gaveUp: extra.gaveUp });
      const settledExtra = await extra.settle();
      await note('3b', 'the same wake without stopping first (information only)', { pass: true, why: settledExtra.sameSession ? 'it woke the same session' : 'it started a copy under another id', msToFile: msToExtra, sameSession: settledExtra.sameSession, detail: settledExtra.note });
    }

    // 4. a fresh third session, checked from its transcript
    const third = await route.start(ctx, { dir: project.dir, prompt: MESSAGES.third, label: 'three' });
    handles.push(third);
    const msToFile4 = await waitForText(path.join(project.dir, 'pong-3.txt'), 'pong-3', { startedAt: third.startedAt, gaveUp: third.gaveUp });
    const settled4 = await route.settle(ctx, third);
    let fresh = { pass: false, why: 'no session id to find the transcript by' };
    if (settled4.sessionId) {
      const file = findTranscript(settled4.sessionId);
      const otherIds = [settled1.sessionId, settled2.sessionId, second.sessionId].filter(Boolean);
      fresh = file
        ? judgeFresh({ entries: parseTranscript(fs.readFileSync(file, 'utf8')), sessionId: settled4.sessionId, otherIds: [...new Set(otherIds)], markers: [MESSAGES.first, MESSAGES.second], prompt: MESSAGES.third })
        : { pass: false, why: 'its transcript file was not found' };
    }
    await note(4, 'start a fresh third', { pass: msToFile4 !== null && fresh.pass, why: msToFile4 === null ? 'pong-3.txt never held pong-3' : fresh.why, msToFile: msToFile4, msToExit: settled4.msToExit, usage: settled4.usage, sessionId: settled4.sessionId, startCommandMs: third.startCommandMs, detail: settled4.note });
    return results;
  } finally {
    if (ctx.options.pauseAtEnd && process.stdin.isTTY) {
      await askEnter(`Route ${route.name} is done; its sessions are still there to look at in Desktop. Press Enter to clean up... `);
    }
    for (const handle of handles) {
      try { await route.finish(ctx, handle); } catch { /* best effort */ }
    }
    await removeWorktree(project, worktree ?? `${project.dir}-second`).catch(() => {});
    await project.cleanup();
  }
}

// Stops and removes the background sessions the trials started (their
// transcripts stay on disk, as `claude rm` leaves them).
async function removeBackgrounded(ctx) {
  for (const id of ctx.backgrounded) {
    if (!id) continue;
    await runClaude(ctx, { args: ['stop', id], cwd: os.tmpdir(), timeoutMs: 60000 }).catch(() => {});
    await runClaude(ctx, { args: ['rm', id], cwd: os.tmpdir(), timeoutMs: 60000 }).catch(() => {});
  }
}

async function claudeVersion(resolved) {
  try {
    const call = invocation(resolved, [], ['--version']);
    const result = await run(call.file, call.args, { input: call.input, timeoutMs: 30000, windowsVerbatimArguments: call.verbatim });
    return result.stdout.trim() || result.stderr.trim();
  } catch (error) {
    return `unknown (${error.message})`;
  }
}

async function checkFlags(resolved, env) {
  const call = invocation(resolved, [], ['--help']);
  const result = await run(call.file, call.args, { env, input: call.input, timeoutMs: 60000, windowsVerbatimArguments: call.verbatim });
  const missing = missingFlags(result.stdout + result.stderr, NEEDED_FLAGS);
  if (missing.length) throw new Error(`This claude does not list the flags the trials need: ${missing.join(', ')}`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const resolved = resolveClaude();
  const env = makeEnv({ inherit: options.inheritEnv });
  await checkFlags(resolved, env.overrides);
  const version = await claudeVersion(resolved);
  const log = path.join(probeLogDir('27-sessions'), `trials-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const ctx = { options, resolved, env, version, log, backgrounded: new Set() };
  console.log(`Check 27, starting and waking sessions, on ${process.platform} with Claude Code ${version}`);
  console.log(`Routes: ${options.routes.join(', ')}; setting sources: ${options.settingSources}; ${options.inheritEnv ? 'environment inherited' : `${strippedNames(process.env).length} Claude variables left out of the sessions' environment`}`);
  const routes = { print: printRoute, stream: streamRoute, bg: bgRoute };
  const all = [];
  try {
    for (const name of options.routes) all.push(...await runRoute(ctx, routes[name]));
  } finally {
    await removeBackgrounded(ctx);
  }
  const failed = all.filter((entry) => !entry.pass);
  console.log(`Check 27 on ${process.platform}: ${failed.length ? 'FAIL' : 'PASS'} (${all.length - failed.length} of ${all.length} trials passed)`);
  console.log(`Log: ${log}`);
  return failed.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(`Check 27 on ${process.platform}: FAIL (${error.message})`); process.exitCode = 2; },
  );
}
