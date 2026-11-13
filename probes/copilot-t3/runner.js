// probes/copilot-t3/runner.js
// Trial stage T3 (docs/specs/2026-11-10-copilot-return-design.md, section 7 and part 10): one quick-lane change on a throwaway
// project kept on this computer, from the First Mate's order to the helper's merge, with the Copilot session killed once
// mid-task and resumed. It measures real requests per step and whether subagents are charged, to replace section 5.2's estimate.
//
//   node probes/copilot-t3/runner.js plan                         prints the steps and spends nothing
//   node probes/copilot-t3/runner.js run --label <label> [--from auto|<step>]
//
// Budget: 10 requests, Auto only: no model is ever passed (budget.js stops the stage before it goes over). Like the Haiku trial's
// runner it keeps a run-log and a snapshot after each step, and carries on past a fault: only a foundation step stops the run.
// `run` starts real Copilot sessions and so spends requests; the unit tests drive `runStage` with a stand-in host (tests/probes/copilot-t3).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BudgetStop, makeBudget, STAGE_BUDGET } from './budget.js';
import { readRun, waitMidTask } from './session.js';
import { nextNumber, takeLocal, writeMeta } from '../haiku-trial/snapshot.js';

const TRIALS = path.join(os.homedir(), '.wheelhouse-trials');
export const runFolder = (label, base = TRIALS) => path.join(base, `copilot-t3-${label}`);
export const snapshotsFolder = (label, base = TRIALS) => path.join(base, `copilot-t3-${label}.snapshots`);

const LABEL = /^[a-z0-9][a-z0-9-]{0,30}$/;

// The First Mate's order for the change: small, visible nowhere, with one check, so a quick lane carries it.
export const ORDER = Object.freeze({
  work: 't3-greeting',
  lane: 'quick',
  goal: 'Make greet(name) in src/greeting.js say "Hello, <name>!" and add a test for it in tests/greeting.test.js.',
});

// `foundation` steps stop the run when they fail: nothing after them can mean anything.
export const STEPS = Object.freeze([
  { name: 'stage', foundation: true, what: 'The throwaway project, kept on this computer, and its scratch Wheelhouse home' },
  { name: 'month-check', foundation: true, what: "The month's use is read; the stage doesn't start if it can't be, or if it would pass 150" },
  { name: 'order', needs: ['stage'], what: "The First Mate's order is recorded for the quick lane" },
  { name: 'build', needs: ['order', 'month-check'], what: "The helper's feature session starts in its worktree; killed once mid-task" },
  { name: 'resume', needs: ['build'], what: 'The same session is resumed by its id and finishes the change' },
  { name: 'merge', needs: ['resume'], what: "The change is opened and the helper's local merge lands it" },
  { name: 'report', what: 'Requests per step, whether subagents were charged, the figures against section 5.2' },
]);

const clock = () => new Date().toISOString();
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

