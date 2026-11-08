// probes/96-helm/run.js
// Check 96: the helm's interactive forms keep the session's grant and mode. Run by hand, never by `npm test`:
//   node probes/96-helm/run.js
// In a scratch project with a hook that logs every event, it starts a session with `-p` (featureStartCall) under a known id, a mode
// and one granted tool; opens it with featureHelmCall resuming (start: false) in tmux, sends one prompt that uses the
// granted tool and `/exit`; then opens a second session with featureHelmCall starting (start: true, the prompt positional)
// and does the same. The report goes to probes/96-helm/reports/<date>.json. Exit 0 when all four answers are true.
// It spends a few model calls on the cheapest model.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeScratchProject } from '../lib/scratch.js';
import { featureHelmCall, featureStartCall } from '../../adapters/claude-code/sessions.js';

const probeDir = path.dirname(fileURLToPath(import.meta.url));
const MODE = 'acceptEdits';
const MODEL = 'haiku';
const GRANT = 'Bash(node:*)';
const TOOL_PROMPT = 'Run exactly this one Bash command and then say done: node -e "console.log(\'probe96-ok\')"';
const config = { sessionMode: MODE, routing: { feature: MODEL } };
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const say = (text) => process.stdout.write(`${text}\n`);

const quote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;
const tmux = (...args) => spawnSync('tmux', args, { encoding: 'utf8' });
const alive = (name) => tmux('has-session', '-t', name).status === 0;
const screen = (name) => tmux('capture-pane', '-p', '-t', name, '-S', '-300').stdout ?? '';

// Polls `check` every 500 ms until it returns something other than false/null, or the time is up (then null).
async function until(check, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const found = check();
    if (found) return found;
    await sleep(500);
  }
  return null;
}

function records(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// One interactive form in tmux: `call` is a featureHelmCall result. Returns what the pane showed and what the hooks logged.
async function sitting({ label, call, dir, logFile, sendPrompt }) {
  const name = `wh96-${label}-${crypto.randomBytes(3).toString('hex')}`;
  const launcher = path.join(dir, `${label}-launch.sh`);
  const exports = Object.entries(call.env).filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)).map(([k, v]) => `export ${k}=${quote(v)}`);
  fs.writeFileSync(launcher, `#!/bin/sh\n${exports.join('\n')}\nexec ${[call.file, ...call.args].map(quote).join(' ')}\n`, { mode: 0o700 });
  const since = new Date().toISOString();
  const seen = { dialog: false, ended: false, exitedBy: null };
  try {
    const started = tmux('new-session', '-d', '-s', name, '-x', '200', '-y', '50', '-c', dir, `sh ${quote(launcher)}`);
    if (started.status !== 0) throw new Error(`tmux would not start: ${started.stderr}`);
    // Ready: the input box is there. A trust question for the scratch folder is answered with its default (Enter).
    const ready = await until(() => {
      const text = screen(name);
      if (/trust (this|the files in this) folder|Yes, I trust/i.test(text)) tmux('send-keys', '-t', name, 'Enter');
      return /\? for shortcuts|bypass permissions|accept edits on|esc to interrupt/i.test(text) ? text : null;
    }, 90000);
    if (!ready) throw new Error('the session never showed its input box');
    if (sendPrompt) {
      tmux('send-keys', '-t', name, '-l', TOOL_PROMPT);
      await sleep(300);
      tmux('send-keys', '-t', name, 'Enter');
    }
    // The granted tool ran when its PostToolUse is logged; a permission question on screen means the grant did not hold.
    const ran = await until(() => {
      const text = screen(name);
      if (/Do you want to (proceed|allow|make)|Allow this|Yes, and don't ask again/i.test(text)) seen.dialog = true;
      return records(logFile).some((r) => r.at >= since && r.event === 'PostToolUse' && r.tool === 'Bash') || seen.dialog ? true : null;
    }, 120000);
    seen.toolRan = Boolean(ran) && !seen.dialog;
    // Let the turn finish before leaving: the input box returns.
    await sleep(3000);
    await until(() => !/esc to interrupt/i.test(screen(name)), 60000);
    tmux('send-keys', '-t', name, '-l', '/exit');
    await sleep(500);
    tmux('send-keys', '-t', name, 'Enter');
    let gone = await until(() => !alive(name), 20000);
    if (!gone) {
      tmux('send-keys', '-t', name, 'Enter');
      gone = await until(() => !alive(name), 20000);
    }
    seen.ended = Boolean(gone);
    seen.exitedBy = '/exit';
    if (gone) await until(() => records(logFile).some((r) => r.at >= since && r.event === 'SessionEnd'), 15000);
    seen.pane = screen(name).split('\n').slice(-12).join('\n');
  } finally {
    if (alive(name)) tmux('kill-session', '-t', name);
    fs.rmSync(launcher, { force: true });
  }
  return { since, until: new Date().toISOString(), ...seen };
}

