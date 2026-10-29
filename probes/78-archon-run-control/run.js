// probes/78-archon-run-control/run.js
// Check 78 (early check E5): Archon's run control. `node probes/78-archon-run-control/run.js trials [count]` runs the
// ask trials, `node probes/78-archon-run-control/run.js cancel` runs the two cancel trials. Both use the scratch engine of
// probes/lib/archon.js and workflows with no model step, so a run costs nothing. The pure parts (the ledger, the tally, the
// disturbance cycle and the cursor rule) are exported and tested; the rest only runs when the file is started directly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { archonEnv, archonRun, readEvents, TELEMETRY } from '../lib/archon.js';

// ---- Pure parts -------------------------------------------------------------------------------------------------

// The key of one ask: the run it belongs to and the node that asked.
export const askId = (runId, node) => `${runId}/${node}`;

// Counts, from a list of events, how often each ask was delivered by the attention stream (`seen`) and how often an
// answer to it was accepted (`answered`). A delivery is a stream line `{ type: 'attention', item: { kind: 'attention',
// runId, node } }`; an accepted answer is `{ type: 'answered', runId, node }`. Everything else is ignored.
export function askLedger(events) {
  const seen = new Map();
  const answered = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'attention' && event.item && event.item.kind === 'attention' && event.item.runId && event.item.node) {
      const id = askId(event.item.runId, event.item.node);
      seen.set(id, (seen.get(id) ?? 0) + 1);
    } else if (event.type === 'answered' && event.runId && event.node) {
      const id = askId(event.runId, event.node);
      answered.set(id, (answered.get(id) ?? 0) + 1);
    }
  }
  return { seen, answered };
}

// The totals for the check. `ledgers` is one `{ expected, seen, answered }` per trial (`expected` lists the ask ids the
// trial's workflow is known to raise). `resumes` is one `{ ok }` per resume trial. `leftovers` lists processes and child
// runs alive after a cancel. Nothing is counted as a pass unless it was measured: no ledgers, no expected asks, no resume
// result, or no leftover list is a failure.
export function tallyE5({ ledgers, resumes, leftovers } = {}) {
  let lost = 0;
  let doubled = 0;
  let expectedTotal = 0;
  for (const ledger of Array.isArray(ledgers) ? ledgers : []) {
    const expected = Array.isArray(ledger.expected) ? ledger.expected : [];
    expectedTotal += expected.length;
    for (const id of expected) {
      if (!((ledger.seen?.get(id) ?? 0) > 0) || !((ledger.answered?.get(id) ?? 0) > 0)) lost += 1;
    }
    for (const count of ledger.answered?.values() ?? []) if (count > 1) doubled += 1;
  }
  const measured = expectedTotal > 0;
  if (!measured && lost === 0) lost = 1;
  const resumeList = Array.isArray(resumes) ? resumes : [];
  const resumeOk = resumeList.length > 0 && resumeList.every((r) => r && r.ok === true);
  const leftoverKnown = Array.isArray(leftovers);
  const survivors = leftoverKnown ? leftovers.length : 0;
  const pass = measured && lost === 0 && doubled === 0 && resumeOk && leftoverKnown && survivors === 0;
  return { lost, doubled, resumeOk, survivors, expectedTotal, pass };
}

const DISTURBANCES = ['follower', 'waker', 'cursor'];
// Which disturbance trial `index` (from 0) gets: the three in turn.
export const disturbanceFor = (index) => DISTURBANCES[index % DISTURBANCES.length];

// The cursor to write to the file after `line` arrives. A bookmark or the end of the snapshot is a point the stream has
// fully read to. For any other line, the previous line's cursor is complete once a line with a different cursor arrives;
// the line's own cursor is not saved, since one event can emit several lines and the process may stop between them.
export function cursorToSave({ previous, line }) {
  if (!line || !line.cursor) return null;
  if (line.type === 'bookmark' || line.type === 'ready') return line.cursor;
  if (previous && previous !== line.cursor) return previous;
  return null;
}

