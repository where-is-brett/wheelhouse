// scripts/setup/git.js
// How setup runs git (rulings R109 to R112): every call shuts out git's global and system config,
// so nothing in ~/.gitconfig or the system's config reaches it, and passes by environment only the
// settings it needs: the director's own sign-in as git's credential helper, when it uses it; hooks
// pointed at the null file; no file-system monitor; no automatic maintenance; no going into
// submodules (whose own settings are never looked at); inert values for the core settings that name
// a program (core.sshCommand, core.askPass, core.editor, core.pager); https certificates always
// checked (http.sslVerify); and no fetching of missing objects on the side (GIT_NO_LAZY_FETCH).
// git may reach a remote over https only (GIT_ALLOW_PROTOCOL, which outranks any protocol.*
// setting), so no transport that runs a program (ext::, a remote helper) and no ssh; a call to a
// remote that setup itself named as a path on this computer (the stand-in host's repositories in
// tests) may use a local path too. Where setup names the folder git works in (a project's folder),
// that folder is git's working tree (GIT_WORK_TREE, which outranks core.worktree).
// Before each call it refuses, naming them, every setting of the repository's own config (with what
// it includes, and its worktree config) that is not on the allowed list below (ruling R112): only
// settings that neither run a program nor change where git connects, writes or what it trusts, and
// the ones setup's own git calls write. An allowed list fails closed: a setting git adds in a later
// version is refused until it is looked at and listed.
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
// without these settings and with the submodule's own; the core settings that name a program set
// to ones that do nothing (a failing `false`, or `cat`); and https certificates checked (a setting
// given this way outranks the repository's own `http.sslVerify`).
const FENCE = [
  ['core.hooksPath', NULL_FILE], ['core.fsmonitor', 'false'], ['maintenance.auto', 'false'],
  ['submodule.recurse', 'false'], ['fetch.recurseSubmodules', 'false'], ['push.recurseSubmodules', 'no'],
  ['core.sshCommand', 'false'], ['core.askPass', 'false'], ['core.editor', 'false'], ['core.pager', 'cat'],
  ['http.sslVerify', 'true'],
];
// The transports git may use (ruling R111): https, and a local path only where setup named one.
const HTTPS_ONLY = 'https';
const WITH_LOCAL = 'https:file';

// The allowed list (ruling R112): the settings a repository's own config may hold for setup's git
// to run there. Sections and keys match in any case, as git matches them; a subsection (a remote's
// or a branch's name) may be any name, kept as written, except that a remote's name holds no `/`,
// `\` or `:` (ruling R113): git reads an address setup names (https://… or a path) as the name of
// a remote of that name, so such a remote's url would send setup's push or fetch elsewhere. Each
// runs no program and changes neither where git connects, nor where it writes, nor what it trusts,
// or is one that setup's own git calls write (init, remote add, clone, branch --set-upstream-to,
// the profile clone's branch settings).
// A section's key, with no subsection:
const PLAIN_KEYS = new Set([
  // What git init writes (on macOS, Linux and Windows), and how files are written out.
  'core.repositoryformatversion', 'core.filemode', 'core.bare', 'core.logallrefupdates', 'core.ignorecase',
  'core.precomposeunicode', 'core.symlinks', 'core.autocrlf', 'core.eol', 'core.safecrlf', 'core.quotepath',
  // A hooks folder (husky's): every call points it at the null file anyway.
  'core.hookspath',
  'user.name', 'user.email', 'init.defaultbranch', 'merge.ff', 'fetch.prune', 'push.default',
  // How objects and refs are stored: what git init writes for a repository of that kind.
  'extensions.objectformat', 'extensions.worktreeconfig', 'extensions.refstorage',
  // Brings in another file, whose settings the look reads and checks as the repository's own.
  'include.path',
]);
// A key under any named subsection of the section:
const NAMED_KEYS = new Map([
  ['remote', new Set(['url', 'fetch'])],
  // A branch's upstream (what clone and branch --set-upstream-to write), how a pull joins it, and
  // its description. Not pushRemote or mergeOptions: setup writes neither, and pushRemote sends a
  // push made without an address to another remote.
  ['branch', new Set(['remote', 'merge', 'rebase', 'description'])],
  ['includeif', new Set(['path'])],
]);
// Every key of the section:
const WHOLE_SECTIONS = new Set(['pull', 'color', 'advice']);

