// probes/69-guards-without-node/run.js
// Check 69: can a Copilot guard work with no Node.js on the machine's PATH, and what does a Copilot web hook do?
// The session is started with a PATH of its own: a scratch folder holding symlinks to only the tools the guard
// needs (sh, bash, curl, git, cat, date, sed, tr, env) and to Copilot itself. The npm `copilot` launcher is a
// `#!/usr/bin/env node` script, so the symlink points at the native program inside the platform package
// (node_modules/@github/copilot-<platform>-<arch>/copilot), which does not need Node.js. The hook logs
// `command -v node` for each call, which shows whether Node.js was on the hook's PATH.
// The guard under test is guard.sh (/bin/sh). It posts the hook input with curl to an answer server that this
// process runs on 127.0.0.1 (the stand-in for Lean's local answer), and refuses when it gets no answer.
// Runs, each a fresh Copilot with a scratch home, one model run each; every run asks the session to view
// README.md (the secret word shows whether the call went through) and says to stop if it is refused:
//   guard-allow   command hook; the server answers allow
//   guard-deny    command hook; the server answers deny
//   guard-down    command hook; nothing is listening (curl fails), so the guard must refuse
//   web-up        web hooks (type http) for preToolUse and postToolUse at http://127.0.0.1:<port>, with
//                 COPILOT_HOOK_ALLOW_LOCALHOST=1; the preToolUse answer is deny, so a call that is refused
//                 means Copilot called it and obeyed. The server counts what it was called with.
//   web-down      the same web hooks with nothing listening
// Permissions: every run passes --allow-all-tools, --trust-folder and --no-ask-user, in a scratch project.
//
// Usage: node probes/69-guards-without-node/run.js              the trial, run from outside any sandbox
//        node probes/69-guards-without-node/run.js --dry-run    the same plumbing against a stand-in Copilot
// Options: --bin <path to the native Copilot program>, --timeout-ms <n> (one run, default 300000), --results-dir <dir>
//
// Model runs: 5. Everything it makes is under the temporary folder and is removed when it ends, also on Ctrl-C.
// It never reads or writes the real ~/.copilot or ~/.wheelhouse.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LOGIN_HOME, defaultPrefix, runCopilot, scratchCopilotHome } from '../lib/copilot.js';
import { assertUnderTmp, makeScratchProject } from '../lib/scratch.js';
import { hookLogLines } from '../56-registration/run.js';
import { toolOutcomes } from '../58-hook-input/run.js';

export const CHECK = '69-guards-without-node';
export const TOOLS = ['sh', 'bash', 'curl', 'git', 'cat', 'date', 'sed', 'tr', 'env'];
export const PROMPT = 'Use the view tool to view README.md and tell me its secret word. Use only that tool. If it is refused, say so and stop. Then say done.';
export const CASES = [
  { id: 'guard-allow', kind: 'guard', answer: 'allow' },
  { id: 'guard-deny', kind: 'guard', answer: 'deny' },
  { id: 'guard-down', kind: 'guard', answer: 'down' },
  { id: 'web-up', kind: 'web', answer: 'deny' },
  { id: 'web-down', kind: 'web', answer: 'down' },
];

const GUARD = fileURLToPath(new URL('./guard.sh', import.meta.url));
const FAKE = fileURLToPath(new URL('./fake-copilot.js', import.meta.url));

// ------------------------------------------------------------------ options

export function parseOptions(argv) {
  const options = { dryRun: false, bin: '', timeoutMs: 300_000, resultsDir: path.join(os.tmpdir(), 'wheelhouse-probe-results') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--bin') options.bin = argv[++i] ?? '';
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
    else if (arg === '--results-dir') options.resultsDir = argv[++i] ?? '';
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('--timeout-ms is a number of milliseconds');
  if (!options.resultsDir) throw new Error('--results-dir needs a folder');
  return options;
}

// ------------------------------------------------------- the PATH without Node.js

// The native Copilot program inside an npm prefix, which is run directly because the npm launcher needs Node.js.
export function nativeBin(prefix, { platform = process.platform, arch = process.arch } = {}) {
  return path.join(prefix, 'node_modules', '@github', `copilot-${platform}-${arch}`, platform === 'win32' ? 'copilot.exe' : 'copilot');
}

// The first executable called `name` in the `pathVariable` folders, or null.
export function findOnPath(name, pathVariable = process.env.PATH ?? '') {
  for (const dir of pathVariable.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      if (fs.statSync(candidate).isFile()) { fs.accessSync(candidate, fs.constants.X_OK); return candidate; }
    } catch { /* not here */ }
  }
  return null;
}