// `host` does what touches the world; it is real in `run` (host.js) and a stand-in in the tests:
//   stage({ folder })                      -> { project }
//   monthUsed()                            -> the month's requests so far, or null
//   order(order)                           -> records the order
//   start({ work, sessionId })             -> a run handle (session.js startRun), with `sessionId`
//   resume({ work, sessionId })            -> a run handle
//   merge({ work })                        -> { merged, commit?, reason? }
// `settings`: { label, from, base, midTaskTools, midTaskTimeoutMs, budgetLimit, sessionId, snapshot (false in tests that skip it) }.
export async function runStage({ host, label, from = null, base = TRIALS, midTaskTools = 1, midTaskTimeoutMs = 10 * 60 * 1000, budgetLimit = STAGE_BUDGET, sessionId = null, snapshot = true } = {}) {
  if (typeof label !== 'string' || !LABEL.test(label)) throw new Error('A run needs a label of lowercase letters, digits and dashes');
  const folder = runFolder(label, base);
  const logFile = path.join(folder, 'run-log.jsonl');
  const stateFile = path.join(folder, 'state.json');
  fs.mkdirSync(folder, { recursive: true });
  const log = (entry) => fs.appendFileSync(logFile, `${JSON.stringify({ ...entry, at: clock() })}\n`);
  const state = readJson(stateFile, { steps: {}, findings: [], budgetSteps: [], used: 0, monthUsed: null });
  const save = () => fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const doneBefore = new Set(from === 'auto' ? Object.entries(state.steps).filter(([, v]) => ['ok', 'failed', 'skipped'].includes(v.outcome)).map(([k]) => k) : []);
  doneBefore.delete('report');
  const names = STEPS.map((s) => s.name);
  if (from !== null && from !== 'auto' && !names.includes(from)) throw new Error(`There is no step ${from}`);
  const start = from === null || from === 'auto' ? 0 : names.indexOf(from);

  let budget = null;
  const session = state.session ?? { id: sessionId ?? crypto.randomUUID(), cumulative: null };
  state.session = session;
  const handles = {};
  const ctx = { stopped: null, killedOnce: state.killed === true };

  const finding = (step, what) => {
    state.findings.push({ step, what, at: clock() });
    log({ step, what, state: 'finding' });
  };
  const failedOrSkipped = (name) => ['failed', 'skipped'].includes(state.steps[name]?.outcome);

  // The run's request figure goes through the budget: reserved before it starts, settled when it ends.
  async function spend(step, begin, { kill = false } = {}) {
    budget.reserve(step);
    let handle;
    try {
      handle = await begin();
    } catch (error) {
      budget.release(step);
      throw error;
    }
    handles[step] = handle;
    let killed = false;
    if (kill) {
      const mid = await waitMidTask(handle, { after: midTaskTools, timeoutMs: midTaskTimeoutMs });
      if (mid.reached && !mid.ended) {
        handle.kill();
        killed = true;
      } else if (!mid.reached) {
        handle.kill();
        killed = true;
        finding(step, mid.ended ? 'The session ended before it was mid-task, so there was nothing to kill' : 'The session was killed without having reached its first tool call');
      } else {
        finding(step, 'The session ended before it could be killed mid-task');
      }
    }
    const end = await handle.done;
    const run = readRun(handle);
    const requests = budget.settle(step, { session: session.id, cumulative: run.cumulative });
    session.cumulative = run.cumulative ?? session.cumulative;
    return { run, requests, killed: killed || end.killed === true, code: end.code };
  }

  const bodies = {
    async stage() {
      const got = await host.stage({ folder });
      state.project = got.project;
      return { project: got.project };
    },
    async 'month-check'() {
      const used = await host.monthUsed();
      state.monthUsed = used;
      budget = makeBudget({ limit: budgetLimit, monthUsed: used });
      return { monthUsed: used };
    },
    async order() {
      await host.order(ORDER);
      return { work: ORDER.work, lane: ORDER.lane };
    },
    async build() {
      const got = await spend('build', () => host.start({ work: ORDER.work, sessionId: session.id }), { kill: true });
      state.killed = got.killed;
      ctx.killedOnce = got.killed;
      state.build = { requests: got.requests, tools: got.run.tools, subagents: got.run.subagents, killed: got.killed, finished: got.run.finished };
      if (!got.killed && got.run.finished) finding('build', 'The session finished before it was killed, so crash resume was not exercised');
      return state.build;
    },
    async resume() {
      if (!ctx.killedOnce) finding('resume', 'The session was not killed, so this resume is not a crash resume');
      const got = await spend('resume', () => host.resume({ work: ORDER.work, sessionId: session.id }));
      state.resume = { requests: got.requests, tools: got.run.tools, subagents: got.run.subagents, finished: got.run.finished };
      if (!got.run.finished) throw new Error('The resumed session ended without a result');
      return state.resume;
    },
    async merge() {
      const got = await host.merge({ work: ORDER.work });
      state.merge = got;
      if (!got.merged) throw new Error(`The helper did not merge the change: ${got.reason ?? 'no reason given'}`);
      return got;
    },
    async report() {
      const steps = budget?.steps ?? state.budgetSteps;
      const subs = (state.build?.subagents ?? 0) + (state.resume?.subagents ?? 0);
      const total = steps.reduce((n, s) => n + s.requests, 0);
      state.report = {
        total,
        budget: budgetLimit,
        steps,
        subagentRuns: subs,
        // Section 5.2 expects 3 to 5 for a quick change. With subagents run and the count unchanged by them, they are free.
        subagentsCharged: subs === 0 ? 'not seen' : (total > steps.length ? 'possibly' : 'no'),
        estimate: { low: 3, high: 5 },
        killed: state.killed === true,
        merged: state.merge?.merged === true,
      };
      return state.report;
    },
  };

  const snap = (point) => {
    if (!snapshot) return;
    const dir = snapshotsFolder(label, base);
    const dest = path.join(dir, `${nextNumber(dir)}-${point}`);
    const { torn } = takeLocal({ folder, dest });
    writeMeta(dest, { point, at: clock(), torn });
  };

  let ranReport = false;
  let stoppedAt = null;
  let why = null;
  for (const step of STEPS.slice(start)) {
    if (doneBefore.has(step.name)) continue;
    const unmet = (step.needs ?? []).find((n) => failedOrSkipped(n));
    if (unmet !== undefined) {
      state.steps[step.name] = { outcome: 'skipped' };
      finding(step.name, `Skipped: ${unmet} did not complete`);
      log({ step: step.name, state: 'done', outcome: 'skipped' });
      save();
      continue;
    }
    // A resumed run builds its budget from what the state kept, not from the month's figure again.
    if (budget === null && !['stage', 'month-check'].includes(step.name) && step.name !== 'report') {
      budget = makeBudget({ limit: budgetLimit, monthUsed: state.monthUsed });
      budget.restore(state.budgetSteps);
    }
    log({ step: step.name, state: 'start' });
    if (step.name === 'report') ranReport = true;
    try {
      const result = await bodies[step.name]();
      state.steps[step.name] = { outcome: 'ok', result };
      log({ step: step.name, state: 'done', outcome: 'ok' });
    } catch (error) {
      if (error instanceof BudgetStop) {
        state.steps[step.name] = { outcome: 'stopped' };
        stoppedAt = step.name;
        why = error.message;
        log({ step: step.name, state: 'done', outcome: 'stopped', why });
        state.budgetSteps = budget?.steps ?? state.budgetSteps;
        save();
        break;
      }
      state.steps[step.name] = { outcome: 'failed', what: error.message };
      finding(step.name, error.message);
      log({ step: step.name, state: 'done', outcome: 'failed' });
      if (step.foundation) {
        stoppedAt = step.name;
        why = error.message;
        save();
        break;
      }
    }
    state.budgetSteps = budget?.steps ?? state.budgetSteps;
    state.used = budget?.used ?? state.used;
    save();
    snap(step.name);
  }

  // Whatever the run's end, a session still running is stopped, and the report is written from what was measured.
  for (const handle of Object.values(handles)) handle.kill();
  if (stoppedAt !== null && !ranReport) {
    try { await bodies.report(); state.steps.report = { outcome: 'ok' }; } catch { /* the figures are in state.budgetSteps */ }
    save();
  }
  fs.writeFileSync(path.join(folder, 'summary.md'), summaryOf(state, { stoppedAt, why }));
  return { done: Object.keys(state.steps).filter((k) => state.steps[k].outcome === 'ok'), findings: state.findings, stoppedAt, why, report: state.report ?? null, state };
}

