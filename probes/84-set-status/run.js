// probes/84-set-status/run.js
// Check 84: the real status path on GitHub (spec section 4.3, step 9). On the private trial repository
// where-is-brett/wheelhouse-merge-trial, which has no Actions, one pull request gets `wheelhouse/checks` from the
// helper's connection: `pending` first, with Archon's merge queue reading it, then `success`, with the queue merging
// through the stand-in broker of check 76. The status goes through `gh` with the environment `envForConnection` gives,
// the line part 2 puts in the adapter's `setStatus`. `ciState` and `hasCi` come from the real adapter, before and after.
//
//   node probes/84-set-status/run.js [--mode quick|narrow] [--resume <stamp> <pr>]
//
// --resume takes up a run that stopped after its `pending` leg, from its scratch folder.
//
// Nothing outside the scratch folder is written, except the one branch, pull request, comment and statuses on the
// trial repository. Narrow needs the app's key in the Wheelhouse home, and stops with a plain line if there is none.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archonEnv, archonRun, installScratch } from '../lib/archon.js';
import { handle, callList } from '../76-archon-merge/broker.js';
import { launcherScript, readyWorkItem, readiedAgain, verdictBody } from '../76-archon-merge/run.js';
import { run, withoutGitVars } from '../../scripts/lib/run.js';
import { envForConnection } from '../../scripts/host/helper.js';
import { makeAdapter } from '../../scripts/host/adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(os.tmpdir(), 'wheelhouse-archon-checks-83');
const GH = '/opt/homebrew/bin/gh';
const OWNER_REPO = 'where-is-brett/wheelhouse-merge-trial';
const REPO = { host: 'github.com', path: OWNER_REPO };
const GITHUB_URL = `https://github.com/${OWNER_REPO}.git`;
const CONTEXT = 'wheelhouse/checks';
const MODE = process.argv[process.argv.indexOf('--mode') + 1] === 'narrow' ? 'narrow' : 'quick';
const resumeAt = process.argv.indexOf('--resume');
const stamp = resumeAt === -1 ? Date.now().toString(36) : process.argv[resumeAt + 1];
const resumed = resumeAt === -1 ? null : Number(process.argv[resumeAt + 2]);
const WORK = path.join(ROOT, `84-${stamp}`);
const dirs = { proj: path.join(WORK, 'proj'), mirror: path.join(WORK, 'mirror.git'), ghDir: path.join(WORK, 'ghbin'), permits: path.join(WORK, 'permits'), logs: path.join(WORK, 'logs') };
const now = () => new Date().toISOString();
const say = (...parts) => process.stdout.write(`[${now()}] ${parts.join(' ')}\n`);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const report = { mode: MODE, legs: {} };

async function git(args, { cwd = dirs.proj, credential = false } = {}) {
  const auth = credential ? ['-c', 'credential.helper=', '-c', `credential.helper=!${GH} auth git-credential`] : [];
  const got = await run('/usr/bin/git', ['-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid', ...auth, ...args], { cwd, baseEnv: withoutGitVars(process.env), timeoutMs: 120000 });
  if (got.code !== 0) throw new Error(`git ${args.join(' ')}: ${got.stderr.trim()}`);
  return got.stdout.trim();
}

// `gh` as the helper runs it: the connection's environment and nothing else added.
const connectionGh = (env, argv) => run(GH, argv, { cwd: WORK, baseEnv: withoutGitVars(process.env), env: { ...env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }, timeoutMs: 60000 });

// The line part 2 puts in the GitHub adapter.
const setStatus = (env, sha, state, description) => connectionGh(env, ['api', '-X', 'POST', `repos/${OWNER_REPO}/statuses/${sha}`, '-f', `state=${state}`, '-f', `context=${CONTEXT}`, '-f', `description=${description}`]);

