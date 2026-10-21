// scripts/lib/safe-git.js
// The one route every git call of Wheelhouse takes, built on setup's fence and allowed list. The
// allowed list lives in scripts/setup/git.js (rulings R109 to R113); it is to move into scripts/lib/
// once Copilot Part 6 has merged, which is listed in the ledger. This file imports the fence and the
// list and never copies them.
// Every call shuts out git's global and system config, points hooks at the null file, and allows one
// transport: https, or https and a local path where the caller names a local remote, or https and
// ssh where the caller asks for ssh by name. Before a call it can look at the repository's own config
// and refuse, naming them, any setting off the allowed list.
import { run as realRun, withoutGitVars } from './run.js';
import path from 'node:path';
import {
  isolated, refuseUnlistedSettings, setupGitEnv, subcommandOf, FENCE, NULL_FILE,
} from '../setup/git.js';

export { NULL_FILE };

const GIT_WAIT_MS = 5 * 60 * 1000;
// Variables that would outrank the fence's settings or point git elsewhere.
const DROPPED = new Set(['GIT_CONFIG_PARAMETERS', 'GIT_DIR', 'GIT_EXEC_PATH', 'GIT_CONFIG', 'GIT_WORK_TREE']);
const TRANSPORT = { https: 'https', local: 'https:file', ssh: 'https:ssh' };

// How a remote's address is reached: 'local' for a path on this computer (absolute, relative, a
// drive letter or a share on Windows) or a file:// address; 'https' for everything else, an ssh or
// scp-style address included (the transport that lets ssh through is asked for by name).
export function reachFor(url, { platform = process.platform } = {}) {
  if (typeof url !== 'string' || url === '') return 'https';
  if (/^file:\/\//i.test(url)) return 'local';
  if (url.includes('::') || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url)) return 'https';
  if (path.posix.isAbsolute(url) || /^\.\.?\//.test(url)) return 'local';
  if (platform === 'win32' && (path.win32.isAbsolute(url) || /^\.\.?\\/.test(url))) return 'local';
  return 'https';
}

// `env` with the whole fence, and the transport `reach` names in place of any given. Safe to apply twice.
export function safeGitEnv(env = {}, { reach = 'https' } = {}) {
  const transport = TRANSPORT[reach];
  if (transport === undefined) throw new Error(`safeGitEnv: unknown reach ${String(reach)}`);
  // Variables that outrank or redirect the fence are dropped, whatever the caller gave.
  const kept = Object.fromEntries(Object.entries(env).filter(([name]) => !DROPPED.has(name.toUpperCase())));
  // Every setting of the fence goes last, and a caller's setting of the same key is dropped, so the
  // fence's value is the one git ends with.
  const fenceKeys = new Set(FENCE.map(([key]) => key.toLowerCase()));
  const count = Number.parseInt(kept.GIT_CONFIG_COUNT ?? '0', 10);
  const own = [];
  for (let i = 0; Number.isInteger(count) && i < count; i += 1) {
    const key = kept[`GIT_CONFIG_KEY_${i}`];
    if (!fenceKeys.has(String(key).toLowerCase())) own.push([key, kept[`GIT_CONFIG_VALUE_${i}`]]);
  }
  for (const name of Object.keys(kept)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/i.test(name)) delete kept[name];
  own.forEach(([key, value], i) => {
    kept[`GIT_CONFIG_KEY_${i}`] = key;
    kept[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  kept.GIT_CONFIG_COUNT = String(own.length);
  return { ...isolated({ ...kept, GIT_ALLOW_PROTOCOL: TRANSPORT.https }), GIT_ALLOW_PROTOCOL: transport };
}

// git in `cwd`: `git(args, options)` gives run's answer. `look` is 'each' (look at the repository's
// settings before every call), 'once' (before the first call of this function only; a refusal is
// thrown again on every later call) or 'never' (the fence alone; for a caller whose comment says
// why). `workTree` makes that folder git's working tree (not for `init`). `options.env` is added
// before the fence, so a caller cannot lift it.
export function safeGit({
  run = realRun, gitPath = 'git', cwd, env = {}, reach = 'https', look = 'each', workTree = null, timeoutMs = GIT_WAIT_MS,
} = {}) {
  if (!['each', 'once', 'never'].includes(look)) throw new Error(`safeGit: unknown look ${String(look)}`);
  let looked = null;
  const lookNow = () => refuseUnlistedSettings({ run, gitPath, cwd });
  return async (args, options = {}) => {
    if (look === 'each') await lookNow();
    else if (look === 'once') {
      looked ??= lookNow();
      await looked;
    }
    // The factory's folder and base environment stand: a call cannot give its own.
    if ('cwd' in options || 'baseEnv' in options) throw new Error('safeGit: cwd and baseEnv are given once, to safeGit, not to a call');
    const { env: extra, ...rest } = options;
    const fenced = safeGitEnv({ ...env, ...extra }, { reach });
    const callEnv = workTree === null || subcommandOf(args) === 'init' ? fenced : { ...fenced, GIT_WORK_TREE: workTree };
    return run(gitPath, args, { timeoutMs, ...rest, cwd, baseEnv: withoutGitVars(), env: callEnv });
  };
}

// The director's own sign-in as git's only credential helper, fenced.
export function directorSignIn(host, { platform = process.platform } = {}) {
  return setupGitEnv({ host, platform });
}

// Files that run git without importing this route or scripts/setup/git.js. Each later task removes
// its own rows.
const later = (n) => `moves in Task ${n} of the security-gaps plan`;
export const RAW_GIT_EXCEPTIONS = Object.freeze([
  ['scripts/state/git.js', later(2)],
  ['scripts/host/helper.js', later(3)],
  ['scripts/foreman/act.js', later(5)],
  ['scripts/feature/cli.js', later(5)],
  ['scripts/install/survey.js', later(6)],
  ['scripts/install/cli.js', later(6)],
  ['scripts/install/private-words.js', later(6)],
  ['scripts/lineage/manifest.js', later(6)],
  ['scripts/lineage/upgrade.js', later(6)],
  ['scripts/lineage/release.js', later(6)],
  ['scripts/eval/stand-in-helper.js', later(11)],
  ['scripts/eval/feature-project.js', later(11)],
  ['scripts/eval/front-desk.js', later(11)],
  ['scripts/eval/harness.js', later(11)],
  ['scripts/eval/run.js', later(11)],
  ['scripts/setup/project-files.js', "setup's own fenced route (rulings R109 to R113)"],
  ['scripts/setup/tools.js', 'runs `git --version` only and reads no repository'],
].map(([file, reason]) => Object.freeze({ file, reason })));