export function summaryOf(state, { stoppedAt = null, why = null } = {}) {
  const r = state.report;
  const lines = ['<!-- copilot-t3 summary -->', '', '# Stage T3: a piece of work', ''];
  if (stoppedAt !== null) lines.push(`Stopped at **${stoppedAt}**: ${why}`, '');
  if (r) {
    lines.push(`Requests used: **${r.total}** of ${r.budget} (section 5.2 estimated ${r.estimate.low} to ${r.estimate.high}).`, '');
    lines.push('| Step | Requests | Counted |', '|---|---|---|');
    for (const s of r.steps) lines.push(`| ${s.step} | ${s.requests} | ${s.assumed ? 'assumed (no figure left)' : 'read from the CLI'} |`);
    lines.push('', `Killed mid-task: ${r.killed ? 'yes' : 'no'}. Merged: ${r.merged ? 'yes' : 'no'}. Subagent runs: ${r.subagentRuns}; charged as their own requests: ${r.subagentsCharged}.`, '');
  }
  if (state.findings.length > 0) {
    lines.push('## Findings', '');
    for (const f of state.findings) lines.push(`- ${f.step}: ${f.what}`);
  }
  return `${lines.join('\n')}\n`;
}

function args(argv) {
  const out = { cmd: argv[0], label: null, from: null };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--label') out.label = argv[++i];
    else if (argv[i] === '--from') out.from = argv[++i];
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = args(process.argv.slice(2));
  if (a.cmd === 'plan') {
    process.stdout.write(`${STEPS.map((s, i) => `${i + 1}. ${s.name}${s.foundation ? ' (foundation)' : ''}: ${s.what}`).join('\n')}\n\nBudget: ${STAGE_BUDGET} requests, Auto only, no model flag. Nothing is spent by \`plan\`.\n`);
  } else if (a.cmd === 'run') {
    const { realHost } = await import('./host.js');
    const result = await runStage({ host: realHost({ label: a.label }), label: a.label, from: a.from });
    process.stdout.write(`${summaryOf(result.state, result)}\n`);
    process.exitCode = result.stoppedAt !== null || result.findings.length > 0 ? 1 : 0;
  } else {
    process.stderr.write('usage: runner.js plan | run --label <label> [--from auto|<step>]\n');
    process.exitCode = 2;
  }
}
