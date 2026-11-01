// probes/85-many-paused/run.js
// Check 85 (early check D1): does Archon's database hold with many paused runs? `node probes/85-many-paused/run.js fields`
// records what `workflow status --all --json` gives for a run and whether a run whose `start` timed out can be told by its
// branch or path. `node probes/85-many-paused/run.js stage <paused> <minutes>` runs 3 loops, a merge-queue stand-in, a fix-lane
// stand-in, a reader stand-in and <paused> paused runs for <minutes>, polled as the helper polls, then answers every paused
// run in one tick. The scratch engine lives in its own folder (root 85) and the workflows have no model step, so a run costs
// nothing. The pure parts are exported and tested; the rest only runs when the file is started directly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { archonEnv, archonRun, installScratch, TELEMETRY } from '../lib/archon.js';
import { askLedger, askId } from '../78-archon-run-control/run.js';

// ---- Pure parts -------------------------------------------------------------------------------------------------

const LOCK_WORDS = /database is locked|SQLITE_BUSY|SQLITE_LOCKED|database table is locked|busy timeout/i;

// How many of the given outputs (each `{ stdout, stderr }`) mention a locked database.
export function lockErrors(outputs) {
  let count = 0;
  for (const out of Array.isArray(outputs) ? outputs : []) if (LOCK_WORDS.test(`${out?.stdout ?? ''}\n${out?.stderr ?? ''}`)) count += 1;
  return count;
}

// The verdict for one stage. `expected` lists the ask ids the paused runs raise; `events` holds the attention deliveries and
// accepted answers (the shapes `askLedger` reads); `polls` is one `{ ok }` per poll; `finals` is each paused run's state
// after the answers; `loopsAlive` is how many of the 6 other runs were still running at the end. Nothing passes unless it
// was measured: no asks, no polls or no final states is a failure.
export function tallyD1({ expected, events, polls, finals, loopsAlive, loopsExpected, lockCount } = {}) {
  const ids = Array.isArray(expected) ? expected : [];
  const { seen, answered } = askLedger(events);
  let lost = 0;
  let doubled = 0;
  for (const id of ids) if (!((seen.get(id) ?? 0) > 0) || !((answered.get(id) ?? 0) > 0)) lost += 1;
  for (const count of answered.values()) if (count > 1) doubled += 1;
  const pollList = Array.isArray(polls) ? polls : [];
  const failedPolls = pollList.filter((p) => !p?.ok).length;
  const finalList = Array.isArray(finals) ? finals : [];
  const notCompleted = finalList.filter((f) => f !== 'completed').length;
  const measured = ids.length > 0 && pollList.length > 0 && finalList.length === ids.length;
  const pass = measured && lost === 0 && doubled === 0 && failedPolls === 0 && notCompleted === 0 && (lockCount ?? 1) === 0 && loopsAlive === loopsExpected;
  return { lost, doubled, failedPolls, notCompleted, lockCount: lockCount ?? null, measured, pass };
}

// ---- The harness ------------------------------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const now = () => new Date().toISOString();
const say = (...parts) => process.stdout.write(`[${now()}] ${parts.join(' ')}\n`);

const LOOP = (name, description) => `# .archon/workflows/${name}.yaml
name: ${name}
description: ${description}
nodes:
  - id: hold
    bash: |
      end=$((SECONDS+7000))
      while [ $SECONDS -lt $end ]; do date >> loop.log; sleep 20; done
`;
const PAUSED = `# .archon/workflows/d1-paused.yaml
name: d1-paused
description: One attention wait, then a short script
nodes:
  - id: ask
    wait:
      attention: "Carry on?"
      form: select
      options: [{ id: a }, { id: b }]
  - id: finish
    depends_on: [ask]
    bash: echo finished
`;
const WORKFLOWS = {
  'd1-loop': LOOP('d1-loop', 'A running loop that holds a run open'),
  'd1-queue': LOOP('d1-queue', 'Stands in for the merge queue'),
  'd1-fix': LOOP('d1-fix', 'Stands in for a fix-lane run'),
  'd1-reader': LOOP('d1-reader', 'Stands in for the reader'),
  'd1-paused': PAUSED,
};

