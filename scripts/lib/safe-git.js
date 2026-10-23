// scripts/lib/safe-git.js
// The one route every git call of Wheelhouse takes, built on setup's fence and allowed list. The
// allowed list lives in scripts/setup/git.js (rulings R109 to R113); it is to move into scripts/lib/
// once the work changing setup's files has merged. This file imports the fence and the list and
// never copies them.
// There are two allowed lists, by the kind of repository the look reads: the own list (setup's, ruling
// R112, in scripts/setup/git.js) for the repositories Wheelhouse made and commits and pushes in, and
// the project list (below) for a director's project repository, where Wheelhouse only reads, fetches,
// makes worktrees and fast-forwards. The design review is docs/specs/notes/2026-10-23-git-settings-allowed-list.md.
// Every call shuts out git's global and system config, points hooks at the null file, and allows one
// transport: https, or https and a local path where the caller names a local remote, or https and
// ssh where the caller asks for ssh by name. Before a call it can look at the repository's own config
// and refuse, naming them, any setting off the allowed list.
// What the fence does not do: the look reads the config in its own folder and its own context. A call
// that runs git in another context (a new worktree, another branch, whose `includeIf` files are read
// only there) needs that context looked at too. The foreman's own check of the main checkout's
// config for `include`, `includeIf` and `filter` sections (R93, checkRepoConfig in
// scripts/foreman/act.js) is load-bearing for its worktree and must stay.
import { run as realRun, withoutGitVars } from './run.js';
import path from 'node:path';
import {
  isolated, refuseUnlistedSettings, setupGitEnv, subcommandOf, allowedSetting, unlistedSettingsLine, CONFIG_UNREAD, FENCE, NULL_FILE,
} from '../setup/git.js';

export { NULL_FILE };

// A repository's git settings that the look refused (or could not read): its text is the refusal.
export class LookRefusal extends Error {}

const GIT_WAIT_MS = 5 * 60 * 1000;
// The GIT_ variables a caller may pass (an allowed list, so it fails closed like the config list: a
// variable git adds in a later version, or one that outranks the fence's settings or points git at
// another repository, is dropped until it is looked at and listed). GIT_CONFIG_KEY_<n> and
// GIT_CONFIG_VALUE_<n> are handled with the pairs; GIT_SSH_COMMAND only when reach is 'ssh'.
const ALLOWED_VARS = new Set([
  'GIT_CONFIG_COUNT', 'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_TERMINAL_PROMPT', 'GIT_OPTIONAL_LOCKS',
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL',
  'GIT_COMMITTER_DATE', 'GIT_ATTR_NOSYSTEM', 'GIT_NO_LAZY_FETCH',
]);
const TRANSPORT = { https: 'https', local: 'https:file', ssh: 'https:ssh', loopback: 'https:http' };

