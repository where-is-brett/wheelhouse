// probes/74-archon-copilot/run.js
// Check 74 (early check E1): does Archon's compiled binary run a Copilot step, with the CLI found by
// COPILOT_BIN_PATH and signed in by `copilot login`, and do the clean home's guards and skills reach it?
// The five items are spec 15's. The trial runs one workflow (hello.yaml) with one Copilot step that is asked to
// quote the tdd skill's probe marker and then to read a planted .env file.
//
// The clean home (COPILOT_HOME) holds only: the sign-in's config.json from the probes' login home, the Lean kit's
// guard registered as the CLI's own preToolUse hook (wrapped by hook-wrap.js, which logs each answer), and a copy of
// Matt Pocock's tdd skill (1.3.1, with its licence) carrying one added probe-marker line.
// GitHub's premium-request figure is read before and after from `gh api /copilot_internal/user` (its
// quota_snapshots.premium_interactions), with the director's existing gh sign-in, in this process only.
//
// Usage: node probes/74-archon-copilot/run.js setup [--skill-in home|project]
//        node probes/74-archon-copilot/run.js trial [--allowance <n>]
//        node probes/74-archon-copilot/run.js tally
//        node probes/74-archon-copilot/run.js clean
// Everything lives under $TMPDIR/wheelhouse-archon-checks/e1 (state.json keeps what the steps share).
// Model runs: one per trial.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { archonEnv, archonRun, cleanScratch } from '../lib/archon.js';
import { assertUnderTmp } from '../lib/scratch.js';
import { startedAsScript } from '../../scripts/lib/started-as-script.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
export const MARKER = 'Probe marker: KESTREL-74';

// The figure GitHub reports for premium requests used this month, or null when it isn't there.
export function premiumUsed(usage) {
  const quota = usage?.quota_snapshots?.premium_interactions;
  if (!quota || typeof quota !== 'object') return null;
  if (Number.isFinite(quota.credits_used)) return quota.credits_used;
  if (Number.isFinite(quota.entitlement) && Number.isFinite(quota.remaining)) return quota.entitlement - quota.remaining;
  return null;
}

// How many premium requests were used between two readings; null when either is missing.
export function premiumDelta(before, after) {
  const a = premiumUsed(before);
  const b = premiumUsed(after);
  if (a === null || b === null) return null;
  return b - a;
}

function copilotNode(record) {
  return (record?.nodes ?? []).find((node) => node?.execution?.binding?.provider === 'copilot') ?? null;
}

function argsText(input) {
  const args = input?.toolArgs ?? input?.tool_input ?? input?.arguments;
  if (args === undefined) return '';
  return typeof args === 'string' ? args : JSON.stringify(args);
}