async function standIn(token) {
  const realGh = (argv, cwd) => run(GH, argv, { cwd: cwd && fs.existsSync(cwd) ? cwd : WORK, baseEnv: withoutGitVars(process.env), env: { GH_TOKEN: token, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }, timeoutMs: 120000 }).then((r) => ({ code: r.code, stdout: r.stdout, stderr: r.stderr }));
  const headOf = async (pr) => JSON.parse((await realGh(['pr', 'view', String(pr), '--repo', OWNER_REPO, '--json', 'headRefOid'])).stdout).headRefOid ?? null;
  const box = { log: path.join(dirs.logs, 'unassigned.jsonl') };
  const secret = crypto.randomBytes(16).toString('hex');
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      let answer;
      try {
        const { argv, cwd } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        answer = req.url === `/${secret}` ? await handle(argv, { log: box.log, permitsDir: dirs.permits, forward: (a) => realGh(a, cwd), headOf }) : { code: 1, stdout: '', stderr: 'refused\n' };
      } catch (error) { answer = { code: 1, stdout: '', stderr: `${error.message}\n` }; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  fs.writeFileSync(path.join(dirs.ghDir, 'gh'), launcherScript(process.execPath, path.join(here, '..', '76-archon-merge', 'broker.js')), { mode: 0o755 });
  const env = archonEnv({ home: path.join(ROOT, 'home'), bunDir: path.join(ROOT, 'bun'), claudeBin: path.join(os.homedir(), '.local', 'bin', 'claude'), ghDir: dirs.ghDir, nodeDir: path.dirname(process.execPath), baseEnv: withoutGitVars(process.env), extra: { WHEELHOUSE_BROKER_URL: `http://127.0.0.1:${server.address().port}/${secret}`, WHEELHOUSE_BROKER_LOG: path.join(dirs.logs, 'broker.jsonl') } });
  return { server, env, box, realGh };
}

const syncMirror = () => git(['--git-dir', dirs.mirror, 'fetch', '-q', '--prune', 'github', '+refs/heads/*:refs/heads/*', '+refs/pull/*/head:refs/pull/*/head'], { cwd: WORK, credential: true });

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'bin', 'archon'))) await installScratch({ root: ROOT });
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  const connection = await envForConnection(() => ({ host: 'github', mode: MODE, project: OWNER_REPO }))('check-84').catch((error) => { throw new Error(`The ${MODE} connection isn't there: ${error.message}`); });
  const adapter = makeAdapter({ host: 'github', repo: OWNER_REPO, run, env: connection.env });
  const token = (await run(GH, ['auth', 'token'], { baseEnv: withoutGitVars(process.env) })).stdout.trim();
  const { server, env, box, realGh } = await standIn(token);
  const archon = (args, { timeoutMs = 120000, input } = {}) => archonRun(args, { env, cwd: dirs.proj, bin: path.join(ROOT, 'bin', 'archon'), timeoutMs, run: input === undefined ? run : (file, argv, options) => run(file, argv, { ...options, input }) });
  const stateOf = async (name) => (await archon(['state', 'get', name])).json;
  const statePut = async (name, value) => {
    const current = await stateOf(name);
    const got = await archon(['state', 'put', name, '--if-revision', String(current?.revision ?? 0)], { input: JSON.stringify(value) });
    if (got.code !== 0) throw new Error(`state put ${name}: ${got.stdout}${got.stderr}`);
  };
  // The trial repository holds Standard's agent settings, whose sandbox shuts out check 76's stand-in broker on
  // localhost. They go from this scratch checkout only; check 81 ran the real broker's route under them.
  const shedSettings = async () => {
    await git(['update-index', '--skip-worktree', '.claude/settings.json']);
    fs.rmSync(path.join(dirs.proj, '.claude', 'settings.json'), { force: true });
  };
  const queue = async (label) => {
    box.log = path.join(dirs.logs, `${label}.jsonl`);
    await syncMirror();
    const started = await archon(['workflow', 'run', 'archon-merge-queue', '--input', `repo_host=${REPO.host}`, '--input', `repo_path=${REPO.path}`, '--model', 'large=medium', '--detach']);
    const id = /Run id:\s*([0-9a-f]+)/.exec(started.stdout)?.[1];
    if (!id) throw new Error(`No run id: ${started.stdout}${started.stderr}`);
    await archon(['workflow', 'wait', id], { timeoutMs: 25 * 60 * 1000 });
    const record = (await archon(['workflow', 'get', id, '--json', '--verbose'])).json;
    return { status: record?.status, cost: record?.metadata?.total_cost_usd ?? null, merges: callList(box.log).filter((c) => c.kind === 'merge').length };
  };
  try {
    let pr = resumed;
    let head = null;
    let url = `https://github.com/${OWNER_REPO}/pull/${pr}`;
    if (resumed !== null) head = JSON.parse((await realGh(['pr', 'view', String(pr), '--repo', OWNER_REPO, '--json', 'headRefOid'])).stdout).headRefOid;
    const branch = `check-84/${stamp}`;
    if (resumed === null) {
    await git(['clone', '-q', '--bare', GITHUB_URL, dirs.mirror], { cwd: WORK, credential: true });
    await git(['--git-dir', dirs.mirror, 'remote', 'add', 'github', GITHUB_URL], { cwd: WORK });
    await git(['clone', '-q', '-b', 'main', dirs.mirror, dirs.proj], { cwd: WORK });
    await git(['remote', 'set-url', 'origin', GITHUB_URL]);
    await git(['config', `url.${dirs.mirror}.insteadOf`, GITHUB_URL]);
    await git(['checkout', '-q', '-b', branch]);
    fs.mkdirSync(path.join(dirs.proj, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dirs.proj, 'docs', `check-84-${stamp}.md`), `<!-- docs/check-84-${stamp}.md -->\nA line for check 84.\n`);
    await git(['add', '-A']);
    await git(['commit', '-q', '-m', 'A line for check 84']);
    await git(['push', '-q', 'origin', `${branch}:${branch}`]);
    await git(['--git-dir', dirs.mirror, 'push', '-q', 'github', `refs/heads/${branch}:refs/heads/${branch}`], { cwd: WORK, credential: true });
    head = await git(['rev-parse', 'HEAD']);
    report.legs.before = { ciState: await adapter.ciState(head), hasCi: await adapter.hasCi(head, branch) };
    const opened = await adapter.openPr({ head: branch, base: 'main', title: 'A line for check 84', body: 'A trial pull request for check 84.' });
    await shedSettings();
    pr = opened.number;
    url = `https://github.com/${OWNER_REPO}/pull/${pr}`;
    report.pr = pr;
    const verdict = await realGh(['pr', 'comment', String(pr), '--repo', OWNER_REPO, '--body', verdictBody(head, { report: 'Check 84 stand-in review.' })]);
    if (verdict.code !== 0) throw new Error(`The verdict: ${verdict.stderr}`);
    fs.writeFileSync(path.join(dirs.permits, `${pr}-${head}`), 'permit\n');
    await statePut(`work/${pr}`, readyWorkItem({ repo: REPO, pr, url, at: now(), runId: 'check-84-a' }));

    const pending = await setStatus(connection.env, head, 'pending', 'Checking on this computer');
    report.legs.pendingPost = { code: pending.code, state: JSON.parse(pending.stdout || '{}').state, context: JSON.parse(pending.stdout || '{}').context, creator: JSON.parse(pending.stdout || '{}').creator?.login };
    report.legs.pending = { ciState: await adapter.ciState(head), hasCi: await adapter.hasCi(head, branch) };
    say('pending posted', JSON.stringify(report.legs.pending));
    const first = await queue('queue-pending');
    const afterPending = await stateOf(`work/${pr}`);
    report.legs.queueOnPending = { ...first, facts: afterPending?.value?.facts?.merge ?? null, pr: JSON.parse((await realGh(['pr', 'view', String(pr), '--repo', OWNER_REPO, '--json', 'state'])).stdout).state };
    say('queue on pending', JSON.stringify(report.legs.queueOnPending).slice(0, 800));
    }

    await shedSettings();
    const green = await setStatus(connection.env, head, 'success', 'Passed in 2 minutes');
    report.legs.successPost = { code: green.code, state: JSON.parse(green.stdout || '{}').state };
    report.legs.success = { ciState: await adapter.ciState(head), hasCi: await adapter.hasCi(head, branch) };
    const item = await stateOf(`work/${pr}`);
    if (item?.value?.facts?.merge?.status !== 'waiting') await statePut(`work/${pr}`, readiedAgain(item.value, { url, at: now(), runId: 'check-84-b' }));
    await sleep(2000);
    const second = await queue('queue-success');
    const view = JSON.parse((await realGh(['pr', 'view', String(pr), '--repo', OWNER_REPO, '--json', 'state,mergedBy,mergeCommit'])).stdout);
    const done = await stateOf(`work/${pr}`);
    report.legs.queueOnSuccess = { ...second, facts: done?.value?.facts?.merge ?? null, pr: view.state, mergedBy: view.mergedBy?.login ?? null };
    report.legs.mainAfterMerge = view.mergeCommit?.oid ? await adapter.ciState(view.mergeCommit.oid) : null;
    report.calls = callList(path.join(dirs.logs, 'queue-success.jsonl')).length;
  } finally {
    server.close();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

await main();