// ---- The harness ------------------------------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

function setup() {
  const root = path.join(os.tmpdir(), 'wheelhouse-archon-checks');
  const bin = path.join(root, 'bin', 'archon');
  if (!fs.existsSync(bin)) throw new Error(`No scratch engine at ${bin}`);
  const env = archonEnv({ home: path.join(root, 'home'), bunDir: path.join(root, 'bun'), claudeBin: path.join(os.homedir(), '.local', 'bin', 'claude') });
  for (const [name, value] of Object.entries(TELEMETRY)) if (env[name] !== value) throw new Error(`${name} is not ${value}`);
  const e5 = path.join(root, 'e5');
  const proj = path.join(e5, 'proj');
  const evidence = path.join(e5, 'evidence');
  fs.mkdirSync(evidence, { recursive: true });
  return { root, bin, env, e5, proj, evidence };
}

const WORKFLOW_FILES = { 'waits.yaml': 'e5-waits.yaml', 'child.yaml': 'e5-child.yaml', 'resume.yaml': 'e5-resume.yaml', 'tree.yaml': 'e5-tree.yaml', 'sleeper.yaml': 'e5-sleeper.yaml' };

function installWorkflows(ctx) {
  const dir = path.join(ctx.proj, '.archon', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  for (const [from, to] of Object.entries(WORKFLOW_FILES)) fs.copyFileSync(path.join(here, from), path.join(dir, to));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@wheelhouse.invalid', ...args], { cwd: ctx.proj, stdio: 'ignore' });
  git('add', '-A');
  try { git('commit', '-q', '-m', 'Workflows for check 78'); git('push', '-q', 'origin', 'main'); } catch { /* nothing new */ }
}

function archon(ctx, args, { timeoutMs = 120000 } = {}) {
  return archonRun(args, { env: ctx.env, cwd: ctx.proj, bin: ctx.bin, timeoutMs });
}

async function startRun(ctx, workflow, { worktree = false } = {}) {
  const args = ['workflow', 'run', workflow, '--detach', ...(worktree ? [] : ['--no-worktree'])];
  const result = await archon(ctx, args);
  const match = /Run id:\s*([0-9a-f]+)/.exec(result.stdout);
  if (!match) throw new Error(`No run id from: ${result.stdout}${result.stderr}`);
  return match[1];
}

async function getRun(ctx, id) {
  const result = await archon(ctx, ['workflow', 'get', id, '--json', '--verbose']);
  return result.json;
}

async function runsList(ctx) {
  const result = await archon(ctx, ['workflow', 'runs', '--json', '--limit', '200']);
  return result.json?.runs ?? [];
}

// A long-lived archon process whose stdout lines go to `onLine`. Stopped only by pid.
function spawnLong(ctx, args, onLine, logFile) {
  const child = spawn(ctx.bin, args, { cwd: ctx.proj, env: ctx.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const handle = { child, pid: child.pid, killedByUs: false, exited: false };
  readline.createInterface({ input: child.stdout }).on('line', (line) => { if (logFile) fs.appendFileSync(logFile, line + '\n'); onLine(line); });
  child.stderr.on('data', (chunk) => { if (logFile) fs.appendFileSync(logFile, `[stderr] ${chunk}`); });
  child.on('exit', () => { handle.exited = true; });
  return handle;
}

function killPid(handle, signal = 'SIGKILL') {
  if (!handle || handle.exited) return;
  handle.killedByUs = true;
  try { process.kill(handle.pid, signal); } catch { /* already gone */ }
}

async function waitExit(handle, ms) {
  const end = Date.now() + ms;
  while (!handle.exited && Date.now() < end) await sleep(100);
  return handle.exited;
}

// ---- The ask trials ---------------------------------------------------------------------------------------------

async function trials(ctx, count) {
  const mine = new Set();
  const answeredKeys = new Set();
  const events = [];
  const stats = { redelivered: 0, refusedSecond: 0, failedAnswers: 0, ownerLost: 0, snapshots: 0, degraded: 0, cursorErrors: 0 };
  const cursorFile = path.join(ctx.evidence, 'cursor.txt');
  const eventsFile = path.join(ctx.evidence, 'events.ndjson');
  fs.writeFileSync(eventsFile, '');
  fs.rmSync(cursorFile, { force: true });
  let previous = null;
  let followerDedupe = true;
  let chain = Promise.resolve();
  let firstCursor = null;
  const record = (event) => { const stamped = { ts: now(), ...event }; events.push(stamped); fs.appendFileSync(eventsFile, JSON.stringify(stamped) + '\n'); };

  async function handle(line) {
    const parsed = readEvents([line])[0];
    if (!parsed) return;
    record(parsed);
    if (parsed.type === 'degraded') stats.degraded += 1;
    if (parsed.type === 'error') stats.cursorErrors += 1;
    if (parsed.type === 'owner_lost') stats.ownerLost += 1;
    const save = cursorToSave({ previous, line: parsed });
    if (parsed.cursor) previous = parsed.cursor;
    if (!firstCursor && parsed.type === 'ready') firstCursor = parsed.cursor;
    if (save) fs.writeFileSync(cursorFile, save);
    if (parsed.type !== 'attention' || !parsed.item || parsed.item.kind !== 'attention') return;
    const item = parsed.item;
    if (!String(item.workflow).startsWith('e5-')) return;
    if (item.parentRunId && mine.has(item.parentRunId)) mine.add(item.runId);
    if (!mine.has(item.runId)) return;
    const key = askId(item.runId, item.node);
    if (answeredKeys.has(key)) {
      stats.redelivered += 1;
      if (followerDedupe) return;
    }
    const result = await archon(ctx, ['workflow', 'answer', item.runId, '--occurrence', item.occurrence, '--choose', 'a', '--json']);
    if (result.json && result.json.ok === true) {
      answeredKeys.add(key);
      record({ type: 'answered', runId: item.runId, node: item.node, occurrence: item.occurrence });
    } else if (answeredKeys.has(key)) {
      stats.refusedSecond += 1;
      record({ type: 'second_answer_refused', runId: item.runId, node: item.node, error: String(result.json?.error ?? result.stderr).slice(0, 200) });
    } else {
      stats.failedAnswers += 1;
      record({ type: 'answer_failed', runId: item.runId, node: item.node, error: String(result.json?.error ?? result.stderr).slice(0, 300) });
    }
  }
  const onLine = (line) => { chain = chain.then(() => handle(line)).catch((error) => record({ type: 'harness_error', error: String(error) })); };

  const followerLog = path.join(ctx.evidence, 'follower.log');
  const wakerLog = path.join(ctx.evidence, 'waker.log');
  const startFollower = (after) => spawnLong(ctx, ['workflow', 'attention', '--watch', '--json', ...(after ? ['--after', after] : [])], onLine, followerLog);
  const startWaker = () => spawnLong(ctx, ['workflow', 'wake', '--watch', '--json'], () => {}, wakerLog);
  const savedCursor = () => (fs.existsSync(cursorFile) ? fs.readFileSync(cursorFile, 'utf8').trim() : null);

  let follower = startFollower(null);
  let waker = startWaker();
  // The supervisor: restarts either process if it stops without our having killed it.
  const unexpected = { follower: 0, waker: 0 };
  const supervisor = setInterval(() => {
    if (follower.exited && !follower.killedByUs) { unexpected.follower += 1; follower = startFollower(savedCursor()); }
    if (waker.exited && !waker.killedByUs) { unexpected.waker += 1; waker = startWaker(); }
  }, 1000);
  await sleep(4000);

  const results = [];
  const answersFor = (family) => events.filter((e) => e.type === 'answered' && family.has(e.runId)).length;

  for (let i = 0; i < count; i += 1) {
    const disturbance = disturbanceFor(i);
    followerDedupe = disturbance !== 'cursor';
    const started = Date.now();
    const runId = await startRun(ctx, 'e5-waits');
    mine.add(runId);
    const trial = { i, disturbance, runId, stalled: false, recovered: false };
    // Even rounds disturb straight after the start; odd rounds wait for the first answer, so the disturbance lands mid-run.
    const midRun = Math.floor(i / 3) % 2 === 1;
    if (midRun) {
      const end = Date.now() + 30000;
      while (answersFor(new Set([runId])) < 1 && Date.now() < end) await sleep(200);
    }
    trial.midRun = midRun;
    if (disturbance === 'waker') {
      killPid(waker);
      await sleep(2500);
      waker = startWaker();
    } else {
      killPid(follower);
      await sleep(2500);
      // The cursor trials restart the stream from the first cursor of the experiment, far behind the saved one.
      follower = startFollower(disturbance === 'cursor' ? firstCursor : savedCursor());
    }
    // Wait for the run to finish.
    let run = null;
    const limit = Date.now() + 75000;
    while (Date.now() < limit) {
      run = await getRun(ctx, runId);
      if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) break;
      await sleep(1000);
    }
    if (!run || run.status !== 'completed') {
      trial.stalled = true;
      trial.stalledStatus = run?.status ?? null;
      const list = await archon(ctx, ['workflow', 'attention', '--json']);
      trial.stalledQueue = (list.json?.items ?? []).filter((it) => it.runId === runId || it.parentRunId === runId).map((it) => ({ runId: it.runId, node: it.node, kind: it.kind }));
      record({ type: 'stalled', runId, status: run?.status, queue: trial.stalledQueue });
      // Recover so the next trial starts clean: answer through the list, then ask for the run to be continued.
      for (const it of list.json?.items ?? []) {
        if (it.kind === 'attention' && (it.runId === runId || it.parentRunId === runId)) {
          mine.add(it.runId);
          const r = await archon(ctx, ['workflow', 'answer', it.runId, '--occurrence', it.occurrence, '--choose', 'a', '--json']);
          if (r.json?.ok) record({ type: 'answered', via: 'backstop', runId: it.runId, node: it.node });
        }
      }
      if (run?.status === 'running') await archon(ctx, ['workflow', 'resume', runId, '--detach']);
      const end2 = Date.now() + 60000;
      while (Date.now() < end2) {
        run = await getRun(ctx, runId);
        if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) break;
        await sleep(1000);
      }
      trial.recovered = run?.status === 'completed';
    }
    trial.status = run?.status ?? null;
    const kids = (await runsList(ctx)).filter((r) => r.parent_run_id === runId);
    trial.childIds = kids.map((k) => k.id);
    trial.expected = [askId(runId, 'ask-one'), askId(runId, 'ask-two'), ...(kids[0] ? [askId(kids[0].id, 'child-ask')] : [askId(`${runId}-child-missing`, 'child-ask')])];
    trial.seconds = Math.round((Date.now() - started) / 1000);
    const family = new Set([runId, ...trial.childIds]);
    trial.ledger = askLedger(events.filter((e) => (e.item && family.has(e.item.runId)) || (e.type === 'answered' && family.has(e.runId))));
    results.push(trial);
    console.log(`trial ${i + 1}/${count} ${disturbance} ${runId.slice(0, 8)} ${trial.status} ${trial.seconds}s${trial.stalled ? ' STALLED' : ''}`);
  }

  // One deliberate second answer to a finished run, to see what the engine does with it.
  const sample = results[0];
  const secondTry = await archon(ctx, ['workflow', 'answer', sample.runId, '--occurrence', 'not-current', '--choose', 'a', '--json']);

  clearInterval(supervisor);
  killPid(follower, 'SIGTERM');
  killPid(waker, 'SIGTERM');
  if (!(await waitExit(waker, 15000))) killPid(waker, 'SIGKILL');
  await waitExit(follower, 5000);
  const summary = {
    finishedAt: now(), count, stats, unexpected, secondAnswerToFinishedRun: secondTry.json,
    trials: results.map((t) => ({ ...t, ledger: { seen: Object.fromEntries(t.ledger.seen), answered: Object.fromEntries(t.ledger.answered) } })),
  };
  fs.writeFileSync(path.join(ctx.evidence, 'trials-summary.json'), JSON.stringify(summary, null, 2));
  const tally = tallyE5({ ledgers: results.map((t) => ({ expected: t.expected, ...t.ledger })), resumes: [{ ok: true }], leftovers: [] });
  console.log(JSON.stringify({ stats, unexpected, lost: tally.lost, doubled: tally.doubled, expectedTotal: tally.expectedTotal, stalled: results.filter((t) => t.stalled).length }, null, 2));
}

// ---- The cancel trials ------------------------------------------------------------------------------------------

function processTable() {
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });
  return out.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }));
}