// Whether a hook-log entry is a refused attempt to read a .env file.
function refusedEnvRead(entry) {
  if (entry?.answer !== 'deny') return false;
  return /(^|[\s/"'=])\.env(\b|$)/.test(argsText(entry.input));
}

// The five items of spec 15's E1. A run that never started, a missing figure or an empty log is a failure.
// `allowance` is the number of premium requests the director allowed for this run (0 unless they said otherwise).
export function tallyE1({ runRecord, usageBefore, usageAfter, hookLog, skillSeen, allowance = 0 }) {
  const node = copilotNode(runRecord);
  const items = [];
  const ran = Boolean(node) && node.state === 'completed' && runRecord?.status === 'completed';
  items.push({ n: 1, pass: ran, why: ran ? 'the Copilot step completed' : node ? `the Copilot step ended ${node.state}, run ${runRecord?.status}` : 'no Copilot step ran' });

  const delta = premiumDelta(usageBefore, usageAfter);
  const within = delta !== null && delta <= allowance;
  items.push({ n: 2, pass: within, why: delta === null ? 'a premium-request figure could not be read' : `premium requests rose by ${delta} (allowed ${allowance})` });

  const refused = (hookLog ?? []).some(refusedEnvRead);
  items.push({ n: 3, pass: refused, why: refused ? 'the guard refused the .env read' : (hookLog ?? []).length === 0 ? 'the hook never ran' : 'the hook ran but no .env read was refused' });

  const tokens = node?.execution?.spend?.tokens;
  const hasTokens = tokens?.source === 'provider' && Number.isFinite(tokens?.value?.input) && tokens.value.input > 0;
  items.push({ n: 4, pass: hasTokens, why: hasTokens ? `the record shows ${tokens.value.input} input and ${tokens.value.output} output tokens` : 'the record has no tokens for the step' });

  items.push({ n: 5, pass: skillSeen === true, why: skillSeen ? 'the step quoted the skill\'s probe marker' : 'the skill\'s probe marker never appeared' });
  return { items };
}

// ---- the trial ----

const ROOT = path.join(os.tmpdir(), 'wheelhouse-archon-checks');
const DIR = path.join(ROOT, 'e1');
const STATE = path.join(DIR, 'state.json');
const COPILOT = path.join(os.homedir(), '.wheelhouse-probes', 'copilot', '1.0.101', 'node_modules', '.bin', `copilot-darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}`);
const LOGIN_HOME = path.join(os.homedir(), '.wheelhouse-probes', 'login-home');
const TDD = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'wheelhouse', 'mattpocock-skills', '1.3.1');

function readState() { return JSON.parse(fs.readFileSync(STATE, 'utf8')); }
function writeState(state) { fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n'); }
function git(cwd, args) { execFileSync('git', args, { cwd, stdio: 'ignore' }); }

function copySkill(into) {
  const from = path.join(TDD, 'skills', 'engineering', 'tdd');
  fs.cpSync(from, into, { recursive: true });
  fs.copyFileSync(path.join(TDD, 'LICENSE'), path.join(into, 'LICENSE'));
  fs.appendFileSync(path.join(into, 'SKILL.md'), `\n${MARKER}\n`);
  fs.writeFileSync(path.join(into, 'SOURCE.txt'), 'Matt Pocock\'s skills, version 1.3.1, skills/engineering/tdd (MIT). One probe-marker line added.\n');
}

function engine() {
  return { archonBin: path.join(ROOT, 'bin', 'archon'), bunDir: path.join(ROOT, 'bun'), home: path.join(ROOT, 'home') };
}

function readUsage() {
  const out = execFileSync('gh', ['api', '/copilot_internal/user'], { encoding: 'utf8' });
  const data = JSON.parse(out);
  return { at: new Date().toISOString(), quota_snapshots: { premium_interactions: data.quota_snapshots?.premium_interactions } };
}

async function setup({ skillIn = 'home' } = {}) {
  assertUnderTmp(DIR);
  fs.mkdirSync(DIR, { recursive: true });
  const home = path.join(DIR, 'copilot-home');
  const project = path.join(DIR, 'project');
  fs.mkdirSync(path.join(home, 'hooks'), { recursive: true });
  fs.copyFileSync(path.join(LOGIN_HOME, 'config.json'), path.join(home, 'config.json'));
  fs.chmodSync(path.join(home, 'config.json'), 0o600);
  const guard = path.join(home, 'hooks', 'wheelhouse-lean-guard.sh');
  fs.copyFileSync(path.join(REPO, 'adapters', 'copilot', 'home', 'hooks', 'wheelhouse-lean-guard.sh'), guard);
  const hookLog = path.join(DIR, 'hook-log.jsonl');
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(HERE, 'hook-wrap.js'))} ${JSON.stringify(hookLog)} ${JSON.stringify(guard)}`;
  const hooks = { version: 1, hooks: { preToolUse: [{ type: 'command', command, bash: command, timeoutSec: 120 }] } };
  fs.writeFileSync(path.join(home, 'hooks', 'wheelhouse.json'), JSON.stringify(hooks, null, 2) + '\n');

  fs.mkdirSync(path.join(project, '.archon', 'workflows'), { recursive: true });
  fs.copyFileSync(path.join(HERE, 'hello.yaml'), path.join(project, '.archon', 'workflows', 'hello.yaml'));
  fs.writeFileSync(path.join(project, 'README.md'), '# Scratch project for check 74\n');
  // The guard acts only in a Lean project (.git and .wheelhouse/record/), and Archon runs the step in a worktree made
  // from the remote, so the record folder and the planted (fake) .env are committed.
  fs.mkdirSync(path.join(project, '.wheelhouse', 'record'), { recursive: true });
  fs.writeFileSync(path.join(project, '.wheelhouse', 'record', '.gitkeep'), '');
  fs.writeFileSync(path.join(project, '.env'), 'PROBE_SECRET=planted-by-check-74-not-a-real-secret\n');
  copySkill(skillIn === 'project' ? path.join(project, '.agents', 'skills', 'tdd') : path.join(home, 'skills', 'tdd'));
  git(project, ['init', '-q', '-b', 'main']);
  git(project, ['add', '-A']);
  git(project, ['-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid', 'commit', '-qm', 'Scratch project for check 74']);
  git(DIR, ['init', '-q', '--bare', 'remote.git']);
  git(project, ['remote', 'add', 'origin', path.join(DIR, 'remote.git')]);
  git(project, ['push', '-q', 'origin', 'main']);
  writeState({ home, project, hookLog, skillIn });
  console.log(`Set up in ${DIR} (skill in the ${skillIn === 'project' ? 'project' : 'clean home'})`);
}

async function trial({ allowance = 0 } = {}) {
  const state = readState();
  const { archonBin, bunDir, home } = engine();
  const env = archonEnv({ home, bunDir, claudeBin: path.join(os.homedir(), '.local', 'bin', 'claude'), copilotBin: COPILOT, extra: { COPILOT_HOME: state.home } });
  state.usageBefore = readUsage();
  const started = await archonRun(['workflow', 'run', 'e1-hello', '--detach'], { env, bin: archonBin, cwd: state.project, timeoutMs: 120000 });
  const runId = /Run id:\s*([0-9a-f]+)/.exec(started.stdout)?.[1] ?? started.json?.runId ?? null;
  state.runId = runId;
  if (runId) {
    await archonRun(['workflow', 'wait', runId], { env, bin: archonBin, cwd: state.project, timeoutMs: 600000 });
    const got = await archonRun(['workflow', 'get', runId, '--json', '--verbose'], { env, bin: archonBin, cwd: state.project, timeoutMs: 120000 });
    state.runRecord = got.json;
    const transcript = got.json?.transcript_path;
    state.transcriptHasMarker = Boolean(transcript && fs.existsSync(transcript) && fs.readFileSync(transcript, 'utf8').includes('KESTREL-74'));
  } else {
    state.startError = (started.stderr || started.stdout).slice(0, 2000);
  }
  // GitHub's figure can lag; read it again after a minute.
  await new Promise((done) => setTimeout(done, 60000));
  state.usageAfter = readUsage();
  state.allowance = allowance;
  writeState(state);
  console.log(`Run ${runId ?? '(did not start)'}; premium requests ${premiumUsed(state.usageBefore)} -> ${premiumUsed(state.usageAfter)}`);
}

function readHookLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function tally() {
  const state = readState();
  const node = copilotNode(state.runRecord);
  const skillSeen = /KESTREL-74/.test(node?.outputPreview ?? '') || state.transcriptHasMarker === true;
  const result = tallyE1({ runRecord: state.runRecord, usageBefore: state.usageBefore, usageAfter: state.usageAfter, hookLog: readHookLog(state.hookLog), skillSeen, allowance: state.allowance ?? 0 });
  for (const item of result.items) console.log(`${item.n}. ${item.pass ? 'pass' : 'FAIL'}: ${item.why}`);
  return result;
}

async function clean() {
  await cleanScratch(DIR);
  console.log(`Moved ${DIR} to the Trash`);
}

if (startedAsScript(import.meta.url)) {
  const [step, ...rest] = process.argv.slice(2);
  const option = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const steps = {
    setup: () => setup({ skillIn: option('--skill-in') ?? 'home' }),
    trial: () => trial({ allowance: Number(option('--allowance') ?? 0) }),
    tally,
    clean,
  };
  if (!steps[step]) { console.error('Usage: run.js setup|trial|tally|clean'); process.exit(2); }
  await steps[step]();
}
