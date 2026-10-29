// probes/76-archon-merge/run.js
// Check 76 (early check E3): the merge path on GitHub through a broker. Archon v0.13.0's own merge queue
// (`archon-merge-queue`) runs against the throwaway private repository where-is-brett/wheelhouse-merge-trial with no key:
// the only `gh` on its PATH is broker.js, which asks this process's helper stand-in (an HTTP server on 127.0.0.1) to run
// the real gh with the token. Git reads come from a local mirror this process refreshes, so Archon never needs a
// credential at all. CI is stood in for by commit statuses this process posts (context `ci`).
//
//   node probes/76-archon-merge/run.js <phase...>     phases: setup deletion a1 a2 b1 b2 c1 c2 c3 config summary
//
// The pure parts (the verdict comment, the work item, the call list's shapes, the launcher and the tally) are exported
// and tested; the rest only runs when the file is started directly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { archonEnv, archonRun, TELEMETRY, unfixture } from '../lib/archon.js';
import { run as defaultRun, withoutGitVars } from '../../scripts/lib/run.js';
import { startedAsScript } from '../../scripts/lib/started-as-script.js';
import { handle, callList } from './broker.js';

// ---- Pure parts -------------------------------------------------------------------------------------------------

// The review-verdict comment the pinned gate trusts (Archon v0.13.0, .archon/workflows/sdlc/.shared/review-comment.ts):
// the marker line, the reviewed commit, the verdict and the contract coverage, a blank line, then prose nothing parses.
export function verdictBody(head, { ready = true, contract = 'complete', report = '' } = {}) {
  if (!/^[0-9a-f]{7,64}$/.test(String(head))) throw new Error(`The reviewed head must be a commit id, not ${head}`);
  if (!['complete', 'open'].includes(contract)) throw new Error(`Unknown contract coverage ${contract}`);
  return `<!-- archon-review-report -->\nReviewed commit: \`${head}\`\nVerdict: ${ready ? 'ready' : 'not ready'}\nContract: ${contract}\n\n${report}`;
}

// A version 1 work item the merge queue claims: the build queue's record says `ready`, and its latest round names the
// pull request. The subject is the pull request's own number (this trial has no issues).
export function readyWorkItem({ repo, pr, url, at, runId }) {
  return {
    version: 1,
    subject: { repo, number: pr },
    created_at: at,
    stage: 'deliver',
    trust: 'maintainer',
    claim: null,
    requests: [],
    links: { runs: [] },
    promoted: null,
    facts: {
      build: {
        status: 'ready',
        brief: '',
        rounds: [{ run_id: runId, at, delivered: true, reason: 'delivered', pr_url: url, summary: 'Opened by check 76.', artifacts: '' }],
        decisions: [],
        at,
      },
    },
    history: [],
  };
}

// The same item handed back as ready after a lane re-run: one more round, a time after the merge queue's last
// decision (or the queue would not wait for it again), and every earlier record kept.
export function readiedAgain(doc, { url, at, runId }) {
  const mergeAt = doc.facts?.merge?.at ?? '';
  if (!(at > mergeAt)) throw new Error(`The ready time ${at} must be later than the merge decision at ${mergeAt}`);
  const build = doc.facts.build ?? { rounds: [], decisions: [] };
  return {
    ...doc,
    claim: null,
    facts: {
      ...doc.facts,
      build: {
        ...build,
        status: 'ready',
        brief: '',
        rounds: [...(build.rounds ?? []), { run_id: runId, at, delivered: true, reason: 'delivered', pr_url: url, summary: 'Brought up to date by check 76.', artifacts: '' }],
        at,
      },
    },
  };
}

const GLOBAL_WITH_VALUE = new Set(['-R', '--repo', '--hostname']);

// A call's shape for the allow list: the command, and for `gh api` the method and the path with its values taken out.
export function callShape(argv) {
  const words = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (GLOBAL_WITH_VALUE.has(argv[i])) { i += 1; continue; }
    words.push(argv[i]);
  }
  if (words[0] !== 'api') return words.slice(0, 2).join(' ');
  const rest = words.slice(1);
  if (rest[0] === 'graphql') {
    const query = rest.find((word) => word.startsWith('query='));
    const kind = query && /^query=\s*mutation\b/.test(query) ? 'mutation' : 'query';
    return `api graphql (${kind})`;
  }
  let method = null;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '-X' || rest[i] === '--method') method = String(rest[i + 1] ?? '').toUpperCase();
    else if (rest[i].startsWith('--method=')) method = rest[i].slice(9).toUpperCase();
  }
  const hasField = rest.some((word) => /^(-f|-F|--field|--raw-field|--input)$/.test(word));
  method = method ?? (hasField ? 'POST' : 'GET');
  const skip = new Set();
  for (let i = 0; i < rest.length; i += 1) if (/^(-X|--method|-f|-F|--field|--raw-field|--input|-H|--header|--jq|-q|--template|-t)$/.test(rest[i])) skip.add(i + 1);
  const target = rest.find((word, i) => !skip.has(i) && !word.startsWith('-') && word.includes('/')) ?? '';
  const generic = target.replace(/^\//, '').split('?')[0]
    .replace(/^repos\/[^/]+\/[^/]+/, 'repos/{o}/{r}')
    .replace(/\/(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}(?=\/|$)|\/[0-9a-f]{40}(?=\/|$)/g, '/{sha}')
    .replace(/\/\d+(?=\/|$)/g, '/{n}');
  return `api ${method} ${generic}`;
}

