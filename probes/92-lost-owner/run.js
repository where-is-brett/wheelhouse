// probes/92-lost-owner/run.js
// Check 92 (early check U2): a run that lost its owner. `node probes/92-lost-owner/run.js install` builds the engine with
// Wheelhouse's patches into this check's own folder, with its own Archon home, so its runs, its waker and its database
// stay apart from any other check's. `node probes/92-lost-owner/run.js trials` runs every trial. The workflows have no
// model step, so a run costs nothing. The pure parts are exported and tested; the rest only runs when the file is started
// directly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { archonEnv, archonRun, readEvents, TELEMETRY } from '../lib/archon.js';
import { buildFromSource, enginePaths, writeArchonSettings } from '../../scripts/engine/archon/build.js';

// ---- Pure parts -------------------------------------------------------------------------------------------------

// The verdict for one lost-owner trial. Nothing passes unless it was measured.
export function tallyU2({ ownerLost, blockedBefore, cancel, status, kept, fresh } = {}) {
  const failures = [];
  if (ownerLost !== true) failures.push('no owner_lost line');
  if (blockedBefore !== true) failures.push('a fresh run was not refused before the cancel');
  if (cancel?.ok !== true) failures.push('the cancel did not take it');
  if (status !== 'cancelled') failures.push(`the run reads ${status ?? 'nothing'}`);
  if (!Array.isArray(kept) || kept.length === 0 || kept.some((file) => !file.there)) failures.push('a file was not kept');
  if (fresh?.status !== 'completed' || fresh?.samePath !== true || fresh?.turnedAway !== false) failures.push('the fresh run did not finish on the same folder');
  return { pass: failures.length === 0, failures };
}

// Whether a detached run's log holds the refusal the worktree lock gives. A start with --detach still returns a run id:
// the run then cancels itself, with no step run, and only this log says why.
export const alreadyActive = (text) => /Workflow already active on this path/.test(String(text ?? ''));

// Whether a start was turned away by the lock: it ended cancelled, with no step run, and a log it wrote says so.
export const turnedAway = ({ status, nodes, logs } = {}) => status === 'cancelled' && Array.isArray(nodes) && nodes.length === 0 && (logs ?? []).some(alreadyActive);

// The file Archon's owner listens at, for a run on this computer (run-live-owner.ts: runLiveOwnerPath).
export const ownerSocket = (runId, uid = process.getuid?.()) => path.join('/tmp', `archon-${uid}`, `${crypto.createHash('sha256').update(runId).digest('hex').slice(0, 32)}.sock`);

// ---- The harness ------------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const now = () => new Date().toISOString();
const say = (...parts) => process.stdout.write(`[${now()}] ${parts.join(' ')}\n`);
const ROOT = path.join(os.tmpdir(), 'wheelhouse-archon-checks-92');
const ENGINE = path.join(ROOT, 'engine');
const TERMINAL = ['completed', 'failed', 'cancelled'];
const STAMP = Date.now().toString(36);

// A step that holds until carry-on.txt appears, so a fresh run can get past it. `talk` writes to the step's standard
// output each second, as a model step does; without it the step never finds its reader gone.
const HOLD = (talk) => `    bash: |
      echo $$ > step.pid
      echo kept > partial.txt
      end=$((SECONDS+900))
      while [ $SECONDS -lt $end ]; do
        [ -f carry-on.txt ] && exit 0
        date > heartbeat.txt
${talk ? '        echo beat\n' : ''}        sleep 1
      done
      exit 1
`;
const STEPS = (name, description, talk) => `# .archon/workflows/${name}.yaml
name: ${name}
description: ${description}
nodes:
  - id: first
    bash: date >> first.txt
  - id: hold
    depends_on: [first]
${HOLD(talk)}  - id: last
    depends_on: [hold]
    bash: echo done > last.txt
`;
const WORKFLOWS = {
  'u2-talks': STEPS('u2-talks', 'A held step that writes to its standard output', true),
  'u2-quiet': STEPS('u2-quiet', 'A held step that writes nothing to its standard output', false),
  'u2-tree': `# .archon/workflows/u2-tree.yaml
name: u2-tree
description: A child run that holds
nodes:
  - id: kid
    workflow: u2-quiet
`,
};

