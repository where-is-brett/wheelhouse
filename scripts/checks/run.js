// scripts/checks/run.js
// One check (spec 4.3): the commit in its folder, `prepare` and then the project's test command, each in the sandbox, with
// no agent and no model. A word comes back, and the helper signs it (record.js) before anything is reported.
// Nothing here ever runs a project's command outside `sandbox-exec`: where that can't start, or won't load the profile,
// the word is could-not-run and the command is never started.
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shellFor } from '../lib/local-git.js';
import { ENGINE_ROOM_PORT } from '../protection/archon.js';
import { sandboxDenyPaths } from '../protection/settings.js';
import { prepareFolder, realFolder } from './folder.js';
import { checkProfile } from './profile.js';
import { commandDigest } from './record.js';
import { DEFAULT_MINUTES } from './settings.js';

const SANDBOX = '/usr/bin/sandbox-exec';
const KEPT = 64 * 1024;
const TEMP = Object.freeze(['/private/tmp', '/private/var/tmp']);
// How long after the time limit a check still waits for its output to close. Something can hold it open for hours.
const GRACE_MS = 5000;
const XCODE = '/Applications/Xcode.app/Contents/Developer';
const CHOSEN_XCODE = '/var/db/xcode_select_link';
// The shell's own exits for a command it couldn't find or start: no test ran, whatever it was.
const NO_TOOL = [126, 127];
const TOOL_LINE = 'A tool this project needs wasn\'t found. A check sees the usual places and the folders version managers use, so a tool kept elsewhere in the home folder isn\'t reached.';
const PORT_LINE = `Port ${ENGINE_ROOM_PORT} is kept for Wheelhouse itself, so a check can't connect to it. Give the test server another port.`;
// What macOS says when a tool tries to sandbox itself inside the check's sandbox: the check didn't run, so it isn't red.
const NESTED = /sandbox_apply: Operation not permitted|^sandbox-exec: /m;
// What `xcodebuild test` says when the sandbox refuses what it starts a test with (check 82).
const TESTS_REFUSED = /Failed to prevent system sleep|testmanagerd\.control|Sandbox restriction|LaunchServices has returned error|Failed to establish communication with the test runner|test runner hung/;

// All a check keeps of the helper's environment: how to find its tools and how to read text. What it could read a test could
// leave for `prepare`, which has the network, so a secret with a name nobody listed must not arrive at all. HOME, TMPDIR and
// DEVELOPER_DIR are set by the check itself.
// Proxy settings go too, since they can hold a password. `CARGO_HOME` stays out: it names `~/.cargo`, whose registry a check
// can't read or write, so `cargo fetch` would fail; with it gone cargo uses the check's own home.
const KEPT_VARIABLES = /^(?:PATH|LANG|LC_[A-Z]+|TZ|USER|LOGNAME|TERM|GOROOT|JAVA_HOME|ASDF_DIR|FNM_MULTISHELL_PATH|SWIFTLY_BIN_DIR|SWIFTLY_TOOLCHAINS_DIR)$/;
// Where each version manager keeps its tools, as profile.js names them: with HOME the check's own, one left unnamed would
// look in an empty folder and its shims would find nothing.
const TOOL_HOMES = Object.freeze({
  ASDF_DATA_DIR: '.asdf', BUN_INSTALL: '.bun', DENO_INSTALL: '.deno', FNM_DIR: 'Library/Application Support/fnm', MISE_DATA_DIR: '.local/share/mise', NVM_DIR: '.nvm', PNPM_HOME: 'Library/pnpm',
  PYENV_ROOT: '.pyenv', RBENV_ROOT: '.rbenv', RUSTUP_HOME: '.rustup', SDKMAN_DIR: '.sdkman', SWIFTLY_HOME_DIR: '.swiftly', VOLTA_HOME: '.volta',
});
export function checkEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => KEPT_VARIABLES.test(name) || Object.hasOwn(TOOL_HOMES, name)));
}
// The version managers on this computer that the environment doesn't name.
export function toolHomes({ env = process.env, userHome = os.homedir(), exists = fs.existsSync } = {}) {
  return Object.fromEntries(Object.entries(TOOL_HOMES).filter(([name, folder]) => env[name] === undefined && exists(path.join(userHome, folder))).map(([name, folder]) => [name, path.join(userHome, folder)]));
}

// The checks running in this process, by project, so All stop can end them.
const running = new Map();

// The Xcode a check's tools come from: `xcode-select` may point at the Command Line Tools, which have no `xctest`. The one
// in the environment, else the one chosen if it is a full Xcode, else Xcode where it usually is, else none.
export function developerDir({ env = process.env, real = fs.realpathSync, exists = fs.existsSync } = {}) {
  if (env.DEVELOPER_DIR) return env.DEVELOPER_DIR;
  let chosen = null;
  try { chosen = real(CHOSEN_XCODE); } catch { /* none chosen */ }
  if (chosen?.endsWith('.app/Contents/Developer')) return chosen;
  return exists(XCODE) ? XCODE : null;
}