// Every logged call grouped by kind and shape, with how many were refused. Sorted by kind, then shape.
export function callSummary(entries) {
  const groups = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const shape = callShape(entry.argv ?? []);
    const key = `${entry.kind}\u0000${shape}`;
    const group = groups.get(key) ?? { kind: entry.kind, shape, count: 0, refused: 0 };
    group.count += 1;
    if (entry.refused) group.refused += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.shape.localeCompare(b.shape));
}

const quote = (word) => `'${String(word).replaceAll("'", "'\\''")}'`;

// The `gh` on Archon's PATH: a shell launcher that starts the broker with an absolute Node path.
export function launcherScript(nodePath, brokerPath) {
  if (!path.isAbsolute(nodePath) || !path.isAbsolute(brokerPath)) throw new Error('The launcher needs absolute paths');
  return `#!/bin/sh\n# Check 76's stand-in broker, the only gh on Archon's PATH.\nexec ${quote(nodePath)} ${quote(brokerPath)} "$@"\n`;
}

export const LEGS = Object.freeze([
  'pr-through-broker',
  'ci-green',
  'merge-without-permit-refused',
  'gate-merges',
  'red-main-held',
  'clash-returned-and-rerun',
  'test-deletion-stopped',
]);

// The check passes only when every leg ran and passed; a leg with no result is a failure.
export function tallyE3(results) {
  const given = results && typeof results === 'object' ? results : {};
  const failed = LEGS.filter((leg) => given[leg]?.ok !== true);
  return { pass: failed.length === 0, failed };
}

// ---- The harness ------------------------------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const GH = '/opt/homebrew/bin/gh';
const OWNER_REPO = 'where-is-brett/wheelhouse-merge-trial';
const REPO = { host: 'github.com', path: OWNER_REPO };
const GITHUB_URL = `https://github.com/${OWNER_REPO}.git`;
const PR_URL = (n) => `https://github.com/${OWNER_REPO}/pull/${n}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
const MQ_TIMEOUT = 25 * 60 * 1000;

function context() {
  const root = path.join(os.tmpdir(), 'wheelhouse-archon-checks');
  const bin = path.join(root, 'bin', 'archon');
  if (!fs.existsSync(bin)) throw new Error(`No scratch engine at ${bin}`);
  const e3 = path.join(root, 'e3');
  const dirs = { e3, proj: path.join(e3, 'proj'), mirror: path.join(e3, 'mirror.git'), ghDir: path.join(e3, 'ghbin'), permits: path.join(e3, 'permits'), logs: path.join(e3, 'logs'), evidence: path.join(e3, 'evidence') };
  for (const dir of [e3, dirs.ghDir, dirs.permits, dirs.logs, dirs.evidence]) fs.mkdirSync(dir, { recursive: true });
  const stateFile = path.join(e3, 'state.json');
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { legs: {}, prs: {}, runs: {} };
  return { root, bin, ...dirs, stateFile, state, archonLog: path.join(dirs.logs, 'unassigned.jsonl') };
}

function save(ctx) {
  fs.writeFileSync(ctx.stateFile, JSON.stringify(ctx.state, null, 2) + '\n');
}

function evidence(ctx, name, value) {
  fs.writeFileSync(path.join(ctx.evidence, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}

function say(...parts) {
  process.stdout.write(`[${now()}] ${parts.join(' ')}\n`);
}

// The real gh, run by the helper stand-in only, with the token in its own environment.
function realGh(ctx, argv, cwd) {
  const dir = cwd && fs.existsSync(cwd) ? cwd : ctx.e3;
  return defaultRun(GH, argv, {
    cwd: dir,
    baseEnv: withoutGitVars(process.env),
    env: { GH_TOKEN: ctx.token, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
    timeoutMs: 120000,
  }).then((r) => ({ code: r.code, stdout: r.stdout, stderr: r.stderr }));
}

async function ghJson(ctx, argv) {
  const result = await realGh(ctx, argv);
  if (result.code !== 0) throw new Error(`gh ${argv.slice(0, 3).join(' ')} failed: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

