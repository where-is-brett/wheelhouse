// scripts/lib/local-git.js
// What a project's own commands run in on this computer, shared by a Lean project's merge and the check runner, and the
// git steps shared by Lean's store and a project's home.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AGENT_VARIABLES } from '../agents/variables.js';
import { safeGit } from './safe-git.js';
import { stateDir } from './paths.js';
import { listEvents } from '../state/events.js';

// Wheelhouse's own variables, the code hosts', the coding agents' and the SSH agent's are cleared from the tests'
// environment.
// The person's SSH agent and password prompt too, so the approved code's tests can't push with their keys.
const CLEARED = /^(?:WHEELHOUSE_|GIT_|GH_|GITHUB_|GITLAB_|GLAB_)|^(?:CI_JOB_TOKEN|SSH_AUTH_SOCK|SSH_ASKPASS)$/i;
export function testEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !CLEARED.test(name) && !AGENT_VARIABLES.test(name)));
}

// The command line the tests run by: the system's own shell.
export function shellFor(command, { platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') {
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
    return { file: path.win32.join(root, 'System32', 'cmd.exe'), args: ['/d', '/s', '/c', `"${command}"`], windowsVerbatimArguments: true };
  }
  return { file: '/bin/sh', args: ['-c', command], windowsVerbatimArguments: false };
}

// --- git on a repository only the helper writes ---
// Lifted from Lean's store (spec 5.1), so the home of a project in git alone shares it. Each step takes the repository and
// the branch in place of a project and `main`, and refuses with a code: the caller keeps its own words for each.

// The longest a change waits for another.
export const LOCK_WAIT_MS = 120 * 1000;
const LOCK_POLL_MS = 100;
// A lock file that can't be read is taken as being written for this long, then as left behind.
const LOCK_WRITING_MS = 10 * 1000;

const LINES = {
  busy: 'Something else is changing this project; try again in a minute',
  moved: 'The main version moved while the helper was working, so nothing was added; try again',
  unread: 'The main version could not be read',
  worktree: 'A worktree for the work could not be made',
  'undo-unread': 'A commit to undo could not be read',
  'undo-wide': 'A commit to undo joins more than two lines of work, so it can\'t be undone here',
  'undo-clash': 'The undo didn\'t apply cleanly, because later work touches the same files. Nothing was changed',
};

// A step that refused: `code` says which, its message is a plain line, and `extra` goes beside it in an answer.
export class LocalRefusal extends Error {
  constructor(code, extra = {}) {
    super(LINES[code] ?? code);
    this.code = code;
    this.extra = extra;
  }
}

// git in `cwd` through safeGit, looked at once: `call` gives run's answer, `must` the trimmed output or a refusal.
export function gitIn(cwd, { run, env = {}, reach = 'https', list = 'project', caller = 'helper', what = null, refuse = (code) => { throw new LocalRefusal(code); } } = {}) {
  const call = safeGit({ run, cwd, env, reach, list, look: 'once', caller, what });
  return {
    call,
    async must(args, why) {
      const got = await call(args);
      if (got.code !== 0) refuse(why);
      return String(got.stdout ?? '').trim();
    },
    async ok(args) {
      return (await call(args)).code === 0;
    },
  };
}

export const realOrNull = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
};

const headRef = (branch) => `refs/heads/${branch}`;

// The commit `branch` of the repository at `dir` names.
export async function headOf({ dir, branch, run, ...route }) {
  return gitIn(dir, { run, ...route }).must(['rev-parse', '--verify', '-q', `${headRef(branch)}^{commit}`], 'unread');
}

// Moves `branch` from `from` to `to`, only if it is still at `from`.
export async function moveHead({ dir, branch, to, from, run, ...route }) {
  if (!(await gitIn(dir, { run, ...route }).ok(['update-ref', '-m', 'Wheelhouse', headRef(branch), to, from]))) throw new LocalRefusal('moved');
}