function descendants(table, rootPid) {
  const found = new Map();
  const queue = [rootPid];
  while (queue.length) {
    const parent = queue.shift();
    for (const p of table) if (p.ppid === parent && !found.has(p.pid)) { found.set(p.pid, p); queue.push(p.pid); }
  }
  return [...found.values()];
}

const MARKERS = /sleep 7[34]\d|setTimeout\(resolve, 73\d000\)/;

async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(500); }
  return null;
}

async function cancelResume(ctx) {
  const out = { name: 'resume' };
  const runId = await startRun(ctx, 'e5-resume', { worktree: true });
  out.runId = runId;
  const run1 = await waitFor(async () => {
    const r = await getRun(ctx, runId);
    const wp = r?.working_path;
    return wp && fs.existsSync(path.join(wp, 'partial.txt')) ? r : null;
  }, 60000);
  if (!run1) { out.ok = false; out.error = 'step two never started'; return { out, leftovers: [] }; }
  const wp = run1.working_path;
  out.worktree = wp;
  const read = (f) => (fs.existsSync(path.join(wp, f)) ? fs.readFileSync(path.join(wp, f), 'utf8') : null);
  const listing = () => fs.readdirSync(wp).filter((f) => f !== '.git').sort();
  const before = { files: listing(), stamp: read('step-one-stamp.txt'), partial: read('partial.txt') };
  const ownerPid = run1.metadata?.execution_owner?.pid;
  const tree = ownerPid ? descendants(processTable(), ownerPid) : [];
  out.ownerPid = ownerPid;
  out.treeBeforeCancel = tree.map((p) => `${p.pid} ${p.ppid} ${p.command.slice(0, 80)}`);
  const cancel = await archon(ctx, ['workflow', 'cancel', runId, '--json']);
  out.cancel = { code: cancel.code, json: cancel.json ?? cancel.stdout.slice(0, 300) };
  await sleep(10000);
  const afterCancel = await getRun(ctx, runId);
  out.statusAfterCancel = afterCancel?.status;
  const table = processTable();
  const alive = new Set(table.map((p) => p.pid));
  const leftovers = [
    ...tree.filter((p) => alive.has(p.pid)).map((p) => ({ pid: p.pid, command: p.command.slice(0, 100), via: 'tree' })),
    ...table.filter((p) => MARKERS.test(p.command) && !tree.some((t) => t.pid === p.pid) && p.pid !== process.pid).map((p) => ({ pid: p.pid, command: p.command.slice(0, 100), via: 'marker' })),
  ].filter((p) => /sleep 731|\bsleep\b|bun/.test(p.command) || p.via === 'marker');
  out.leftoversAfterCancel = leftovers;
  out.before = before;
  out.ownerAliveAfterCancel = ownerPid ? alive.has(ownerPid) : null;
  for (const p of leftovers) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* gone */ } }
  // Resume.
  const resume = await archon(ctx, ['workflow', 'resume', runId, '--json'], { timeoutMs: 150000 });
  out.resume = { code: resume.code, json: resume.json ? { ok: resume.json.ok, action: resume.json.action, error: resume.json.error, status: resume.json.status } : resume.stdout.slice(0, 400), stderr: resume.stderr.slice(0, 300) };
  const run2 = await waitFor(async () => { const r = await getRun(ctx, runId); return r && ['completed', 'failed', 'cancelled'].includes(r.status) ? r : null; }, 120000);
  out.statusAfterResume = run2?.status ?? null;
  const ranLog = path.join(run2?.output_root ?? '', 'artifacts', 'runs', runId, 'ran.log');
  const log = fs.existsSync(ranLog) ? fs.readFileSync(ranLog, 'utf8').trim().split('\n') : null;
  out.ranLog = log;
  const after = { files: fs.existsSync(wp) ? listing() : null, stamp: read('step-one-stamp.txt'), partial: read('partial.txt'), stepTwoDone: read('step-two-done.txt'), stepThree: read('made-by-step-three.txt') };
  out.after = after;
  out.skippedFinished = log ? log.filter((l) => l === 'step-one ran').length === 1 : false;
  out.worktreeKept = before.stamp !== null && before.stamp === after.stamp && after.partial === before.partial;
  out.ok = out.statusAfterResume === 'completed' && out.skippedFinished && out.worktreeKept && after.stepThree !== null;
  if (!out.ok) {
    // The fallback Carry on would use: a fresh run on the same branch, which adopts the worktree as it was.
    const carry = { name: 'carry-on' };
    try {
      const branch = execFileSync('git', ['-C', wp, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
      carry.branch = branch;
      const id = await archon(ctx, ['workflow', 'run', 'e5-resume', '--branch', branch, '--detach']);
      const match = /Run id:\s*([0-9a-f]+)/.exec(id.stdout);
      carry.started = Boolean(match);
      carry.output = match ? undefined : (id.stdout + id.stderr).slice(0, 500);
      if (match) {
        carry.runId = match[1];
        const done = await waitFor(async () => { const r = await getRun(ctx, match[1]); return r && ['completed', 'failed', 'cancelled'].includes(r.status) ? r : null; }, 120000);
        carry.status = done?.status ?? null;
        carry.workingPathSame = done?.working_path === wp;
        const log2 = path.join(done?.output_root ?? '', 'artifacts', 'runs', match[1], 'ran.log');
        carry.ranLog = fs.existsSync(log2) ? fs.readFileSync(log2, 'utf8').trim().split('\n') : null;
        carry.partialKept = read('partial.txt') === before.partial;
        carry.stepTwoDone = read('step-two-done.txt');
        carry.stepThree = read('made-by-step-three.txt');
        carry.stepOneStampAfter = read('step-one-stamp.txt');
        carry.stepOneRanAgain = carry.stepOneStampAfter !== before.stamp;
      }
    } catch (error) { carry.error = String(error).slice(0, 300); }
    out.carryOn = carry;
  }
  return { out, leftovers };
}

async function cancelTree(ctx) {
  const out = { name: 'tree' };
  const runId = await startRun(ctx, 'e5-tree', { worktree: true });
  out.runId = runId;
  const ready = await waitFor(async () => {
    const r = await getRun(ctx, runId);
    const kids = (await runsList(ctx)).filter((k) => k.parent_run_id === runId);
    const table = processTable();
    const owner = r?.metadata?.execution_owner?.pid;
    const procs = owner ? descendants(table, owner) : [];
    const sleeping = procs.filter((p) => MARKERS.test(p.command) || /bun/.test(p.command));
    return kids.length > 0 && procs.some((p) => /sleep 733/.test(p.command)) && sleeping.length >= 2 && procs.some((p) => /sleep 749/.test(p.command)) ? { r, kids, owner } : null;
  }, 60000);
  if (!ready) { out.ok = false; out.error = 'the tree never reached its sleeping steps'; return { out, leftovers: [] }; }
  const childIds = ready.kids.map((k) => k.id);
  out.childIds = childIds;
  // The child run has its own owner (a detached child may or may not be a descendant): collect every owner's tree.
  const table0 = processTable();
  const owners = [ready.owner];
  for (const k of ready.kids) { const kr = await getRun(ctx, k.id); if (kr?.metadata?.execution_owner?.pid) owners.push(kr.metadata.execution_owner.pid); }
  const tree = new Map();
  for (const o of owners) { const proc = table0.find((p) => p.pid === o); if (proc) tree.set(proc.pid, proc); for (const d of descendants(table0, o)) tree.set(d.pid, d); }
  for (const p of table0) if (MARKERS.test(p.command)) tree.set(p.pid, p);
  out.owners = owners;
  out.treeBeforeCancel = [...tree.values()].map((p) => `${p.pid} ${p.ppid} ${p.command.slice(0, 90)}`);
  const cancel = await archon(ctx, ['workflow', 'cancel', runId, '--json']);
  out.cancel = { code: cancel.code, json: cancel.json ? { ok: cancel.json.ok, error: cancel.json.error, cleanupWarnings: cancel.json.cleanupWarnings } : cancel.stdout.slice(0, 400), stderr: cancel.stderr.slice(0, 300) };
  await sleep(10000);
  const table = processTable();
  const alive = new Set(table.map((p) => p.pid));
  const survivors = [...tree.values()].filter((p) => alive.has(p.pid)).map((p) => ({ pid: p.pid, command: p.command.slice(0, 100), via: 'tree' }));
  const markerOnly = table.filter((p) => MARKERS.test(p.command) && !tree.has(p.pid)).map((p) => ({ pid: p.pid, command: p.command.slice(0, 100), via: 'marker' }));
  const leftoverProcs = [...survivors, ...markerOnly];
  const parent = await getRun(ctx, runId);
  const kidStates = [];
  for (const id of childIds) { const kr = await getRun(ctx, id); kidStates.push({ id, status: kr?.status }); }
  const liveKids = kidStates.filter((k) => !['cancelled', 'failed', 'completed'].includes(k.status));
  out.parentStatus = parent?.status;
  out.childStates = kidStates;
  out.leftoverProcesses = leftoverProcs;
  const leftovers = [...leftoverProcs, ...liveKids.map((k) => ({ childRun: k.id, status: k.status }))];
  for (const p of leftoverProcs) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* gone */ } }
  // Child runs still live are cancelled by their own ids.
  for (const k of liveKids) await archon(ctx, ['workflow', 'cancel', k.id, '--json']);
  out.ok = leftovers.length === 0;
  return { out, leftovers };
}

async function cancelTrials(ctx) {
  const a = await cancelResume(ctx);
  const b = await cancelTree(ctx);
  const leftovers = [...a.leftovers, ...b.leftovers];
  const tally = tallyE5({ ledgers: [{ expected: ['x'], seen: new Map([['x', 1]]), answered: new Map([['x', 1]]) }], resumes: [{ ok: a.out.ok }], leftovers });
  const summary = { finishedAt: now(), resume: a.out, tree: b.out, leftovers, tallyOfCancelPartOnly: tally };
  fs.writeFileSync(path.join(ctx.evidence, 'cancel-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const [mode, countArg] = process.argv.slice(2);
  const ctx = setup();
  installWorkflows(ctx);
  if (mode === 'trials') await trials(ctx, Number(countArg ?? 50));
  else if (mode === 'cancel') await cancelTrials(ctx);
  else { console.error('Usage: run.js trials [count] | cancel'); process.exitCode = 2; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
