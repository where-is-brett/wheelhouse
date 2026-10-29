// probes/79-archon-spend/run.js
// Check 79 (early check E6): what each step's spend looks like in Archon's record, and how close the spend meter's
// Copilot estimate (prompts sent, times the model's multiplier) comes to GitHub's own premium-request figure.
// stepSpend and estimatePremium are the meter's two halves (spec 10.1); the trial runs Copilot steps and three
// Claude steps through the scratch engine and compares the estimate with GitHub's figure before and after.
//
// Usage: node probes/79-archon-spend/run.js trial --copilot <n> --allowance <n>
//        node probes/79-archon-spend/run.js clean
// The trial reuses check 74's clean home (run check 74's setup first) and its own scratch project under
// $TMPDIR/wheelhouse-archon-checks/e6. It stops before a step that would take GitHub's figure past the allowance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { archonEnv, archonRun, cleanScratch } from '../lib/archon.js';
import { premiumUsed } from '../74-archon-copilot/run.js';
import { startedAsScript } from '../../scripts/lib/started-as-script.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function sumTokens(value) {
  if (!value || typeof value !== 'object') return null;
  return ['input', 'output', 'cacheRead', 'cacheWrite'].reduce((total, key) => total + (Number.isFinite(value[key]) ? value[key] : 0), 0);
}

// One entry per AI step in a `workflow get --json --verbose` record: its provider, model, tokens (all four kinds
// added) and cost. Cost the provider didn't report is null with source 'unavailable', never zero.
export function stepSpend(runRecord) {
  const steps = [];
  for (const node of runRecord?.nodes ?? []) {
    const binding = node?.execution?.binding;
    if (!binding?.provider) continue;
    const spend = node.execution.spend ?? {};
    const reported = spend.costUsd?.source === 'provider' && Number.isFinite(spend.costUsd.value);
    steps.push({
      node: node.nodeId,
      provider: binding.provider,
      model: binding.model?.resolved?.value ?? binding.model?.requested ?? null,
      tokens: spend.tokens?.source === 'provider' ? sumTokens(spend.tokens.value) : null,
      costUsd: reported ? spend.costUsd.value : null,
      source: reported ? 'reported' : 'unavailable',
    });
  }
  return steps;
}

// The prompts each Copilot node sent, from the record: one per attempt, so a retry or a loop round adds one.
export function promptsPerNode(runRecord) {
  const counts = {};
  for (const node of runRecord?.nodes ?? []) {
    if (node?.execution?.binding?.provider !== 'copilot') continue;
    const id = node.execution.attempt?.id ?? `${node.execution.invocation?.id}:${JSON.stringify(node.execution.invocation?.loopPath ?? [])}`;
    counts[node.nodeId] ??= new Set();
    counts[node.nodeId].add(id);
  }
  return Object.fromEntries(Object.entries(counts).map(([name, ids]) => [name, ids.size]));
}

// The meter's Copilot estimate: prompts sent per Copilot step times the model's multiplier. An included model's
// multiplier is 0. A model with no known multiplier is an error, never a zero.
export function estimatePremium(steps, multipliers) {
  let total = 0;
  for (const step of steps) {
    if (step.provider !== 'copilot') continue;
    const multiplier = multipliers[step.model];
    if (!Number.isFinite(multiplier)) throw new Error(`No premium-request multiplier is known for the model ${step.model}`);
    total += (step.prompts ?? 1) * multiplier;
  }
  return total;
}

// ---- the trial ----

const ROOT = path.join(os.tmpdir(), 'wheelhouse-archon-checks');
const DIR = path.join(ROOT, 'e6');
const E1 = path.join(ROOT, 'e1');
const COPILOT = path.join(os.homedir(), '.wheelhouse-probes', 'copilot', '1.0.101', 'node_modules', '.bin', `copilot-darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}`);

function git(cwd, args) { execFileSync('git', args, { cwd, stdio: 'ignore' }); }
function usage() {
  const data = JSON.parse(execFileSync('gh', ['api', '/copilot_internal/user'], { encoding: 'utf8' }));
  return { at: new Date().toISOString(), quota_snapshots: { premium_interactions: data.quota_snapshots?.premium_interactions } };
}