function setup() {
  const p = enginePaths(ENGINE);
  if (!fs.existsSync(p.launcher)) throw new Error(`No engine at ${p.launcher}; run this file with install first`);
  const env = archonEnv({ home: path.join(ROOT, 'home'), bunDir: p.bunDir, claudeBin: path.join(os.homedir(), '.local', 'bin', 'claude') });
  for (const [name, value] of Object.entries(TELEMETRY)) if (env[name] !== value) throw new Error(`${name} is not ${value}`);
  const work = path.join(ROOT, 'u2');
  const proj = path.join(work, 'proj');
  const remote = path.join(work, 'remote.git');
  const evidence = path.join(work, 'evidence');
  fs.mkdirSync(evidence, { recursive: true });
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@wheelhouse.invalid', ...args], { cwd, stdio: 'ignore' });
  if (!fs.existsSync(proj)) {
    git(work, 'init', '-q', '--bare', '-b', 'main', remote);
    git(work, 'clone', '-q', remote, proj);
    git(proj, 'checkout', '-q', '-B', 'main');
    fs.writeFileSync(path.join(proj, 'README.md'), '<!-- README.md -->\nA scratch project for check 92.\n');
    fs.writeFileSync(path.join(proj, '.gitignore'), '# .gitignore\nstep.pid\nheartbeat.txt\n');
    git(proj, 'add', '-A');
    git(proj, 'commit', '-q', '-m', 'Scratch project');
    git(proj, 'push', '-q', 'origin', 'main');
  }
  const dir = path.join(proj, '.archon', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(WORKFLOWS)) fs.writeFileSync(path.join(dir, `${name}.yaml`), body);
  git(proj, 'add', '-A');
  try { git(proj, 'commit', '-q', '-m', 'Workflows for check 92'); git(proj, 'push', '-q', 'origin', 'main'); } catch { /* nothing new */ }
  return { bin: p.launcher, env, proj, evidence };
}

const archon = (ctx, args, { timeoutMs = 120000 } = {}) => archonRun(args, { env: ctx.env, cwd: ctx.proj, bin: ctx.bin, timeoutMs });
const getRun = async (ctx, id) => (await archon(ctx, ['workflow', 'get', id, '--json', '--verbose'])).json;

async function startRun(ctx, workflow, branch) {
  const result = await archon(ctx, ['workflow', 'run', workflow, '--branch', branch, '--detach']);
  return { id: /Run id:\s*([0-9a-f]+)/.exec(result.stdout)?.[1] ?? null, result };
}

async function waitFor(check, ms, every = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(every);
  }
  return null;
}

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
};
const kill = (pid) => { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } };

// The logs of detached starts, and the text of those added since `before`.
const logDir = (ctx) => path.join(ctx.env.ARCHON_HOME, 'logs');
const detachedLogs = (ctx) => new Set(fs.existsSync(logDir(ctx)) ? fs.readdirSync(logDir(ctx)) : []);
const newLogs = (ctx, before) => [...detachedLogs(ctx)].filter((name) => !before.has(name)).map((name) => fs.readFileSync(path.join(logDir(ctx), name), 'utf8'));

// A long-lived archon process: the stream or the waker. Each line of its output goes to `onLine`.
function spawnLong(ctx, args, onLine, logFile) {
  const child = spawn(ctx.bin, args, { cwd: ctx.proj, env: ctx.env, stdio: ['ignore', 'pipe', 'pipe'] });
  readline.createInterface({ input: child.stdout }).on('line', (line) => { fs.appendFileSync(logFile, `${line}\n`); onLine(line); });
  child.stderr.on('data', (chunk) => fs.appendFileSync(logFile, `[stderr] ${chunk}`));
  return child;
}

// The stream, with what it has said kept, and its last cursor for a restart.
function follow(ctx, name, after) {
  const state = { lines: [], cursor: after ?? null };
  state.child = spawnLong(ctx, ['workflow', 'attention', '--watch', '--json', '--all', ...(after ? ['--after', after] : [])], (line) => {
    const parsed = readEvents([line])[0];
    if (!parsed) return;
    state.lines.push({ at: now(), ...parsed });
    if (parsed.cursor) state.cursor = parsed.cursor;
  }, path.join(ctx.evidence, `${name}-stream.ndjson`));
  return state;
}

