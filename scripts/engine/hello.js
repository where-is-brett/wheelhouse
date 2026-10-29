// scripts/engine/hello.js
// Setup's proof that the build engine works (Archon design, section 14.4): the engine's health, then the pack's
// `wheelhouse-hello` trial, one script step and one cheap AI step, a few cents. The trial runs in a scratch project of
// its own, never the director's: a git repository with Standard's project settings and a planted `.env` that holds no
// secret. Its AI step tries once to read that file; the trial passes only when the read is refused.
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
const GIT = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Wheelhouse', '-c', 'user.email=trial@wheelhouse.invalid'];

// Whether a `node` is in one of PATH's folders.
export function nodeOnPath(env = archonEnv()) {
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  return String(env.PATH ?? '').split(path.delimiter).some((dir) => dir && fs.existsSync(path.join(dir, name)));
}

// The scratch project, made afresh in `folder`.
async function scratchProject(folder, run) {
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), `${JSON.stringify(standardProjectSettings(), null, 2)}\n`);
  fs.writeFileSync(path.join(folder, '.env'), 'WHEELHOUSE_HELLO=planted by the health trial; not a secret\n');
  fs.writeFileSync(path.join(folder, 'README.md'), "Wheelhouse's health trial. Nothing here is real work.\n");
  for (const args of [['init', '-q'], ['add', 'README.md', '.claude/settings.json'], ['commit', '-q', '-m', 'Health trial']]) {
    const got = await run('git', [...GIT, ...args], { cwd: folder });
    if (got.code !== 0) throw new Error('the trial project could not be made');
  }
}

// helloTrial({ cli, run, folder, packDir, configFile }) -> 'refused' | 'read' | 'could not run'
export async function helloTrial({ cli = archonCli, run = defaultRun, folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-hello-')), packDir, configFile, timeout = TRIAL_MS } = {}) {
  try {
    await scratchProject(folder, run);
    const started = await cli(['workflow', 'run', HELLO, '--workflow-source', packDir, '--config', configFile, '--cwd', folder], { json: true, timeout });
    const runId = started.json?.runId;
    if (started.code !== 0 || typeof runId !== 'string') return 'could not run';
    const record = await cli(['workflow', 'get', runId, '--verbose'], { json: true, timeout: 60000 });
    const output = JSON.parse(readOutputs(record.json).guarded ?? 'null');
    if (output?.refused === true) return 'refused';
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
