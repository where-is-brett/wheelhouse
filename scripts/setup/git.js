// scripts/setup/git.js
// How setup runs git (rulings R109 to R112): every call shuts out git's global and system config,
// so nothing in ~/.gitconfig or the system's config reaches it, and passes by environment only the
// settings it needs: the director's own sign-in as git's credential helper, when it uses it; hooks
// pointed at the null file; no file-system monitor; no automatic maintenance; no going into
// submodules (whose own settings are never looked at); inert values for the core settings that name
// a program (core.sshCommand, core.askPass, core.editor, core.pager); https certificates checked
// (http.sslVerify, which a URL-scoped http.<url>.sslVerify in the repository would beat, so the allowed
// lists refuse those); no signing and no checking of signatures; and no fetching of missing objects on
// the side (GIT_NO_LAZY_FETCH).
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
// to ones that do nothing (a failing `false`, or `cat`); https certificates checked (a setting
// given this way outranks the repository's own plain `http.sslVerify`, but not a URL-scoped
// `http.<url>.sslVerify`, which beats it: the allowed lists refuse every URL-scoped `http.` key); and
// no signing and no checking of a signature (commits, tags and pushes unsigned; `git log` and
// `git merge` verify nothing), so no signing program is ever started.
export const FENCE = [
  ['core.hooksPath', NULL_FILE], ['core.fsmonitor', 'false'], ['maintenance.auto', 'false'],
  ['submodule.recurse', 'false'], ['fetch.recurseSubmodules', 'false'], ['push.recurseSubmodules', 'no'],
  ['core.sshCommand', 'false'], ['core.askPass', 'false'], ['core.editor', 'false'], ['core.pager', 'cat'],
  ['http.sslVerify', 'true'],
  ['commit.gpgSign', 'false'], ['tag.gpgSign', 'false'], ['push.gpgSign', 'false'],
  ['log.showSignature', 'false'], ['merge.verifySignatures', 'false'],
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

// The environment setup's git runs with where the director has no host tool to sign in with (GitLab
// narrow, made with the one-day setup token): no credential helper, and the project's own key as an
// http.extraHeader for the project's GitLab address only (`root`, https), as the helper gives it to
// the agents' git. Carried in the environment, never an argument; the setup token is never here.
export function keyedGitEnv({ root, key, gitPath = 'git', env = process.env, platform = process.platform } = {}) {
  if (typeof key !== 'string' || key === '' || /[\s\0]/.test(key)) throw new Error('The project\'s key is missing');
  if (typeof root !== 'string' || !/^https:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/.test(root) || root.endsWith('/')) throw new Error('The project\'s key is given to an https address only');
  const plain = setupGitEnv({ gitPath, env, platform });
  const pairs = [
    ...pairsOf(plain),
    ['credential.helper', ''],
    [`http.${root}/.extraheader`, `AUTHORIZATION: basic ${Buffer.from(`oauth2:${key}`, 'utf8').toString('base64')}`],
  ];
  const out = { ...plain, GIT_CONFIG_COUNT: String(pairs.length) };
  pairs.forEach(([k, v], i) => {
    out[`GIT_CONFIG_KEY_${i}`] = k;
    out[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return out;
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
// `env` is added to the look's own environment (git's sign-in gives GIT_CEILING_DIRECTORIES, so a folder that is no repository finds
// none above it).
export async function refuseUnlistedSettings({ run = realRun, gitPath = 'git', cwd, env: given = {}, baseEnv = withoutGitVars() }) {
  const env = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_FILE, ...given };
  let got;
  try {
    got = await run(gitPath, ['config', '--includes', '--name-only', '--list', '-z'], { cwd, env, baseEnv, timeoutMs: GIT_WAIT_MS });
  } catch {
    throw new Error(CONFIG_UNREAD);
  }
  if (got.code !== 0) throw new Error(CONFIG_UNREAD);
  const names = String(got.stdout ?? '').split('\0').map((k) => k.trim()).filter((k) => k !== '');
  const keys = [...new Set(names.filter((k) => !allowedSetting(k)))];
  if (keys.length > 0) throw new Error(unlistedSettingsLine(keys));
}

// git's subcommand among its arguments: the first that is neither an option nor the value of `-c`.
export function subcommandOf(args) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-c' || args[i] === '-C') i += 1;
    else if (!String(args[i]).startsWith('-')) return args[i];
  }
  return '';
}

// What the director's own git runs with on the "Use my git as it is" route, wherever it runs: every variable that could make git, or the
// credential helper it starts, load or trace code or read settings the director's own files do not hold is dropped. Every GCM_* variable
// goes except those named in `keep` (the one setup sets, GCM_INTERACTIVE, for git's sign-in alone), and so do the .NET startup hooks and
// host tracing, the runtime's own settings (CORECLR_*, COMPLUS_* and DOTNET_*, but not DOTNET_ROOT, which the helper may need to find its runtime), and the loader's preload, audit and library-path variables. HOME, XDG_CONFIG_HOME, the proxy and certificate variables stay as they are:
// the director's git reads its settings and reaches the host with them (on a company computer HOME is often set on purpose).
const ASIS_DROPPED = /^(?:GCM_.*|CORECLR_.*|COMPLUS_.*|DOTNET_(?!ROOT(?:$|\(x86\)$|_))[^]*|COREHOST_TRACE.*|DYLD_.*|LD_PRELOAD|LD_AUDIT|LD_LIBRARY_PATH)$/i;
export function asIsGitEnv(env, { keep = [] } = {}) {
  const kept = new Set(keep.map((name) => name.toUpperCase()));
  return Object.fromEntries(Object.entries(env ?? {}).filter(([name]) => kept.has(name.toUpperCase()) || !ASIS_DROPPED.test(name)));
}

// The git subcommands that reach a remote: the only calls an as-is route gives the director's own git (`reachEnv`).
const REMOTE_CALLS = new Set(['fetch', 'push', 'ls-remote']);

// The address a call that reaches a remote names: the argument after `--end-of-options`, or null.
export function addressOf(args) {
  const at = args.indexOf('--end-of-options');
  return at >= 0 && typeof args[at + 1] === 'string' ? args[at + 1] : null;
}

// git for setup in `cwd` (or none): `git(args, options)` gives run's answer, after refusing any
// setting of the repository's not on the allowed list; every call isolated as above. With
// `workTree` (the folder setup names, a project's), that folder is git's working tree whatever the
// repository's config says; not for `git init`, which makes the repository in `cwd` and takes no
// working tree without a git folder named too.
//
// With `reachEnv` (the as-is route's: scripts/lib/safe-git.js safeGitEnv with a push reach, so the director's own global and
// system settings and credential helper come in, the fence still outranks them, and nothing prompts), the calls that reach a
// remote (REMOTE_CALLS) run with it in place of the isolated one. It is built with the fence already, so it is not isolated
// again: `isolated` would shut the director's files out once more. Every call that only touches the folder stays isolated.
// With `reachGuard` (setup's as-is connect gives one), each such call first has the director's settings looked at for the address it
// names, and runs with the environment the guard gives back.
export function setupGit({ run = realRun, gitPath = 'git', env = {}, cwd, workTree = null, timeoutMs = GIT_WAIT_MS, reachEnv = null, reachGuard = null } = {}) {
  const fenced = isolated(env);
  const inFolder = workTree === null ? fenced : { ...fenced, GIT_WORK_TREE: workTree };
  const reaches = reachEnv === null ? null : workTree === null ? reachEnv : { ...reachEnv, GIT_WORK_TREE: workTree };
  return async (args, options = {}) => {
    const sub = subcommandOf(args);
    const toRemote = reaches !== null && REMOTE_CALLS.has(sub);
    // A call to the remote on the as-is route has the as-is base, the one the guard read the settings with; the look at the repository's
    // settings before it runs with that base too.
    const baseEnv = toRemote ? asIsGitEnv(withoutGitVars()) : withoutGitVars();
    await refuseUnlistedSettings({ run, gitPath, cwd, baseEnv });
    let callEnv = sub === 'init' ? fenced : toRemote ? reaches : inFolder;
    // `reachGuard` checks the director's own settings for the address the call names and gives back the environment to use.
    if (toRemote && reachGuard !== null) callEnv = await reachGuard({ run, gitPath, cwd, env: callEnv, url: addressOf(args), timeoutMs, baseEnv });
    return run(gitPath, args, { cwd, env: callEnv, baseEnv, timeoutMs, ...options });
  };
}

// ---- What git said, for a failure line ----

const HIDDEN = '[hidden]';
// The user or token in an address (`scheme://user:pass@host`, a password with an unencoded `/` or `@` in it too): everything from
// after `://` to the last `@` before the next white space goes. A scan, not one pattern: a pattern that reads on to the end for
// each `scheme://` it meets goes quadratic on a long line of them. Each run to white space is read once, so no text is read twice.
function hideUserinfo(text) {
  let out = '';
  let from = 0;
  let at = text.indexOf('://');
  while (at >= 0) {
    let start = at;
    while (start > from && /[A-Za-z0-9+.-]/.test(text[start - 1])) start -= 1;
    let end = at + 3;
    let lastAt = -1;
    while (end < text.length && !/\s/.test(text[end])) {
      if (text[end] === '@') lastAt = end;
      end += 1;
    }
    if (lastAt >= 0 && /[A-Za-z]/.test(text.slice(start, at))) {
      out += `${text.slice(from, at + 3)}${HIDDEN}`;
      from = lastAt;
    }
    at = text.indexOf('://', end);
  }
  return out + text.slice(from);
}

// Text git (or its helpers) wrote, with anything that could carry a sign-in taken out: the user or token in an address
// (hideUserinfo), an Authorization or extra-header value (to the end of its line), a Cookie or Set-Cookie value (to the end of its
// line), a bare `Bearer` or `Basic` value (`bearer: x` too), a `token` or `client_secret` value after `=` or `:` (bare, to the end of its
// run of non-space characters, or in quotes), a JSON member, in double or single quotes, named for a password, pass, secret, token, credential, api key, private key, access key,
// authorization or auth (accessToken and id_token too, its value hidden even when its closing quote is missing), a `password:` value, a `secret=` or `secret:` (`aws_secret_access_key=`, `app_secret=` and `X-Secret:` too), `api_key:` or `sig=` value, an address with no scheme but a user and password (within 256 characters of it, ending at a host name with a dot), a `password=` or `passwd=` value, and anything shaped like a GitLab or GitHub token
// (after a letter too). Safe to apply twice. Every pattern reads each stretch of text once, so a long line costs a pass.
export function scrubGitText(text) {
  return hideUserinfo(String(text ?? ''))
    .replace(/(authorization[ \t]*[:=][ \t]*)[^\r\n]*/gi, `$1${HIDDEN}`)
    .replace(/(extraheader[^\s=:]{0,256}[ \t]*[:=][ \t]*)[^\r\n]*/gi, `$1${HIDDEN}`)
    .replace(/(private-token[ \t]*:[ \t]*)[^\r\n]*/gi, `$1${HIDDEN}`)
    .replace(/(\b(?:set-)?cookie[ \t]*[:=][ \t]*)[^\r\n]*/gi, `$1${HIDDEN}`)
    .replace(/(\bbearer[ \t]*[:=][ \t]*)[^\r\n]*/gi, `$1${HIDDEN}`)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{4,}/gi, `$1${HIDDEN}`)
    // A `Basic` value is 8 or more base64 (or base64url) characters, not followed by another, with a digit, an `=`, a `+` or a `/`, or both
    // cases, in it: prose such as "Basic authentication failed" stays.
    .replace(/\b(Basic\s+)([A-Za-z0-9+/=_-]{8,})(?![A-Za-z0-9+/=_-])/gi, (all, lead, token) => (/[0-9=+/]|[a-z][A-Z]|[A-Z][a-z]/.test(token) ? `${lead}${HIDDEN}` : all))
    // A JSON member: "password": "x" or 'password': 'x', and the other names a secret goes by ("accessToken", "id_token", "client_secret",
    // "api-key", "authorization", "auth"; a dot may be in the name). The key is read once, between its quotes, and tested for the words
    // afterwards; a value whose closing quote is missing ends at the line.
    .replace(/(((["'])([A-Za-z0-9_.-]*)\3)[ \t]*:[ \t]*)(["'])(?:(?!\5)[^\\\r\n]|\\.)*\5?/g, (all, lead, _quoted, _q, key, quote) => (/password|passwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|credential|authorization|^auth$|^pass$/i.test(key) ? `${lead}${quote}${HIDDEN}${quote}` : all))
    // `token=x`, `token: x`, `token = "x"`, `client_secret=x`, `token= A,B`: a quoted string, or the run of characters up to white space.
    .replace(/((?:token|client_secret)[ \t]*[:=][ \t]*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s&'"]+)/gi, `$1${HIDDEN}`)
    .replace(/(pass(?:word|wd)[ \t]*[=:][ \t]*)[^\r\n]*/gi, `$1${HIDDEN}`)
    // `secret=x`, `secret: x`, `aws_secret_access_key=x`, `X-Secret: x`, `api_key: x`, `api-key=x`: a quoted string, or the run of characters up to white space; `sig=x` in a query.
    .replace(/(secret[A-Za-z0-9_-]{0,64}[ \t]*[:=][ \t]*|api[-_]?key[ \t]*[:=][ \t]*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s&'"]+)/gi, `$1${HIDDEN}`)
    .replace(/(\bsig=)[^\s&'"]+/gi, `$1${HIDDEN}`)
    // An address with no scheme: `user:pass@host/path`, from the start of a word to the last @ in it. The user is up to 64 characters of
    // a user name's, with a letter in them, and the part after the @ is a host name (then a dot, a colon, a slash, a space, a closing bracket or
    // quote, or the end) or a bracketed address, so `C:\Users\me@corp\repo` and `2026-11-18 10:15:22@server` stay as they are. An `=`
    // may come before it (`http.proxy=user:pw@proxy:3128`).
    // A one-letter user whose password starts with `/` or `\` and has another one in it is shown, as it can't be told from a Windows path.
    .replace(/(^|[\s(<'"=])(?=[0-9._%+\\-]{0,63}[A-Za-z])([A-Za-z0-9._%+\\-]{1,64}):(?!\/\/)\S{0,256}@(?=\[|[A-Za-z0-9-]{1,63}(?:[.:/]|[\s'")>]|$))/g, (all, lead, user) => (/[A-Za-z]/.test(user) && !/^[A-Za-z]:[\\/][^:]*[\\/][^:]*$/.test(all.slice(lead.length)) ? `${lead}${HIDDEN}@` : all))
    // GitLab's personal access token, whatever its body, and GitHub's tokens, whatever comes before them (a letter too); and GitLab's
    // other token prefixes (gldt-, glrt-, glcbt-, gloas-, glft-, glptt-, glimt-, glsoat-), by their shape: a body with a digit in it. Whatever
    // comes before, an underscore too, is not part of the token.
    .replace(/glpat-[A-Za-z0-9_-]{8,}/g, HIDDEN)
    .replace(/(?<![A-Za-z0-9])gl[a-z]{2,5}-[A-Za-z0-9_-]{8,}/g, (m) => (/\d/.test(m.slice(m.indexOf('-') + 1)) ? HIDDEN : m))
    .replace(/(?:gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})/g, HIDDEN);
}

// Lines git adds that say nothing of why: its hints, the `To <address>` line of a push (git's own, capital T), and its closing
// `failed to push` line (the `remote:` reason and the `! [remote rejected]` line before it are what matter).
const isNoise = (line) => /^To\s+\S/.test(line) || /^(?:hint:|error: failed to push some refs)/i.test(line);
// How much of the end of git's stderr is scrubbed at all: only the last lines can be said.
const SCRUBBED_LINES = 16;

// The last line or two of git's stderr, scrubbed, without the noise above, and trimmed to about 300 characters (the end is kept:
// it is what git ended on, and the cut falls at a word), or '' when git said nothing. Only the last lines are scrubbed, line by
// line, and nothing is cut by characters before it is scrubbed.
export function gitSaid(stderr, { limit = 300 } = {}) {
  const lines = String(stderr ?? '').split(/[\r\n]+/).filter((l) => l.trim() !== '').slice(-SCRUBBED_LINES)
    .map((l) => scrubGitText(l).trim()).filter((l) => l !== '' && !isNoise(l));
  const said = lines.slice(-2).join(' ');
  if (said.length <= limit) return said;
  const from = said.length - (limit - 1);
  let tail = said.slice(from);
  // A cut that fell inside a word drops that part of the word; with no space to cut at, the hard cut stands.
  if (!/\s/.test(said[from - 1]) && /\s/.test(tail)) tail = tail.slice(tail.search(/\s/)).trimStart();
  return `\u2026${tail}`;
}

// The end of already scrubbed text, within `max` characters (the end is what a failure ended on): a cut that falls inside a word drops
// that part of the word, and an ellipsis marks the cut. Cut after scrubbing, never before.
export function endOf(text, max = 4096) {
  const t = String(text ?? '');
  if (t.length <= max) return t;
  const from = t.length - (max - 1);
  let tail = t.slice(from);
  if (!/\s/.test(t[from - 1]) && /\s/.test(tail)) tail = tail.slice(tail.search(/\s/)).trimStart();
  return `\u2026${tail}`;
}

// A failure line: `why`, then what git said when it said anything, then `then` (the next step) when given.
export function gitFailure(why, stderr, { then = null } = {}) {
  const said = gitSaid(stderr);
  return `${why}${said === '' ? '' : ` (git said: ${said})`}${then === null ? '' : `; ${then}`}`;
}

// A failure with two texts: `message` is the director's line, `detail` the exact names for the agent reading status (the journal's
// failedDetail, shown on a `Detail:` line the director is never told).
export class DetailedError extends Error {
  constructor(message, detail) {
    super(message);
    this.detail = typeof detail === 'string' ? scrubGitText(detail) : undefined;
  }
}

// What git said when a call that reached the host failed, told by its last lines, one line at a time (so a long stderr costs a
// pass, nothing more), and in the text of a line outside its addresses and paths, so a project named auth-service.git says nothing:
// 'not-found' when the project is not there for this sign-in, 'sign-in' when a sign-in is missing or refused, else 'other'.
const NOT_FOUND = [/could not be found or you don.t have permission/i, /the project you were looking for could not be found/i, /permission to \S+ denied/i, /repository not found/i];
const SIGN_IN_WORDS = /auth|credential|sign.?in|log.?in|forbidden|denied/i;
const SIGN_IN_FAILURE = [/could not read (?:username|password)/i, /authentication failed/i, /http basic: access denied/i, /\b401\b/, /terminal prompts (?:have been )?disabled/i, /user interactivity has been disabled/i];
const SAID_LINES = 16;
const outsideAddresses = (line) => line.split(/\s+/).filter((word) => !/[/\\]|\.git\b/i.test(word)).join(' ');
export function reachFailureKind(stderr) {
  const said = String(stderr ?? '').split(/[\r\n]+/).filter((l) => l.trim() !== '').slice(-SAID_LINES);
  // These phrases hold spaces, so no address or path can make one.
  if (said.some((l) => NOT_FOUND.some((re) => re.test(l)))) return 'not-found';
  const lines = said.map(outsideAddresses);
  if (lines.some((l) => SIGN_IN_FAILURE.some((re) => re.test(l)) || (/\b403\b/.test(l) && SIGN_IN_WORDS.test(l)))) return 'sign-in';
  return 'other';
}