const lineFor = (stream, type, id) => stream.lines.find((l) => l.type === type && l.runId === id);

// Starts `workflow` and returns once its held step is running, with the run, its folder and its owner's process.
async function startHeld(ctx, workflow, branch) {
  const started = await startRun(ctx, workflow, branch);
  if (!started.id) throw new Error(`No run id: ${started.result.stdout}${started.result.stderr}`);
  const ready = await waitFor(async () => {
    const run = await getRun(ctx, started.id);
    const folder = run?.working_path;
    return folder && fs.existsSync(path.join(folder, 'step.pid')) && fs.existsSync(path.join(folder, 'heartbeat.txt')) ? run : null;
  }, 60000);
  if (!ready) throw new Error(`The held step of ${started.id} never ran`);
  const folder = ready.working_path;
  const ownerPid = ready.metadata?.execution_owner?.pid;
  if (!ownerPid) throw new Error(`No recorded owner on ${started.id}: ${JSON.stringify(ready.metadata)}`);
  fs.writeFileSync(path.join(folder, 'uncommitted.txt'), 'Work no commit holds.\n');
  return { id: started.id, folder, ownerPid, stepPid: Number(fs.readFileSync(path.join(folder, 'step.pid'), 'utf8')), recordedOwner: ready.metadata.execution_owner };
}

// After the owner is gone: the stream's line, a start that meets the run's lock, the cancel, what stayed, a fresh run.
async function afterLoss(ctx, { workflow, branch, held, stream, out }) {
  const beat = () => fs.statSync(path.join(held.folder, 'heartbeat.txt')).mtimeMs;
  const seen = await waitFor(() => lineFor(stream, 'owner_lost', held.id), 60000);
  out.ownerLost = Boolean(seen);
  out.ownerLostLine = seen ?? null;
  const before = beat();
  await sleep(4000);
  out.step = { alive: alive(held.stepPid), stillWriting: beat() > before };

  const logsBefore = detachedLogs(ctx);
  const early = await startRun(ctx, workflow, branch);
  const refused = await waitFor(async () => {
    const r = early.id ? await getRun(ctx, early.id) : null;
    return r && TERMINAL.includes(r.status) ? r : null;
  }, 20000);
  await sleep(1000);
  const logs = newLogs(ctx, logsBefore);
  out.earlyStart = { id: early.id, status: refused?.status ?? null, nodes: refused?.nodes ?? null, cancelReasonInLog: logs.filter(alreadyActive).length };
  out.blockedBefore = turnedAway({ status: refused?.status, nodes: refused?.nodes, logs });

  const cancel = await archon(ctx, ['workflow', 'cancel', held.id, '--json']);
  out.cancel = cancel.json ?? { ok: false, text: `${cancel.stdout}${cancel.stderr}`.slice(0, 400) };
  out.status = (await getRun(ctx, held.id))?.status;
  out.terminal = (await waitFor(() => lineFor(stream, 'terminal', held.id), 15000)) ?? null;
  const again = await archon(ctx, ['workflow', 'cancel', held.id, '--json']);
  out.secondCancel = again.json ?? { ok: false, text: `${again.stdout}${again.stderr}`.slice(0, 300) };
  out.kept = ['uncommitted.txt', 'partial.txt', 'first.txt'].map((file) => ({ file, there: fs.existsSync(path.join(held.folder, file)) }));
  out.gitStatus = execFileSync('git', ['status', '--porcelain'], { cwd: held.folder, encoding: 'utf8' }).trim().split('\n');
  out.branchAfter = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: held.folder, encoding: 'utf8' }).trim();

  // A step left behind is stopped here, as All stop stops one by its folder, then the fresh run is let through.
  if (alive(held.stepPid)) kill(held.stepPid);
  fs.writeFileSync(path.join(held.folder, 'carry-on.txt'), 'Go on.\n');
  const logsBeforeFresh = detachedLogs(ctx);
  const fresh = await startRun(ctx, workflow, branch);
  out.fresh = { id: fresh.id, text: fresh.id ? null : `${fresh.result.stdout}${fresh.result.stderr}`.slice(0, 400) };
  if (fresh.id) {
    const done = await waitFor(async () => {
      const r = await getRun(ctx, fresh.id);
      return r && TERMINAL.includes(r.status) ? r : null;
    }, 60000);
    out.fresh = { ...out.fresh, status: done?.status ?? null, samePath: done?.working_path === held.folder, lastStep: fs.existsSync(path.join(held.folder, 'last.txt')), uncommittedStayed: fs.existsSync(path.join(held.folder, 'uncommitted.txt')), turnedAway: newLogs(ctx, logsBeforeFresh).some(alreadyActive) };
  }
  return { ...out, verdict: tallyU2(out) };
}

