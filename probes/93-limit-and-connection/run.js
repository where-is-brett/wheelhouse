// probes/93-limit-and-connection/run.js
// Check 93 (early check U4): the failure kinds of a dropped connection and a limit, whether a failed run resumes, and
// whether a limit can bill rather than pause. It runs on its own scratch engine, with the provider's base address
// pointed at a stand-in on this computer. The stand-in passes calls on to the provider, or cuts the socket, or answers
// as a limit would. The computer's network is never touched, and no real limit is reached.
//
// Usage: node probes/93-limit-and-connection/run.js install
//        node probes/93-limit-and-connection/run.js trial [connection|blip|limit|paid|ask|all]
//        node probes/93-limit-and-connection/run.js clean
// Evidence goes to $TMPDIR/wheelhouse-archon-checks-93/evidence. The stand-in logs paths, modes and statuses, never a
// header or a body. The real spend is a few cents; the trial stops before a new leg once the runs have passed SPEND_CAP.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { archonEnv, archonRun, cleanScratch, installScratch, readEvents } from '../lib/archon.js';
import { run as defaultRun } from '../../scripts/lib/run.js';
import { startedAsScript } from '../../scripts/lib/started-as-script.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(os.tmpdir(), 'wheelhouse-archon-checks-93');
const EVIDENCE = path.join(ROOT, 'evidence');
const PROJECT = path.join(ROOT, 'project');
const PROVIDER = 'api.anthropic.com';
const WORKFLOWS = ['step.yaml', 'ask.yaml', 'ask-beside.yaml'];
const SPEND_CAP = 0.75;
// Long enough for the model CLI's own retries inside each of Archon's three attempts.
const FAIL_MS = 25 * 60 * 1000;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ---- The stand-in ------------------------------------------------------------------------------------------------

const isTurn = (req) => req.method === 'POST' && req.url.startsWith('/v1/messages') && !req.url.includes('count_tokens');

// The headers of a limit, by the names the model CLI reads. No limit was reached to record them.
export function limitHeaders({ resetAt = null, overage = 'rejected', overageInUse = false, status = 'rejected' } = {}) {
  return {
    'anthropic-ratelimit-unified-status': status,
    'anthropic-ratelimit-unified-representative-claim': 'five_hour',
    'anthropic-ratelimit-unified-overage-status': overage,
    ...(overage === 'rejected' ? { 'anthropic-ratelimit-unified-overage-disabled-reason': 'org_level_disabled' } : {}),
    ...(overageInUse ? { 'anthropic-ratelimit-unified-overage-in-use': 'true' } : {}),
    ...(resetAt ? { 'anthropic-ratelimit-unified-reset': String(resetAt) } : {}),
  };
}

// Modes: `pass` forwards all; `cut` forwards until a turn carries a tool's result, cuts that reply part-way and goes
// `down`; `blip` does the same and goes back to `pass`; `down` destroys every socket; `limit` answers each turn with a
// 429; `paid` forwards with the headers of a limit passed on to paid usage.
export function makeStandIn({ log = () => {}, upstream = https, host = PROVIDER } = {}) {
  const state = { mode: 'pass', resetAt: null, forwarded: 0 };
  const note = (req, what) => log({ at: new Date().toISOString(), mode: state.mode, method: req.method, path: req.url.split('?')[0], what });

  const forward = (req, res, body, { cutAfter = null, addHeaders = {} } = {}) => {
    state.forwarded += 1;
    const headers = { ...req.headers, host };
    delete headers.connection;
    const up = upstream.request({ host, port: 443, method: req.method, path: req.url, headers }, (reply) => {
      note(req, `forwarded ${reply.statusCode}`);
      res.writeHead(reply.statusCode, { ...reply.headers, ...addHeaders });
      let sent = 0;
      reply.on('data', (chunk) => {
        res.write(chunk);
        sent += chunk.length;
        if (cutAfter !== null && sent >= cutAfter) {
          note(req, `cut after ${sent} bytes`);
          up.destroy();
          res.socket?.destroy();
        }
      });
      reply.on('end', () => res.end());
      reply.on('error', () => res.socket?.destroy());
    });
    up.on('error', () => res.socket?.destroy());
    up.end(body);
  };

  const handle = (req, res, body) => {
    if (state.mode === 'down') { note(req, 'dropped'); req.socket.destroy(); return; }
    if (isTurn(req) && (state.mode === 'cut' || state.mode === 'blip') && body.includes('"tool_result"')) {
      forward(req, res, body, { cutAfter: 200 });
      state.mode = state.mode === 'cut' ? 'down' : 'pass';
      return;
    }
    if (isTurn(req) && state.mode === 'limit') {
      note(req, 'answered 429');
      res.writeHead(429, { 'content-type': 'application/json', 'request-id': 'req_standin', ...limitHeaders({ resetAt: state.resetAt }) });
      res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'Stand-in: this request would exceed the rate limit.' }, request_id: 'req_standin' }));
      return;
    }
    const paid = isTurn(req) && state.mode === 'paid';
    forward(req, res, body, paid ? { addHeaders: limitHeaders({ overage: 'allowed', overageInUse: true, resetAt: Math.floor(Date.now() / 1000) + 3600 }) } : {});
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => handle(req, res, Buffer.concat(chunks)));
    req.on('error', () => {});
  });
  return { state, server, listen: () => new Promise((done) => server.listen(0, '127.0.0.1', () => done(server.address().port))) };
}

