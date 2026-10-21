// probes/lib/copilot.js
// Copilot CLI for the probes: installed into a folder of its own under ~/.wheelhouse-probes (never
// globally), run from a scratch home so it never reads or writes the person's real ~/.copilot, and
// started without the caller's host tokens. Nothing here runs at load time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../../scripts/lib/run.js';
import { COPILOT_VERSION } from '../../scripts/lib/copilot-numbers.js';
import { assertUnderTmp } from './scratch.js';

export { COPILOT_VERSION };

const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
// Variables that carry a host's token. A probe's Copilot gets its sign-in from its own home, never these.
const TOKEN_VARIABLE = /^(GH|GITHUB|COPILOT_GITHUB|GITLAB|GLAB)_[A-Z0-9_]*TOKEN$/i;

// Where a version is installed: ~/.wheelhouse-probes/copilot/<version>/.
export function defaultPrefix(version = COPILOT_VERSION, home = os.homedir()) {
  if (!VERSION.test(version)) throw new Error(`Not a Copilot version: ${JSON.stringify(version)}`);
  return path.join(home, '.wheelhouse-probes', 'copilot', version);
}

// The program npm puts in the prefix.
export function copilotBin(prefix, { platform = process.platform } = {}) {
  return path.join(prefix, 'node_modules', '.bin', platform === 'win32' ? 'copilot.cmd' : 'copilot');
}

// Installs @github/copilot at an exact version into `prefix`, never globally.
export async function installCopilot({ version = COPILOT_VERSION, prefix, platform = process.platform } = {}) {
  if (!VERSION.test(version)) throw new Error(`Not a Copilot version: ${JSON.stringify(version)}`);
  const into = prefix ?? defaultPrefix(version);
  await fs.promises.mkdir(into, { recursive: true });
  const npm = platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = await run(npm, ['install', '--prefix', into, `@github/copilot@${version}`], { cwd: into });
  if (result.code !== 0) throw new Error(`npm could not install Copilot CLI ${version}: ${result.stderr.trim().slice(0, 300)}`);
  const bin = copilotBin(into, { platform });
  if (!fs.existsSync(bin)) throw new Error(`npm finished, but there is no Copilot CLI at ${bin}`);
  return { bin };
}

// An empty folder for COPILOT_HOME, under the system's temporary folder.
export function scratchCopilotHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-copilot-home-'));
  assertUnderTmp(dir);
  return {
    dir,
    remove() {
      assertUnderTmp(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// The environment a probe's Copilot gets: the caller's, without any host token, with COPILOT_HOME set.
export function copilotEnv({ env = {}, home, baseEnv = process.env } = {}) {
  if (!home) throw new Error('A probe runs Copilot from a home of its own: pass `home`');
  const kept = {};
  for (const [name, value] of Object.entries({ ...baseEnv, ...env })) {
    if (!TOKEN_VARIABLE.test(name) && value !== undefined && value !== null) kept[name] = value;
  }
  return { ...kept, COPILOT_HOME: home };
}

// The lines of `text` as JSON objects when every non-empty line is one; otherwise [].
export function jsonEvents(text) {
  const lines = String(text ?? '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];
  const events = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value === null || typeof value !== 'object') return [];
      events.push(value);
    } catch {
      return [];
    }
  }
  return events;
}

// Runs Copilot once. `bin` is a path from copilotBin, or the name `copilot` found on the PATH.
// A run still going at `timeoutMs` is stopped and the result says `timedOut: true`.
export async function runCopilot({ args = [], cwd, env, home, timeoutMs = 120000, bin = 'copilot' } = {}) {
  const result = await run(bin, args, { cwd, env: copilotEnv({ env, home }), baseEnv: {}, timeoutMs });
  return {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    events: jsonEvents(result.stdout),
    timedOut: result.timedOut === true,
  };
}

const SIGNED_OUT = /log ?in|sign ?in|authenticat|not logged|unauthori[sz]ed/i;

// Whether Copilot answers a plain question from this home without asking to be signed in.
export async function signedIn({ home, bin = 'copilot', timeoutMs = 90000 } = {}) {
  const result = await runCopilot({ args: ['-p', 'Reply with the single word ok.'], home, bin, timeoutMs });
  if (result.timedOut || result.code !== 0) return false;
  return !SIGNED_OUT.test(result.stdout + result.stderr);
}
