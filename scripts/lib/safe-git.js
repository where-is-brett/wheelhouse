// scripts/lib/safe-git.js
// The one route every git call of Wheelhouse takes, built on setup's fence and allowed list. The
// allowed list lives in scripts/setup/git.js (rulings R109 to R113); it is to move into scripts/lib/
// once Copilot Part 6 has merged, which is listed in the ledger. This file imports the fence and the
// list and never copies them.
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
  isolated, refuseUnlistedSettings, setupGitEnv, subcommandOf, allowedSetting, FENCE, NULL_FILE,
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
    if (!fenceKeys.has(String(key).toLowerCase())) own.push([key, kept[`GIT_CONFIG_VALUE_${i}`]]);
  }
  for (const name of Object.keys(kept)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name)) delete kept[name];
  own.forEach(([key, value], i) => {
    kept[`GIT_CONFIG_KEY_${i}`] = key;
    kept[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  kept.GIT_CONFIG_COUNT = String(own.length);
  return { ...isolated({ ...kept, GIT_ALLOW_PROTOCOL: TRANSPORT.https }), GIT_ALLOW_PROTOCOL: transport };
}

// The settings the repository in `cwd` holds that are off the allowed list: `{ keys }` (empty when
// all are listed, or when no repository is there), or `{ unread: true }` when git could not say. The
// same call as setup's look, and it never throws, so each caller words its own refusal.
export async function lookAtSettings({ run = realRun, gitPath = 'git', cwd }) {
  const env = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_FILE };
  let got;
  try {
    got = await run(gitPath, ['config', '--includes', '--name-only', '--list', '-z'], { cwd, env, baseEnv: withoutGitVars(), timeoutMs: GIT_WAIT_MS });
  } catch {
    return { unread: true };
  }
  if (got.code !== 0) return { unread: true };
  const names = String(got.stdout ?? '').split('\0').map((k) => k.trim()).filter((k) => k !== '');
  return { keys: [...new Set(names.filter((k) => !allowedSetting(k)))] };
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
function refuseFenceOverride(args) {
  const fenceKeys = new Set(FENCE.map(([key]) => key.toLowerCase()));
  for (let i = 0; i < args.length; i += 1) {
    const given = String(args[i]);
    // `--config-env=<key>=<var>`, or `--config-env` with `<key>=<var>` as the next argument.
    const fromEnv = given.startsWith('--config-env=') ? given.slice(13) : given === '--config-env' ? String(args[i + 1] ?? '') : null;
    if (fromEnv !== null && fenceKeys.has(fromEnv.split('=')[0].toLowerCase())) {
      throw new Error(`safeGit: an argument may not set ${fromEnv.split('=')[0].toLowerCase()}, a setting of the fence`);
    }
    if (given !== '-c') continue;
    const setting = String(args[i + 1] ?? '');
    const key = setting.split('=')[0].toLowerCase();
    if (fenceKeys.has(key) && !ARGUMENT_SETTINGS_ALLOWED.has(setting.toLowerCase())) {
      throw new Error(`safeGit: an argument may not set ${key}, a setting of the fence`);
    }
  }
}

// git in `cwd`: `git(args, options)` gives run's answer. `look` is 'each' (look at the repository's
// settings before every call), 'once' (before the first call of this function only; a refusal is
// thrown again on every later call) or 'never' (the fence alone; for a caller whose comment says
// why). `workTree` makes that folder git's working tree (not for `init`). `options.env` is added
// before the fence, so a caller cannot lift it. Nor can the arguments: one that sets a fence key
// with `-c` or `--config-env` (git applies it after the environment) is refused, bar a short named list. With
// `caller` ('helper', 'foreman', 'survey', 'feature' or 'reinstall'), a refused look throws a
// LookRefusal worded for that caller (and `what` names the repository); without it, setup's line.
export function safeGit({
  run = realRun, gitPath = 'git', cwd, env = {}, reach = 'https', look = 'each', workTree = null, timeoutMs = GIT_WAIT_MS,
  caller = null, what = null,
} = {}) {
  if (!['each', 'once', 'never'].includes(look)) throw new Error(`safeGit: unknown look ${String(look)}`);
  if (caller !== null && !(caller in NEXT)) throw new Error(`safeGit: unknown caller ${String(caller)}`);
  let looked = null;
  const lookNow = caller === null
    ? () => refuseUnlistedSettings({ run, gitPath, cwd })
    : async () => {
      const found = await lookAtSettings({ run, gitPath, cwd });
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
  ['scripts/eval/stand-in-helper.js', later(11)],
  ['scripts/eval/feature-project.js', later(11)],
  ['scripts/eval/front-desk.js', later(11)],
  ['scripts/eval/harness.js', later(11)],
  ['scripts/eval/run.js', later(11)],
  ['scripts/setup/project-files.js', "setup's own fenced route (rulings R109 to R113)"],
].map(([file, reason]) => Object.freeze({ file, reason })));
