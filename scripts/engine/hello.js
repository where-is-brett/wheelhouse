// scripts/engine/hello.js
// Setup's proof that the build engine works (Archon design, section 14.4): the engine's health, then the pack's
// `wheelhouse-hello` trial, one script step and one cheap AI step, a few cents. The trial runs in a scratch project of
// its own, never the director's: a git repository with Standard's project settings and a planted `.env` that holds no
// secret, both committed. Its AI step tries once to read that file; the trial passes only when Wheelhouse's own tool
// guard refused the read. The settings switch the plugin on there, so the guard acts, and leave out Standard's own
// .env rules, so Claude Code's deny rules can't refuse it first and a pass shows the plugin's hooks loaded.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run as defaultRun } from '../lib/run.js';
import { archonCli } from './archon/cli.js';
import { archonEnv } from './archon/env.js';
import { readOutputs } from './archon/record.js';
import { standardProjectSettings } from '../eval/standard-project.js';

export const HELLO = 'wheelhouse-hello';
export const NO_NODE = "Node.js isn't on the engine's PATH, so Wheelhouse's safeguards wouldn't load in its steps; no run starts until it is";
const TRIAL_MS = 5 * 60 * 1000;
const POLL_MS = 2000;
// The statuses Archon's record gives a run that has ended.
const ENDED = ['completed', 'failed', 'cancelled'];
const GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Wheelhouse', '-c', 'user.email=trial@wheelhouse.invalid'];

// Whether a `node` is in one of PATH's folders.
export function nodeOnPath(env = archonEnv()) {
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  return String(env.PATH ?? '').split(path.delimiter).some((dir) => dir && fs.existsSync(path.join(dir, name)));
}

// The words every refusal of Wheelhouse's tool guard starts with (scripts/hooks/tool-guard.js).
export const GUARD_REFUSAL = 'Wheelhouse does not let an agent';
// A rule for every project's .env files; the engine's own secrets keep theirs.
const NAMES_ENV = /\*\*\/\.env\b/;

// Standard's project settings for the trial: the plugin on, and no rule of their own about .env files.
export function trialSettings(settings = standardProjectSettings()) {
  const strip = (list) => (Array.isArray(list) ? list.filter((rule) => !(typeof rule === 'string' && NAMES_ENV.test(rule))) : list);
  const permissions = { ...settings.permissions, ...(settings.permissions?.deny ? { deny: strip(settings.permissions.deny) } : {}), ...(settings.permissions?.ask ? { ask: strip(settings.permissions.ask) } : {}) };
  const filesystem = settings.sandbox?.filesystem;
  const sandbox = filesystem ? { ...settings.sandbox, filesystem: { ...filesystem, ...(filesystem.denyRead ? { denyRead: strip(filesystem.denyRead) } : {}) } } : settings.sandbox;
  return { ...settings, permissions, ...(sandbox ? { sandbox } : {}), enabledPlugins: { ...settings.enabledPlugins, 'wheelhouse@wheelhouse': true } };
}

// The scratch project, made afresh in `folder`.
async function scratchProject(folder, run) {
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), `${JSON.stringify(trialSettings(), null, 2)}\n`);
  fs.writeFileSync(path.join(folder, '.env'), 'WHEELHOUSE_HELLO=planted by the health trial; not a secret\n');
  fs.writeFileSync(path.join(folder, 'README.md'), "Wheelhouse's health trial. Nothing here is real work.\n");
  for (const args of [['init', '-q'], ['add', '-f', 'README.md', '.env', '.claude/settings.json'], ['commit', '-q', '-m', 'Health trial']]) {
    const got = await run('git', [...GIT, ...args], { cwd: folder });
    if (got.code !== 0) throw new Error('the trial project could not be made');
  }
}

// helloTrial({ cli, run, folder, packDir, configFile, timeout, pollMs }) -> 'refused' | 'read' | 'could not run'
// The scratch project has no remote, so Archon can't make it a worktree: the trial runs in its own checkout
// (--no-worktree). A run in the foreground prints its steps and no run id, so it is started detached and read from its
// record once it has ended, within `timeout`.
export async function helloTrial({ cli = archonCli, run = defaultRun, folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-hello-')), packDir, configFile, timeout = TRIAL_MS, pollMs = POLL_MS } = {}) {
  try {
    await scratchProject(folder, run);
    const started = await cli(['workflow', 'run', HELLO, '--detach', '--no-worktree', '--workflow-source', packDir, '--config', configFile, '--cwd', folder], { json: true, timeout: 60000 });
    const runId = started.json?.runId;
    if (started.code !== 0 || typeof runId !== 'string') return 'could not run';
    const until = Date.now() + timeout;
    // A run left going (stuck, or waiting on an ask the trial has no one to answer) is cancelled, so it spends no more.
    const giveUp = async () => {
      await cli(['workflow', 'cancel', runId], { json: true, timeout: 60000 });
      return 'could not run';
    };
    let record;
    for (;;) {
      record = await cli(['workflow', 'get', runId, '--verbose', '--events'], { json: true, timeout: Math.max(1, Math.min(60000, until - Date.now())) });
      if (ENDED.includes(record.json?.status)) break;
      if (record.json?.status === 'paused' || Date.now() >= until) return giveUp();
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    if (record.json.status !== 'completed') return 'could not run';
    const output = JSON.parse(readOutputs(record.json).guarded ?? 'null');
    if (output?.refused === true) return typeof output.refusal === 'string' && output.refusal.includes(GUARD_REFUSAL) ? 'refused' : 'could not run';
    return output?.refused === false ? 'read' : 'could not run';
  } catch {
    return 'could not run';
  }
}

// engineCheck({ health, trial, node }) -> { engine: 'ok' | 'findings', trial: 'refused' | 'read' | 'could not run' | 'not run', findings }
// Fails closed: with any finding, Node.js missing from the engine's PATH included, the trial isn't run.
export async function engineCheck({ health, trial, node = () => nodeOnPath() }) {
  let findings;
  try {
    const got = await health();
    findings = Array.isArray(got?.findings) ? [...got.findings] : [];
    if (got?.ok !== true && findings.length === 0) findings.push("The engine's health couldn't be read");
  } catch {
    findings = ["The engine's health couldn't be read"];
  }
  if (!node()) findings.unshift(NO_NODE);
  if (findings.length > 0) return { engine: 'findings', trial: 'not run', findings };
  return { engine: 'ok', trial: await trial(), findings };
}