// A folder of symlinks to only `tools` (found on the current PATH) and `copilot` (the given program).
export function makeToolPath(dir, copilot, tools = TOOLS) {
  fs.mkdirSync(dir, { recursive: true });
  const linked = {};
  const missing = [];
  for (const name of tools) {
    const target = findOnPath(name);
    if (!target) { missing.push(name); continue; }
    fs.symlinkSync(target, path.join(dir, name));
    linked[name] = target;
  }
  fs.symlinkSync(copilot, path.join(dir, 'copilot'));
  linked.copilot = copilot;
  return { dir, linked, missing };
}

// What a shell with only that PATH finds: Node.js should be absent, the tools present.
export function proveNodeAbsent(binDir) {
  const script = 'printf "node=%s\\n" "$(command -v node)"; printf "npm=%s\\n" "$(command -v npm)"; printf "curl=%s\\n" "$(command -v curl)"; git --version';
  const result = spawnSync('/bin/sh', ['-c', script], { env: { PATH: binDir }, encoding: 'utf8', timeout: 30_000 });
  const field = (name) => (result.stdout.match(new RegExp(`^${name}=(.*)$`, 'm')) ?? [])[1] ?? '';
  return { node: field('node'), npm: field('npm'), curl: field('curl'), git: (result.stdout.match(/git version.*/) ?? [''])[0], nodeAbsent: field('node') === '' && field('npm') === '' };
}

// ------------------------------------------------------------ answer server

export const ANSWERS = {
  allow: '{"permissionDecision":"allow"}',
  deny: '{"permissionDecision":"deny","permissionDecisionReason":"The stand-in answer server says no."}',
};

// Answers on 127.0.0.1. POST /answer gives the current answer (allow or deny); /web-pre gives deny; /web-post gives {}.
// Every request is kept, to show who called and with what.
export function startAnswerServer() {
  const state = { answer: 'allow', requests: [] };
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      state.requests.push({ at: new Date().toISOString(), method: request.method, url: request.url, contentType: request.headers['content-type'] ?? null, body: body.slice(0, 2000) });
      const text = request.url === '/answer' ? ANSWERS[state.answer] ?? ANSWERS.deny : request.url === '/web-pre' ? ANSWERS.deny : '{}';
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(text);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, state }));
  });
}

// A port nothing listens on: one that was free a moment ago.
export function deadPort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// -------------------------------------------------------------- hook files

export function guardCommand({ guard = GUARD, url, log }) {
  return `/bin/sh "${guard}" "${url}" "${log}"`;
}

export function hookFiles({ kind, base, guard = GUARD, log }) {
  if (kind === 'guard') {
    return { 'probe-guard.json': { version: 1, hooks: { preToolUse: [{ type: 'command', bash: guardCommand({ guard, url: `${base}/answer`, log }), timeoutSec: 20 }] } } };
  }
  if (kind === 'web') {
    return {
      'probe-web.json': {
        version: 1,
        hooks: {
          preToolUse: [{ type: 'http', url: `${base}/web-pre`, timeoutSec: 5 }],
          postToolUse: [{ type: 'http', url: `${base}/web-post`, timeoutSec: 5 }],
        },
      },
    };
  }
  throw new Error(`Unknown hook kind: ${kind}`);
}

export function copilotArgs({ prompt = PROMPT, logDir }) {
  return ['-p', prompt, '--output-format', 'json', '--no-auto-update', '--disable-builtin-mcps', '--allow-all-tools', '--trust-folder', '--no-ask-user', '--log-dir', logDir, '--log-level', 'debug'];
}

// The environment a case adds to the session: the PATH without Node.js, and for web hooks the switch the
// reference names for http://127.* addresses.
export function caseEnv({ kind, binDir }) {
  return { PATH: binDir, ...(kind === 'web' ? { COPILOT_HOOK_ALLOW_LOCALHOST: '1' } : {}) };
}

