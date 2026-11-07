// scripts/host/start-helper.js
// Starts Wheelhouse's helper, and the watcher for each project on this computer. The sign-in start (a launch agent on
// macOS, a start-up entry on Windows) runs it as `"<node>" "<root>/scripts/host/start-helper.js" start`, once at
// sign-in and again every minute, so a helper that stopped comes back. It prints one plain line, "Wheelhouse's helper
// is running", or why not, and exits 0, or exits 1.
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pathWithNode } from '../lib/claude.js';
import { jobFolder, wheelhouseHome } from '../lib/paths.js';
import { registeredProjects } from '../lib/projects.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { helperClient } from './helper-client.js';
import { caEnv } from './company-ca.js';
import { askHealth, startDetached } from '../lib/background.js';
import { receiverPort } from '../telemetry/main.js';
import { projectConfig } from '../watcher/main.js';
import { startWatcher } from '../foreman/start.js';
import { readProgress } from '../setup/uninstall.js';
import { sessionsOfProject } from '../agents/project-agent.js';
import { isPendingPart } from '../agents/contract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// This file, from the Wheelhouse folder: what the sign-in start runs.
export const START_SCRIPT = 'scripts/host/start-helper.js';
// How long `start` waits for a helper it started to answer.
export const START_WAIT_MS = 15000;
const POLL_MS = 200;

export const RUNNING = 'Wheelhouse\'s helper is running';
export const NOT_STARTED = `Wheelhouse's helper didn't start within ${START_WAIT_MS / 1000} seconds. Run the start command again; if it still doesn't start, restart the computer and try once more`;
const USAGE = 'Usage: start-helper.js start';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const answerOf = async (promise) => {
  try {
    return await promise;
  } catch {
    return null;
  }
};

// startAll({ client, spawn, pluginRoot, waitMs, pause, env }) -> { ok, line, watchers }
export async function startAll({
  client = null, spawn = nodeSpawn, pluginRoot = ROOT, waitMs = START_WAIT_MS, pause = sleep, env = process.env,
  receiverUp = () => askHealth(receiverPort()),
} = {}) {
  const api = client ?? helperClient({ timeout: 2000 });
  let up = (await answerOf(api.health()))?.ok === true;
  if (!up) {
    try {
      const home = wheelhouseHome();
      fs.mkdirSync(home, { recursive: true });
      // Started in Wheelhouse's own folder, never the project's.
      const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'host', 'helper-main.js')], {
        cwd: jobFolder(), detached: true, windowsHide: true, stdio: 'ignore', env: pathWithNode({ ...env, ...caEnv(home) }),
      });
      child?.on?.('error', () => {});
      child?.unref?.();
    } catch {
      return { ok: false, line: NOT_STARTED, watchers: [] };
    }
    const until = Date.now() + waitMs;
    while (!up && Date.now() < until) {
      await pause(POLL_MS);
      up = (await answerOf(api.health()))?.ok === true;
    }
  }
  if (!up) return { ok: false, line: NOT_STARTED, watchers: [] };
  // The watcher for each project whose configuration the foreman's check accepts.
  const watchers = [];
  for (const { project, record } of registeredProjects()) {
    // The launch agent runs this every minute: an uninstall under way has stopped this watcher and means it to stay so.
    if (readProgress(record?.folder)?.state === 'running') continue;
    const read = await answerOf(projectConfig(project, api));
    if (!read || read.config === null) continue;
    let sessions;
    try {
      sessions = sessionsOfProject(read.config);
    } catch {
      continue;
    }
    if (isPendingPart(sessions)) continue;
    try {
      sessions.checkForeman(read.config);
    } catch {
      continue;
    }
    try {
      startWatcher(project, { spawn, pluginRoot, env });
      watchers.push(project);
    } catch { /* that project's watcher is started by its own session start */ }
  }
  if (watchers.length > 0 && !(await answerOf(receiverUp()))) startDetached(spawn, path.join(pluginRoot, 'scripts', 'telemetry', 'main.js'));
  return { ok: true, line: RUNNING, watchers };
}

export async function main(argv = process.argv.slice(2), { stdout = process.stdout, deps = {} } = {}) {
  const say = (line) => stdout.write(`${line}\n`);
  if (argv.length !== 1 || argv[0] !== 'start') {
    say(USAGE);
    return 1;
  }
  try {
    const got = await startAll(deps.startOptions ?? {});
    say(got.line);
    return got.ok ? 0 : 1;
  } catch (error) {
    say(`That did not work: ${String(error?.message ?? 'no reason given').replace(/\s+/g, ' ')}`);
    return 1;
  }
}

if (startedAsScript(import.meta.url)) {
  main().then((code) => { process.exitCode = code; });
}
