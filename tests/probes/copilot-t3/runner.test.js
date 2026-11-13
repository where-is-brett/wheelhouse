// tests/probes/copilot-t3/runner.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStage, runFolder, snapshotsFolder, STEPS } from '../../../probes/copilot-t3/runner.js';
import { startRun } from '../../../probes/copilot-t3/session.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-session.js');

// A stand-in host: real child processes (so a kill is a real kill), no Copilot, no git.
function standInHost({ month = 20, buildMode = 'hang', resumeMode = 'finish', resumeRequests = 2, subagents = 0, merge = { merged: true, commit: 'abc' } } = {}) {
  const calls = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-host-'));
  const handle = (name, mode, requests, subs, sessionId) => startRun({
    file: process.execPath, args: [FAKE, mode, path.join(dir, `${name}.usage.json`), String(requests), String(subs)], env: process.env,
    input: '', verbatim: false, output: path.join(dir, `${name}.out`), usageFile: path.join(dir, `${name}.usage.json`), sessionId,
  }, { cwd: dir });
  return {
    calls,
    dir,
    attach: async ({ project, order }) => { calls.push(`attach:${project}:${order.work}`); },
    stage: async ({ folder }) => { calls.push('stage'); fs.mkdirSync(path.join(folder, 'project'), { recursive: true }); return { project: 'local__t3' }; },
    monthUsed: async () => { calls.push('monthUsed'); return month; },
    order: async () => { calls.push('order'); },
    start: async ({ sessionId }) => { calls.push('start'); return handle('build', buildMode, 1, subagents, sessionId); },
    resume: async ({ sessionId }) => { calls.push('resume'); return handle('resume', resumeMode, resumeRequests, 0, sessionId); },
    merge: async () => { calls.push('merge'); return merge; },
  };
}

const setup = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wh-t3-'));
const common = { label: 'a', midTaskTimeoutMs: 5000 };

test('plan names every step once', () => {
  assert.deepEqual(STEPS.map((s) => s.name), ['stage', 'month-check', 'order', 'build', 'resume', 'merge', 'report']);
});

test('a piece runs end to end: killed once mid-task, resumed, merged, and the requests are reported', async () => {
  const base = setup();
  const host = standInHost();
  const r = await runStage({ host, base, ...common });
  assert.equal(r.stoppedAt, null);
  assert.deepEqual(host.calls, ['stage', 'monthUsed', 'order', 'start', 'resume', 'merge']);
  assert.equal(r.report.killed, true);
  assert.equal(r.report.merged, true);
  // The killed build left no figure, so it counts as 1 (assumed); the resumed session reads 2 cumulative, so 1 more.
  assert.deepEqual(r.report.steps.map((s) => [s.step, s.requests, s.assumed]), [['build', 1, true], ['resume', 1, false]]);
  assert.equal(r.report.total, 2);
  assert.deepEqual(r.findings, []);
  const log = fs.readFileSync(path.join(runFolder('a', base), 'run-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(log.some((e) => e.step === 'build' && e.state === 'done' && e.outcome === 'ok'));
  assert.match(fs.readFileSync(path.join(runFolder('a', base), 'summary.md'), 'utf8'), /Requests used: \*\*2\*\* of 10/);
  assert.ok(fs.readdirSync(snapshotsFolder('a', base)).some((n) => n.endsWith('-build')));
});

test('the build and the resume carry one session id', async () => {
  const base = setup();
  const host = standInHost();
  const r = await runStage({ host, base, ...common });
  const ids = new Set(r.report.steps.map((s) => s.session));
  assert.equal(ids.size, 1);
});

test('subagent runs are counted and, when the total does not rise with them, reported as not charged', async () => {
  const base = setup();
  const r = await runStage({ host: standInHost({ subagents: 2 }), base, ...common });
  assert.equal(r.report.subagentRuns, 2);
  assert.equal(r.report.subagentsCharged, 'no');
});

test('the stage stops before it goes over its budget and still reports', async () => {
  const base = setup();
  const host = standInHost();
  const r = await runStage({ host, base, budgetLimit: 1, ...common });
  assert.equal(r.stoppedAt, 'resume');
  assert.match(r.why, /would take the stage to 2 of its 1/);
  assert.ok(!host.calls.includes('resume'));
  assert.equal(r.report.total, 1);
});

test('a month that cannot be read stops the run before any session starts', async () => {
  const base = setup();
  const host = standInHost({ month: null });
  const r = await runStage({ host, base, ...common });
  assert.equal(r.stoppedAt, 'month-check');
  assert.ok(!host.calls.includes('start'));
});

test('a month that would pass 150 stops the run before any session starts', async () => {
  const base = setup();
  const host = standInHost({ month: 150 });
  const r = await runStage({ host, base, ...common });
  assert.equal(r.stoppedAt, 'build');
  assert.ok(!host.calls.includes('start'));
});

test('a merge that fails is a finding, and the report is still written', async () => {
  const base = setup();
  const r = await runStage({ host: standInHost({ merge: { merged: false, reason: 'clash' } }), base, ...common });
  assert.equal(r.stoppedAt, null);
  assert.ok(r.findings.some((f) => f.step === 'merge' && /clash/.test(f.what)));
  assert.equal(r.report.merged, false);
});

test('a session that finishes before it is killed is a finding: crash resume was not exercised', async () => {
  const base = setup();
  const r = await runStage({ host: standInHost({ buildMode: 'finish' }), base, ...common });
  assert.ok(r.findings.some((f) => /crash resume was not exercised|ended before it could be killed/.test(f.what)));
});

test('a later attempt with --from auto carries on from where the stage stopped, with the budget already spent kept', async () => {
  const base = setup();
  const first = await runStage({ host: standInHost(), base, budgetLimit: 1, ...common });
  assert.equal(first.stoppedAt, 'resume');
  const host = standInHost();
  const second = await runStage({ host, base, from: 'auto', ...common });
  assert.ok(!host.calls.includes('start'));
  assert.ok(!host.calls.includes('stage'));
  assert.equal(second.stoppedAt, null);
  assert.deepEqual(host.calls, ['attach:local__t3:t3-greeting', 'resume', 'merge']);
  // The first attempt's build (1, assumed) is kept, and the resume reads 1 more from the session's cumulative figure.
  assert.equal(second.report.total, 2);
});

test('a label with a path in it is refused', async () => {
  await assert.rejects(runStage({ host: standInHost(), base: setup(), label: '../x' }), /label/);
});

test('a run is killed when its spend reaches what the budget has left, so the stage does not end over', async () => {
  const base = setup();
  // The build counts 1 (killed, no figure); the resume has 3 left (cumulative 4) and spends 6.
  const r = await runStage({ host: standInHost({ resumeMode: 'spend', resumeRequests: 4 }), base, budgetLimit: 4, ...common });
  assert.ok(r.findings.some((f) => f.step === 'resume' && /reached the 3 requests/.test(f.what)));
  assert.deepEqual(r.report.steps.map((s) => [s.step, s.requests]), [['build', 1], ['resume', 3]]);
  assert.ok(r.report.total <= 4);
});

test('a resume from a later step tells the host where the project is', async () => {
  const base = setup();
  const first = standInHost();
  await runStage({ host: first, base, ...common });
  const host = standInHost();
  await runStage({ host, base, from: 'merge', ...common });
  assert.deepEqual(host.calls, ['attach:local__t3:t3-greeting', 'merge']);
});
