// scripts/setup/git.js
// How setup runs git (ruling R109): every call shuts out git's global and system config, so
// nothing in ~/.gitconfig or the system's config reaches it, and passes by environment only the
// settings it needs: the director's own sign-in as git's credential helper, when it uses it; hooks
// pointed at the null file; and no file-system monitor. Before each call it refuses, naming what it
// found, when the repository's own config declares a hook (`hook.<name>.*`), which git runs
// whatever core.hooksPath says: no hook an agent can write runs in setup's name or with the
// director's sign-in. Identity is given by each commit as it makes it.
//
// What is left out with the global and system config: a proxy or certificate setting kept there
// (proxies still come from the environment). A director who needs one sees setup's git fail,
// said plainly, until it is passed through here.
import path from 'node:path';
import { run as realRun, withoutGitVars } from '../lib/run.js';
import { toolPath } from '../lib/host-tools.js';

// The null file git reads as an empty config and an empty hooks folder.
export const NULL_FILE = '/dev/null';
const TOOL = { github: 'gh', gitlab: 'glab' };
const GIT_WAIT_MS = 5 * 60 * 1000;
// What every call carries, by environment, besides the sign-in.
const FENCE = [['core.hooksPath', NULL_FILE], ['core.fsmonitor', 'false']];

// The settings an environment passes to git by GIT_CONFIG_COUNT, as [key, value] pairs.
function pairsOf(env) {
  const count = Number.parseInt(env?.GIT_CONFIG_COUNT ?? '0', 10);
  const pairs = [];
  for (let i = 0; Number.isInteger(count) && i < count; i += 1) pairs.push([env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
  return pairs;
}

// `env` with git's global and system config shut out, no prompting, and the fence's settings
// added after whatever it passes already (a later setting wins). Safe to apply twice.
export function isolated(env = {}) {
  const pairs = pairsOf(env);
  const missing = FENCE.filter(([key, value]) => !pairs.some(([k, v]) => k === key && v === value));
  const all = [...pairs, ...missing];
  const out = { ...env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_FILE, GIT_CONFIG_COUNT: String(all.length) };
  all.forEach(([key, value], i) => {
    out[`GIT_CONFIG_KEY_${i}`] = key;
    out[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return out;
}

// The environment setup's git runs with. With `host`, the director's own sign-in: their host tool
// as git's only credential helper (the list cleared first, so no other helper asks), never the
// narrow key. The folder of the git step 2 found goes first on the path, so a git installed since
// the helper started is the one run. Carried in the environment, never an argument.
export function setupGitEnv({ host = null, gitPath = 'git', env = process.env, platform = process.platform } = {}) {
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const dir = paths.isAbsolute(gitPath) ? paths.dirname(gitPath) : null;
  const signIn = host === null ? {} : {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: `!"${toolPath(TOOL[host], { platform }).replaceAll('\\', '/')}" auth git-credential`,
  };
  return isolated({ ...signIn, ...(dir === null ? {} : { [pathKey]: `${dir}${paths.delimiter}${env[pathKey] ?? ''}` }) });
}

// Said when the repository's own config declares a hook, or can't be read.
export const configHookLine = (keys) => `git's config in this repository declares a hook (${keys.join(', ')}), which setup never runs, so it stopped: remove it from the repository's .git/config, then a fresh Go ahead tries again`;
export const CONFIG_UNREAD = 'git\'s config in this repository could not be read, so setup did not run git there: a fresh Go ahead tries again';

// Refuses, naming them, when the config git would read in `cwd` (the repository's own, and what
// it includes) declares any hook.*. Nothing found, or no repository there, passes.
export async function refuseConfigHooks({ run = realRun, gitPath = 'git', env = {}, cwd }) {
  let got;
  try {
    got = await run(gitPath, ['config', '--includes', '--name-only', '--get-regexp', '^hook\\.'], { cwd, env: isolated(env), baseEnv: withoutGitVars(), timeoutMs: GIT_WAIT_MS });
  } catch {
    throw new Error(CONFIG_UNREAD);
  }
  if (got.code === 1) return;
  const keys = String(got.stdout ?? '').split(/\r?\n/).map((k) => k.trim()).filter(Boolean);
  if (got.code === 0 && keys.length === 0) return;
  if (got.code === 0) throw new Error(configHookLine([...new Set(keys)]));
  throw new Error(CONFIG_UNREAD);
}

// git for setup in `cwd` (or none): `git(args, options)` gives run's answer, after refusing a hook
// the repository's config declares; every call isolated as above.
export function setupGit({ run = realRun, gitPath = 'git', env = {}, cwd, timeoutMs = GIT_WAIT_MS } = {}) {
  const fenced = isolated(env);
  return async (args, options = {}) => {
    await refuseConfigHooks({ run, gitPath, env: fenced, cwd });
    return run(gitPath, args, { cwd, env: fenced, baseEnv: withoutGitVars(), timeoutMs, ...options });
  };
}