// How a remote's address is reached: 'local' for a path on this computer (absolute, relative, a
// drive letter or a share on Windows) or a file:// address; 'loopback' for an http:// address on
// 127.0.0.1, localhost or [::1]; 'https' for everything else, an ssh or
// scp-style address included (the transport that lets ssh through is asked for by name).
export function reachFor(url, { platform = process.platform } = {}) {
  if (typeof url !== 'string' || url === '') return 'https';
  if (/^file:\/\//i.test(url)) return 'local';
  // Plain http on this computer's own loopback only: the narrow-key tests' stand-in host. Setup never
  // records such a remote for a real project. Any other http:// address stays refused.
  if (/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(url)) return 'loopback';
  if (url.includes('::') || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url)) return 'https';
  if (path.posix.isAbsolute(url) || /^\.\.?\//.test(url)) return 'local';
  if (platform === 'win32' && (path.win32.isAbsolute(url) || /^\.\.?\\/.test(url))) return 'local';
  return 'https';
}

// --- The project list ---
// The settings a director's project repository may hold, besides the own list's (the design review's
// section 3). Wheelhouse runs only `symbolic-ref`, `rev-parse`, `worktree add`, `fetch`, `merge --ff-only`,
// `log`, `rev-list`, `status`, `remote` and `worktree list` there. A setting is on it because it runs no
// program and changes nowhere git connects or writes, or because the fence sets the same key on every
// call (PROJECT_OVERRIDDEN below, kept true by a test). It fails closed, as the own list does.
// Case does not matter in a section or a key; a subsection is kept as written.

// Conditions the list's last rows rest on. Each is the result of a scan in
// tests/scripts/lib/safe-git-lists.test.js, which fails when the value here and the scan disagree.
export const PROJECT_CONDITIONS = Object.freeze({
  // Test 9: every `gh` and `glab` call in scripts/ names its repository (`-R`, `--repo`, or a full API
  // path) or runs outside any project. `gh` writes `remote.<name>.gh-resolved` to pick a repository, so
  // that key, and any other hyphenated `remote.<name>.<key>` (git reads no key with a `-`), is on the
  // list only while this holds. It does not today: the survey's open-requests list runs `gh pr list`
  // and `glab mr list` in the project's folder with no repository named (scripts/install/survey.js,
  // openRequests). Those keys stay refused until that call names its repository.
  ghNamesRepository: false,
  // Test 10: no route whose look is the project list runs `push`, `commit`, `tag`, `rebase` or `am`.
  // Holds today. The push targets (`remote.<name>.pushurl`, `remote.pushDefault`,
  // `branch.<name>.pushRemote`) are on the list only while it does.
  noPushFromProject: true,
});

// A key of a section, with no subsection (`core.longpaths`).
const PROJECT_PLAIN = new Set([
  // Storage, speed and line handling (Windows and Scalar write several).
  'core.longpaths', 'core.fscache', 'core.untrackedcache', 'core.splitindex', 'core.commitgraph', 'core.multipackindex',
  'core.preloadindex', 'core.checkstat', 'core.trustctime', 'core.whitespace', 'core.abbrev', 'core.compression',
  'core.sparsecheckout', 'core.sparsecheckoutcone',
  // Overridden by the fence on every call (see PROJECT_OVERRIDDEN). `core.fsmonitorhookversion` only
  // says how a hook named by `core.fsmonitor` is called, and the fence sets that to `false`.
  'core.fsmonitor', 'core.fsmonitorhookversion', 'core.sshcommand', 'core.askpass', 'core.editor', 'core.pager',
  // Identity only; a signing key's id runs nothing.
  'user.signingkey', 'user.useconfigonly', 'author.name', 'author.email', 'committer.name', 'committer.email',
  // Signing and signature checks: the fence turns them off. `gpg.format` only picks the kind.
  'commit.gpgsign', 'tag.gpgsign', 'push.gpgsign', 'log.showsignature', 'merge.verifysignatures', 'gpg.format',
  // Every fenced call clears the credential helpers before adding the director's own.
  'credential.helper', 'credential.username', 'credential.usehttppath',
  // Transfer sizes and timing only; the plain sslverify is overridden. URL-scoped `http.<url>.*` are refused.
  'http.postbuffer', 'http.version', 'http.lowspeedlimit', 'http.lowspeedtime', 'http.maxrequests', 'http.sslverify',
  'protocol.version',
  'submodule.active', 'submodule.recurse',
  'merge.conflictstyle', 'rebase.autostash', 'rebase.autosquash', 'rebase.updaterefs',
  'fetch.prunetags', 'fetch.writecommitgraph', 'fetch.parallel', 'fetch.showforcedupdates', 'fetch.unpacklimit',
  'fetch.negotiationalgorithm', 'fetch.output', 'fetch.recursesubmodules',
  'push.autosetupremote', 'push.followtags', 'push.useforceifincludes', 'push.recursesubmodules',
  'gc.auto', 'gc.autodetach', 'gc.autopacklimit', 'gc.writecommitgraph', 'gc.cruftpacks', 'gc.reflogexpire',
  'gc.reflogexpireunreachable', 'gc.pruneexpire',
  'checkout.defaultremote', 'checkout.workers', 'checkout.thresholdforparallelism',
  'worktree.guessremote', 'worktree.userelativepaths',
  'extensions.partialclone', 'extensions.preciousobjects',
]);
// A key under any named subsection of the section (`branch.<name>.pushremote`).
const PROJECT_NAMED = new Map([
  // A URL's own helper, user name and path rule (cleared with the rest by the fence's reset).
  ['credential', new Set(['helper', 'username', 'usehttppath'])],
  ['branch', new Set([
    // Not mergeoptions: it can name a merge strategy (a program) or signing.
    ...(PROJECT_CONDITIONS.noPushFromProject ? ['pushremote'] : []),
  ])],
  ['remote', new Set([
    // Which refs a fetch takes; no address.
    'tagopt', 'prune', 'prunetags', 'push', 'partialclonefilter', 'promisor', 'followremotehead', 'skipdefaultupdate', 'skipfetchall',
    // Only while no Wheelhouse call pushes from a project (PROJECT_CONDITIONS.noPushFromProject).
    ...(PROJECT_CONDITIONS.noPushFromProject ? ['pushurl'] : []),
  ])],
  // Wheelhouse never runs `git submodule`, and the fence turns recursion off. Not `update`: its
  // `!command` form runs a program.
  ['submodule', new Set(['url', 'path', 'active', 'branch', 'ignore', 'shallow', 'fetchrecursesubmodules'])],
]);
// `remote.pushdefault`, with no subsection, is the one push target that sits on a plain key.
if (PROJECT_CONDITIONS.noPushFromProject) PROJECT_PLAIN.add('remote.pushdefault');
// Sections where git 2.54 has no key that runs a program or names an address. A git upgrade is looked
// at before it is trusted: test 14 fails when the installed git lists a key in one of these that the
// snapshot (tests/fixtures/git-config-keys.json) lacks. `lfs` is read only by git-lfs, which runs only
// through a filter or a hook, both off.
export const PROJECT_WHOLE_SECTIONS = Object.freeze([
  'pack', 'index', 'feature', 'commitgraph', 'status', 'log', 'column', 'gui', 'rerere', 'blame', 'lfs', 'maintenance',
]);
const PROJECT_WHOLE = new Set(PROJECT_WHOLE_SECTIONS);
// The own list's entries stay on this one (`user.name`, `user.email`, `init.defaultbranch`, `merge.ff`,
// `fetch.prune`, `push.default`, `remote.*.url`, `branch.*.merge` and the rest).

// Each setting the project list allows because the fence sets another on every call, as
// [the listed shape, the fence key that holds it]. `credential.helper` is the reset that begins every
// call's own pairs (safeGitEnv). A test keeps every row true.
export const PROJECT_OVERRIDDEN = Object.freeze([
  ['core.fsmonitor', 'core.fsmonitor'],
  ['core.sshcommand', 'core.sshcommand'],
  ['core.askpass', 'core.askpass'],
  ['core.editor', 'core.editor'],
  ['core.pager', 'core.pager'],
  ['commit.gpgsign', 'commit.gpgsign'],
  ['tag.gpgsign', 'tag.gpgsign'],
  ['push.gpgsign', 'push.gpgsign'],
  ['log.showsignature', 'log.showsignature'],
  ['merge.verifysignatures', 'merge.verifysignatures'],
  ['http.sslverify', 'http.sslverify'],
  ['submodule.recurse', 'submodule.recurse'],
  ['fetch.recursesubmodules', 'fetch.recursesubmodules'],
  ['push.recursesubmodules', 'push.recursesubmodules'],
  ['maintenance.auto', 'maintenance.auto'],
  ['submodule.<name>.fetchrecursesubmodules', 'fetch.recursesubmodules'],
  ['credential.helper', 'credential.helper'],
  ['credential.<url>.helper', 'credential.helper'],
].map((row) => Object.freeze(row)));

// Whether a setting, named as `git config --name-only` gives it, is on the project list: the own list's
// settings, and the rows above.
export function allowedProjectSetting(name) {
  if (allowedSetting(name)) return true;
  if (typeof name !== 'string') return false;
  const first = name.indexOf('.');
  const last = name.lastIndexOf('.');
  if (first <= 0 || last === name.length - 1) return false;
  const section = name.slice(0, first).toLowerCase();
  const key = name.slice(last + 1).toLowerCase();
  if (PROJECT_WHOLE.has(section)) return true;
  if (first === last) return PROJECT_PLAIN.has(`${section}.${key}`) || section === 'alias';
  // A remote's name holds no `/`, `\` or `:` (ruling R113), whatever the key.
  if (section === 'remote' && /[/\\:]/.test(name.slice(first + 1, last))) return false;
  if (last === first + 1) return false;
  if (PROJECT_NAMED.get(section)?.has(key)) return true;
  // A tool's own key holds a `-`, and git reads no key with a `-` in its name. A branch's are allowed
  // outright; a remote's only while every `gh` and `glab` call names its repository (`gh-resolved`).
  if (key.includes('-')) return section === 'branch' || (section === 'remote' && PROJECT_CONDITIONS.ghNamesRepository);
  return false;
}

// What each list is, for the look: `own` is setup's (R112), `project` the list above.
const LISTS = { own: allowedSetting, project: allowedProjectSetting };

// `env` with the whole fence, and the transport `reach` names in place of any given. Safe to apply twice.
export function safeGitEnv(env = {}, { reach = 'https' } = {}) {
  const transport = TRANSPORT[reach];
  if (transport === undefined) throw new Error(`safeGitEnv: unknown reach ${String(reach)}`);
  // Any GIT_ variable off the allowed list is dropped, whatever the caller gave.
  const kept = {};
  for (const [name, value] of Object.entries(env ?? {})) {
    const upper = name.toUpperCase();
    if (!upper.startsWith('GIT_')) kept[name] = value;
    else if (ALLOWED_VARS.has(upper) || /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(upper) || (upper === 'GIT_SSH_COMMAND' && reach === 'ssh')) kept[upper] = value;
  }
  // Every setting of the fence goes last, and a caller's setting of the same key is dropped, so the
  // fence's value is the one git ends with.
  const fenceKeys = new Set(FENCE.map(([key]) => key.toLowerCase()));
  const count = Number.parseInt(kept.GIT_CONFIG_COUNT ?? '0', 10);
  const own = [];
  for (let i = 0; Number.isInteger(count) && i < count; i += 1) {
    if (!(`GIT_CONFIG_KEY_${i}` in kept) || !(`GIT_CONFIG_VALUE_${i}` in kept)) {
      throw new Error(`safeGitEnv: GIT_CONFIG_COUNT is ${count}, but setting ${i} is not given`);
    }
    const key = kept[`GIT_CONFIG_KEY_${i}`];
    const value = kept[`GIT_CONFIG_VALUE_${i}`];
    // A caller's own clearing of the credential helpers is dropped: the reset below does it, once.
    if (String(key).toLowerCase() === 'credential.helper' && value === '') continue;
    if (!fenceKeys.has(String(key).toLowerCase())) own.push([key, value]);
  }
  // The call's own pairs begin with a clearing of every credential helper the repository (or a URL
  // in it) lists, so none runs; the director's sign-in, which comes after it among the caller's
  // pairs, is then the only helper. Nothing after it names credential.helper: the fence does not.
  own.unshift(['credential.helper', '']);
  for (const name of Object.keys(kept)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name)) delete kept[name];
  own.forEach(([key, value], i) => {
    kept[`GIT_CONFIG_KEY_${i}`] = key;
    kept[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  kept.GIT_CONFIG_COUNT = String(own.length);
  return { ...isolated({ ...kept, GIT_ALLOW_PROTOCOL: TRANSPORT.https }), GIT_ALLOW_PROTOCOL: transport };
}

// The settings the repository in `cwd` holds that are off the allowed list (`list`: 'own', the default,
// or 'project'): `{ keys }` (empty when
// all are listed, or when no repository is there), or `{ unread: true }` when git could not say. The
// same call as setup's look; it throws only for an unknown list, so each caller words its own refusal.
export async function lookAtSettings({ run = realRun, gitPath = 'git', cwd, list = 'own' }) {
  const allowed = Object.hasOwn(LISTS, list) ? LISTS[list] : undefined;
  if (allowed === undefined) throw new Error(`lookAtSettings: unknown list ${String(list)}`);
  const env = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_FILE };
  let got;
  try {
    got = await run(gitPath, ['config', '--includes', '--name-only', '--list', '-z'], { cwd, env, baseEnv: withoutGitVars(), timeoutMs: GIT_WAIT_MS });
  } catch {
    return { unread: true };
  }
  if (got.code !== 0) return { unread: true };
  const names = String(got.stdout ?? '').split('\0').map((k) => k.trim()).filter((k) => k !== '');
  return { keys: [...new Set(names.filter((k) => !allowed(k)))] };
}

const KEY_CHARS = 80;
const KEYS_SHOWN = 5;
// A setting's name made safe to show: only letters, digits, `.`, `_` and `-`, a long run of them
// (which could be a token an agent put in a section name) hidden, and the whole cut short.
export function safeKeyName(key) {
  const clean = String(key).replace(/[^A-Za-z0-9._-]/g, '').replace(/[A-Za-z0-9_-]{24,}/g, '<long>');
  return clean.length > KEY_CHARS ? `${clean.slice(0, KEY_CHARS)}...` : clean;
}
const listOf = (keys) => {
  const shown = keys.slice(0, KEYS_SHOWN).map(safeKeyName).filter((k) => k !== '');
  const more = keys.length - KEYS_SHOWN;
  return `${shown.length > 0 ? shown.join(', ') : 'a setting with an odd name'}${more > 0 ? ` and ${more} more` : ''}`;
};
const WHAT = {
  helper: "the project's git repository",
  foreman: "the project's main checkout",
  survey: "the project's repository",
  feature: "the feature's worktree",
  reinstall: "Claude Code's copy of the marketplace",
};
// How each caller tells it that the look refused, in plain words and with its own next step. None
// of them holds a phrase the helper reads as a failure to sign in.
const NEXT = {
  helper: (them) => `The helper ran no git there. Remove ${them} from that repository's .git/config, then try the request again.`,
  foreman: (them) => `No worktree was made. The director needs to remove ${them} from that checkout's .git/config before this work can start.`,
  survey: (them) => `The survey went no further. Remove ${them} from that repository's .git/config, then run the survey again.`,
  feature: (them) => `The pull ran no git there. Remove ${them} from that worktree's repository, then run pull again.`,
  reinstall: (them) => `Nothing was reinstalled. Remove ${them} from that copy's .git/config, then run the reinstall again.`,
};
const UNREAD_NEXT = {
  helper: 'The helper ran no git there. Try the request again.',
  foreman: 'No worktree was made. Try starting the work again; if it keeps happening, ask the director.',
  survey: 'The survey went no further. Run the survey again.',
  feature: 'The pull ran no git there. Run pull again.',
  reinstall: 'Nothing was reinstalled. Run the reinstall again.',
};

// The refusal line for `caller` ('helper', 'foreman', 'survey', 'feature' or 'reinstall') after a
// look that gave `found` (from lookAtSettings). `what` names the repository where the caller knows
// better than the default.
export function lookRefusalLine(caller, found, { what = null } = {}) {
  if (!(caller in NEXT)) throw new Error(`lookRefusalLine: unknown caller ${String(caller)}`);
  const where = what ?? WHAT[caller];
  if (found.unread) return `Git's settings in ${where} could not be read. ${UNREAD_NEXT[caller]}`;
  const one = found.keys.length === 1;
  return `Git's settings in ${where} include ${listOf(found.keys)}, which Wheelhouse does not allow, as ${one ? 'it' : 'they'} could make git run a program or connect, write or trust somewhere else. ${NEXT[caller](one ? 'it' : 'them')}`;
}

// The settings that git's `-c` may not set in a call's arguments: the fence's own keys, which
// `-c` would lift (git applies it after the environment's pairs). A short named list is let through.
const ARGUMENT_SETTINGS_ALLOWED = new Set(['core.editor=true']);
// `credential.helper`, and a URL's own `credential.<url>.helper`: an argument's would come after the reset.
const CREDENTIAL_HELPER = /^credential\.(?:.+\.)?helper$/i;
function refuseFenceOverride(args) {
  const fenceKeys = new Set(FENCE.map(([key]) => key.toLowerCase()));
  for (let i = 0; i < args.length; i += 1) {
    const given = String(args[i]);
    // `--config-env=<key>=<var>`, or `--config-env` with `<key>=<var>` as the next argument.
    const fromEnv = given.startsWith('--config-env=') ? given.slice(13) : given === '--config-env' ? String(args[i + 1] ?? '') : null;
    if (fromEnv !== null && (fenceKeys.has(fromEnv.split('=')[0].toLowerCase()) || CREDENTIAL_HELPER.test(fromEnv.split('=')[0]))) {
      throw new Error(`safeGit: an argument may not set ${fromEnv.split('=')[0].toLowerCase()}, a setting of the fence`);
    }
    if (given !== '-c') continue;
    const setting = String(args[i + 1] ?? '');
    const key = setting.split('=')[0].toLowerCase();
    if (CREDENTIAL_HELPER.test(key)) throw new Error(`safeGit: an argument may not set ${key}, which would come after the fence's clearing of the credential helpers`);
    if (fenceKeys.has(key) && !ARGUMENT_SETTINGS_ALLOWED.has(setting.toLowerCase())) {
      throw new Error(`safeGit: an argument may not set ${key}, a setting of the fence`);
    }
  }
}

// git in `cwd`: `git(args, options)` gives run's answer. `list` says which allowed list the look uses:
// 'own' (the default, so a caller that says nothing gets the strict one) for a repository Wheelhouse
// made, or 'project' for a director's project repository. `look` is 'each' (look at the repository's
// settings before every call), 'once' (before the first call of this function only; a refusal is
// thrown again on every later call) or 'never' (the fence alone; for a caller whose comment says
// why). `workTree` makes that folder git's working tree (not for `init`). `options.env` is added
// before the fence, so a caller cannot lift it. Nor can the arguments: one that sets a fence key
// with `-c` or `--config-env` (git applies it after the environment) is refused, bar a short named list. With
// `caller` ('helper', 'foreman', 'survey', 'feature' or 'reinstall'), a refused look throws a
// LookRefusal worded for that caller (and `what` names the repository); without it, setup's line.
export function safeGit({
  run = realRun, gitPath = 'git', cwd, env = {}, reach = 'https', look = 'each', list = 'own', workTree = null, timeoutMs = GIT_WAIT_MS,
  caller = null, what = null,
} = {}) {
  if (!['each', 'once', 'never'].includes(look)) throw new Error(`safeGit: unknown look ${String(look)}`);
  if (!Object.hasOwn(LISTS, list)) throw new Error(`safeGit: unknown list ${String(list)}`);
  if (caller !== null && !(caller in NEXT)) throw new Error(`safeGit: unknown caller ${String(caller)}`);
  let looked = null;
  const lookNow = caller === null
    ? (list === 'own' ? () => refuseUnlistedSettings({ run, gitPath, cwd }) : async () => {
      const found = await lookAtSettings({ run, gitPath, cwd, list });
      if (found.unread) throw new Error(CONFIG_UNREAD);
      if (found.keys.length > 0) throw new Error(unlistedSettingsLine(found.keys));
    })
    : async () => {
      const found = await lookAtSettings({ run, gitPath, cwd, list });
      if (found.unread || found.keys.length > 0) throw new LookRefusal(lookRefusalLine(caller, found, { what }));
    };
  return async (args, options = {}) => {
    options ??= {};
    refuseFenceOverride(args);
    if (look === 'each') await lookNow();
    else if (look === 'once') {
      looked ??= lookNow();
      await looked;
    }
    // The factory's folder and base environment stand: a call cannot give its own.
    if (options && ('cwd' in options || 'baseEnv' in options)) throw new Error('safeGit: cwd and baseEnv are given once, to safeGit, not to a call');
    const { env: extra, ...rest } = options ?? {};
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
  ['scripts/lineage/upgrade.js', "land: the maintainer's own tool, committing in their checkout with their identity and hooks, on purpose"],
  ['scripts/eval/bare-host.js', later(11)],
  ['scripts/eval/stand-in-helper.js', later(11)],
  ['scripts/eval/feature-project.js', later(11)],
  ['scripts/eval/front-desk.js', later(11)],
  ['scripts/eval/harness.js', later(11)],
  ['scripts/eval/run.js', later(11)],
  ['scripts/setup/project-files.js', "setup's own fenced route (rulings R109 to R113)"],
].map(([file, reason]) => Object.freeze({ file, reason })));