function setup() {
  const root = path.join(os.tmpdir(), 'wheelhouse-archon-checks-85');
  const bin = path.join(root, 'bin', 'archon');
  if (!fs.existsSync(bin)) throw new Error(`No scratch engine at ${bin}; run installScratch with that root first`);
  const env = archonEnv({ home: path.join(root, 'home'), bunDir: path.join(root, 'bun'), claudeBin: path.join(os.homedir(), '.local', 'bin', 'claude') });
  for (const [name, value] of Object.entries(TELEMETRY)) if (env[name] !== value) throw new Error(`${name} is not ${value}`);
  const work = path.join(root, 'd1');
  const proj = path.join(work, 'proj');
  const remote = path.join(work, 'remote.git');
  const evidence = path.join(work, 'evidence');
  fs.mkdirSync(evidence, { recursive: true });
  if (!fs.existsSync(proj)) {
    const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@wheelhouse.invalid', ...args], { cwd, stdio: 'ignore' });
    git(work, 'init', '-q', '--bare', '-b', 'main', remote);
    git(work, 'clone', '-q', remote, proj);
    git(proj, 'checkout', '-q', '-B', 'main');
    fs.writeFileSync(path.join(proj, 'README.md'), '<!-- README.md -->\nA scratch project for check 85.\n');
    git(proj, 'add', '-A');
    git(proj, 'commit', '-q', '-m', 'Scratch project');
    git(proj, 'push', '-q', 'origin', 'main');
  }
  const dir = path.join(proj, '.archon', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(WORKFLOWS)) fs.writeFileSync(path.join(dir, `${name}.yaml`), body);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@wheelhouse.invalid', ...args], { cwd: proj, stdio: 'ignore' });
  git('add', '-A');
  try { git('commit', '-q', '-m', 'Workflows for check 85'); git('push', '-q', 'origin', 'main'); } catch { /* nothing new */ }
  return { root, bin, env, proj, evidence };
}

const archon = (ctx, args, { timeoutMs = 120000 } = {}) => archonRun(args, { env: ctx.env, cwd: ctx.proj, bin: ctx.bin, timeoutMs });

async function startRun(ctx, workflow, extra = []) {
  const result = await archon(ctx, ['workflow', 'run', workflow, '--detach', ...extra]);
  const match = /Run id:\s*([0-9a-f]+)/.exec(result.stdout);
  if (!match) throw new Error(`No run id from: ${result.stdout}${result.stderr}`);
  return match[1];
}

const getRun = async (ctx, id) => (await archon(ctx, ['workflow', 'get', id, '--json', '--verbose'])).json;
const TERMINAL = ['completed', 'failed', 'cancelled'];

// ---- The fields trial -------------------------------------------------------------------------------------------