// ---- The harness -------------------------------------------------------------------------------------------------

function git(cwd, args) {
  execFileSync('git', ['-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid', ...args], { cwd, stdio: 'ignore' });
}

function makeProject() {
  if (fs.existsSync(PROJECT)) return;
  const workflows = path.join(PROJECT, '.archon', 'workflows');
  fs.mkdirSync(workflows, { recursive: true });
  for (const file of WORKFLOWS) fs.copyFileSync(path.join(HERE, file), path.join(workflows, file));
  fs.writeFileSync(path.join(PROJECT, 'README.md'), '# Scratch project for check 93\n');
  git(PROJECT, ['init', '-q', '-b', 'main']);
  git(PROJECT, ['add', '-A']);
  git(PROJECT, ['commit', '-qm', 'Scratch project for check 93']);
  git(ROOT, ['init', '-q', '--bare', 'remote.git']);
  git(PROJECT, ['remote', 'add', 'origin', path.join(ROOT, 'remote.git')]);
  git(PROJECT, ['push', '-q', 'origin', 'main']);
}

async function context() {
  const bin = path.join(ROOT, 'bin', 'archon');
  if (!fs.existsSync(bin)) throw new Error(`No scratch engine at ${bin}: run install first`);
  fs.mkdirSync(EVIDENCE, { recursive: true });
  makeProject();
  const logFile = path.join(EVIDENCE, 'stand-in.jsonl');
  const standIn = makeStandIn({ log: (entry) => fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`) });
  const port = await standIn.listen();
  const env = archonEnv({ home: path.join(ROOT, 'home'), bunDir: path.join(ROOT, 'bun'), claudeBin: path.join(os.homedir(), '.local', 'bin', 'claude'), extra: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` } });
  const lines = [];
  const ctx = { bin, env, standIn, lines, procs: [] };
  ctx.follower = spawnLong(ctx, ['workflow', 'attention', '--watch', '--json', '--all'], 'stream.jsonl', (line) => lines.push(...readEvents([line])));
  ctx.waker = spawnLong(ctx, ['workflow', 'wake', '--watch', '--json'], 'waker.jsonl');
  await sleep(3000);
  return ctx;
}

