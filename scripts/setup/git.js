// scripts/setup/git.js
// How setup runs git (rulings R109, R110, R111): every call shuts out git's global and system
// config, so nothing in ~/.gitconfig or the system's config reaches it, and passes by environment
// only the settings it needs: the director's own sign-in as git's credential helper, when it uses
// it; hooks pointed at the null file; no file-system monitor; no automatic maintenance; no going
// into submodules (whose own settings are never looked at); and, as a second fence, inert values for
// the core settings that name a program (core.sshCommand, core.askPass, core.editor, core.pager).
// git may reach a remote over https only (GIT_ALLOW_PROTOCOL, which outranks any protocol.*
// setting), so no transport that runs a program (ext::, a remote helper) and no ssh; a call to a
// remote that setup itself named as a path on this computer (the stand-in host's repositories in
// tests) may use a local path too.
// Before each call it refuses, naming the key, when the repository's own config (with what it
// includes, and its worktree config) holds any setting on the refusal list below: a hook
// (`hook.*`, which git runs whatever core.hooksPath says), a filter, a diff or merge driver, an ssh
// command, an editor, a pager, a credential helper, a gpg program, a URL rewrite, a remote's own
// programs or proxy, an HTTP proxy, an alternate's refs command, a garbage-collection hook, a
// bundle address, a protocol permission. Of the programs a repository's settings can name, none on
// the refusal list runs in setup's name or with the director's sign-in. git's other program
// settings belong to commands setup never runs (difftool, mergetool, submodule update, an
// interactive add, an alias) or to a terminal setup's git never has (a command's own pager).
// Identity is given by each commit as it makes it.
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
// What every call carries, by environment, besides the sign-in: hooks and the monitor off; no
// automatic maintenance after a commit or fetch; no going into submodules, since git runs there
// without these settings and with the submodule's own; and the core settings that name a program
// set to ones that do nothing (a failing `false`, or `cat`).
const FENCE = [
  ['core.hooksPath', NULL_FILE], ['core.fsmonitor', 'false'], ['maintenance.auto', 'false'],
  ['submodule.recurse', 'false'], ['fetch.recurseSubmodules', 'false'], ['push.recurseSubmodules', 'no'],
  ['core.sshCommand', 'false'], ['core.askPass', 'false'], ['core.editor', 'false'], ['core.pager', 'cat'],
];
// The transports git may use (ruling R111): https, and a local path only where setup named one.
const HTTPS_ONLY = 'https';
const WITH_LOCAL = 'https:file';

// The refusal list: the repository settings that make git run a program or send elsewhere in the
// operations setup performs (rulings R110, R111), as the lower-case names `git config --name-only`
// gives (the section and the key in lower case, a subsection as written).
const RUNS_OR_SENDS = [
  /^hook\./i, /^filter\./i, /^diff\.external$/i, /^diff\..+\.(?:command|textconv)$/i, /^merge\..+\.driver$/i,
  /^core\.(?:sshcommand|fsmonitor|editor|pager|askpass|gitproxy|alternaterefscommand|alternaterefsprefixes)$/i,
  /^credential\./i, /^gpg\./i, /^sequence\.editor$/i, /^gc\.recentobjectshook$/i,
  /^url\..+\.(?:insteadof|pushinsteadof)$/i, /^remote\..+\.(?:uploadpack|receivepack|proxy|vcs)$/i, /^http\.(?:.+\.)?proxy$/i,
  /^fetch\.bundleuri$/i, /^bundle\./i, /^protocol\.(?:.+\.)?allow$/i,
];
export const runsOrSends = (key) => RUNS_OR_SENDS.some((pattern) => pattern.test(key));

// The settings an environment passes to git by GIT_CONFIG_COUNT, as [key, value] pairs.
function pairsOf(env) {
  const count = Number.parseInt(env?.GIT_CONFIG_COUNT ?? '0', 10);
  const pairs = [];
  for (let i = 0; Number.isInteger(count) && i < count; i += 1) pairs.push([env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
  return pairs;
}

// Whether a remote's address is a path on this computer (absolute, on either kind of system), never
// a URL or a `<transport>::` address.
export const localPath = (url) => typeof url === 'string' && !url.includes('::') && !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url)
  && (path.posix.isAbsolute(url) || path.win32.isAbsolute(url));

// `env` for git calls that reach the remote `url`, as setup itself named it: https only, and a
// local path too when `url` is one (the stand-in host's, in tests).
export const reaching = (env, url) => ({ ...env, GIT_ALLOW_PROTOCOL: localPath(url) ? WITH_LOCAL : HTTPS_ONLY });

// `env` with git's global and system config shut out, no prompting, https the only transport
// (unless `reaching` allowed a local path), and the fence's settings added after whatever it passes
// already (a later setting wins). Safe to apply twice.
export function isolated(env = {}) {
  const pairs = pairsOf(env);
  const missing = FENCE.filter(([key, value]) => !pairs.some(([k, v]) => k === key && v === value));
  const all = [...pairs, ...missing];
  const out = {
    ...env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_FILE,
    GIT_ALLOW_PROTOCOL: env.GIT_ALLOW_PROTOCOL === WITH_LOCAL ? WITH_LOCAL : HTTPS_ONLY, GIT_CONFIG_COUNT: String(all.length),
  };
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

// Said when the repository's own config holds a setting that would run a program or send elsewhere,
// or can't be read.
export const commandSettingLine = (keys) => `git's settings in this folder's repository would run a program or send elsewhere (${keys.join(', ')}), so setup can't go on here with your sign-in: remove ${keys.length === 1 ? 'that setting' : 'those settings'} from the repository's .git/config, then a fresh Go ahead tries again`;
export const CONFIG_UNREAD = 'git\'s settings in this folder\'s repository could not be read, so setup did not run git there: a fresh Go ahead tries again';

// Refuses, naming them, when the config git would read in `cwd` (the repository's own, what it
// includes and its worktree config: the global and system config are shut out, and the call's own
// settings are left off for the look) holds any setting that would run a program or send elsewhere.
// Nothing found, or no repository there, passes.
export async function refuseCommandSettings({ run = realRun, gitPath = 'git', cwd }) {
  const env = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_FILE };
  let got;
  try {
    got = await run(gitPath, ['config', '--includes', '--name-only', '--list', '-z'], { cwd, env, baseEnv: withoutGitVars(), timeoutMs: GIT_WAIT_MS });
  } catch {
    throw new Error(CONFIG_UNREAD);
  }
  if (got.code !== 0) throw new Error(CONFIG_UNREAD);
  const keys = [...new Set(String(got.stdout ?? '').split('\0').map((k) => k.trim()).filter(runsOrSends))];
  if (keys.length > 0) throw new Error(commandSettingLine(keys));
}

// git for setup in `cwd` (or none): `git(args, options)` gives run's answer, after refusing a
// setting of the repository's that would run a program or send elsewhere; every call isolated as above.
export function setupGit({ run = realRun, gitPath = 'git', env = {}, cwd, timeoutMs = GIT_WAIT_MS } = {}) {
  const fenced = isolated(env);
  return async (args, options = {}) => {
    await refuseCommandSettings({ run, gitPath, cwd });
    return run(gitPath, args, { cwd, env: fenced, baseEnv: withoutGitVars(), timeoutMs, ...options });
  };
}