async function fields(ctx) {
  const out = { startedAt: now() };
  const withTree = await startRun(ctx, 'd1-paused');
  await sleep(6000);
  const status = await archon(ctx, ['workflow', 'status', '--all', '--json']);
  out.statusAll = status.json;
  out.statusKeys = [...new Set((status.json?.runs ?? []).flatMap((r) => Object.keys(r)))].sort();
  out.getVerbose = await getRun(ctx, withTree);
  out.attention = (await archon(ctx, ['workflow', 'attention', '--json'])).json;
  // A start that times out: the client is stopped while the run is being set up, with a branch we chose.
  const cases = [];
  for (const [label, extra] of [['worktree-branch', ['--branch', 'd1-timeout-a']], ['worktree-default', []], ['no-worktree', ['--no-worktree']]]) {
    const before = new Set(((await archon(ctx, ['workflow', 'runs', '--json', '--limit', '200'])).json?.runs ?? []).map((r) => r.id));
    const started = await archonRun(['workflow', 'run', 'd1-paused', ...extra], { env: ctx.env, cwd: ctx.proj, bin: ctx.bin, timeoutMs: 1500 });
    await sleep(4000);
    const after = (await archon(ctx, ['workflow', 'runs', '--json', '--limit', '200'])).json?.runs ?? [];
    const fresh = after.filter((r) => !before.has(r.id));
    const detail = [];
    for (const r of fresh) detail.push(await getRun(ctx, r.id));
    cases.push({ label, clientCode: started.code, clientTimedOut: started.timedOut ?? null, stdoutTail: started.stdout.slice(-300), freshRuns: fresh.map((r) => ({ id: r.id, status: r.status, branch: r.branch ?? null, workingPath: r.working_path ?? null, keys: Object.keys(r).sort() })), detail: detail.map((d) => ({ id: d?.id, status: d?.status, working_path: d?.working_path, branch: d?.branch, metadataKeys: Object.keys(d?.metadata ?? {}), owner: d?.metadata?.execution_owner })) });
  }
  out.timedOutStart = cases;
  for (const r of (await archon(ctx, ['workflow', 'status', '--all', '--json'])).json?.runs ?? []) await archon(ctx, ['workflow', 'cancel', r.id, '--json']);
  fs.writeFileSync(path.join(ctx.evidence, 'fields.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ statusKeys: out.statusKeys, cases: cases.map((c) => ({ label: c.label, fresh: c.freshRuns })) }, null, 2));
}

// ---- A stage ----------------------------------------------------------------------------------------------------

async function stage(ctx, paused, minutes) {
  const tag = `p${paused}`;
  const logFile = path.join(ctx.evidence, `${tag}.log`);
  const note = (line) => { say(line); fs.appendFileSync(logFile, `[${now()}] ${line}\n`); };
  const events = [];
  const outputs = [];
  const polls = [];
  const record = (event) => events.push({ ts: now(), ...event });

  // The waker, as the helper keeps one running: an answered run continues only when it wakes.
  const waker = spawn(ctx.bin, ['workflow', 'wake', '--watch', '--json'], { cwd: ctx.proj, env: ctx.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const wakerOut = [];
  waker.stdout.on('data', (chunk) => wakerOut.push(String(chunk)));
  waker.stderr.on('data', (chunk) => wakerOut.push(`[stderr] ${chunk}`));
  const loopIds = [];
  for (const name of ['d1-loop', 'd1-loop', 'd1-loop', 'd1-queue', 'd1-fix', 'd1-reader']) loopIds.push(await startRun(ctx, name));
  const pausedIds = [];
  for (let i = 0; i < paused; i += 1) pausedIds.push(await startRun(ctx, 'd1-paused'));
  note(`started ${loopIds.length} loops and ${paused} paused runs`);
  const mine = new Set([...loopIds, ...pausedIds]);

  // Polling as the helper does: the attention queue and the status list every five seconds, a run's detail every minute.
  const end = Date.now() + minutes * 60000;
  let tick = 0;
  const occurrences = new Map();
  while (Date.now() < end) {
    tick += 1;
    const calls = [archon(ctx, ['workflow', 'attention', '--json']), archon(ctx, ['workflow', 'status', '--all', '--json'])];
    if (tick % 12 === 0) for (const id of [...mine]) calls.push(archon(ctx, ['workflow', 'get', id, '--json', '--verbose']));
    const got = await Promise.all(calls);
    for (const r of got) outputs.push({ stdout: r.stdout, stderr: r.stderr });
    polls.push({ ok: got.every((r) => r.code === 0 && !LOCK_WORDS.test(`${r.stdout}${r.stderr}`)) });
    for (const item of got[0].json?.items ?? []) {
      if (item.kind === 'attention' && mine.has(item.runId)) {
        occurrences.set(item.runId, item.occurrence);
        if (!events.some((e) => e.type === 'attention' && e.item?.runId === item.runId && e.tick === tick)) record({ type: 'attention', tick, item: { kind: 'attention', runId: item.runId, node: item.node } });
      }
    }
    if (tick % 60 === 0) note(`tick ${tick}: ${polls.filter((p) => !p.ok).length} failed polls, ${occurrences.size} asks seen`);
    await sleep(5000);
  }
  note(`polled ${polls.length} times, ${polls.filter((p) => !p.ok).length} failed`);

  // The state of every run just before the answers.
  const before = [];
  for (const id of [...loopIds, ...pausedIds]) before.push({ id, status: (await getRun(ctx, id))?.status });
  const loopsAlive = before.filter((b) => loopIds.includes(b.id) && b.status === 'running').length;
  const stillPaused = before.filter((b) => pausedIds.includes(b.id) && b.status === 'paused').length;
  note(`before answers: ${loopsAlive}/${loopIds.length} loops running, ${stillPaused}/${paused} paused`);

  // All answers in one tick.
  const wave = await Promise.all(pausedIds.map(async (id) => {
    const r = await archon(ctx, ['workflow', 'answer', id, '--occurrence', occurrences.get(id) ?? 'missing', '--choose', 'a', '--json']);
    outputs.push({ stdout: r.stdout, stderr: r.stderr });
    if (r.json?.ok === true) record({ type: 'answered', runId: id, node: 'ask' });
    return { id, code: r.code, ok: r.json?.ok === true, error: r.json?.error ?? null };
  }));
  note(`answer wave: ${wave.filter((w) => w.ok).length}/${paused} accepted`);
  // A second answer to each, to see that a repeat is refused.
  const repeat = [];
  for (const id of pausedIds) {
    const r = await archon(ctx, ['workflow', 'answer', id, '--occurrence', occurrences.get(id) ?? 'missing', '--choose', 'a', '--json']);
    outputs.push({ stdout: r.stdout, stderr: r.stderr });
    if (r.json?.ok === true) record({ type: 'answered', runId: id, node: 'ask' });
    repeat.push({ id, ok: r.json?.ok === true, error: String(r.json?.error ?? r.stderr).slice(0, 160) });
  }
  const finals = [];
  for (const id of pausedIds) {
    let run = null;
    const waitEnd = Date.now() + 120000;
    while (Date.now() < waitEnd) { run = await getRun(ctx, id); if (run && TERMINAL.includes(run.status)) break; await sleep(1000); }
    finals.push(run?.status ?? null);
  }
  for (const id of loopIds) await archon(ctx, ['workflow', 'cancel', id, '--json']);
  await sleep(3000);
  const loopFinals = [];
  for (const id of loopIds) loopFinals.push((await getRun(ctx, id))?.status);

  waker.kill('SIGTERM');
  outputs.push({ stdout: wakerOut.join(''), stderr: '' });
  const expected = pausedIds.map((id) => askId(id, 'ask'));
  const tally = tallyD1({ expected, events, polls, finals, loopsAlive, loopsExpected: loopIds.length, lockCount: lockErrors(outputs) });
  const summary = { finishedAt: now(), paused, minutes, polls: polls.length, loopsAlive, stillPaused, wave, repeat, finals, loopFinals, tally };
  fs.writeFileSync(path.join(ctx.evidence, `${tag}-summary.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const [mode, pausedArg, minutesArg] = process.argv.slice(2);
  if (mode === 'install') { await installScratch({ root: path.join(os.tmpdir(), 'wheelhouse-archon-checks-85') }); return; }
  const ctx = setup();
  if (mode === 'fields') await fields(ctx);
  else if (mode === 'stage') await stage(ctx, Number(pausedArg ?? 6), Number(minutesArg ?? 60));
  else { console.error('Usage: run.js install | fields | stage <paused> <minutes>'); process.exitCode = 2; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
