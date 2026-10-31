// scripts/checks/run.js
// One check (spec 4.3): the commit in its folder, `prepare` and then the project's test command, each in the sandbox, with
// no agent and no model. A word comes back, and the helper signs it (record.js) before anything is reported.
// Nothing here ever runs a project's command outside `sandbox-exec`: where that can't start, or won't load the profile,
// the word is could-not-run and the command is never started.
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shellFor, testEnv } from '../lib/local-git.js';
import { sandboxDenyPaths } from '../protection/settings.js';
import { prepareFolder } from './folder.js';
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
// What macOS says when a tool tries to sandbox itself inside the check's sandbox: the check didn't run, so it isn't red.
const NESTED = /sandbox_apply: Operation not permitted|^sandbox-exec: /m;
// What `xcodebuild test` says when the sandbox refuses what it starts a test with (check 82).
const TESTS_REFUSED = /Failed to prevent system sleep|testmanagerd\.control|Sandbox restriction|LaunchServices has returned error|Failed to establish communication with the test runner|test runner hung/;

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
  const build = command.trim().replace(/\stest(?=\s|$)/, ' build-for-testing');
  return `${build} TEST_HOST= BUNDLE_LOADER= && for bundle in ${output}/Build/Products/*/*.xctest; do xcrun xctest "$bundle" || exit 1; done`;
}

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
  if (attempt.timedOut) return 'timed-out';
  if (attempt.code === 0) return 'passed';
  return NESTED.test(attempt.output) ? 'could-not-run' : null;
}

// The real paths of the deny list too: the sandbox matches a file by its real path.
function deniedPaths() {
  const real = (p) => {
    try { return fs.realpathSync(p); } catch { return p; }
  };
  return [...new Set(sandboxDenyPaths().flatMap((p) => [p, real(p)]))];
}

// Runs the check at `commit` and gives `{ commit, command, result, minutes, tail }`, with `command` the digest of the test
// command and `tail` the end of the output, up to 64 KB. `settings` come from the default branch (settings.js).
export async function runCheck({
  project, commit, main, settings, source, signal, git, spawn = nodeSpawn, now = () => new Date(), platform = process.platform,
  sandbox = SANDBOX, profile = checkProfile, limitMs = (settings.minutes ?? DEFAULT_MINUTES) * 60000, graceMs = GRACE_MS,
}) {
  const startedAt = now().getTime();
  const { testCommand, prepare, network } = settings;
  const answer = (result, tail = '') => ({ commit, command: commandDigest(testCommand), result, minutes: Math.round((now().getTime() - startedAt) / 6000) / 10, tail });
  if (platform !== 'darwin') return answer('could-not-run', 'Checks run in macOS\'s sandbox, and this computer has none.');
  let paths;
  try {
    paths = await prepareFolder({ project, commit, main, source, ...(git ? { git } : {}) });
  } catch (error) {
    return answer('could-not-run', String(error?.message ?? error));
  }
  const ownHome = main ? paths.mainHome : paths.home;
  const tmp = path.join(ownHome, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const xcode = developerDir();
  const env = { ...testEnv(), HOME: ownHome, CFFIXED_USER_HOME: ownHome, TMPDIR: tmp, ...(xcode ? { DEVELOPER_DIR: xcode } : {}) };
  const denied = deniedPaths();
  const textFor = (name) => profile({ paths, main, stage: name, network, denied, temp: TEMP, userHome: os.homedir() });

  let stop = null;
  let ended = false;
  const watch = (fn) => { stop = fn; };
  const endIt = () => { ended = true; stop?.(); };
  running.set(project, endIt);
  if (signal?.aborted) ended = true;
  signal?.addEventListener('abort', endIt, { once: true });

  const inSandbox = (name, command, untilMs) => stage({ sandbox, profile: textFor(name), command, cwd: paths.tree, env, spawn, untilMs, graceMs, now, watch });
  // `prepare` then the tests, within one time limit.
  const attempt = async (command = testCommand) => {
    const untilMs = now().getTime() + limitMs;
    if (ended) return { stopped: true, output: '' };
    if (prepare) {
      const prepared = await inSandbox('prepare', prepare, untilMs);
      if (prepared.code !== 0) return prepared;
      if (ended) return { ...prepared, stopped: true };
    }
    return inSandbox('test', command, untilMs);
  };

  try {
    const first = await attempt();
    const word = wordOf(first);
    if (word !== null) return answer(word, first.output);
    const hosted = secondTryOf(testCommand);
    if (hosted !== null && TESTS_REFUSED.test(first.output)) {
      const second = await attempt(hosted);
      return answer(wordOf(second) === 'passed' ? 'passed' : 'could-not-run', second.output);
    }
    const again = await attempt();
    return answer(wordOf(again) ?? 'failed', again.output);
  } finally {
    running.delete(project);
    signal?.removeEventListener('abort', endIt);
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
