// scripts/foreman/start.js
// The foreman's start (build-loop design, section 11), run as
//   node scripts/foreman/start.js <project>
// The shape comes from the project's configuration on its default branch,
// asked of the helper (ruling R50), never the working copy.
//
// Shape 1: starts the watcher (scripts/watcher/main.js <project>) detached and
// hidden, as the session start starts the helper, when it isn't running, and
// nothing else: the watcher starts a fresh foreman at each wake. It counts as
// running when the pid in its lock, or in its health.json, is a live process
// and the record is fresh (the watcher touches both at every loop; ten
// minutes, as its lock's own staleness). A second start while it runs starts
// nothing; two at once start two, and the second finds the lock taken and
// stops. The session start shares startWatcher (ruling R62).
//
// Shape 2: starts the foreman's long session in the project's main checkout:
// `claude` with its explicit mode (sessionModeOf) and model
// (config.routing.foreman), its own settings file in the watcher's folder with
// `autoCompactWindow` at FOREMAN_FALLBACK_COMPACT so it compacts early, the
// foreman's tools with --allowedTools, the environment less the host session's
// variables with WHEELHOUSE_ROLE=foreman (ruling R26; the waker sets it for
// Shape 1's foremen), and a first prompt beginning `Wheelhouse foreman:`. The
// session runs in this terminal until it ends.
// The mod in that session runs the watcher's loop on its timer, through the
// bridge's tick (scripts/mod/watch.js), and hands the session each wake line
// as a prompt; the start says so.
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { foremanTools } from './tools.js';
import { isModelName } from '../gate/guardrails.js';
import { helperClient } from '../host/helper-client.js';
import { FOREMAN_FALLBACK_COMPACT } from '../lib/build-loop.js';
import { invocation, resolveClaude } from '../lib/claude.js';
import { stateDir, wheelhouseHome } from '../lib/paths.js';
import { readProject } from '../lib/projects.js';
import { healthFile, lockFile, projectConfig } from '../watcher/main.js';
import {
  ROLE_VARIABLE, pidAlive, sessionEnv, sessionModeOf, watcherFolder, writeJsonFile,
} from '../watcher/waker.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// How long the watcher's lock or health record counts as fresh.
export const WATCHER_FRESH_MS = 10 * 60 * 1000;
export const FOREMAN_PROMPT_LEAD = 'Wheelhouse foreman:';
// What the Shape 2 start says about how the session is woken.
export const MONITOR_NOTE = "The mod in this session hands it the watcher's wakes.";

class StartError extends Error {}
const refuse = (message) => { throw new StartError(message); };

function readSmall(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 64 * 1024) return null;
    return { text: fs.readFileSync(file, 'utf8'), mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

// Whether the project's watcher runs: a live pid in a fresh lock or health record.
export function watcherRunning(project, { alive = pidAlive, now = () => new Date() } = {}) {
  const t = now().getTime();
  const fresh = (ms) => Number.isFinite(ms) && t - ms < WATCHER_FRESH_MS;
  const livePid = (pid) => Number.isInteger(pid) && pid > 0 && alive(pid);
  const lock = readSmall(lockFile(project));
  if (lock !== null && fresh(lock.mtimeMs) && livePid(Number.parseInt(lock.text, 10))) return true;
  const health = readSmall(healthFile(project));
  if (health !== null) {
    try {
      const h = JSON.parse(health.text);
      if (livePid(h?.pid) && fresh(Date.parse(h?.at))) return true;
    } catch { /* not a health record */ }
  }
  return false;
}

// Starts the watcher, detached and hidden, in Wheelhouse's own folder, unless
// it runs already: `{ started }`.
// Its environment is this process's less the host session's variables and
// WHEELHOUSE_ROLE, so a watcher started from a foreman or any session is no one's.
export function startWatcher(project, { spawn = nodeSpawn, pluginRoot = PLUGIN_ROOT, alive, now, env = process.env } = {}) {
  stateDir(project); // a project name that is not a folder name throws here
  if (watcherRunning(project, { alive, now })) return { started: false };
  const home = wheelhouseHome();
  fs.mkdirSync(home, { recursive: true });
  const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'watcher', 'main.js'), project], {
    cwd: home, env: sessionEnv(env), detached: true, windowsHide: true, stdio: 'ignore',
  });
  child?.on?.('error', () => {});
  child?.unref?.();
  return { started: true };
}

// The foreman's long session (Shape 2): what to run, where, and with what. Writes its settings file.
export function foremanSession({ project, config, pluginRoot = PLUGIN_ROOT, platform = process.platform, env = process.env, claude = null }) {
  const checkout = readProject(project)?.folder;
  if (typeof checkout !== 'string') refuse("The project's folder isn't known on this computer");
  const model = config.routing?.foreman ?? null;
  if (model !== null && !isModelName(model)) refuse("The foreman's model can't be passed to claude");
  const settings = path.join(watcherFolder(project), 'foreman-settings.json');
  writeJsonFile(settings, { autoCompactWindow: FOREMAN_FALLBACK_COMPACT });
  const args = [
    '--settings', settings,
    '--permission-mode', sessionModeOf(config),
    ...(model ? ['--model', model] : []),
    '--allowedTools', ...foremanTools(pluginRoot, { platform }),
  ];
  const prompt = `${FOREMAN_PROMPT_LEAD} you are the long-lived foreman of ${project}. At each wake, follow the wheelhouse:foreman skill.`;
  // The prompt goes first: --allowedTools takes every word after it.
  const call = invocation(claude ?? resolveClaude({ platform, env }), [prompt], args);
  return {
    file: call.file,
    args: call.args,
    options: {
      cwd: checkout, env: { ...sessionEnv(env), [ROLE_VARIABLE]: 'foreman' }, stdio: 'inherit', windowsVerbatimArguments: call.verbatim,
    },
  };
}

// Runs a program in this terminal and resolves with its exit code.
function launchHere(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(file, args, options);
    child.once('error', reject);
    child.once('exit', (code) => resolve(Number.isInteger(code) ? code : 1));
  });
}

export async function main(argv, {
  client = helperClient(), spawn = nodeSpawn, launch = launchHere, pluginRoot = PLUGIN_ROOT, platform = process.platform, env = process.env,
  claude = null, alive, now, out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
} = {}) {
  try {
    const [project, ...rest] = argv;
    if (typeof project !== 'string' || rest.length > 0) refuse('Give the project: start.js <project>');
    try {
      stateDir(project);
    } catch {
      refuse('A project name is letters, digits, dots, hyphens and underscores');
    }
    if (readProject(project) === null) refuse(`${project} isn't set up on this computer`);
    const read = await projectConfig(project, client);
    if (read.config === null) refuse(`The project's configuration can't be read from its default branch: ${read.why}`);
    const config = read.config;
    if (config.watcherShape === 2) {
      const session = foremanSession({ project, config, pluginRoot, platform, env, claude });
      err(`${MONITOR_NOTE}\n`);
      return await launch(session.file, session.args, session.options);
    }
    const { started } = startWatcher(project, {
      spawn, pluginRoot, alive, now, env,
    });
    out(started ? `Started the watcher for ${project}.\n` : `The watcher for ${project} is running already.\n`);
    return 0;
  } catch (error) {
    err(`${error instanceof StartError ? error.message : `That did not work: ${String(error instanceof Error ? error.message : 'unknown error').replace(/\s+/g, ' ')}`}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