// The second try of an `xcodebuild test` the sandbox refused (spec 4.5): build for testing with the test host taken out,
// then run each test bundle in `xctest`, which runs inside the sandbox and starts nothing outside it. Null for any other
// command, one with more in it than the command itself included.
export function secondTryOf(command) {
  if (!/^\s*xcodebuild\s/.test(command) || !/\stest(\s|$)/.test(command) || /[;&|`$<>\n]/.test(command)) return null;
  const output = /-derivedDataPath\s+(\S+)/.exec(command)?.[1] ?? '.build/checks';
  return hostlessTests(command.trim().replace(/\stest(?=\s|$)/, ' build-for-testing'), output);
}

// Tests with no host, from `xcodebuild build-for-testing ...`: what the finder writes, since `xcodebuild test` never runs here.
export const hostlessTests = (build, output) => `${build} TEST_HOST= BUNDLE_LOADER= && for bundle in ${output}/Build/Products/*/*.xctest; do xcrun xctest "$bundle" || exit 1; done`;
// Whether a command is that already. Tests that can't build or run with no host fail it too, so only a pass says anything.
export const isHostless = (command) => /^\s*xcodebuild\s+build-for-testing\s/.test(command) && /\sTEST_HOST=\s/.test(command) && /\sxcrun xctest\s/.test(command);

const killGroup = (pid) => {
  try { process.kill(-pid, 'SIGKILL'); } catch { /* it has gone */ }
};

// Runs one command under the profile, in a process group of its own, and stops waiting at `untilMs` plus the grace.
function jailed({ sandbox, profile, command, cwd, env, spawn, untilMs, graceMs, now, watch }) {
  return new Promise((resolve) => {
    const { file, args } = shellFor(command);
    let output = '';
    let timedOut = false;
    let stopped = false;
    let child;
    let settled = false;
    let timer = null;
    let lastWait = null;
    let exited = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(lastWait);
      if (Number.isInteger(child?.pid)) killGroup(child.pid);
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      watch(null);
      resolve({ output, timedOut, stopped, ...answer });
    };
    const end = (mark) => {
      if (exited) return;
      mark();
      if (Number.isInteger(child?.pid)) killGroup(child.pid);
      lastWait = setTimeout(() => finish({ code: null }), graceMs);
    };
    try {
      child = spawn(sandbox, ['-p', profile, file, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch {
      finish({ code: null, unstarted: true });
      return;
    }
    const keep = (chunk) => { output = (output + chunk.toString('utf8')).slice(-KEPT); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', () => finish({ code: null, unstarted: true }));
    // The shell's own exit is the answer. A job it left holding the output open is ended with the group, and one in a
    // session of its own gets the grace, so it can't turn a finished test into a timeout.
    child.on('exit', (code) => {
      exited = true;
      killGroup(child.pid);
      lastWait ??= setTimeout(() => finish({ code }), graceMs);
    });
    child.on('close', (code) => finish({ code }));
    watch(() => end(() => { stopped = true; }));
    timer = setTimeout(() => end(() => { timedOut = true; }), Math.max(untilMs - now().getTime(), 0));
  });
}

// One stage, once the sandbox has shown it loads this profile: a command that exits at once, so a profile that won't load
// is told from a test that failed, and the project's own command never starts.
async function stage({ sandbox, profile, command, cwd, env, spawn, untilMs, graceMs, now, watch }) {
  const common = { sandbox, profile, cwd, env, spawn, now, graceMs, watch };
  const loads = await jailed({ ...common, command: 'exit 0', untilMs: now().getTime() + 60000 });
  if (loads.stopped) return loads;
  if (loads.unstarted || loads.code !== 0) return { ...loads, unstarted: true };
  return jailed({ ...common, command, untilMs });
}

// The check's word for an attempt, or null when it was a red result.
function wordOf(attempt) {
  if (attempt.unstarted || attempt.stopped) return 'could-not-run';
  if (attempt.prepareFailed) return 'could-not-run';
  if (attempt.timedOut) return 'timed-out';
  if (attempt.code === 0) return 'passed';
  return NESTED.test(attempt.output) || NO_TOOL.includes(attempt.code) ? 'could-not-run' : null;
}

// The output with what a person or a builder needs to know of why it ended so, where the output doesn't say. Last, so the
// end kept of it holds the line.
function explained(attempt) {
  if (NO_TOOL.includes(attempt.code)) return `${attempt.output}\n${TOOL_LINE}`;
  if (attempt.code !== 0 && new RegExp(`\\b${ENGINE_ROOM_PORT}\\b`).test(attempt.output)) return `${attempt.output}\n${PORT_LINE}`;
  return attempt.output;
}

// The sandbox matches a file by its real path.
const real = (p) => {
  try { return fs.realpathSync(p); } catch { return p; }
};

// The real paths of the deny list too.
function deniedPaths() {
  return [...new Set(sandboxDenyPaths().flatMap((p) => [p, real(p)]))];
}

// While a project's tests aren't counting (spec 4.5) a check still runs where there is a command, and its result is
// not-counted, whatever the exit: a check that can't run holds nothing up either, but All stop's end is still could-not-run,
// and it runs again. Only a pass on the main line keeps its word, which is what ends the state. With no command nothing
// runs, and the record stands alone (the plan's choice 5).
export async function runCheck(args) {
  const { commit, main, settings, signal } = args;
  if (settings.notCounting !== true) return oneCheck(args);
  if (typeof settings.testCommand !== 'string') return { commit, command: null, result: 'not-counted', minutes: 0, tail: '', ...(main ? { clean: true } : {}) };
  const got = await oneCheck(args);
  return (main && got.result === 'passed') || signal?.aborted ? got : { ...got, result: 'not-counted' };
}

// Runs the check at `commit`, a head of `work` or the main line, and gives `{ commit, command, result, minutes, tail, clean? }`, with `command` the digest of the
// test command, `tail` the end of the output, up to 64 KB, and `clean` on a main-line check, which starts from an empty tree. `settings` come from the default branch (settings.js).
async function oneCheck({
  project, commit, main, work = null, settings, source, signal, git, spawn = nodeSpawn, now = () => new Date(), platform = process.platform,
  sandbox = SANDBOX, profile = checkProfile, limitMs = (settings.minutes ?? DEFAULT_MINUTES) * 60000, graceMs = GRACE_MS,
}) {
  const startedAt = now().getTime();
  const { testCommand, prepare, network } = settings;
  const answer = (result, tail = '') => ({ commit, command: commandDigest(testCommand), result, minutes: Math.round((now().getTime() - startedAt) / 6000) / 10, tail, ...(main ? { clean: true } : {}) });
  if (platform !== 'darwin') return answer('could-not-run', 'Checks run in macOS\'s sandbox, and this computer has none.');
  // All stop can reach a check from here on, while its folder is being prepared as well.
  let stop = null;
  let ended = false;
  const watch = (fn) => { stop = fn; };
  const endIt = () => { ended = true; stop?.(); };
  running.set(project, endIt);
  if (signal?.aborted) ended = true;
  signal?.addEventListener('abort', endIt, { once: true });
  const over = () => {
    running.delete(project);
    signal?.removeEventListener('abort', endIt);
  };
  let paths;
  let ownHome;
  let tmp;
  try {
    paths = await prepareFolder({ project, commit, main, work, source, ...(git ? { git } : {}) });
    ownHome = paths.home;
    tmp = path.join(ownHome, 'tmp');
    realFolder(tmp);
  } catch (error) {
    over();
    return answer('could-not-run', String(error?.message ?? error));
  }
  const xcode = developerDir();
  const env = { ...checkEnv(), ...toolHomes(), HOME: ownHome, CFFIXED_USER_HOME: ownHome, TMPDIR: tmp, ...(xcode ? { DEVELOPER_DIR: xcode } : {}) };
  const denied = deniedPaths();
  const textFor = (name) => profile({ paths, main, stage: name, network, denied, temp: TEMP, userHome: real(os.homedir()) });

  const inSandbox = (name, command, untilMs) => stage({ sandbox, profile: textFor(name), command, cwd: paths.tree, env, spawn, untilMs, graceMs, now, watch });
  // `prepare` then the tests, within one time limit.
  const attempt = async (command = testCommand) => {
    const untilMs = now().getTime() + limitMs;
    if (ended) return { stopped: true, output: '' };
    if (prepare) {
      const prepared = await inSandbox('prepare', prepare, untilMs);
      if (prepared.code !== 0) return { ...prepared, prepareFailed: true };
      if (ended) return { ...prepared, stopped: true };
    }
    return inSandbox('test', command, untilMs);
  };

  try {
    const first = await attempt();
    const word = wordOf(first);
    // Tests with no host stand in for the real ones, so only their pass says anything.
    if (isHostless(testCommand)) return answer(word === 'passed' ? 'passed' : 'could-not-run', first.output);
    if (word !== null) return answer(word, explained(first));
    const hosted = secondTryOf(testCommand);
    if (hosted !== null && TESTS_REFUSED.test(first.output)) {
      const second = await attempt(hosted);
      return answer(wordOf(second) === 'passed' ? 'passed' : 'could-not-run', second.output);
    }
    if (settings.notCounting === true) return answer('failed', explained(first));
    const again = await attempt();
    return answer(wordOf(again) ?? 'failed', explained(again));
  } finally {
    over();
  }
}

// Ends a project's running check, everything it started included. Its result is could-not-run, and it runs again after All
// stop lifts. True when one was running.
export function endCheck(project) {
  const end = running.get(project);
  if (end === undefined) return false;
  end();
  return true;
}