// Step 2: the owner killed, with everything else left alone.
async function killedOwner(ctx, name, workflow) {
  const branch = `u2-${name}-${STAMP}`;
  const out = { trial: name, workflow, startedAt: now() };
  const stream = follow(ctx, name);
  await waitFor(() => stream.lines.find((l) => l.type === 'ready'), 20000);
  const held = await startHeld(ctx, workflow, branch);
  out.run = { id: held.id, folder: held.folder, recordedOwner: held.recordedOwner, stepPid: held.stepPid };
  kill(held.ownerPid);
  const result = await afterLoss(ctx, { workflow, branch, held, stream, out });
  stream.child.kill('SIGTERM');
  return result;
}

// Step 3: a restart's stand-in. The stream, the waker, the owner and its step all die at once, and the waker and the
// stream start again from the saved cursor, with the run's row left at `running`.
async function restart(ctx) {
  const name = 'restart';
  const workflow = 'u2-talks';
  const branch = `u2-restart-${STAMP}`;
  const out = { trial: name, workflow, startedAt: now() };
  const wakeLog = path.join(ctx.evidence, 'restart-wake.log');
  const waker = spawnLong(ctx, ['workflow', 'wake', '--watch', '--json'], () => {}, wakeLog);
  const stream = follow(ctx, name);
  await waitFor(() => stream.lines.find((l) => l.type === 'ready'), 20000);
  const held = await startHeld(ctx, workflow, branch);
  out.run = { id: held.id, folder: held.folder, recordedOwner: held.recordedOwner, stepPid: held.stepPid };
  await sleep(2000);
  const cursor = stream.cursor;
  for (const pid of [held.ownerPid, held.stepPid, waker.pid, stream.child.pid]) kill(pid);
  await waitFor(() => !alive(held.ownerPid) && !alive(held.stepPid), 10000);
  out.everyProcessGone = !alive(held.ownerPid) && !alive(held.stepPid);
  out.rowAfterDeath = (await getRun(ctx, held.id))?.status;
  const nextWaker = spawnLong(ctx, ['workflow', 'wake', '--watch', '--json'], () => {}, wakeLog);
  const nextStream = follow(ctx, `${name}-again`, cursor);
  await sleep(10000);
  out.rowAfterWake = (await getRun(ctx, held.id))?.status;
  const result = await afterLoss(ctx, { workflow, branch, held, stream: nextStream, out });
  for (const child of [nextWaker, nextStream.child]) child.kill('SIGTERM');
  return result;
}

// A live owner behaves as released: cancel stops it.
async function liveOwner(ctx) {
  const out = { trial: 'live-owner', startedAt: now() };
  const held = await startHeld(ctx, 'u2-talks', `u2-live-${STAMP}`);
  const cancel = await archon(ctx, ['workflow', 'cancel', held.id, '--json']);
  out.cancel = cancel.json;
  out.status = (await getRun(ctx, held.id))?.status;
  await sleep(2000);
  out.ownerAlive = alive(held.ownerPid);
  out.stepAlive = alive(held.stepPid);
  out.verdict = { pass: out.cancel?.processStopped === true && out.status === 'cancelled' && !out.ownerAlive };
  return out;
}

