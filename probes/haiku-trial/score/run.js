// probes/haiku-trial/score/run.js
// The one way the score runs a child process. Every part takes `run` as an argument so tests stay offline.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// run(cmd, args, {cwd, timeoutMs, env}) -> {status, stdout, stderr}. status is null when the child timed out or never started.
export function defaultRun(cmd, args, { cwd, timeoutMs = 600000, env = {} } = {}) {
  const merged = { ...process.env, ...env };
  for (const key of Object.keys(merged)) if (key.startsWith('NODE_TEST')) delete merged[key];
  const out = spawnSync(cmd, args, { cwd, env: merged, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { status: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '' };
}

// Installs what package.json lists, with `npm ci` when there is a lockfile and `npm install` when there is not. A project with
// no dependencies needs nothing. Returns { ok, skipped?, command?, why? }.
export function installDependencies(dir, run = defaultRun) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return { ok: true, skipped: true };
  }
  if (Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length === 0) return { ok: true, skipped: true };
  const command = fs.existsSync(path.join(dir, 'package-lock.json')) ? 'ci' : 'install';
  const got = run('npm', [command, '--no-audit', '--no-fund'], { cwd: dir });
  return got.status === 0 ? { ok: true, command: `npm ${command}` } : { ok: false, why: `npm ${command} failed: ${String(got.stderr).trim().split('\n').slice(-3).join(' ')}` };
}