function makeProject() {
  const project = path.join(DIR, 'project');
  fs.mkdirSync(path.join(project, '.archon', 'workflows'), { recursive: true });
  for (const file of ['copilot-step.yaml', 'copilot-loop.yaml', 'claude-step.yaml']) {
    fs.copyFileSync(path.join(HERE, file), path.join(project, '.archon', 'workflows', file));
  }
  fs.writeFileSync(path.join(project, 'README.md'), '# Scratch project for check 79\n');
  git(project, ['init', '-q', '-b', 'main']);
  git(project, ['add', '-A']);
  git(project, ['-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid', 'commit', '-qm', 'Scratch project for check 79']);
  git(DIR, ['init', '-q', '--bare', 'remote.git']);
  git(project, ['remote', 'add', 'origin', path.join(DIR, 'remote.git')]);
  git(project, ['push', '-q', 'origin', 'main']);
  return project;
}

async function runOne(workflow, { env, bin, cwd }) {
  const started = await archonRun(['workflow', 'run', workflow, '--detach'], { env, bin, cwd, timeoutMs: 120000 });
  const runId = /Run id:\s*([0-9a-f]+)/.exec(started.stdout)?.[1];
  if (!runId) return { workflow, error: (started.stderr || started.stdout).slice(0, 500) };
  await archonRun(['workflow', 'wait', runId], { env, bin, cwd, timeoutMs: 900000 });
  const got = await archonRun(['workflow', 'get', runId, '--json', '--verbose'], { env, bin, cwd, timeoutMs: 120000 });
  return { workflow, runId, status: got.json?.status, steps: stepSpend(got.json), prompts: promptsPerNode(got.json), metadata: { cost: got.json?.metadata?.total_cost_usd, tokensIn: got.json?.metadata?.total_tokens_in, tokensOut: got.json?.metadata?.total_tokens_out } };
}

// Runs `copilot` single Copilot steps (the last two as one looping workflow with retries), then three Claude steps.
async function trial({ copilot = 20, allowance = 0 } = {}) {
  fs.mkdirSync(DIR, { recursive: true });
  const project = makeProject();
  const env = archonEnv({ home: path.join(ROOT, 'home'), bunDir: path.join(ROOT, 'bun'), claudeBin: path.join(os.homedir(), '.local', 'bin', 'claude'), copilotBin: COPILOT, extra: { COPILOT_HOME: path.join(E1, 'copilot-home') } });
  const bin = path.join(ROOT, 'bin', 'archon');
  const before = usage();
  const runs = [];
  const singles = Math.max(0, copilot - 3);
  for (let i = 0; i < singles; i += 1) {
    if (premiumUsed(usage()) - premiumUsed(before) >= allowance) { runs.push({ stopped: 'allowance reached' }); break; }
    runs.push(await runOne('e6-copilot-step', { env, bin, cwd: project }));
  }
  if (premiumUsed(usage()) - premiumUsed(before) + 3 <= allowance) runs.push(await runOne('e6-copilot-loop', { env, bin, cwd: project }));
  for (let i = 0; i < 3; i += 1) runs.push(await runOne('e6-claude-step', { env, bin, cwd: project }));
  await new Promise((done) => setTimeout(done, 90000));
  const after = usage();
  const copilotSteps = runs.flatMap((r) => (r.steps ?? []).filter((s) => s.provider === 'copilot').map((s) => ({ ...s, prompts: r.prompts?.[s.node] ?? 1 })));
  const result = { before, after, githubDelta: premiumUsed(after) - premiumUsed(before), estimate: estimatePremium(copilotSteps, { auto: 1 }), runs };
  fs.writeFileSync(path.join(DIR, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`GitHub's figure rose by ${result.githubDelta}; the estimate is ${result.estimate}; ${runs.length} runs`);
}

if (startedAsScript(import.meta.url)) {
  const [step, ...rest] = process.argv.slice(2);
  const option = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  if (step === 'trial') await trial({ copilot: Number(option('--copilot') ?? 20), allowance: Number(option('--allowance') ?? 0) });
  else if (step === 'clean') { await cleanScratch(DIR); console.log(`Moved ${DIR} to the Trash`); }
  else { console.error('Usage: run.js trial|clean'); process.exit(2); }
}
