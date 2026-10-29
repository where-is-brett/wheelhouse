// scripts/engine/archon/cli.js
// Runs the Archon binary: the one way Wheelhouse does (spec 6.3). There is no environment argument; every
// command gets archonEnv, which carries the telemetry switches.
import path from 'node:path';
import { run as defaultRun } from '../../lib/run.js';
import { engineDir } from '../../lib/paths.js';
import { archonEnv } from './env.js';

// The JSON in `stdout`: the whole text, or else the last line that parses to an object or array. Null when there is none.
export function parseJson(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return null;
  const usable = (value) => (value && typeof value === 'object' ? value : null);
  try { return usable(JSON.parse(text)); } catch { /* not one document */ }
  for (const line of text.split(/\r?\n/).reverse()) {
    try {
      const value = usable(JSON.parse(line));
      if (value) return value;
    } catch { /* next */ }
  }
  return null;
}

// The program, arguments and whole environment for `archon <args>`, for a process the caller supervises itself (the
// continuation host's wake): the same binary and archonEnv as archonCli, and nothing taken from the caller's environment.
export function archonCommand(args, { engine = engineDir(), home, claudeBin, copilotBin, nodeDir } = {}) {
  const env = archonEnv({ engine, home, claudeBin, copilotBin, nodeDir });
  const command = path.join(engine, 'archon', 'bin', process.platform === 'win32' ? 'archon.exe' : 'archon');
  return { command, args: [...args], env };
}

// Runs `archon <args>` in `cwd`. `json: true` adds --json when the arguments lack it. `engine`, `home`, `claudeBin`,
// `copilotBin` and `nodeDir` choose folders and programs for archonEnv (tests use them); none of them is an environment.
// `input` is written to the command's standard input. `onStdout(text)` is given standard output as it comes, and `limit` (bytes) caps what is kept of each stream, for a
// command that runs on (the attention stream). Resolves with { code, json, stdout, stderr }, plus `timedOut` or
// `stopped` when the run ended that way.
export async function archonCli(args, { run = defaultRun, cwd, input, timeout, signal, onStdout, limit, json = false, engine = engineDir(), home, claudeBin, copilotBin, nodeDir } = {}) {
  const full = json && !args.includes('--json') ? [...args, '--json'] : [...args];
  const { command, env } = archonCommand(full, { engine, home, claudeBin, copilotBin, nodeDir });
  const result = await run(command, full, { cwd, env, input, baseEnv: {}, timeoutMs: timeout, signal, onStdout, limit });
  const out = { code: result.code, json: parseJson(result.stdout), stdout: result.stdout, stderr: result.stderr };
  if (result.timedOut) out.timedOut = true;
  if (result.stopped) out.stopped = true;
  return out;
}