async function headOf(ctx, pr) {
  const view = await ghJson(ctx, ['pr', 'view', String(pr), '--repo', OWNER_REPO, '--json', 'headRefOid']);
  return view.headRefOid ?? null;
}

function brokerOptions(ctx, log) {
  return { log, permitsDir: ctx.permits, forward: (argv, cwd) => realGh(ctx, argv, cwd), headOf: (pr) => headOf(ctx, pr) };
}

// The helper stand-in: answers {argv, cwd} from the broker program with broker.js's `handle`.
async function startStandIn(ctx) {
  const token = await defaultRun(GH, ['auth', 'token'], { baseEnv: withoutGitVars(process.env) });
  if (token.code !== 0 || !token.stdout.trim()) throw new Error('gh auth token gave nothing');
  ctx.token = token.stdout.trim();
  const secret = crypto.randomBytes(16).toString('hex');
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== `/${secret}`) { res.writeHead(404); res.end(); return; }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      let answer;
      try {
        const { argv, cwd } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Array.isArray(argv)) throw new Error('no argv');
        const options = brokerOptions(ctx, ctx.archonLog);
        answer = await handle(argv, { ...options, forward: (a) => realGh(ctx, a, cwd) });
      } catch (error) {
        answer = { code: 1, stdout: '', stderr: `The helper stand-in failed: ${error.message}\n` };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/${secret}`;
  fs.writeFileSync(path.join(ctx.ghDir, 'gh'), launcherScript(process.execPath, path.join(here, 'broker.js')), { mode: 0o755 });
  fs.chmodSync(path.join(ctx.ghDir, 'gh'), 0o755);
  ctx.env = archonEnv({
    home: path.join(ctx.root, 'home'),
    bunDir: path.join(ctx.root, 'bun'),
    claudeBin: path.join(os.homedir(), '.local', 'bin', 'claude'),
    ghDir: ctx.ghDir,
    extra: { WHEELHOUSE_BROKER_URL: url, WHEELHOUSE_BROKER_LOG: path.join(ctx.logs, 'broker.jsonl') },
  });
  for (const [name, value] of Object.entries(TELEMETRY)) if (ctx.env[name] !== value) throw new Error(`${name} is not ${value}`);
  if ('GH_TOKEN' in ctx.env || 'GITHUB_TOKEN' in ctx.env) throw new Error('A token reached Archon\'s environment');
  ctx.server = server;
  return server;
}

// A gh call the helper itself makes through the broker (as it would post a verdict), logged apart from Archon's.
function helperCall(ctx, argv, label) {
  return handle(argv, brokerOptions(ctx, path.join(ctx.logs, `helper-${label}.jsonl`)));
}

const GIT_ID = ['-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid'];

async function git(ctx, args, { cwd = ctx.proj, allowFail = false } = {}) {
  const result = await defaultRun('git', [...GIT_ID, ...args], { cwd, baseEnv: withoutGitVars(process.env), timeoutMs: 120000 });
  if (result.code !== 0 && !allowFail) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result;
}

// Git to GitHub, from the mirror only, with gh as the credential helper in this process.
function mirrorGit(ctx, args) {
  return git(ctx, ['--git-dir', ctx.mirror, '-c', 'credential.helper=', '-c', `credential.helper=!${GH} auth git-credential`, ...args], { cwd: ctx.e3 });
}

async function syncMirror(ctx) {
  await mirrorGit(ctx, ['fetch', '-q', '--prune', 'github', '+refs/heads/*:refs/heads/*', '+refs/pull/*/head:refs/pull/*/head']);
}

async function publish(ctx, branch) {
  await git(ctx, ['push', '-q', '-f', 'origin', `${branch}:${branch}`]);
  await mirrorGit(ctx, ['push', '-q', '-f', 'github', `refs/heads/${branch}:refs/heads/${branch}`]);
}

async function headSha(ctx, ref = 'HEAD') {
  return (await git(ctx, ['rev-parse', ref])).stdout.trim();
}

async function postStatus(ctx, sha, state, description) {
  const result = await realGh(ctx, ['api', `repos/${OWNER_REPO}/statuses/${sha}`, '-f', `state=${state}`, '-f', 'context=ci', '-f', `description=${description}`]);
  if (result.code !== 0) throw new Error(`Posting a ${state} status failed: ${result.stderr}`);
  const combined = await ghJson(ctx, ['api', `repos/${OWNER_REPO}/commits/${sha}/status`]);
  return combined.state;
}

function archon(ctx, args, { timeoutMs = 120000, input } = {}) {
  const runner = input === undefined ? defaultRun : (file, argv, options) => defaultRun(file, argv, { ...options, input });
  return archonRun(args, { env: ctx.env, cwd: ctx.proj, bin: ctx.bin, timeoutMs, run: runner });
}

async function startRun(ctx, args) {
  const result = await archon(ctx, ['workflow', 'run', ...args, '--detach']);
  const match = /Run id:\s*([0-9a-f]+)/.exec(result.stdout);
  if (!match) throw new Error(`No run id from: ${result.stdout}${result.stderr}`);
  return match[1];
}

function summariseRecord(record) {
  if (!record) return null;
  return {
    status: record.status,
    cost: record.metadata?.total_cost_usd ?? null,
    error: record.metadata?.error ?? null,
    nodes: (record.nodes ?? []).map((node) => ({ id: node.nodeId, state: node.state, error: node.error ?? null, output: String(node.outputPreview ?? '').slice(0, 1500) })),
  };
}

async function waitRun(ctx, id, timeoutMs = MQ_TIMEOUT) {
  await archon(ctx, ['workflow', 'wait', id], { timeoutMs });
  const got = await archon(ctx, ['workflow', 'get', id, '--json', '--verbose']);
  return got.json;
}

// One Archon run with its gh calls logged under `label`.
async function archonPhase(ctx, label, args, timeoutMs) {
  ctx.archonLog = path.join(ctx.logs, `${label}.jsonl`);
  say('start', label, args.join(' '));
  const id = await startRun(ctx, args);
  const record = await waitRun(ctx, id, timeoutMs);
  evidence(ctx, `${label}-record.json`, record);
  const summary = { id, ...summariseRecord(record) };
  ctx.state.runs[label] = summary;
  save(ctx);
  say('done', label, summary.status, `cost ${summary.cost}`);
  return { id, record, summary };
}

function mergeQueue(ctx, label) {
  return archonPhase(ctx, label, ['archon-merge-queue', '--input', 'repo_host=github.com', '--input', `repo_path=${OWNER_REPO}`, '--model', 'large=medium']);
}

async function prFor(ctx, branch) {
  const rows = await ghJson(ctx, ['pr', 'list', '--repo', OWNER_REPO, '--head', branch, '--state', 'all', '--json', 'number,headRefOid,url,state,author']);
  return rows[0] ?? null;
}

async function prState(ctx, pr) {
  return ghJson(ctx, ['pr', 'view', String(pr), '--repo', OWNER_REPO, '--json', 'state,headRefOid,mergeable,mergeCommit,mergedBy']);
}

async function waitMergeable(ctx, pr, want) {
  for (let i = 0; i < 30; i += 1) {
    const view = await prState(ctx, pr);
    if (view.mergeable !== 'UNKNOWN') { if (!want || view.mergeable === want) return view.mergeable; }
    await sleep(3000);
  }
  return (await prState(ctx, pr)).mergeable;
}

async function stateGet(ctx, name) {
  const result = await archon(ctx, ['state', 'get', name]);
  return result.json;
}

async function statePut(ctx, name, value) {
  const current = await stateGet(ctx, name);
  const result = await archon(ctx, ['state', 'put', name, '--if-revision', String(current?.revision ?? 0)], { input: JSON.stringify(value) });
  if (result.code !== 0) throw new Error(`state put ${name} failed: ${result.stdout}${result.stderr}`);
}

function permit(ctx, pr, sha) {
  fs.writeFileSync(path.join(ctx.permits, `${pr}-${sha}`), `permit for pull request ${pr} at ${sha}, written ${now()}\n`);
}

async function postVerdict(ctx, pr, sha, label) {
  const body = verdictBody(sha, { report: 'Check 76 stand-in review: the helper signed a CLEAN review of this head.' });
  const answer = await helperCall(ctx, ['pr', 'comment', String(pr), '--repo', OWNER_REPO, '--body', body], label);
  if (answer.code !== 0) throw new Error(`Posting the verdict failed: ${answer.stderr}`);
  const url = answer.stdout.trim();
  const id = /issuecomment-(\d+)/.exec(url)?.[1] ?? null;
  return { url, id, body };
}

function writeFile(ctx, relative, text) {
  const file = path.join(ctx.proj, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// A branch from main with one change, committed in the project checkout and pushed (helper side) to GitHub.
async function makeBranch(ctx, branch, change, { push = true } = {}) {
  await git(ctx, ['checkout', '-q', 'main']);
  await git(ctx, ['reset', '-q', '--hard', 'origin/main']);
  await git(ctx, ['checkout', '-q', '-B', branch]);
  await change();
  await git(ctx, ['add', '-A']);
  await git(ctx, ['commit', '-q', '-m', `Trial change on ${branch}`]);
  if (push) await publish(ctx, branch);
  return headSha(ctx);
}

async function openPr(ctx, branch, label) {
  await git(ctx, ['checkout', '-q', branch]);
  await syncMirror(ctx);
  const { summary } = await archonPhase(ctx, label, ['trial-pr', '--no-worktree'], 10 * 60 * 1000);
  const pr = await prFor(ctx, branch);
  const calls = callList(ctx.archonLog);
  return { summary, pr, calls };
}

function copyDir(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(target, { recursive: true }); copyDir(source, target); }
    else fs.copyFileSync(source, target);
  }
}

// ---- The phases ---------------------------------------------------------------------------------------------------

const PHASES = {
  async setup(ctx) {
    const view = await ghJson(ctx, ['repo', 'view', OWNER_REPO, '--json', 'isEmpty,isPrivate']);
    if (!view.isPrivate) throw new Error('The trial repository is not private');
    if (!view.isEmpty) throw new Error('The trial repository is not empty; setup runs only once');
    await git(ctx, ['init', '-q', '--bare', '-b', 'main', ctx.mirror], { cwd: ctx.e3 });
    await git(ctx, ['--git-dir', ctx.mirror, 'remote', 'add', 'github', GITHUB_URL], { cwd: ctx.e3 });
    fs.mkdirSync(ctx.proj, { recursive: true });
    await git(ctx, ['init', '-q', '-b', 'main']);
    copyDir(path.join(here, 'seed'), ctx.proj);
    unfixture(ctx.proj);
    await git(ctx, ['config', 'user.name', 'Wheelhouse probe']);
    await git(ctx, ['config', 'user.email', 'probe@wheelhouse.invalid']);
    await git(ctx, ['remote', 'add', 'origin', GITHUB_URL]);
    // Archon's scripts find the remote by its configured URL (GitHub's); git itself reads and pushes the mirror.
    await git(ctx, ['config', `url.${ctx.mirror}.insteadOf`, GITHUB_URL]);
    await git(ctx, ['add', '-A']);
    await git(ctx, ['commit', '-q', '-m', 'Start the merge trial for check 76']);
    await publish(ctx, 'main');
    await git(ctx, ['fetch', '-q', 'origin']);
    await git(ctx, ['branch', '-q', '--set-upstream-to=origin/main', 'main']);
    const sha = await headSha(ctx);
    ctx.state.mainSeed = sha;
    ctx.state.mainSeedStatus = await postStatus(ctx, sha, 'success', 'Check 76 stand-in CI');
    save(ctx);
    say('seeded main at', sha, 'status', ctx.state.mainSeedStatus);
  },

  async deletion(ctx) {
    const branch = 'trial/drop-test';
    await syncMirror(ctx);
    await git(ctx, ['fetch', '-q', 'origin']);
    await makeBranch(ctx, branch, async () => {
      fs.rmSync(path.join(ctx.proj, 'tests', 'add.test.js'));
      writeFile(ctx, 'src/add.js', fs.readFileSync(path.join(ctx.proj, 'src', 'add.js'), 'utf8').replace('return a + b;', 'return b + a;'));
    }, { push: false });
    const { summary, pr, calls } = await openPr(ctx, branch, 'deletion-trial-pr');
    const check = summary.nodes.find((n) => n.id === 'check');
    const prNode = summary.nodes.find((n) => n.id === 'pr');
    const created = calls.filter((c) => c.kind === 'create');
    ctx.state.legs['test-deletion-stopped'] = {
      ok: summary.status === 'failed' && check?.state === 'failed' && prNode?.state !== 'completed' && pr === null && created.length === 0,
      run: summary.status, check: check?.state, prNode: prNode?.state ?? 'not run', pr: pr?.number ?? null, creates: created.length,
      checkOutput: check?.output ?? '',
    };
    save(ctx);
    say('deletion leg', JSON.stringify(ctx.state.legs['test-deletion-stopped']));
  },

  async a1(ctx) {
    const branch = 'trial/a-double';
    await syncMirror(ctx);
    await git(ctx, ['fetch', '-q', 'origin']);
    await makeBranch(ctx, branch, async () => {
      writeFile(ctx, 'src/double.js', '// src/double.js\nexport function double(n) {\n  return n * 2;\n}\n');
      writeFile(ctx, 'tests/double.test.js', "// tests/double.test.js\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { double } from '../src/double.js';\n\ntest('double doubles', () => {\n  assert.equal(double(4), 8);\n});\n");
    });
    const { summary, pr, calls } = await openPr(ctx, branch, 'a-trial-pr');
    const created = calls.filter((c) => c.kind === 'create');
    ctx.state.legs['pr-through-broker'] = { ok: summary.status === 'completed' && pr !== null && created.length === 1 && pr.author?.login === 'where-is-brett', pr: pr?.number ?? null, author: pr?.author?.login ?? null, calls: callSummary(calls) };
    if (!pr) { save(ctx); throw new Error('No pull request was opened'); }
    const head = pr.headRefOid;
    const ci = await postStatus(ctx, head, 'success', 'Check 76 stand-in CI');
    ctx.state.legs['ci-green'] = { ok: ci === 'success', pr: pr.number, head, combined: ci };
    const verdict = await postVerdict(ctx, pr.number, head, 'a');
    ctx.state.prs.a = { number: pr.number, head, verdict, branch };
    await statePut(ctx, `work/${pr.number}`, readyWorkItem({ repo: REPO, pr: pr.number, url: PR_URL(pr.number), at: now(), runId: 'check-76-a' }));
    save(ctx);
    await syncMirror(ctx);
    // No permit yet: the gate's merge must be refused by the broker.
    const { summary: mq } = await mergeQueue(ctx, 'mq1-no-permit');
    const after = await prState(ctx, pr.number);
    const mqCalls = callList(ctx.archonLog);
    const refused = mqCalls.filter((c) => c.kind === 'merge' && c.refused);
    const item = await stateGet(ctx, `work/${pr.number}`);
    ctx.state.legs['merge-without-permit-refused'] = { ok: after.state === 'OPEN' && refused.length > 0 && !mqCalls.some((c) => c.kind === 'merge' && !c.refused), run: mq.status, prState: after.state, refusedMerges: refused.map((c) => c.argv), merge: item?.value?.facts?.merge ?? null };
    save(ctx);
    say('a1', JSON.stringify(ctx.state.legs['merge-without-permit-refused']).slice(0, 2000));
  },

  async a2(ctx) {
    const a = ctx.state.prs.a;
    permit(ctx, a.number, a.head);
    const item = await stateGet(ctx, `work/${a.number}`);
    const status = item?.value?.facts?.merge?.status;
    if (status !== 'waiting' && status !== undefined) {
      say('work item status was', status, '- handing it back as ready');
      await statePut(ctx, `work/${a.number}`, readiedAgain(item.value, { url: PR_URL(a.number), at: now(), runId: 'check-76-a2' }));
    }
    await syncMirror(ctx);
    const { summary: mq } = await mergeQueue(ctx, 'mq2-permit');
    const after = await prState(ctx, a.number);
    const merges = callList(ctx.archonLog).filter((c) => c.kind === 'merge');
    ctx.state.legs['gate-merges'] = { ok: after.state === 'MERGED' && merges.some((c) => !c.refused), run: mq.status, prState: after.state, mergeCommit: after.mergeCommit?.oid ?? null, mergedBy: after.mergedBy?.login ?? null, merges: merges.map((c) => ({ argv: c.argv, refused: !!c.refused })) };
    save(ctx);
    say('a2', JSON.stringify(ctx.state.legs['gate-merges']));
  },

  async b1(ctx) {
    await syncMirror(ctx);
    await git(ctx, ['fetch', '-q', 'origin']);
    const mainHead = await headSha(ctx, 'origin/main');
    const red = await postStatus(ctx, mainHead, 'failure', 'Check 76 stand-in CI: red on the main line');
    ctx.state.redMain = { head: mainHead, combined: red };
    const greet = (text) => async () => writeFile(ctx, 'src/add.js', fs.readFileSync(path.join(ctx.proj, 'src', 'add.js'), 'utf8').replace("greeting = 'hello';", `greeting = '${text}';`));
    for (const [key, branch, text] of [['b', 'trial/b-greeting', 'hello there'], ['c', 'trial/c-greeting', 'good day']]) {
      await makeBranch(ctx, branch, greet(text));
      const { pr } = await openPr(ctx, branch, `${key}-trial-pr`);
      if (!pr) throw new Error(`No pull request for ${branch}`);
      await postStatus(ctx, pr.headRefOid, 'success', 'Check 76 stand-in CI');
      const verdict = await postVerdict(ctx, pr.number, pr.headRefOid, key);
      permit(ctx, pr.number, pr.headRefOid);
      ctx.state.prs[key] = { number: pr.number, head: pr.headRefOid, verdict, branch };
      save(ctx);
    }
    const b = ctx.state.prs.b;
    await statePut(ctx, `work/${b.number}`, readyWorkItem({ repo: REPO, pr: b.number, url: PR_URL(b.number), at: now(), runId: 'check-76-b' }));
    await syncMirror(ctx);
    ctx.archonLog = path.join(ctx.logs, 'mq3-red-main.jsonl');
    const id = await startRun(ctx, ['archon-merge-queue', '--input', 'repo_host=github.com', '--input', `repo_path=${OWNER_REPO}`, '--model', 'large=medium']);
    let record = await waitRun(ctx, id);
    evidence(ctx, 'mq3-red-main-record-paused.json', record);
    const paused = summariseRecord(record);
    const attention = (await archon(ctx, ['workflow', 'attention', id, '--json'])).json;
    evidence(ctx, 'mq3-red-main-attention.json', attention);
    const item = attention?.item ?? null;
    let answered = null;
    if (item) {
      const options = item.options ?? item.wait?.options ?? [];
      const choice = options.map((o) => o.id ?? o).find((o) => o !== 'other') ?? null;
      const occurrence = item.occurrence ?? item.wait?.occurrence;
      if (choice && occurrence) {
        answered = await archon(ctx, ['workflow', 'answer', id, '--occurrence', String(occurrence), '--choose', choice], { timeoutMs: 10 * 60 * 1000 });
        answered = { choice, code: answered.code, out: (answered.stdout + answered.stderr).slice(0, 1500) };
      }
    }
    record = await waitRun(ctx, id);
    evidence(ctx, 'mq3-red-main-record.json', record);
    const summary = { id, ...summariseRecord(record) };
    ctx.state.runs['mq3-red-main'] = { ...summary, paused };
    const after = await prState(ctx, b.number);
    const merges = callList(ctx.archonLog).filter((c) => c.kind === 'merge');
    ctx.state.legs['red-main-held'] = {
      ok: after.state === 'OPEN' && merges.length === 0 && paused.status === 'paused' && !!item,
      pausedStatus: paused.status, finalStatus: summary.status, prState: after.state, merges: merges.length,
      attentionKind: item?.kind ?? null, labels: item?.labels ?? null, options: item?.options ?? null, answered,
    };
    save(ctx);
    say('b1', JSON.stringify(ctx.state.legs['red-main-held']).slice(0, 2500));
  },

  async b2(ctx) {
    await syncMirror(ctx);
    const mainHead = ctx.state.redMain.head;
    ctx.state.greenMain = await postStatus(ctx, mainHead, 'success', 'Check 76 stand-in CI: green again');
    const b = ctx.state.prs.b;
    const item = await stateGet(ctx, `work/${b.number}`);
    const status = item?.value?.facts?.merge?.status;
    if (status !== 'waiting' && status !== undefined) {
      say('B work item status was', status, '- handing it back as ready');
      await statePut(ctx, `work/${b.number}`, readiedAgain(item.value, { url: PR_URL(b.number), at: now(), runId: 'check-76-b2' }));
    }
    const { summary } = await mergeQueue(ctx, 'mq4-green-main');
    const after = await prState(ctx, b.number);
    ctx.state.bMerged = { ok: after.state === 'MERGED', run: summary.status, mergeCommit: after.mergeCommit?.oid ?? null, priorStatus: status ?? null };
    save(ctx);
    say('b2', JSON.stringify(ctx.state.bMerged));
  },

  async c1(ctx) {
    const c = ctx.state.prs.c;
    const mergeable = await waitMergeable(ctx, c.number, 'CONFLICTING');
    ctx.state.clashMergeable = mergeable;
    await statePut(ctx, `work/${c.number}`, readyWorkItem({ repo: REPO, pr: c.number, url: PR_URL(c.number), at: now(), runId: 'check-76-c' }));
    await syncMirror(ctx);
    const { summary } = await mergeQueue(ctx, 'mq5-clash');
    const after = await prState(ctx, c.number);
    const item = await stateGet(ctx, `work/${c.number}`);
    ctx.state.clashReturned = { run: summary.status, prState: after.state, mergeable, build: item?.value?.facts?.build ?? null, merge: item?.value?.facts?.merge ?? null };
    save(ctx);
    say('c1', JSON.stringify(ctx.state.clashReturned).slice(0, 2500));
  },

  async c2(ctx) {
    const c = ctx.state.prs.c;
    await syncMirror(ctx);
    await git(ctx, ['fetch', '-q', 'origin']);
    await git(ctx, ['checkout', '-q', c.branch]);
    await git(ctx, ['reset', '-q', '--hard', `origin/${c.branch}`]);
    const { summary } = await archonPhase(ctx, 'c-trial-update', ['trial-update', '--no-worktree'], 15 * 60 * 1000);
    const head = await headSha(ctx);
    const file = fs.readFileSync(path.join(ctx.proj, 'src', 'add.js'), 'utf8');
    ctx.state.rerun = { run: summary.status, nodes: summary.nodes.map((n) => ({ id: n.id, state: n.state })), cost: summary.cost, head, greeting: /greeting = .*$/m.exec(file)?.[0] ?? null };
    save(ctx);
    if (summary.status !== 'completed') throw new Error('The lane re-run did not complete');
    await publish(ctx, c.branch);
    await postStatus(ctx, head, 'success', 'Check 76 stand-in CI');
    // The helper edits the one verdict comment in place for the new head (a second marked comment reads as duplicate).
    const body = verdictBody(head, { report: 'Check 76 stand-in review: the helper signed a CLEAN review of the updated head.' });
    const edit = await helperCall(ctx, ['api', '-X', 'PATCH', `repos/${OWNER_REPO}/issues/comments/${c.verdict.id}`, '-f', `body=${body}`], 'c-update');
    if (edit.code !== 0) throw new Error(`Editing the verdict failed: ${edit.stderr}`);
    permit(ctx, c.number, head);
    const item = await stateGet(ctx, `work/${c.number}`);
    await statePut(ctx, `work/${c.number}`, readiedAgain(item.value, { url: PR_URL(c.number), at: now(), runId: 'check-76-c2' }));
    ctx.state.prs.c = { ...c, head };
    save(ctx);
    say('c2', JSON.stringify(ctx.state.rerun));
  },

  async c3(ctx) {
    const c = ctx.state.prs.c;
    ctx.state.rerunMergeable = await waitMergeable(ctx, c.number, 'MERGEABLE');
    await syncMirror(ctx);
    const { summary } = await mergeQueue(ctx, 'mq6-after-rerun');
    const after = await prState(ctx, c.number);
    const returned = ctx.state.clashReturned;
    ctx.state.legs['clash-returned-and-rerun'] = {
      ok: returned?.merge?.status === 'returned' && returned?.build?.status === 'next' && !!returned?.build?.brief && ctx.state.rerun?.run === 'completed' && after.state === 'MERGED',
      returnedStatus: returned?.merge?.status ?? null, buildStatus: returned?.build?.status ?? null, brief: returned?.build?.brief ?? null,
      rerun: ctx.state.rerun?.run ?? null, run: summary.status, prState: after.state, mergeCommit: after.mergeCommit?.oid ?? null,
    };
    save(ctx);
    say('c3', JSON.stringify(ctx.state.legs['clash-returned-and-rerun']).slice(0, 2500));
  },

  // Can Wheelhouse's --config carry the maintainers policy? A run-scoped layer with a policy key, and one that sets an
  // environment variable instead, each on a dry run.
  async config(ctx) {
    const policy = path.join(ctx.e3, 'config-policy.yaml');
    fs.writeFileSync(policy, 'sdlc:\n  maintainers: ["where-is-brett"]\n');
    const env = path.join(ctx.e3, 'config-env.yaml');
    fs.writeFileSync(env, 'env:\n  ARCHON_SDLC_MAINTAINERS: "where-is-brett"\n');
    const base = ['workflow', 'run', 'archon-merge-queue', '--dry-run', '--input', 'repo_host=github.com', '--input', `repo_path=${OWNER_REPO}`];
    const a = await archon(ctx, [...base, '--config', policy]);
    const b = await archon(ctx, [...base, '--config', env]);
    ctx.state.config = {
      policyKey: { code: a.code, out: (a.stdout + a.stderr).slice(0, 1200) },
      envKey: { code: b.code, out: (b.stdout + b.stderr).slice(0, 1200) },
    };
    save(ctx);
    say('config', JSON.stringify(ctx.state.config));
  },

  async summary(ctx) {
    const mqLogs = fs.readdirSync(ctx.logs).filter((name) => /^mq\d/.test(name));
    const all = mqLogs.flatMap((name) => callList(path.join(ctx.logs, name)).map((entry) => ({ ...entry, run: name })));
    const perRun = Object.fromEntries(mqLogs.map((name) => [name, callSummary(callList(path.join(ctx.logs, name)))]));
    const lanes = fs.readdirSync(ctx.logs).filter((name) => /trial-(pr|update)\.jsonl$/.test(name));
    const laneCalls = Object.fromEntries(lanes.map((name) => [name, callSummary(callList(path.join(ctx.logs, name)))]));
    const helper = fs.readdirSync(ctx.logs).filter((name) => name.startsWith('helper-'));
    const helperCalls = Object.fromEntries(helper.map((name) => [name, callSummary(callList(path.join(ctx.logs, name)))]));
    const out = { tally: tallyE3(ctx.state.legs), mergeQueueCalls: callSummary(all), perRun, laneCalls, helperCalls, runs: ctx.state.runs };
    evidence(ctx, 'summary.json', out);
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  },
};

async function main(phases) {
  const ctx = context();
  const unknown = phases.filter((p) => !PHASES[p]);
  if (phases.length === 0 || unknown.length) throw new Error(`Name phases from: ${Object.keys(PHASES).join(' ')}`);
  const server = await startStandIn(ctx);
  try {
    for (const phase of phases) await PHASES[phase](ctx);
  } finally {
    server.close();
  }
}

if (startedAsScript(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exit(1);
  });
}
