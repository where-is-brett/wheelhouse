// probes/haiku-trial/score/run.js
// The one way the score runs a child process. Every part takes `run` as an argument so tests stay offline.
import { spawnSync } from 'node:child_process';

// run(cmd, args, {cwd, timeoutMs, env}) -> {status, stdout, stderr}. status is null when the child timed out or never started.
export function defaultRun(cmd, args, { cwd, timeoutMs = 600000, env = {} } = {}) {
  const merged = { ...process.env, ...env };
  for (const key of Object.keys(merged)) if (key.startsWith('NODE_TEST')) delete merged[key];
  const out = spawnSync(cmd, args, { cwd, env: merged, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { status: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '' };
}