// A fresh worktree of the repository at `at`, detached, in a folder of its own beside the repository, for `fn`; removed
// afterwards whatever happens. `fn` gets the folder and git in it, with `env`.
export async function inTempTree({ dir, at, env = {}, run, ...route }, fn) {
  const repo = gitIn(dir, { run, ...route });
  const parent = fs.mkdtempSync(path.join(path.dirname(dir), 'work-'));
  const tree = path.join(parent, 'tree');
  try {
    await repo.must(['worktree', 'add', '--detach', '--quiet', tree, at], 'worktree');
    return await fn(tree, gitIn(tree, { run, env, ...route }));
  } finally {
    await repo.call(['worktree', 'remove', '--force', tree]).catch(() => {});
    // Windows can hold a folder a moment after the programs in it have ended: removal tries again.
    fs.rmSync(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await repo.call(['worktree', 'prune']).catch(() => {});
  }
}

// Reverts `commits` (newest first) in a fresh worktree at `at`, and gives the new head.
export async function revertOn({ dir, at, commits, env = {}, run, ...route }) {
  return inTempTree({ dir, at, env, run, ...route }, async (_tree, tree) => {
    for (const commit of commits) {
      const parents = (await tree.must(['rev-list', '--parents', '-n', '1', commit], 'undo-unread')).split(' ').length - 1;
      if (parents > 2) throw new LocalRefusal('undo-wide');
      const reverted = await tree.call(['revert', '--no-edit', ...(parents === 2 ? ['-m', '1'] : []), commit]);
      if (reverted.code !== 0) {
        await tree.call(['revert', '--abort']);
        throw new LocalRefusal('undo-clash');
      }
    }
    return tree.must(['rev-parse', '--verify', 'HEAD^{commit}'], 'undo-unread');
  });
}

// --- the card about a main version moved outside the helper ---

export const mainMovedLine = (from, to) => `The main version moved from ${from} to ${to} without an approval`;
export const MAIN_MOVED_LINE = /The main version moved from ([0-9a-f]{40}) to ([0-9a-f]{40}) without an approval/g;

export function mainMovedCard(from, to) {
  const line = mainMovedLine(from, to);
  return {
    question: [
      'The main version changed without an approval: something moved it outside Wheelhouse\'s helper.',
      'Undo it takes those changes back out with a new commit; nothing is deleted. Keep it keeps them, confirmed in Wheelhouse\'s own window.',
      'Recommended: Undo it. Until you choose, nothing is added to the main version.',
      line,
    ].join('\n'),
    header: 'Main moved',
    options: ['Undo it', 'Keep it', 'Not now'],
    kind: 'question',
    level: 4,
    recommend: 'Undo it',
    line,
  };
}

// Whether a card's data is the helper's own composed card: its question, options, header, kind, level and
// recommendation the same (ruling P5-50), so a card anyone wrote with the helper's line but other words, or another
// recommendation for the board to show, is never taken for it.
export function sameCard(data, composed) {
  return data !== null && typeof data === 'object'
    && data.question === composed.question && data.header === composed.header
    && data.kind === composed.kind && data.level === composed.level && data.recommend === composed.recommend
    && Array.isArray(data.options) && data.options.length === composed.options.length && data.options.every((o, i) => o === composed.options[i]);
}

// The helper's card, raised once: the id of the one the state holds, if it is that card word for word, else of one
// written now by `record` (project, kind, data).
export async function raiseCard(project, data, record) {
  const held = listEvents(stateDir(project), { report: () => {} }).find((e) => e.kind === 'card' && e.data?.line === data.line && sameCard(e.data, data));
  return held ? held.id : record(project, 'card', data);
}

// Compares the head the record holds with the repository's. When they differ, nothing is added until the director decides,
// and `record` raises the card asking (it takes the composed card). `expected` may be a function: it is read after the
// repository, so a look while another window moves the head (the repository first, then the record) never sees the new
// head against the old record. Gives { recorded, current, moved, card? }.
export async function lookAtHead({ dir, branch, expected, run, record, ...route }) {
  const current = await headOf({ dir, branch, run, ...route });
  const recorded = typeof expected === 'function' ? expected() : expected;
  if (current === recorded) return { recorded, current, moved: false };
  return { recorded, current, moved: true, card: await record(mainMovedCard(recorded, current)) };
}

// --- the lock: one change at a time ---

function lockGone(file) {
  let held;
  try {
    held = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Being written, or left half written: only age frees it.
    try {
      return Date.now() - fs.statSync(file).mtimeMs > LOCK_WRITING_MS;
    } catch {
      return false;
    }
  }
  const pid = held?.pid;
  if (!Number.isInteger(pid) || pid < 1) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}

// Runs `fn` holding a lock: the file `name` in `dir`, made with an exclusive create, holding { pid, startedAt }, and freed in
// `finally`. A lock whose process has gone is taken over (renamed to a name of its own first, so a waiter never removes a
// lock made in its place). After `waitMs` it refuses with `busy`.
export async function withLocalLock({ dir, name = 'local.lock' }, fn, { waitMs = LOCK_WAIT_MS, pollMs = LOCK_POLL_MS, now = () => new Date() } = {}) {
  const file = path.join(dir, name);
  fs.mkdirSync(dir, { recursive: true });
  const mine = `${JSON.stringify({ pid: process.pid, startedAt: now().toISOString(), token: crypto.randomBytes(8).toString('hex') })}\n`;
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(file, mine, { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let seen;
    try { seen = fs.readFileSync(file, 'utf8'); } catch { /* gone */ }
    if (seen !== undefined && lockGone(file)) {
      const taken = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.gone`;
      try {
        fs.renameSync(file, taken);
        if (fs.readFileSync(taken, 'utf8') !== seen) {
          try { fs.linkSync(taken, file); } catch { /* another lock stands */ }
        }
        fs.rmSync(taken, { force: true });
      } catch { /* another waiter took it over */ }
      continue;
    }
    if (Date.now() >= until) throw new LocalRefusal('busy');
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  try {
    return await fn();
  } finally {
    try {
      if (fs.readFileSync(file, 'utf8') === mine) fs.rmSync(file, { force: true });
    } catch { /* already gone */ }
  }
}

// --- the copy ---

// Brings the copy folder up to `branch`, never with force. The copy fetches it, in a git run in the copy through safeGit,
// naming the repository by its path (ruling P5-50): nothing is pushed into the copy, so its receive hooks never run, the
// fence's hooks setting covers the one process that writes its refs, and the look reads the copy's own settings first. No
// remote's name is read, so no push or fetch setting anywhere is followed. Gives { pushed, commit } (`pushed`: the copy holds
// it now).
export async function updateCopy({ dir, branch, copy, copyWhat = null, run, ...route }) {
  const commit = await headOf({ dir, branch, run, ...route });
  if (!fs.existsSync(copy)) return { pushed: false, commit };
  const inCopy = gitIn(copy, { run, ...route, reach: 'local', what: copyWhat });
  // The copy folder must be a repository itself (a bare one, or one with its own .git): git looks upwards from a
  // folder that isn't one, and the fetch would land in whatever repository holds it.
  const own = async () => {
    const got = await inCopy.call(['rev-parse', '--absolute-git-dir']);
    const held = got.code === 0 ? realOrNull(String(got.stdout ?? '').trim()) : null;
    return held !== null && [realOrNull(copy), realOrNull(path.join(copy, '.git'))].includes(held);
  };
  const fetch = (from, ref) => inCopy.ok(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', from, `${ref}:${ref}`]);
  try {
    return { pushed: (await own()) && (await fetch(dir, headRef(branch))), commit };
  } catch {
    return { pushed: false, commit };
  }
}
