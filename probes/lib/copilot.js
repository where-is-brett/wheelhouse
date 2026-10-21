// probes/lib/copilot.js
// Copilot CLI for the probes: installed into a folder of its own under ~/.wheelhouse-probes (never
// globally), run from a scratch home so it never reads or writes the person's real ~/.copilot, and
// started without the caller's host tokens. Nothing here runs at load time.
//
// Sign-in: Copilot CLI keeps the sign-in token in the operating system's keychain. A home only holds a
// non-secret config.json (the signed-in users), which is how a home finds the keychain entry. The sign-in
// is made once, with COPILOT_HOME set to the login home; a scratch home starts signed in only when that
// config.json is copied into it (scratchCopilotHome's `signedInFrom`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../../scripts/lib/run.js';
import { quoteForCmd } from '../../scripts/lib/claude.js';
import { COPILOT_VERSION } from '../../scripts/lib/copilot-numbers.js';
import { assertUnderTmp } from './scratch.js';

export { COPILOT_VERSION };

const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
// Variables that carry a host's token. A probe's Copilot never inherits these; it gets its sign-in from its own home.
// Any name ending _TOKEN or _PAT (GITHUB_PAT, OAUTH_TOKEN, CI_JOB_TOKEN), and the host families' own secrets and keys.
const TOKEN_VARIABLE = /(^|_)(TOKEN|PAT)$|^(GH|GITHUB|COPILOT_GITHUB|GITLAB|GLAB)_[A-Z0-9_]*(TOKEN|PAT|SECRET|KEY|PASSWORD)$/i;
// Variables that change what a session may do or load. A probe's Copilot never inherits these from the caller's
// shell; a probe that wants one passes it in `env` on purpose.
const STEERING_VARIABLE = /^(COPILOT_ALLOW_ALL|COPILOT_CUSTOM_INSTRUCTIONS_DIRS|COPILOT_SKILLS_DIRS)$/i;

// Where a version is installed: ~/.wheelhouse-probes/copilot/<version>/.
export function defaultPrefix(version = COPILOT_VERSION, home = os.homedir()) {
  if (!VERSION.test(version)) throw new Error(`Not a Copilot version: ${JSON.stringify(version)}`);
  return path.join(home, '.wheelhouse-probes', 'copilot', version);
}

// The home the one-time sign-in is made with: ~/.wheelhouse-probes/login-home.
export function loginHome(home = os.homedir()) {
  return path.join(home, '.wheelhouse-probes', 'login-home');
}

export const LOGIN_HOME = loginHome();

// How to start `file` with `args`. A Windows .cmd shim cannot be spawned directly by current Node.js, so it
// goes through cmd.exe with the command line quoted by quoteForCmd (which refuses an argument holding a
// double quote, a percent sign or a line break). Anything else is started as it is.
export function launch(file, args, { platform = process.platform } = {}) {
  if (platform === 'win32' && /\.cmd$/i.test(file)) {
    const line = [file, ...args].map(quoteForCmd).join(' ');
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
  }
  return { file, args, windowsVerbatimArguments: false };
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
  const call = launch(npm, ['install', '--prefix', into, `@github/copilot@${version}`], { platform });
  const result = await run(call.file, call.args, { cwd: into, windowsVerbatimArguments: call.windowsVerbatimArguments });
  if (result.code !== 0) throw new Error(`npm could not install Copilot CLI ${version}: ${result.stderr.trim().slice(0, 300)}`);
  const bin = copilotBin(into, { platform });
  if (!fs.existsSync(bin)) throw new Error(`npm finished, but there is no Copilot CLI at ${bin}`);
  return { bin };
}

// A folder for COPILOT_HOME, under the system's temporary folder. It starts empty. Given `signedInFrom`
// (the login home), it starts with that folder's config.json, and only that file, so the keychain
// sign-in is found; a missing folder or file means the sign-in has not been done.
export function scratchCopilotHome({ signedInFrom } = {}) {
  let config;
  if (signedInFrom !== undefined) {
    config = path.join(signedInFrom, 'config.json');
    if (!fs.existsSync(config)) {
      throw new Error(`The Copilot sign-in has not been done: there is no config.json in ${signedInFrom}`);
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-copilot-home-'));
  assertUnderTmp(dir);
  if (config) {
    try {
      fs.writeFileSync(path.join(dir, 'config.json'), fs.readFileSync(config), { mode: 0o600 });
    } catch (error) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }
  return {
    dir,
    remove() {
      assertUnderTmp(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// The environment a probe's Copilot gets: the inherited environment without any host token, then the
// variables the caller passes explicitly in `env` (a probe may hand it a token on purpose), with
// COPILOT_HOME set.
// On Windows names are matched without regard to case, so a caller's `PATH` replaces the inherited `Path`
// rather than sitting beside it.
export function copilotEnv({ env = {}, home, baseEnv = process.env, platform = process.platform } = {}) {
  if (!home) throw new Error('A probe runs Copilot from a home of its own: pass `home`');
  const merged = {};
  const same = (a, b) => (platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const forget = (name) => {
    for (const existing of Object.keys(merged)) if (same(existing, name)) delete merged[existing];
  };
  for (const [name, value] of Object.entries(baseEnv)) {
    if (TOKEN_VARIABLE.test(name) || STEERING_VARIABLE.test(name)) continue;
    if (value !== undefined && value !== null) merged[name] = value;
  }
  for (const [name, value] of Object.entries(env)) {
    forget(name);
    if (value !== undefined && value !== null) merged[name] = value;
  }
  forget('COPILOT_HOME');
  return { ...merged, COPILOT_HOME: home };
}

// Where a probe's Copilot home may be: under the system's temporary folder, or under ~/.wheelhouse-probes
// (the login home). Never the person's real ~/.copilot.
export function assertProbeHome(home, { userHome = os.homedir() } = {}) {
  const resolved = path.resolve(home);
  const roots = [path.resolve(os.tmpdir()), fs.realpathSync(os.tmpdir()), path.join(path.resolve(userHome), '.wheelhouse-probes')];
  const real = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
  const inside = roots.some((root) => [resolved, real].some((candidate) => candidate !== root && candidate.startsWith(root + path.sep)));
  if (!inside) throw new Error(`Refusing to run Copilot with ${resolved} as its home: it is not under the temporary folder or ~/.wheelhouse-probes`);
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
export async function runCopilot({ args = [], cwd, env, home, timeoutMs = 120000, bin = 'copilot', platform = process.platform } = {}) {
  const environment = copilotEnv({ env, home, platform });
  assertProbeHome(home);
  const call = launch(bin, args, { platform });
  const result = await run(call.file, call.args, { cwd, env: environment, baseEnv: {}, timeoutMs, windowsVerbatimArguments: call.windowsVerbatimArguments });
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