function spawnLong(ctx, args, file, onLine = () => {}) {
  const child = spawn(ctx.bin, args, { cwd: PROJECT, env: ctx.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = path.join(EVIDENCE, file);
  readline.createInterface({ input: child.stdout }).on('line', (line) => { fs.appendFileSync(out, `${line}\n`); onLine(line); });
  child.stderr.on('data', (chunk) => fs.appendFileSync(out, `[stderr] ${chunk}`));
  ctx.procs.push(child);
  return child;
}

const archon = (ctx, args, timeoutMs = 120000) => archonRun(args, { env: ctx.env, bin: ctx.bin, cwd: PROJECT, timeoutMs });

async function start(ctx, workflow, branch) {
  const got = await archon(ctx, ['workflow', 'run', workflow, '--branch', branch, '--detach']);
  const id = /Run id:\s*([0-9a-f]+)/.exec(got.stdout)?.[1];
  if (!id) throw new Error(`No run id: ${got.stdout}${got.stderr}`);
  return id;
}

async function waitFor(test, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const found = await test();
    if (found) return found;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const forRun = (ctx, id, type) => ctx.lines.filter((line) => line.runId === id && line.type === type);
const waitLines = (ctx, id, type, count, ms = FAIL_MS) => waitFor(() => (forRun(ctx, id, type).length >= count ? forRun(ctx, id, type) : null), ms, `${count} ${type} line(s) on ${id}`);
const openAsk = (ctx, id, node) => [...ctx.lines].reverse().find((line) => line.type === 'attention' && line.item?.runId === id && line.item?.node === node);

async function record(ctx, id, name) {
  const got = await archon(ctx, ['workflow', 'get', id, '--json', '--verbose']);
  fs.writeFileSync(path.join(EVIDENCE, `${name}.json`), `${JSON.stringify(got.json, null, 2)}\n`);
  return got.json;
}

const spent = { total: 0 };
function guard(run) {
  spent.total = Math.max(spent.total, 0) + Number(run?.metadata?.total_cost_usd ?? 0);
  if (spent.total > SPEND_CAP) throw new Error(`Stopping: recorded spend is $${spent.total.toFixed(4)}`);
}

function summary(run) {
  return {
    id: run?.id, status: run?.status, workingPath: run?.working_path, stopReason: run?.metadata?.stop_reason, firstFailedNode: run?.metadata?.first_failed_node,
    cost: run?.metadata?.total_cost_usd, tokensIn: run?.metadata?.total_tokens_in, tokensOut: run?.metadata?.total_tokens_out,
    nodes: (run?.nodes ?? []).map((node) => ({ id: node.nodeId, state: node.state ?? node.status, attempts: node.attempts?.length, cost: node?.execution?.spend?.costUsd?.value ?? node?.spend?.costUsd?.value })),
  };
}

function read(file) {
  try { return fs.readFileSync(file, 'utf8').trim().split('\n'); } catch { return null; }
}

// A connection cut in the middle of a step's second turn, a resume while it is still down, and a resume once it is back.
async function connection(ctx) {
  ctx.standIn.state.mode = 'cut';
  const id = await start(ctx, 'u4-step', 'u4-connection');
  const [first] = await waitLines(ctx, id, 'terminal', 1);
  const atFirst = await record(ctx, id, 'connection-1-failed');
  guard(atFirst);
  const workingPath = atFirst.working_path;
  const artefacts = read(path.join(workingPath, 'artefacts-path.txt'))?.[0];
  const stampBefore = read(path.join(workingPath, 'step-one-stamp.txt'));

  ctx.standIn.state.mode = 'down';
  const secondLeg = await archon(ctx, ['workflow', 'resume', id, '--detach']);
  await waitLines(ctx, id, 'terminal', 2);
  const atSecond = await record(ctx, id, 'connection-2-failed');
  guard({ metadata: { total_cost_usd: Number(atSecond.metadata?.total_cost_usd ?? 0) - Number(atFirst.metadata?.total_cost_usd ?? 0) } });

  ctx.standIn.state.mode = 'pass';
  const thirdLeg = await archon(ctx, ['workflow', 'resume', id, '--detach']);
  await waitLines(ctx, id, 'terminal', 3, 5 * 60 * 1000);
  const end = await record(ctx, id, 'connection-3-ended');
  guard({ metadata: { total_cost_usd: Number(end.metadata?.total_cost_usd ?? 0) - Number(atSecond.metadata?.total_cost_usd ?? 0) } });

  const replayFile = path.join(EVIDENCE, 'replay.jsonl');
  const cursor = first.cursor;
  const before = ctx.lines.find((line) => line.cursor)?.cursor;
  const replayLines = [];
  const replay = spawnLong(ctx, ['workflow', 'attention', '--watch', '--json', '--all', '--after', before], 'replay.jsonl', (line) => replayLines.push(...readEvents([line])));
  await sleep(15000);
  replay.kill('SIGKILL');
  const inspect = await archon(ctx, ['workflow', 'get', id]);
  fs.writeFileSync(path.join(EVIDENCE, 'connection-inspect.txt'), `${inspect.stdout}\n${inspect.stderr}`);
  return {
    id, first, firstCursor: cursor, atFirst: summary(atFirst), atSecond: summary(atSecond), end: summary(end),
    terminals: forRun(ctx, id, 'terminal'), resumed: forRun(ctx, id, 'resumed'),
    resumeOutput: [secondLeg.stdout.slice(0, 500), thirdLeg.stdout.slice(0, 500)],
    sameArtefacts: artefacts, ranLog: read(path.join(artefacts ?? '', 'ran.log')), ticketRead: read(path.join(end.working_path ?? workingPath, 'ticket-read.txt')),
    thinkRan: read(path.join(end.working_path ?? workingPath, 'think-ran.txt')), stampKept: JSON.stringify(stampBefore) === JSON.stringify(read(path.join(workingPath, 'step-one-stamp.txt'))),
    samePath: end.working_path === workingPath, replayFile, replayTerminals: replayLines.filter((line) => line.type === 'terminal' && line.runId === id), replayResumed: replayLines.filter((line) => line.type === 'resumed' && line.runId === id),
  };
}

// A connection cut once in a step's second turn, and back at once.
async function blip(ctx) {
  ctx.standIn.state.mode = 'blip';
  const id = await start(ctx, 'u4-step', `u4-blip-${Date.now()}`);
  const [terminal] = await waitLines(ctx, id, 'terminal', 1, 10 * 60 * 1000);
  const end = await record(ctx, id, 'blip-ended');
  guard(end);
  return { terminal, end: summary(end), thinkRan: read(path.join(end.working_path, 'think-ran.txt')) };
}

// A limit with no reset, then a limit with one. Nothing reaches the provider until the resume.
async function limit(ctx) {
  ctx.standIn.state.mode = 'limit';
  ctx.standIn.state.resetAt = null;
  const id = await start(ctx, 'u4-step', 'u4-limit-no-reset');
  const [terminal] = await waitLines(ctx, id, 'terminal', 1);
  const failed = await record(ctx, id, 'limit-no-reset');
  ctx.standIn.state.mode = 'pass';
  await archon(ctx, ['workflow', 'resume', id, '--detach']);
  await waitLines(ctx, id, 'terminal', 2, 5 * 60 * 1000);
  const end = await record(ctx, id, 'limit-no-reset-resumed');
  guard(end);

  ctx.standIn.state.mode = 'limit';
  ctx.standIn.state.resetAt = Math.floor(Date.now() / 1000) + 120;
  const reset = await start(ctx, 'u4-step', 'u4-limit-reset');
  const item = await waitFor(() => ctx.lines.find((line) => line.type === 'attention' && line.item?.runId === reset && line.item?.kind === 'usage_limit'), 5 * 60 * 1000, 'the usage_limit item');
  const paused = await record(ctx, reset, 'limit-reset-paused');
  ctx.standIn.state.mode = 'pass';
  await waitLines(ctx, reset, 'terminal', 1, 8 * 60 * 1000);
  const ended = await record(ctx, reset, 'limit-reset-ended');
  guard(ended);
  return { noReset: { terminal, failed: summary(failed), end: summary(end) }, reset: { item, paused: summary(paused), end: summary(ended), resolved: forRun(ctx, reset, 'resolved'), resumed: forRun(ctx, reset, 'resumed') } };
}

// A turn answered with the headers of paid usage in force: does anything stop, and does the record show it? Then the
// same through the model CLI alone, to see what it tells Archon.
async function paid(ctx) {
  ctx.standIn.state.mode = 'paid';
  const id = await start(ctx, 'u4-step', `u4-paid-${Date.now()}`);
  const [terminal] = await waitLines(ctx, id, 'terminal', 1, 5 * 60 * 1000);
  const end = await record(ctx, id, 'paid-ended');
  guard(end);
  const log = path.join(ctx.env.ARCHON_HOME, 'logs', `detached-run-${id}.log`);
  const model = end.metadata?.model_bindings?.effective?.aliases?.small?.model;
  const direct = await defaultRun(ctx.env.CLAUDE_BIN_PATH, ['-p', 'Reply with the single word ok.', '--model', model, '--output-format', 'stream-json', '--verbose', '--setting-sources', '', '--max-budget-usd', '0.05'], { cwd: PROJECT, env: ctx.env, baseEnv: {}, timeoutMs: 120000 });
  const events = readEvents(direct.stdout).filter((line) => line.type === 'rate_limit_event');
  ctx.standIn.state.mode = 'pass';
  return { terminal, end: summary(end), asks: forRun(ctx, id, 'attention').length, inRecord: JSON.stringify(end).match(/overage/gi)?.length ?? 0, inLog: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').match(/rate_limit_event/g)?.length ?? 0 : null, direct: { code: direct.code, events } };
}

// Whether an ask after a resume, or the same ask met again, has a new occurrence.
async function ask(ctx) {
  const answer = (id, node) => waitFor(() => openAsk(ctx, id, node), 60000, `the ask ${node}`).then(async (line) => {
    const got = await archon(ctx, ['workflow', 'answer', id, '--occurrence', line.item.occurrence, '--choose', 'a', '--json']);
    return { node, occurrence: line.item.occurrence, code: got.code };
  });
  const id = await start(ctx, 'u4-ask', 'u4-ask');
  const one = await answer(id, 'ask-one');
  const failed = await waitLines(ctx, id, 'terminal', 1, 120000);
  const resume = await archon(ctx, ['workflow', 'resume', id, '--detach']);
  const two = await answer(id, 'ask-two');
  await waitLines(ctx, id, 'terminal', 2, 120000);
  const after = await record(ctx, id, 'ask-ended');

  const beside = await start(ctx, 'u4-ask-beside', 'u4-ask-beside');
  await waitFor(() => openAsk(ctx, beside, 'ask-beside'), 60000, 'the ask beside');
  await sleep(10000);
  const middle = await record(ctx, beside, 'ask-beside-middle');
  const firstAsk = openAsk(ctx, beside, 'ask-beside').item.occurrence;
  const refused = await archon(ctx, ['workflow', 'resume', beside, '--detach']);
  const answered = await archon(ctx, ['workflow', 'answer', beside, '--occurrence', firstAsk, '--choose', 'a', '--json']);
  await waitLines(ctx, beside, 'terminal', 1, 60000).catch(() => null);
  const afterAnswer = await record(ctx, beside, 'ask-beside-answered');
  let again = null;
  if (afterAnswer.status === 'failed') {
    await archon(ctx, ['workflow', 'resume', beside, '--detach']);
    await sleep(10000);
    again = await record(ctx, beside, 'ask-beside-resumed');
  }
  return {
    plain: { id, one, two, failed, status: after.status, resumeCode: resume.code },
    beside: { id: beside, middleStatus: middle.status, middle: summary(middle), resumeWhilePaused: `${refused.stdout}${refused.stderr}`.slice(0, 300), answerCode: answered.code, afterAnswer: summary(afterAnswer), again: again && summary(again), lines: ctx.lines.filter((line) => line.runId === beside || line.item?.runId === beside).map(({ type, occurrence, status, cause, item, reason }) => ({ type, occurrence, status, cause, reason, node: item?.node, itemOccurrence: item?.occurrence })) },
  };
}

const TRIALS = { connection, blip, limit, paid, ask };

async function trial(which = 'all') {
  const ctx = await context();
  const results = {};
  try {
    for (const name of which === 'all' ? Object.keys(TRIALS) : [which]) {
      console.log(`${new Date().toISOString()} ${name}`);
      try {
        results[name] = await TRIALS[name](ctx);
      } catch (error) {
        results[name] = { error: error.message };
        console.log(`${name}: ${error.message}`);
        if (error.message.startsWith('Stopping')) break;
      }
      fs.writeFileSync(path.join(EVIDENCE, `result-${which}.json`), `${JSON.stringify({ results, spent: spent.total, forwarded: ctx.standIn.state.forwarded }, null, 2)}\n`);
      ctx.standIn.state.mode = 'pass';
    }
  } finally {
    for (const child of ctx.procs) child.kill('SIGKILL');
    ctx.standIn.server.closeAllConnections();
    ctx.standIn.server.close();
  }
  console.log(`Spend recorded: $${spent.total.toFixed(4)}. Results in ${EVIDENCE}`);
}

if (startedAsScript(import.meta.url)) {
  const [step, which] = process.argv.slice(2);
  if (step === 'install') { await installScratch({ root: ROOT }); console.log(`Installed under ${ROOT}`); }
  else if (step === 'trial') { await trial(which); process.exit(0); }
  else if (step === 'clean') { await cleanScratch(ROOT); console.log(`Moved ${ROOT} to the Trash`); }
  else { console.error('Usage: run.js install | trial [connection|blip|limit|paid|ask|all] | clean'); process.exit(2); }
}