const summarise = (rows) => ({
  events: rows.map((r) => r.event),
  modes: [...new Set(rows.filter((r) => r.mode !== null).map((r) => r.mode))],
  entrypoints: [...new Set(rows.map((r) => r.entrypoint))],
  roles: [...new Set(rows.map((r) => r.role))],
  tools: rows.filter((r) => r.event === 'PostToolUse').map((r) => r.tool),
  sessionEnd: rows.filter((r) => r.event === 'SessionEnd').map((r) => r.reason),
});

async function main() {
  if (spawnSync('tmux', ['-V']).status !== 0) throw new Error('This probe needs tmux');
  const logFile = path.join(os.tmpdir(), `wheelhouse-probe-96-${crypto.randomBytes(4).toString('hex')}.jsonl`);
  const hook = (event) => ({ [event]: [{ hooks: [{ type: 'command', command: `node ${quote(path.join(probeDir, 'hook.js'))} ${quote(logFile)}`, timeout: 10 }] }] });
  const project = await makeScratchProject({
    name: '96-helm',
    settings: { hooks: Object.assign({}, ...['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionEnd'].map(hook)) },
  });
  const report = { date: new Date().toISOString().slice(0, 10), model: MODEL, mode: MODE, grant: GRANT, forms: {} };
  try {
    const resumeId = crypto.randomUUID();
    const startId = crypto.randomUUID();
    const common = { config, allowed: [GRANT], model: MODEL };
    // 1. The session the helm resumes: started with -p so it exists under a known id.
    const first = featureStartCall({ sessionId: resumeId, prompt: 'Reply with the single word ready.', ...common });
    const ran = spawnSync(first.file, first.args, { cwd: project.dir, env: first.env, input: first.input, encoding: 'utf8', timeout: 180000 });
    report.firstRun = { status: ran.status, entrypoints: [...new Set(records(logFile).map((r) => r.entrypoint))] };
    if (ran.status !== 0) throw new Error(`the -p start failed (status ${ran.status}): ${String(ran.stderr).slice(0, 300)}`);
    // 2. Resuming form, 3. starting form.
    const forms = [
      ['resume', featureHelmCall({ sessionId: resumeId, start: false, ...common }), true],
      ['start', featureHelmCall({ sessionId: startId, start: true, prompt: TOOL_PROMPT, ...common }), false],
    ];
    for (const [label, call, sendPrompt] of forms) {
      say(`Opening the ${label} form...`);
      const result = await sitting({ label, call: { ...call, env: call.env }, dir: project.dir, logFile, sendPrompt });
      const rows = records(logFile).filter((r) => r.at >= result.since && r.at <= result.until);
      report.forms[label] = { args: call.args.map((a) => (a === TOOL_PROMPT ? '<prompt>' : a)), ...result, hooks: summarise(rows) };
    }
    const both = Object.values(report.forms);
    const hooksOf = (f) => f.hooks;
    report.answers = {
      grantHeld: both.every((f) => f.toolRan === true && hooksOf(f).tools.includes('Bash')),
      modeHeld: both.every((f) => hooksOf(f).modes.length > 0 && hooksOf(f).modes.every((m) => m === MODE)),
      entrypointCli: both.every((f) => hooksOf(f).entrypoints.length > 0 && hooksOf(f).entrypoints.every((e) => e === 'cli')),
      sessionEndOnExit: both.every((f) => f.ended === true && hooksOf(f).sessionEnd.length > 0),
    };
    // Recorded observations, not gates.
    report.observations = {
      sessionEndReasons: both.map((f) => hooksOf(f).sessionEnd),
      sessionEndWhileProcessAlive: 'recorded, not gated: each form\'s hooks.sessionEnd holds the reason the SessionEnd hook input carried after /exit, and ended says whether the process had gone by then',
      roleEnvSeen: both.map((f) => hooksOf(f).roles),
    };
  } finally {
    await project.cleanup();
    fs.rmSync(logFile, { force: true });
    for (const name of tmux('list-sessions', '-F', '#{session_name}').stdout?.split('\n') ?? []) if (name.startsWith('wh96-')) tmux('kill-session', '-t', name);
  }
  return report;
}

let report;
try {
  report = await main();
} catch (error) {
  report = { date: new Date().toISOString().slice(0, 10), error: String(error?.message ?? error), answers: {} };
}
fs.mkdirSync(path.join(probeDir, 'reports'), { recursive: true });
const out = path.join(probeDir, 'reports', `${report.date}.json`);
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
const answers = report.answers ?? {};
for (const key of ['grantHeld', 'modeHeld', 'entrypointCli', 'sessionEndOnExit']) say(`${key}: ${answers[key] === true ? 'yes' : 'NO'}`);
if (report.error) say(`Error: ${report.error}`);
say(`Report: ${out}`);
process.exit(['grantHeld', 'modeHeld', 'entrypointCli', 'sessionEndOnExit'].every((k) => answers[k] === true) ? 0 : 1);