// Whether a setting, named as `git config --name-only` gives it, is on the allowed list.
export function allowedSetting(name) {
  if (typeof name !== 'string') return false;
  const first = name.indexOf('.');
  const last = name.lastIndexOf('.');
  if (first <= 0 || last === name.length - 1) return false;
  const section = name.slice(0, first).toLowerCase();
  const key = name.slice(last + 1).toLowerCase();
  if (WHOLE_SECTIONS.has(section)) return true;
  if (first === last) return PLAIN_KEYS.has(`${section}.${key}`);
  if (section === 'remote' && /[/\\:]/.test(name.slice(first + 1, last))) return false;
  return last > first + 1 && (NAMED_KEYS.get(section)?.has(key) ?? false);
}

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

// `env` with git's global and system config shut out, no prompting, no fetching of a missing object
// from the repository's own remote (a partial clone's), https the only transport (unless `reaching`
// allowed a local path), and the fence's settings added after whatever it passes
// already (a later setting wins). Safe to apply twice.
export function isolated(env = {}) {
  const pairs = pairsOf(env);
  const missing = FENCE.filter(([key, value]) => !pairs.some(([k, v]) => k === key && v === value));
  const all = [...pairs, ...missing];
  const out = {
    ...env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_FILE, GIT_NO_LAZY_FETCH: '1',
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

// Said when the repository's own config holds a setting that isn't on the allowed list, or can't be read.
export const unlistedSettingsLine = (keys) => {
  const one = keys.length === 1;
  return `git's settings in this folder's repository hold ${one ? 'a setting' : 'settings'} setup doesn't allow (${keys.join(', ')}), as ${one ? 'it' : 'they'} could make git run a program or connect, write or trust elsewhere, so setup can't go on while ${one ? 'it is' : 'they are'} there: remove ${one ? 'that setting' : 'those settings'} from the repository's .git/config, then a fresh Go ahead tries again`;
};
export const CONFIG_UNREAD = 'git\'s settings in this folder\'s repository could not be read, so setup did not run git there: a fresh Go ahead tries again';

// Refuses, naming them, when the config git would read in `cwd` (the repository's own, what it
// includes and its worktree config: the global and system config are shut out, and the call's own
// settings are left off for the look) holds any setting not on the allowed list. Nothing there, or
// no repository there, passes.
export async function refuseUnlistedSettings({ run = realRun, gitPath = 'git', cwd }) {
  const env = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_FILE };
  let got;
  try {
    got = await run(gitPath, ['config', '--includes', '--name-only', '--list', '-z'], { cwd, env, baseEnv: withoutGitVars(), timeoutMs: GIT_WAIT_MS });
  } catch {
    throw new Error(CONFIG_UNREAD);
  }
  if (got.code !== 0) throw new Error(CONFIG_UNREAD);
  const names = String(got.stdout ?? '').split('\0').map((k) => k.trim()).filter((k) => k !== '');
  const keys = [...new Set(names.filter((k) => !allowedSetting(k)))];
  if (keys.length > 0) throw new Error(unlistedSettingsLine(keys));
}

// git's subcommand among its arguments: the first that is neither an option nor the value of `-c`.
function subcommandOf(args) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-c' || args[i] === '-C') i += 1;
    else if (!String(args[i]).startsWith('-')) return args[i];
  }
  return '';
}

// git for setup in `cwd` (or none): `git(args, options)` gives run's answer, after refusing any
// setting of the repository's not on the allowed list; every call isolated as above. With
// `workTree` (the folder setup names, a project's), that folder is git's working tree whatever the
// repository's config says; not for `git init`, which makes the repository in `cwd` and takes no
// working tree without a git folder named too.
export function setupGit({ run = realRun, gitPath = 'git', env = {}, cwd, workTree = null, timeoutMs = GIT_WAIT_MS } = {}) {
  const fenced = isolated(env);
  const inFolder = workTree === null ? fenced : { ...fenced, GIT_WORK_TREE: workTree };
  return async (args, options = {}) => {
    await refuseUnlistedSettings({ run, gitPath, cwd });
    return run(gitPath, args, { cwd, env: subcommandOf(args) === 'init' ? fenced : inFolder, baseEnv: withoutGitVars(), timeoutMs, ...options });
  };
}