// An owner that lives with its endpoint gone is what a confirmation must catch: nothing answers, yet the owner runs. The
// socket is moved aside, the cancel is tried, and the socket is put back.
async function liveWithoutEndpoint(ctx) {
  const out = { trial: 'endpoint-gone', startedAt: now() };
  const held = await startHeld(ctx, 'u2-talks', `u2-endpoint-${STAMP}`);
  const socket = ownerSocket(held.id);
  const aside = `${socket}.aside`;
  fs.renameSync(socket, aside);
  const cancel = await archon(ctx, ['workflow', 'cancel', held.id, '--json']);
  out.cancel = cancel.json ?? { ok: false, text: `${cancel.stdout}${cancel.stderr}`.slice(0, 500) };
  out.statusWhileHidden = (await getRun(ctx, held.id))?.status;
  out.ownerAlive = alive(held.ownerPid);
  fs.renameSync(aside, socket);
  const real = await archon(ctx, ['workflow', 'cancel', held.id, '--json']);
  out.afterPutBack = real.json;
  out.status = (await getRun(ctx, held.id))?.status;
  out.verdict = { pass: out.cancel?.ok !== true && out.statusWhileHidden === 'running' && out.ownerAlive && out.status === 'cancelled' };
  return out;
}

// A child run shares its parent's owner. Cancelling the parent takes the child too.
async function childRun(ctx) {
  const out = { trial: 'child-run', startedAt: now() };
  const started = await startRun(ctx, 'u2-tree', `u2-child-${STAMP}`);
  if (!started.id) throw new Error(`No run id: ${started.result.stdout}${started.result.stderr}`);
  const list = async () => ((await archon(ctx, ['workflow', 'runs', '--json', '--limit', '200'])).json?.runs ?? []).filter((r) => r.parent_run_id === started.id);
  const kid = await waitFor(async () => {
    const [row] = await list();
    if (!row) return null;
    const run = await getRun(ctx, row.id);
    return run?.working_path && fs.existsSync(path.join(run.working_path, 'step.pid')) ? run : null;
  }, 60000);
  if (!kid) throw new Error('The child run never reached its held step');
  const parent = await getRun(ctx, started.id);
  const stepPid = Number(fs.readFileSync(path.join(kid.working_path, 'step.pid'), 'utf8'));
  out.owners = { parent: parent.metadata?.execution_owner, child: kid.metadata?.execution_owner };
  kill(parent.metadata.execution_owner.pid);
  await sleep(3000);
  const cancel = await archon(ctx, ['workflow', 'cancel', started.id, '--json']);
  out.cancel = cancel.json ?? { ok: false, text: `${cancel.stdout}${cancel.stderr}`.slice(0, 400) };
  out.parent = (await getRun(ctx, started.id))?.status;
  out.child = (await getRun(ctx, kid.id))?.status;
  out.stepAlive = alive(stepPid);
  if (alive(stepPid)) kill(stepPid);
  out.verdict = { pass: out.parent === 'cancelled' && out.child === 'cancelled' };
  return out;
}

async function trials(ctx) {
  const results = [];
  const trial = async (name, body) => {
    say('trial', name);
    let result;
    try { result = await body(); } catch (error) { result = { trial: name, threw: String(error?.stack ?? error), verdict: { pass: false } }; }
    fs.writeFileSync(path.join(ctx.evidence, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
    say(name, result.verdict?.pass ? 'pass' : `FAIL ${JSON.stringify(result.verdict?.failures ?? result.threw ?? '')}`);
    results.push(result);
  };
  await trial('killed-talks', () => killedOwner(ctx, 'killed-talks', 'u2-talks'));
  await trial('killed-quiet', () => killedOwner(ctx, 'killed-quiet', 'u2-quiet'));
  await trial('restart', () => restart(ctx));
  await trial('live-owner', () => liveOwner(ctx));
  await trial('endpoint-gone', () => liveWithoutEndpoint(ctx));
  await trial('child-run', () => childRun(ctx));
  fs.writeFileSync(path.join(ctx.evidence, 'summary.json'), `${JSON.stringify(results.map((r) => ({ trial: r.trial, pass: r.verdict?.pass === true })), null, 2)}\n`);
}

async function main() {
  const [mode] = process.argv.slice(2);
  if (mode === 'install') {
    fs.mkdirSync(ENGINE, { recursive: true });
    await buildFromSource({ engine: ENGINE });
    writeArchonSettings(path.join(ROOT, 'home'));
    return;
  }
  if (mode === 'trials') await trials(setup());
  else { console.error('Usage: run.js install | trials'); process.exitCode = 2; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