// --------------------------------------------------------------- analysis

// The records guard.sh wrote: key=value lines, each record ended by a line holding "--".
export function parseGuardLog(text) {
  const records = [];
  let current = {};
  for (const line of String(text ?? '').split('\n')) {
    if (line === '--') { records.push(current); current = {}; continue; }
    const at = line.indexOf('=');
    if (at > 0) current[line.slice(0, at)] = line.slice(at + 1);
  }
  return records;
}

export function readGuardLog(file) {
  try { return parseGuardLog(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

// Whether the call went through, from the session's own words and events: the secret word in the output means
// the view was read; a tool call that failed with code denied means it was refused.
export function verdictOf({ secretSeen, outcomes }) {
  if (secretSeen) return 'went-through';
  if (outcomes.some((o) => o.code === 'denied')) return 'refused';
  return 'unclear';
}

export function countRequests(requests) {
  const counts = {};
  for (const request of requests) counts[request.url] = (counts[request.url] ?? 0) + 1;
  return counts;
}

const WARNING = /warn|error|hook/i;
export function warningEvents(events) {
  return events.filter((event) => WARNING.test(String(event?.type)) && !/tools_|mcp_server|tool\.execution/.test(String(event.type))).slice(0, 20);
}

// ---------------------------------------------------------------- summary

export function summarise(results) {
  const out = [];
  out.push(`Check ${CHECK}${results.dryRun ? ' (dry run, against a stand-in)' : ''}: ${results.runs.length} model run(s), Copilot ${results.copilotVersion || 'version unknown'}`);
  const proof = results.pathProof;
  if (proof) out.push(`PATH folder: node ${proof.nodeAbsent ? 'absent' : `FOUND at ${proof.node || proof.npm}`}; curl ${proof.curl ? 'present' : 'missing'}; ${proof.git || 'git missing'}${results.missingTools?.length ? `; not found on this machine: ${results.missingTools.join(', ')}` : ''}`);
  for (const run of results.runs) {
    out.push(`${run.id.padEnd(12)} exit ${String(run.code).padEnd(4)}${run.timedOut ? ' TIMED OUT' : ''} ${Math.round(run.durationMs / 1000)}s  verdict: ${run.verdict}`);
    out.push(`             outcomes: ${run.toolOutcomes.map((o) => `${o.tool}:${o.success ? 'ok' : o.code ?? 'failed'}`).join(' ') || 'none'}`);
    out.push(`             server saw: ${JSON.stringify(run.serverCounts)}`);
    if (run.kind === 'guard') {
      out.push(`             guard ran ${run.guardRecords.length} time(s); node on its PATH: ${run.guardRecords.map((r) => (r.node ? r.node : 'no')).join(',') || 'n/a'}; decisions: ${run.guardRecords.map((r) => `${r.decision}(curl ${r.curl_exit})`).join(' ') || 'none'}`);
    }
  }
  if (results.error) out.push(`STOPPED EARLY: ${String(results.error).split('\n')[0]}`);
  return out.join('\n');
}

// ------------------------------------------------------------------- main

function fakeBin(dir) {
  const bin = path.join(dir, 'fake-copilot');
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  return bin;
}

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export async function main(argv = process.argv.slice(2), { out = console.log, settleMs } = {}) {
  const options = parseOptions(argv);
  const settle = settleMs ?? (options.dryRun ? 0 : 1000);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-nonode-work-'));
  assertUnderTmp(work);
  const undo = [() => fs.rmSync(work, { recursive: true, force: true })];
  const cleanup = () => { for (const step of undo.splice(0).reverse()) { try { step(); } catch { /* keep undoing the rest */ } } };
  const onSignal = (signal) => { cleanup(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const results = {
    check: CHECK, dryRun: options.dryRun, startedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
    permissionFlags: ['--allow-all-tools', '--trust-folder', '--no-ask-user'],
    copilotVersion: '', bin: '', startedFrom: '', pathProof: null, linkedTools: {}, missingTools: [], runs: [], error: null,
  };

  try {
    const target = options.bin || (options.dryRun ? fakeBin(work) : nativeBin(defaultPrefix()));
    results.bin = target;
    if (!fs.existsSync(target)) throw new Error(`There is no Copilot program at ${target}. Install the pinned version first (installCopilot in probes/lib/copilot.js).`);
    const tools = makeToolPath(path.join(work, 'bin'), target);
    results.startedFrom = path.join(tools.dir, 'copilot');
    results.linkedTools = tools.linked;
    results.missingTools = tools.missing;
    results.pathProof = proveNodeAbsent(tools.dir);
    if (!results.pathProof.nodeAbsent) throw new Error(`Node.js is still on the session's PATH: ${results.pathProof.node || results.pathProof.npm}`);

    const answers = await startAnswerServer();
    undo.push(() => answers.server.close());
    const base = `http://127.0.0.1:${answers.port}`;
    const downBase = `http://127.0.0.1:${await deadPort()}`;

    const home = options.dryRun ? scratchCopilotHome() : scratchCopilotHome({ signedInFrom: LOGIN_HOME });
    undo.push(() => home.remove());
    const version = await runCopilot({ args: ['--version'], cwd: work, home: home.dir, bin: results.startedFrom, env: { PATH: tools.dir }, timeoutMs: 60_000 });
    results.copilotVersion = version.stdout.trim().split('\n')[0] ?? '';

    const secret = `secret-${crypto.randomBytes(4).toString('hex')}`;
    const project = await makeScratchProject({ name: 'nonode', files: { 'README.md': `Wheelhouse probe 69. The secret word is ${secret}.\n` } });
    const cwd = project.dir;
    undo.push(() => { assertUnderTmp(cwd); fs.rmSync(cwd, { recursive: true, force: true }); });
    const hooksDir = path.join(home.dir, 'hooks');
    const guardLog = path.join(work, 'guard.log');

    for (const testCase of CASES) {
      fs.rmSync(hooksDir, { recursive: true, force: true });
      fs.mkdirSync(hooksDir, { recursive: true });
      const hookBase = testCase.answer === 'down' ? downBase : base;
      const files = hookFiles({ kind: testCase.kind, base: hookBase, log: guardLog });
      for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(hooksDir, name), JSON.stringify(data, null, 2) + '\n');
      answers.state.answer = testCase.answer === 'allow' ? 'allow' : 'deny';
      answers.state.requests.length = 0;
      fs.writeFileSync(guardLog, '');
      const logDir = path.join(work, `copilot-log-${testCase.id}`);
      const args = copilotArgs({ logDir });
      const env = caseEnv({ kind: testCase.kind, binDir: tools.dir });
      const t0 = Date.now();
      const result = await runCopilot({ args, cwd, env, home: home.dir, bin: results.startedFrom, timeoutMs: options.timeoutMs });
      await sleep(settle);
      const outcomes = toolOutcomes(result.events);
      const secretSeen = result.stdout.includes(secret);
      const serverRequests = answers.state.requests.map((request) => ({ ...request }));
      results.runs.push({
        id: testCase.id, kind: testCase.kind, answer: testCase.answer, hookFiles: files, args, env: { PATH: env.PATH === tools.dir ? '[the tool folder]' : env.PATH, COPILOT_HOOK_ALLOW_LOCALHOST: env.COPILOT_HOOK_ALLOW_LOCALHOST ?? null },
        code: result.code, timedOut: result.timedOut, durationMs: Date.now() - t0, stdout: result.stdout, stderr: result.stderr,
        result: result.events.find((event) => event.type === 'result') ?? null,
        toolOutcomes: outcomes, secretSeen, verdict: verdictOf({ secretSeen, outcomes }),
        guardRecords: readGuardLog(guardLog), serverRequests, serverCounts: countRequests(serverRequests),
        warnings: warningEvents(result.events), copilotLogLines: hookLogLines(logDir),
      });
    }
  } catch (error) {
    results.error = error?.stack ?? String(error);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    cleanup();
    results.finishedAt = new Date().toISOString();
  }

  fs.mkdirSync(options.resultsDir, { recursive: true });
  const file = path.join(options.resultsDir, `${CHECK}${options.dryRun ? '.dry-run' : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
  out(summarise(results));
  out(`Raw results: ${file}`);
  return { results, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { results } = await main();
  if (results.error) process.exitCode = 1;
}
