// scripts/host/helper.js
// The host helper (design section 11): a small local server, on a socket file
// or, on Windows, a named pipe. It alone holds the host keys. Agents ask it to
// push a branch, open or update a pull request, read CI, and merge; it applies
// the push rules and the merge gate (section 12.3) before anything reaches the
// host. A key reaches git, gh and glab only through their environment, and no
// answer, error or log carries a key or a remote address with credentials in it.
//
// Pushing: git with a key in its environment runs only in repositories the
// helper owns. Each project has a bare mirror at
// ~/.wheelhouse/projects/<project>/mirror.git, whose origin the helper sets from
// its own state clone. A push first copies the branch's objects from the
// agent's folder into the mirror, with no key, reading nothing but objects
// from that folder (its config, remote, replace refs and hooks count for
// nothing). The checks and the push then run in the mirror, with the key.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { computerId, helperAddress, profileDir, stateDir } from '../lib/paths.js';
import { stopState, setStop } from '../lib/stop.js';
import { bypassActive } from '../lib/bypass.js';
import { run as realRun, withoutGitVars } from '../lib/run.js';
import { gateDecision } from '../gate/conditions.js';
import { classifyChange, readConfig, CI_FILES } from '../gate/guardrails.js';
import { scrub } from './adapter.js';
import { deleteKey, readKey } from './keys.js';
import { checkBaseUrl, gitlabApi, projectPath } from './gitlab-key.js';
import { childEnv } from './connection.js';
import { listEvents, makeEvent, writeEvent, syncState, eventPath, PLAIN_KINDS, PROTECTED_KINDS } from '../state/events.js';
import { git as stateGit } from '../state/git.js';
import { cloneState } from '../state/clone.js';
import { takeStartLock } from '../lib/start-lock.js';
import { scanContent, scanText } from '../state/secret-scan.js';
import { buildViews, latestFor, writeViews } from '../state/views.js';
import { readEnrolled, verify } from '../state/signing.js';
import { heldCounter, holdsLock, takeLock, touchLock, readLock } from '../state/lock.js';
import { readProject, isInsideFolder, projectForFolder } from '../lib/projects.js';
import { matchGlob } from '../gate/glob.js';
import { ciPushLine } from '../state/card-lines.js';

export const STATE_BRANCH = 'wheelhouse-state';
export const LOCK_BRANCH = 'wheelhouse-lock';
const REMOTE = 'origin';
const INCOMING = 'refs/wheelhouse/incoming';
const MOST_BODY = 1024 * 1024;
const PROBE_MS = 1000;
const PIPE = /^\\\\[.?]\\pipe\\/i;
// Git for Windows reads "/dev/null" as its null device too.
const NO_FILE = '/dev/null';
const CLICK_MS = 10 * 60 * 1000;
// A restore pull request may be merged under STOP for a day after the director's step 3 click.
const RESTORE_MS = 24 * 60 * 60 * 1000;
const CONTAIN_MS = 10 * 60 * 1000;
const RESTORE_PREFIX = 'wheelhouse-restore-';
const RESTORE_BRANCH = /^wheelhouse-restore-([0-9a-f]{12})$/;
const NEEDS_CLICK = 'this step needs the director\'s click on its card';
const NOT_EARLIER = 'that is not an earlier commit of the default branch, so the product is not put back to it';
const NO_HARM = 'This project has defined no live harm to contain';
const BACKUP_FILE = /^\d{4}-\d{2}-\d{2}\.bundle$/;
const BACKUP_REF = 'refs/wheelhouse/backup';
const EVENT_FILE = /^events\/\d{4}\/\d{2}\/[A-Za-z0-9._-]+\.json$/;
const MOST_OUTPUT = 2000;
const MOST_KEPT = 64 * 1024;
// Text from git, gh or glab that says the sign-in is missing or refused.
const AUTH_FAILURE = /authentication|could not read username|permission denied|\b40[13]\b|not logged in|auth login|sign in/i;
const NOT_AMONG = 'that commit is not among the last ten merges, so the product is not put back to it';
const LOCK_REASON = 'this computer no longer holds the lock';

// The plugin's version, from .claude-plugin/plugin.json beside these scripts, so session-start
// can tell a helper left running from an older copy. Null when it cannot be read.
const PLUGIN_VERSION = (() => {
  try {
    const version = JSON.parse(fs.readFileSync(new URL('../../.claude-plugin/plugin.json', import.meta.url), 'utf8'))?.version;
    return typeof version === 'string' && version !== '' ? version : null;
  } catch {
    return null;
  }
})();

const FOLDER_MS = 60 * 1000;
const HOST_MS = 5 * 60 * 1000;

// Every git call the helper makes: no prompting, no replace refs. Each starts
// from the helper's environment with every inherited GIT_* variable removed.
const GIT_BASE = { GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' };
// No system or user config: for calls that need no sign-in, and for the narrow
// connection, whose key travels in the environment. The quick connection keeps
// them, because the director's own sign-in is found through them.
const ISOLATED = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NO_FILE };

const UNREADABLE_CHANGES = 'the changed files couldn\'t be read, so this needs the director\'s approval';
const BASE_REF = 'refs/wheelhouse/base';
const CONFIG_FILE = '.claude/wheelhouse.json';

// What a pull request changes, and the project's configuration. The pull
// request's head and the default branch are fetched into the mirror with the
// connection's key (`run` is the keyed git runner); the head must be the one
// the host reported. Paths come from the merge base, with renames listed as a
// delete and an add, so a file moved out of .claude/ still counts by its old
// path. The configuration is read from the default branch, never the pull request.
export async function changedPaths({ mirror, host, number, headSha, defaultBranch, run: git }) {
  if (!Number.isInteger(number) || number < 1) throw new Error('the pull request number must be a whole number from 1');
  if (typeof headSha !== 'string' || !/^[0-9a-f]{40,64}$/.test(headSha)) throw new Error('the head commit is not known');
  if (!plainBranch(defaultBranch)) throw new Error('the default branch is not known');
  const source = host === 'gitlab' ? `refs/merge-requests/${number}/head` : `refs/pull/${number}/head`;
  const prRef = `refs/wheelhouse/pr/${number}`;
  const inMirror = (args, options = {}) => git('git', args, { cwd: mirror, ...options });
  const must = async (args, what) => {
    const answer = await inMirror(args);
    if (answer.code !== 0) throw new Error(`${what} failed`);
    return answer.stdout;
  };
  await must(['fetch', '-q', '--no-tags', REMOTE, `+${source}:${prRef}`, `+refs/heads/${defaultBranch}:${BASE_REF}`], 'fetching the pull request');
  try {
    const fetched = (await must(['rev-parse', '--verify', '--end-of-options', `${prRef}^{commit}`], 'reading the fetched head')).trim();
    if (fetched !== headSha) throw new Error('the fetched head is not the head the host reported');
    const base = (await must(['merge-base', BASE_REF, prRef], 'finding the merge base')).trim();
    const listed = await must(['diff', '--name-only', '-z', '--no-renames', base, prRef], 'listing the changed files');
    const paths = listed.split('\0').filter((p) => p !== '');
    return { paths, config: await baseConfig(must) };
  } finally {
    await inMirror(['update-ref', '-d', prRef]);
  }
}

// The project's configuration from the default branch's commit (BASE_REF),
// through `must`, which runs git in the mirror and throws when it fails.
async function baseConfig(must) {
  const present = await must(['ls-tree', '-z', '--name-only', BASE_REF, '--', CONFIG_FILE], 'looking for the configuration');
  return readConfig(present === '' ? null : await must(['show', `${BASE_REF}:${CONFIG_FILE}`], 'reading the configuration'));
}

// The paths a branch changes from the default branch (merge base to `sha`),
// and the project's configuration. `sha` is already in the mirror.
async function branchChanges({ mirror, sha, defaultBranch, run: git }) {
  if (!plainBranch(defaultBranch)) throw new Error('the default branch is not known');
  const must = async (args, what) => {
    const answer = await git('git', args, { cwd: mirror, input: '' });
    if (answer.code !== 0) throw new Error(`${what} failed`);
    return answer.stdout;
  };
  const fetched = await git('git', ['fetch', '-q', '--no-tags', REMOTE, `+refs/heads/${defaultBranch}:${BASE_REF}`], { cwd: mirror });
  let from = null;
  let config = readConfig(null);
  if (fetched.code === 0) {
    // With no common history the whole branch counts as changed: it is compared with nothing.
    const common = await git('git', ['merge-base', BASE_REF, sha], { cwd: mirror });
    from = common.code === 0 ? common.stdout.trim() : null;
    config = await baseConfig(must);
  } else {
    // A host with no default branch yet has nothing to compare with; any other failure is not read.
    const listed = await must(['ls-remote', '--heads', REMOTE, `refs/heads/${defaultBranch}`], 'looking for the default branch');
    if (listed.trim() !== '') throw new Error('fetching the default branch failed');
  }
  from ??= (await must(['hash-object', '-t', 'tree', '--stdin'], 'making the empty tree')).trim();
  const listed = await must(['diff', '--name-only', '-z', '--no-renames', from, sha], 'listing the changed files');
  return { paths: listed.split('\0').filter((p) => p !== ''), config };
}

const ciPatterns = (config) => [...CI_FILES, ...config.ciFiles];
const touchesCi = (paths, config) => paths.some((file) => ciPatterns(config).some((p) => matchGlob(p, file, { ignoreCase: true })));

// The git configuration files of a folder, read with fs only: running git
// there could run what the folder's configuration names. Null when the folder
// has no repository; throws when one cannot be read.
function folderGitConfigs(dir) {
  const readIf = (file) => {
    try { return fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  };
  const dot = path.join(dir, '.git');
  let gitdir = null;
  let stat = null;
  try { stat = fs.lstatSync(dot); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat?.isDirectory()) {
    gitdir = dot;
  } else if (stat) {
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(readIf(dot));
    if (!match) throw new Error('the folder\'s .git file could not be read');
    gitdir = path.resolve(dir, match[1]);
  } else if (fs.existsSync(path.join(dir, 'HEAD')) && fs.existsSync(path.join(dir, 'objects'))) {
    gitdir = dir;
  }
  if (gitdir === null) return null;
  const dirs = [gitdir];
  const common = readIf(path.join(gitdir, 'commondir')).trim();
  if (common !== '') dirs.push(path.resolve(gitdir, common));
  return dirs.flatMap((d) => [readIf(path.join(d, 'config')), readIf(path.join(d, 'config.worktree'))]);
}

function isPartialClone(dir) {
  const configs = folderGitConfigs(dir);
  // No repository in the folder itself: git would also try <dir>.git, which is not read here.
  if (configs === null) throw new Error('no repository in the folder');
  // An included file is not followed, so a config that includes one is not read.
  return configs.some((text) => /promisor|partialclone|\[\s*include/i.test(text));
}

export const PUSH_REFUSALS = {
  plain: 'only a plain branch name may be pushed',
  force: 'a force-push is refused',
  remove: 'a branch is never deleted through the helper',
  same: 'a branch may only be pushed to the branch of the same name',
  defaultBranch: 'the default branch is never pushed to: changes reach it only by a merge',
  unknownDefault: 'the default branch is not known, so nothing is pushed',
  missing: 'that branch does not exist in the folder',
  shallow: 'a shallow repository cannot be checked, so nothing is pushed',
  state: 'a state push may only add new plain files under events/',
  lock: 'a lock push may only change lock.json',
  merges: 'a state or lock push may not carry a merge commit',
  ownRequests: 'state and the lock are written through their own requests',
  unchecked: 'the commits being pushed could not be checked',
  ciFile: 'the branch changes a CI file, so it needs the director\'s click on its card',
  ciSignIn: 'sign in to GitHub (or GitLab) on this computer to push the CI change',
  outsideProject: 'the folder to push from is not inside the project',
  partialClone: 'the folder is set up to fetch missing objects from elsewhere, so it is not read',
  notJson: 'a file in the state push is not JSON, so nothing is pushed',
  prBase: 'a pull request may only be opened against the default branch',
};

// A plain branch name: [A-Za-z0-9._/-], not refs/..., not HEAD, and nothing git
// would read as an option or refuse as a ref name.
function plainBranch(name) {
  return typeof name === 'string'
    && /^[A-Za-z0-9._/-]+$/.test(name)
    && !name.startsWith('refs/')
    && name !== 'HEAD'
    && !/^[-./]/.test(name)
    && !/[/.]$/.test(name)
    && !name.includes('..')
    && !name.includes('//')
    && !name.includes('/.')
    && !name.endsWith('.lock');
}

// What a state or lock push may carry, by status letter, new mode and path.
// 100644 is a plain file: no symlinks, gitlinks or executables.
const ALLOWED_CHANGE = {
  [STATE_BRANCH]: (status, mode, file) => status === 'A' && mode === '100644'
    && file.startsWith('events/') && file.length > 'events/'.length,
  [LOCK_BRANCH]: (status, mode, file) => (status === 'A' || status === 'M') && mode === '100644' && file === 'lock.json',
};

// Checks every commit up to `sha` that the remote's copy of `branch` lacks.
// The remote's copy is fetched first; with none, every commit is checked, the
// root commit included.
async function checkCommits({ dir, branch, sha, run, allowed, refused, scan = false }) {
  const git = (args) => run('git', args, { cwd: dir, env: { GIT_NO_REPLACE_OBJECTS: '1' } });
  const tracking = `refs/remotes/${REMOTE}/${branch}`;
  let range = [sha];
  const fetched = await git(['fetch', '-q', '--no-tags', REMOTE, `+refs/heads/${branch}:${tracking}`]);
  if (fetched.code === 0) {
    range = [sha, `^${tracking}`];
  } else {
    const listed = await git(['ls-remote', '--heads', REMOTE, `refs/heads/${branch}`]);
    if (listed.code !== 0 || listed.stdout.trim() !== '') return { allowed: false, refused: PUSH_REFUSALS.unchecked };
  }
  const listed = await git(['rev-list', '--parents', ...range, '--']);
  if (listed.code !== 0) return { allowed: false, refused: PUSH_REFUSALS.unchecked };
  for (const line of listed.stdout.split('\n').filter(Boolean)) {
    const [commit, ...parents] = line.trim().split(/\s+/);
    if (parents.length > 1) return { allowed: false, refused: PUSH_REFUSALS.merges };
    const changed = await git(['diff-tree', '--no-commit-id', '-r', '--raw', '--no-renames', '-z', '--root', commit]);
    if (changed.code !== 0) return { allowed: false, refused: PUSH_REFUSALS.unchecked };
    // -z --raw: ":<old mode> <new mode> <old id> <new id> <status>\0<path>\0" per file.
    const parts = changed.stdout.split('\0');
    for (let i = 0; i < parts.length; i += 2) {
      const meta = parts[i];
      if (meta === '') break;
      const [, newMode, , newId, status] = meta.replace(/^:/, '').split(' ');
      const file = parts[i + 1];
      if (typeof file !== 'string' || !allowed(status, newMode, file)) return { allowed: false, refused };
      if (scan) {
        const found = await scanAdded(git, newId, file);
        if (found) return { allowed: false, refused: found };
      }
    }
  }
  return { allowed: true };
}

// The secret scan on one file a state push adds (design section 9): its text
// and every decoded string in it. A refusal names the patterns and the file,
// never the value; a file name that itself matches is not repeated.
async function scanAdded(git, blob, file) {
  if (scanText(file).length > 0) return 'a file in the state push has a name that looks like a secret, so nothing is pushed';
  const read = await git(['cat-file', 'blob', blob]);
  if (read.code !== 0) return PUSH_REFUSALS.unchecked;
  const found = scanContent(read.stdout);
  if (found.length > 0) return `the state push was refused because ${file} matched: ${found.join(', ')}`;
  try { JSON.parse(read.stdout); } catch { return PUSH_REFUSALS.notJson; }
  return null;
}

// The spelling rules alone: `<branch>` or `<branch>:<branch>`, no `+`, a plain
// name, not the default branch.
export function checkRefspec(refspec, defaultBranch) {
  if (typeof refspec !== 'string' || refspec === '') return { allowed: false, refused: PUSH_REFUSALS.plain };
  if (refspec.startsWith('+')) return { allowed: false, refused: PUSH_REFUSALS.force };
  if (refspec.startsWith(':')) return { allowed: false, refused: PUSH_REFUSALS.remove };
  const parts = refspec.split(':');
  if (parts.length > 2) return { allowed: false, refused: PUSH_REFUSALS.plain };
  const [source, target = source] = parts;
  if (!plainBranch(source)) return { allowed: false, refused: PUSH_REFUSALS.plain };
  if (target !== source) return { allowed: false, refused: PUSH_REFUSALS.same };
  if (typeof defaultBranch !== 'string' || defaultBranch === '') return { allowed: false, refused: PUSH_REFUSALS.unknownDefault };
  if (source === defaultBranch) return { allowed: false, refused: PUSH_REFUSALS.defaultBranch };
  return { allowed: true, branch: source };
}

// Whether a push may go ahead: the spelling rules, then, in `dir`, the commit
// being pushed (`sha`, or the branch's own commit when not given). A shallow
// repository is refused. A state push may only add plain files under events/,
// a lock push may only change lock.json. Resolves with the commit checked,
// which is the one to push.
export async function checkPush({
  refspec, dir, defaultBranch, stateBranch = STATE_BRANCH, lockBranch = LOCK_BRANCH, run = realRun, sha,
}) {
  const spelled = checkRefspec(refspec, defaultBranch);
  if (!spelled.allowed) return spelled;
  const { branch } = spelled;
  const git = (args) => run('git', args, { cwd: dir, env: { GIT_NO_REPLACE_OBJECTS: '1' } });

  const shallow = await git(['rev-parse', '--is-shallow-repository']);
  if (shallow.code !== 0) return { allowed: false, refused: PUSH_REFUSALS.unchecked };
  if (shallow.stdout.trim() === 'true') return { allowed: false, refused: PUSH_REFUSALS.shallow };

  const resolved = await git(['rev-parse', '--verify', '-q', `${sha ?? `refs/heads/${branch}`}^{commit}`]);
  const commit = resolved.stdout.trim();
  if (resolved.code !== 0 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) return { allowed: false, refused: PUSH_REFUSALS.missing };

  const rules = { [stateBranch]: ALLOWED_CHANGE[STATE_BRANCH], [lockBranch]: ALLOWED_CHANGE[LOCK_BRANCH] };
  if (rules[branch]) {
    const refusal = branch === stateBranch ? PUSH_REFUSALS.state : PUSH_REFUSALS.lock;
    const checked = await checkCommits({
      dir, branch, sha: commit, run, allowed: rules[branch], refused: refusal, scan: branch === stateBranch,
    });
    if (!checked.allowed) return checked;
  }
  return { allowed: true, branch, sha: commit };
}

// --- keeping secrets out of answers ---

const CREDENTIAL_URL = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@'"]+@/g;

// The secrets in a connection's environment: the keys themselves, and the
// header git is given, with the base64 inside it and the key that decodes from it.
export function secretsOf(env) {
  const out = new Set();
  const add = (value) => { if (typeof value === 'string' && value.length >= 8) out.add(value); };
  for (const [name, value] of Object.entries(env ?? {})) {
    if (typeof value !== 'string') continue;
    if (name === 'GH_TOKEN' || name === 'GITLAB_TOKEN') add(value);
    if (/^GIT_CONFIG_VALUE_\d+$/.test(name)) {
      add(value);
      const match = /\b(?:basic|bearer)\s+(\S+)/i.exec(value);
      if (match) {
        add(match[1]);
        const decoded = Buffer.from(match[1], 'base64').toString('utf8');
        if (/^[\x20-\x7e]+$/.test(decoded)) {
          add(decoded);
          add(decoded.slice(decoded.indexOf(':') + 1));
        }
      }
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

function hide(text, secrets) {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join('[hidden]');
  return out.replace(CREDENTIAL_URL, '$1[hidden]@');
}

// For refusals and errors: the adapter's scrub (key-like text), then every
// secret and any credentials in an address.
function clean(text, secrets) {
  return hide(scrub(hide(text, secrets), Object.fromEntries(secrets.map((s, i) => [i, s]))), secrets);
}

function cleanDeep(value, secrets) {
  if (typeof value === 'string') return hide(value, secrets);
  if (Array.isArray(value)) return value.map((v) => cleanDeep(v, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanDeep(v, secrets)]));
  }
  return value;
}

// --- serving ---

// One in-flight call per project: concurrent requests share it, so a rotating
// renewal key is never used twice at once.
export function serialisePerProject(fn) {
  const inFlight = new Map();
  return (project, ...rest) => {
    if (inFlight.has(project)) return inFlight.get(project);
    const promise = Promise.resolve().then(() => fn(project, ...rest));
    inFlight.set(project, promise);
    const done = () => { if (inFlight.get(project) === promise) inFlight.delete(project); };
    promise.then(done, done);
    return promise;
  };
}

// envFor for the real helper: the connection's mode, and its environment from childEnv.
export function envForConnection(connectionFor, { fetch, now } = {}) {
  return async (project) => {
    const connection = await connectionFor(project);
    return { mode: connection?.mode, env: await childEnv(connection, { fetch, now }) };
  };
}

// envFor may answer `{ mode, env }` or a bare environment. A bare one is quick
// when it carries no key, narrow when it does.
function connectionOf(answer) {
  if (answer && typeof answer === 'object' && (answer.mode === 'quick' || answer.mode === 'narrow')
    && answer.env && typeof answer.env === 'object') {
    return { mode: answer.mode, env: answer.env };
  }
  const env = answer && typeof answer === 'object' ? answer : {};
  const keyed = Object.keys(env).some((k) => k === 'GH_TOKEN' || k === 'GITLAB_TOKEN' || /^GIT_CONFIG_VALUE_\d+$/.test(k));
  return { mode: keyed ? 'narrow' : 'quick', env };
}

class Refusal extends Error {}
const refuse = (message) => { throw new Refusal(message); };

const NOT_IN_PROJECT = 'This folder is not inside a Wheelhouse project, so the runbook does not know which project to act on.';

// The project whose folder holds `cwd`, a full path.
function placeFolder(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) refuse('the folder must be a full path');
  const found = projectForFolder(cwd);
  if (!found) refuse(NOT_IN_PROJECT);
  return found.project;
}

// Beside the runbook's own routes, these carry on with the director's sign-in once step 2 has
// removed the narrow key: reading a pull request, and recording a signed click, so the
// director's approval of the restore pull request can still be read and kept.
const FALL_BACK_ROUTES = ['/pr/state', '/state/record'];

function checkProject(project) {
  try {
    stateDir(project);
  } catch {
    refuse('the project name is not valid');
  }
  return project;
}

function socketLimit(platform) {
  return platform === 'linux' ? 107 : 103;
}

// Asks the address for /health: 'helper' when a Wheelhouse helper answers,
// 'none' when nothing listens, 'other' otherwise. A fresh connection each
// time: a kept one may belong to a helper that has gone.
function probe(address) {
  return new Promise((resolve) => {
    const req = http.get({ socketPath: address, path: '/health', timeout: PROBE_MS, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (text.length < 4096) text += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(text)?.ok === true ? 'helper' : 'other');
        } catch {
          resolve('other');
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve('other'); });
    req.on('error', (error) => resolve(error.code === 'ECONNREFUSED' || error.code === 'ENOENT' ? 'none' : 'other'));
  });
}

const ALREADY = 'A Wheelhouse helper is already running at this address, so a second was not started';
const OTHER = 'Something other than a Wheelhouse helper answers at the helper\'s address, so the helper was not started';

function send(res, status, answer, headers = {}) {
  const body = JSON.stringify(answer);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

// The request's body, or null when it passed 1 MB: then a 413 has been sent
// and the connection is closed once it has gone.
function readBody(req, res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const onData = (chunk) => {
      size += chunk.length;
      if (size <= MOST_BODY) {
        chunks.push(chunk);
        return;
      }
      req.off('data', onData);
      req.pause();
      res.on('finish', () => req.socket?.destroy());
      send(res, 413, { ok: false, refused: 'the request is larger than 1 MB' }, { connection: 'close' });
      resolve(null);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function startHelper({
  address = helperAddress(), adapterFor, envFor, now = () => new Date(), run = realRun, onArrive = () => {}, fetch = globalThis.fetch, startWaitMs = 30 * 1000,
} = {}) {
  if (typeof adapterFor !== 'function') throw new Error('The helper needs an adapterFor function');
  if (typeof envFor !== 'function') throw new Error('The helper needs an envFor function');
  const pipe = PIPE.test(address);
  if (!pipe && Buffer.byteLength(address) > socketLimit(process.platform)) {
    throw new Error(`The helper's socket path is too long for this system (${Buffer.byteLength(address)} bytes, at most ${socketLimit(process.platform)}): set WHEELHOUSE_HOME to a shorter folder`);
  }

  // Two helpers started at once would both see no socket, and the second would remove the
  // first's and listen in its place, leaving the first running on a socket nobody can reach.
  // So from the probe to the listen one start holds a lock file beside the socket; a lock
  // whose process has gone is taken over. The later start finds the earlier one answering.
  const releaseStart = pipe ? () => {} : await takeStartLock(`${address}.start`, { message: 'Another helper is starting', waitMs: startWaitMs });
  try {
    const found = await probe(address);
    if (found === 'helper') throw new Error(ALREADY);
    if (found === 'other') throw new Error(OTHER);
    if (!pipe) {
      let stat = null;
      try { stat = fs.lstatSync(address); } catch { /* nothing there */ }
      if (stat && !stat.isSocket()) throw new Error('There is a file at the helper\'s address that is not a socket, so it was left alone');
      if (stat) fs.rmSync(address, { force: true });
    }
  } catch (error) {
    releaseStart();
    throw error;
  }

  const sharedEnv = serialisePerProject((project) => envFor(project));

  // Each request reads the environment once, before anything else, keeps its
  // secrets for scrubbing that request's answer, and gives that same
  // environment to the adapter.
  // The narrow connection's key is gone (the runbook's step 2 deletes it): the runbook's own
  // routes, and FALL_BACK_ROUTES, carry on with the director's sign-in, as the quick connection does.
  function narrowKeyMissing(project) {
    const connection = readProject(project)?.connection;
    if (connection?.mode !== 'narrow') return false;
    try {
      const key = readKey(connection.host === 'github' ? 'github-app' : `gitlab-project-${connection.projectId}`);
      const token = connection.host === 'github' ? key?.accessToken : key?.token;
      return typeof token !== 'string' || token === '';
    } catch {
      return false; // damaged, or no usable name: the usual path says so
    }
  }

  async function contextFor(project, { fallBack = false } = {}) {
    // Only where the connection's environment cannot be made because the key is gone.
    let found;
    let signedOut = false;
    try {
      found = connectionOf(await sharedEnv(project));
    } catch (error) {
      if (!fallBack || !narrowKeyMissing(project)) throw error;
      signedOut = true;
      found = { mode: 'quick', env: {} };
    }
    const { mode, env } = found;
    let adapter = null;
    return {
      mode,
      env,
      signedOut,
      // What git gets in the helper's own repositories for this connection.
      gitEnv: mode === 'narrow' ? { ...ISOLATED, ...env } : { ...env },
      secrets: secretsOf(env),
      adapter: async () => {
        adapter ??= Promise.resolve(adapterFor(project, { env, envFor: async () => env, now }));
        return adapter;
      },
    };
  }

  const defaults = new Map();
  function defaultBranchOf(project, adapter) {
    if (!defaults.has(project)) {
      const promise = Promise.resolve().then(() => adapter.defaultBranch());
      defaults.set(project, promise);
      promise.catch(() => defaults.delete(project));
    }
    return defaults.get(project);
  }

  // STOP and bypass are read here, when a request's turn comes, never when it
  // arrived: a request queued before STOP was set still reads it.
  const STOP_REFUSAL = { ok: false, refused: 'STOP is on' };
  const stopped = () => stopState().on;
  const BYPASS_PUSH = 'a session on this computer is in bypass mode';

  const queues = new Map();
  function oneAtATime(key, fn) {
    const before = queues.get(key) ?? Promise.resolve();
    const next = before.catch(() => {}).then(fn);
    queues.set(key, next);
    const done = () => { if (queues.get(key) === next) queues.delete(key); };
    next.then(done, done);
    return next;
  }

  // A runner for git with the given environment over the clean base, and a
  // time limit, so a hung remote or folder cannot hold up a queue.
  const gitIn = (env, timeoutMs = HOST_MS) => (file, args, options = {}) => run(file, args, {
    timeoutMs, ...options, baseEnv: withoutGitVars(process.env), env: { ...GIT_BASE, ...env, ...options.env },
  });
  const unkeyed = gitIn(ISOLATED);

  // The lock clone is used by pushes and merges alike: one git call at a time.
  function lockHeld(project, ctx) {
    return oneAtATime(`lock:${project}`, async () => {
      const counter = heldCounter({ project });
      return counter !== null && (await holdsLock({ project, counter, env: ctx.gitEnv })) === true;
    });
  }

  // The project's mirror, made if missing, with origin set from the helper's
  // own state clone.
  async function mirrorFor(project) {
    const plain = unkeyed;
    const origin = await plain('git', ['config', '--get', `remote.${REMOTE}.url`], { cwd: stateDir(project) });
    const url = origin.stdout.trim();
    if (origin.code !== 0 || url === '') refuse('the project has no state clone to find its repository from');
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@\s]*:[^/@\s]*@/.test(url)) {
      refuse('the project\'s repository address carries credentials, so nothing is pushed: keys travel only in the environment');
    }
    const mirror = path.join(stateDir(project), '..', 'mirror.git');
    if (!fs.existsSync(path.join(mirror, 'HEAD'))) {
      fs.rmSync(mirror, { recursive: true, force: true });
      fs.mkdirSync(mirror, { recursive: true });
      if ((await plain('git', ['init', '-q', '--bare'], { cwd: mirror })).code !== 0) refuse('the project\'s mirror could not be made');
    }
    if ((await plain('git', ['config', `remote.${REMOTE}.url`, url], { cwd: mirror })).code !== 0) {
      refuse('the project\'s mirror could not be set up');
    }
    return mirror;
  }

  // The mirror keeps what the next fetch negotiates from, and nothing else between requests.
  // The default branch's copy (BASE_REF) stays, so the next fetch asks only for what is new;
  // the refs made per request (incoming, each pull request's head, any other) are dropped
  // after each push and merge. Called inside the project's mirror queue.
  async function dropRequestRefs(project) {
    try {
      const mirror = path.join(stateDir(project), '..', 'mirror.git');
      if (!fs.existsSync(path.join(mirror, 'HEAD'))) return;
      const listed = await unkeyed('git', ['for-each-ref', '--format=%(refname)', 'refs/wheelhouse/'], { cwd: mirror });
      for (const name of listed.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
        if (name !== BASE_REF) await unkeyed('git', ['update-ref', '-d', name], { cwd: mirror });
      }
    } catch { /* tidying is best effort */ }
  }

  // git tidies the objects itself when enough have built up. It runs after the answer is
  // written, queued behind it on the same key, so the next request waits for it.
  function tidyAfterAnswer(project) {
    oneAtATime(`mirror:${project}`, async () => {
      try {
        const mirror = path.join(stateDir(project), '..', 'mirror.git');
        if (!fs.existsSync(path.join(mirror, 'HEAD'))) return;
        await unkeyed('git', ['-c', 'gc.autoDetach=false', 'gc', '--auto', '--quiet'], { cwd: mirror });
      } catch { /* tidying is best effort */ }
    }).catch(() => {});
  }

  // Whether this computer's director clicked the card for pushing this exact
  // commit of this branch in the last ten minutes: a signed `action` event.
  function ciClick(project, branch, sha) {
    const enrolled = readEnrolled();
    const nowMs = now().getTime();
    return listEvents(stateDir(project), { report: () => {} }).some((e) => {
      const age = nowMs - Date.parse(e.at);
      return e.kind === 'action' && e.data?.action === 'ci-push' && e.data.branch === branch && e.data.sha === sha
        && e.computer === computerId() && e.sig?.computer === computerId() && verify(e, enrolled)
        && age <= CLICK_MS && age >= -60 * 1000;
    });
  }

  // Copies the branch in from `source`, checks it, and pushes it with the
  // connection's key. `source` is a folder the helper trusts: a code push's
  // folder (read for objects only), or one of the helper's own clones.
  // One at a time per project: the mirror and its incoming ref are shared.
  function pushFrom(args, ctx) {
    return oneAtATime(`mirror:${args.project}`, async () => {
      try {
        return await pushToHost(args, ctx);
      } finally {
        await dropRequestRefs(args.project);
        tidyAfterAnswer(args.project);
      }
    });
  }

  async function pushToHost({ project, branch, source, refspec, defaultBranch, ciGuard = false, allowStop = false, asDirector: asOwn = false }, ctx) {
    return (async () => {
      const mirror = await mirrorFor(project);
      // Copy the branch's objects in from the folder, with no key, and nothing
      // from the folder's config, hooks or replace refs taking part. The
      // incoming ref is cleared first: git leaves it alone when it declines a
      // ref (for example one that would make the mirror shallow) yet exits 0.
      // git-upload-pack runs in the folder: GIT_NO_LAZY_FETCH stops a partial
      // clone there from fetching missing objects through its own remote.
      await unkeyed('git', ['update-ref', '-d', INCOMING], { cwd: mirror });
      const fetched = await gitIn({ ...ISOLATED, GIT_NO_LAZY_FETCH: '1' }, FOLDER_MS)('git', [
        '-c', `core.hooksPath=${NO_FILE}`, '-c', 'core.fsmonitor=false', '-c', 'protocol.file.allow=always',
        'fetch', '-q', '--no-tags', '--no-recurse-submodules', source, `+refs/heads/${branch}:${INCOMING}`,
      ], { cwd: mirror });
      if (fetched.timedOut) return { ok: false, refused: 'reading the folder took too long' };
      const arrived = await unkeyed('git', ['rev-parse', '--verify', '-q', INCOMING], { cwd: mirror });
      if (fetched.code !== 0 || arrived.code !== 0) return { ok: false, refused: PUSH_REFUSALS.missing };

      const keyed = gitIn(ctx.gitEnv);
      const checked = await checkPush({ refspec, dir: mirror, defaultBranch, run: keyed, sha: INCOMING });
      if (checked.refused === PUSH_REFUSALS.shallow) {
        // A shallow marker came in with the objects: start the mirror afresh next time.
        fs.rmSync(mirror, { recursive: true, force: true });
      }
      if (!checked.allowed) return { ok: false, refused: checked.refused };

      // A code push that changes a CI file goes only with the director's click
      // for this commit, and then with the director's own sign-in.
      let pusher = asOwn ? gitIn({}) : keyed;
      if (ciGuard) {
        let changes;
        try {
          changes = await branchChanges({ mirror, sha: checked.sha, defaultBranch, run: keyed });
        } catch {
          return { ok: false, refused: PUSH_REFUSALS.unchecked };
        }
        if (touchesCi(changes.paths, changes.config)) {
          if (!ciClick(project, branch, checked.sha)) return { ok: false, refused: PUSH_REFUSALS.ciFile };
          pusher = gitIn({});
        }
      }
      const asDirector = pusher !== keyed;

      if (stopped() && !allowStop) return STOP_REFUSAL;
      const pushed = await pusher('git', ['push', '--no-verify', '--porcelain', REMOTE, `${checked.sha}:refs/heads/${branch}`], { cwd: mirror });
      if (pushed.code === 0) return { ok: true, sha: checked.sha };
      if (pushed.timedOut) return { ok: false, refused: 'the host did not answer the push in time' };
      const refused = pushed.stdout.split('\n').find((line) => line.startsWith('!') && line.includes(`refs/heads/${branch}`));
      // Another computer's push can land between ours: the host then declines to move the branch
      // ("failed to update ref", "incorrect old value provided"), which is the same as the branch having moved on.
      if (refused && /\((?:non-fast-forward|fetch first|failed to update ref|incorrect old value provided)\)/.test(refused)) return { ok: false, rejected: 'non-fast-forward' };
      if (asDirector && /authentication|could not read username|permission denied|\b40[13]\b/i.test(pushed.stderr)) return { ok: false, refused: PUSH_REFUSALS.ciSignIn };
      const detail = clean(pushed.stderr, ctx.secrets);
      return { ok: false, refused: `git could not push the branch${detail ? `: ${detail}` : ''}` };
    })();
  }

  // The state and lock branches are fixed names, never the host's default
  // branch, so a push of either does not ask the host which that is.
  const NOT_THE_DEFAULT = '(a branch that is not the default)';
  const ownFolder = (project, branch) => (branch === STATE_BRANCH ? stateDir(project) : path.join(stateDir(project), '..', 'lock'));

  // Pushes the state or the lock branch from the helper's own clone of it. The
  // objects are read from the clone's resolved path.
  async function pushOwn(project, branch, ctx, { allowStop = false } = {}) {
    if (branch !== STATE_BRANCH && branch !== LOCK_BRANCH) return { ok: false, refused: PUSH_REFUSALS.plain };
    let source = null;
    try { source = fs.realpathSync.native(ownFolder(project, branch)); } catch { /* no clone */ }
    if (source === null) return { ok: false, refused: PUSH_REFUSALS.missing };
    const answer = await pushFrom({ project, branch, source, refspec: branch, defaultBranch: NOT_THE_DEFAULT, allowStop }, ctx);
    if (answer.ok && branch === STATE_BRANCH) {
      // The push went through the mirror, so the clone is told what the host now holds.
      await unkeyed('git', ['update-ref', `refs/remotes/${REMOTE}/${branch}`, answer.sha], { cwd: source });
    }
    return answer.ok ? { ok: true } : answer;
  }

  async function doPush({ project, dir, refspec }, ctx) {
    if (stopped()) return STOP_REFUSAL;
    const adapter = await ctx.adapter();
    const defaultBranch = await defaultBranchOf(project, adapter);
    const spelled = checkRefspec(refspec, defaultBranch);
    if (!spelled.allowed) return { ok: false, refused: spelled.refused };
    const { branch } = spelled;
    if (branch === STATE_BRANCH || branch === LOCK_BRANCH) return { ok: false, refused: PUSH_REFUSALS.ownRequests };
    if (bypassActive({ now })) return { ok: false, refused: BYPASS_PUSH };
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) refuse('the folder to push from must be a full path');
    let isDir = false;
    try { isDir = fs.statSync(dir).isDirectory(); } catch { /* missing */ }
    if (!isDir) refuse('the folder to push from was not found');
    if (!isInsideFolder(recordOf(project).folder, dir)) return { ok: false, refused: PUSH_REFUSALS.outsideProject };
    try {
      if (isPartialClone(dir)) return { ok: false, refused: PUSH_REFUSALS.partialClone };
    } catch {
      return { ok: false, refused: PUSH_REFUSALS.unchecked };
    }
    if (!(await lockHeld(project, ctx))) return { ok: false, refused: LOCK_REASON };
    const answer = await pushFrom({ project, branch, source: dir, refspec, defaultBranch, ciGuard: true }, ctx);
    return answer.ok ? { ok: true } : answer;
  }

  // --- state and the lock ---

  function recordOf(project) {
    const record = readProject(project);
    if (!record) refuse('the project has not been set up on this computer');
    return record;
  }

  async function ensureStateClone(project, ctx) {
    await cloneState({ project, remoteUrl: recordOf(project).remoteUrl, env: ctx.gitEnv });
  }

  const pushFor = (project, ctx) => (_dir, branch) => pushOwn(project, branch, ctx);

  const stateRoute = (fn, { clone = true, write = false } = {}) => (body, ctx) => oneAtATime(`state:${body.project}`, async () => {
    if (write && stopped()) return STOP_REFUSAL;
    if (clone) await ensureStateClone(body.project, ctx);
    if (write && stopped()) return STOP_REFUSAL;
    return fn(body, ctx);
  });
  // The lock clone is shared with the merge gate's lock check: the same queue.
  const lockRoute = (fn, { write = false } = {}) => (body, ctx) => oneAtATime(`lock:${body.project}`, async () => {
    if (write && stopped()) return STOP_REFUSAL;
    await oneAtATime(`state:${body.project}`, () => ensureStateClone(body.project, ctx));
    if (write && stopped()) return STOP_REFUSAL;
    return fn(body, ctx);
  });

  const written = (made) => ({
    ok: true, id: made.event.id, pushed: made.result.pushed, ...(made.result.refused ? { refused: made.result.refused } : {}),
  });

  async function doWrite({ project, kind, data }, ctx) {
    if (PROTECTED_KINDS.includes(kind)) refuse('a signed kind is recorded through /state/record, never written here');
    if (!PLAIN_KINDS.includes(kind)) refuse('that kind of event is not known');
    if (!data || typeof data !== 'object' || Array.isArray(data)) refuse('the event\'s data must be an object');
    const event = makeEvent({ kind, data, now });
    const result = await writeEvent({ project, event, push: pushFor(project, ctx), env: ctx.gitEnv });
    return written({ event, result });
  }

  const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
  async function doRecord({ project, event }, ctx) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) refuse('the record must be an event');
    if (!PROTECTED_KINDS.includes(event.kind)) refuse('only a signed kind is recorded this way');
    if (typeof event.id !== 'string' || typeof event.at !== 'string' || !ISO_TIME.test(event.at)) refuse('the record is not a whole event');
    if (!verify(event, readEnrolled())) refuse('the record is not signed by an enrolled computer');
    if (event.sig.computer !== computerId() || event.computer !== computerId()) refuse('only this computer\'s own signed records are taken');
    if (listEvents(stateDir(project), { report: () => {} }).some((e) => e.id === event.id)) refuse('the state already holds an event with that id');
    const result = await writeEvent({ project, event, push: pushFor(project, ctx), env: ctx.gitEnv });
    return written({ event, result });
  }

  // The changed files and the configuration, in the mirror. One at a time per
  // project: the mirror and its refs are shared with pushes.
  function readChanges({ project, number, headSha, defaultBranch }, ctx) {
    return oneAtATime(`mirror:${project}`, async () => {
      const mirror = await mirrorFor(project);
      return changedPaths({
        mirror, host: recordOf(project).host, number, headSha, defaultBranch, run: gitIn(ctx.gitEnv),
      });
    });
  }

  async function doMerge(body, ctx) {
    try {
      return await mergeAnswer(body, ctx);
    } finally {
      if (typeof body?.project === 'string') {
        await oneAtATime(`mirror:${body.project}`, () => dropRequestRefs(body.project));
        tidyAfterAnswer(body.project);
      }
    }
  }

  async function mergeAnswer(body, ctx) {
    const { project, number } = body;
    if (!Number.isInteger(number) || number < 1) refuse('the pull request number must be a whole number from 1');
    const adapter = await ctx.adapter();
    const pr = await adapter.prState(number);
    if (pr?.state !== 'open') {
      return { ok: false, refused: `pull request ${number} is not open`, reasons: [`pull request ${number} is not open`], guardrailPaths: [], criticalAreas: [] };
    }
    const headSha = pr.headSha;
    // The restore pull request of the runbook's step 3 needs no review, and under STOP it is the
    // only merge that goes on (Rulings 42 and 47). When it is named like one but a check fails,
    // the answer says which.
    let restoreCheck = { matched: false };
    try {
      restoreCheck = await isRestoreMerge({ project, number, pr }, ctx);
    } catch {
      restoreCheck = { matched: RESTORE_BRANCH.test(typeof pr.headRef === 'string' ? pr.headRef : ''), ok: false, why: 'it could not be checked' };
    }
    const restore = restoreCheck.ok === true;
    // The helper works out the guardrail and approval conditions from the
    // changed files; the caller may only raise them. If the files can't be
    // read, the change counts as touching the guardrails.
    let classified = { touchesGuardrails: true, guardrailPaths: [], criticalAreas: [] };
    let readable = true;
    try {
      const defaultBranch = await defaultBranchOf(project, adapter);
      const { paths, config } = await readChanges({ project, number, headSha, defaultBranch }, ctx);
      classified = classifyChange({ paths, config });
    } catch {
      readable = false;
    }
    // A restore is a release that passed review before; the director's approval stands in for it.
    const touchesGuardrails = (!restore && classified.touchesGuardrails) || body.touchesGuardrails === true;
    const approvalRequired = body.approvalRequired === true || touchesGuardrails || restore;
    const found = { guardrailPaths: classified.guardrailPaths, criticalAreas: classified.criticalAreas };
    const ci = await adapter.ciState(headSha);
    const skipped = [];
    const enrolled = readEnrolled();
    const views = buildViews(listEvents(stateDir(project), { report: () => {}, skipped }), enrolled, { damaged: skipped, now });
    const holdsLock = await lockHeld(project, ctx);
    // STOP and bypass are read last, just before the decision, so one set during the
    // fetches above is seen. The caller may only raise them.
    const decision = gateDecision({
      stop: (stopped() && !restore) || body.stop === true,
      bypass: bypassActive({ now }) || body.bypass === true,
      holdsLock,
      headSha,
      ci,
      // Every merge needs a review; the caller may only add the approval and guardrail conditions.
      reviewRequired: !restore,
      approvalRequired,
      touchesGuardrails,
      review: latestFor(views.reviews, number),
      approval: latestFor(views.approvals, number),
      enrolled,
    });
    if (!decision.allow) {
      const said = restoreCheck.matched && !restore ? [`restore pull request: ${restoreCheck.why}`] : [];
      const reasons = [...said, ...(readable ? decision.reasons : [...decision.reasons, UNREADABLE_CHANGES])];
      return { ok: false, refused: reasons.join('; '), reasons, ...found };
    }
    if (stopped() && !restore) {
      const reasons = [...(restoreCheck.matched ? [`restore pull request: ${restoreCheck.why}`] : []), 'STOP is on'];
      return { ok: false, refused: reasons.join('; '), reasons, ...found };
    }
    const merged = await adapter.merge({ number, sha: headSha });
    if (merged?.merged === true) return { ok: true, merged: true, sha: headSha, ...found };
    return { ok: false, refused: merged?.reason || 'the host did not merge the pull request', ...found };
  }

  // Records a CI push the director may be asked about, one entry per branch,
  // for the hook that turns a click into a full commit. Written whole.
  function writePending(project, entry) {
    const file = path.join(stateDir(project), '..', 'ci-pending.json');
    let pending = {};
    try {
      const read = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (read && typeof read === 'object' && !Array.isArray(read)) pending = read;
    } catch { /* none yet, or unreadable: start again */ }
    pending[entry.branch] = entry;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify(pending, null, 2)}\n`);
      fs.renameSync(temp, file);
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw error;
    }
    return { ok: true, line: ciPushLine(entry.branch, entry.sha) };
  }


  // --- the runbook (design section 12.7) ---
  // These routes answer under STOP. Each step but the first needs the director's
  // click on its card: a signed `action` for that step, from this computer.

  // The director's clicks on record for this runbook step, newest first: signed here, no older
  // than `maxAgeMs`, and for the same commit when `sha12` is given.
  function runbookClicks(project, step, { sha12, maxAgeMs = CLICK_MS } = {}) {
    const enrolled = readEnrolled();
    const nowMs = now().getTime();
    return listEvents(stateDir(project), { report: () => {} }).filter((e) => {
      const age = nowMs - Date.parse(e.at);
      return e.kind === 'action' && e.data?.action === 'runbook' && e.data.step === step
        && (sha12 === undefined || e.data.sha === sha12)
        && e.computer === computerId() && e.sig?.computer === computerId() && verify(e, enrolled)
        && age <= maxAgeMs && age >= -60 * 1000;
    }).reverse();
  }
  const runbookClick = (project, step, options) => runbookClicks(project, step, options).length > 0;

  // Uses one click, once: a marker named for the click's event, made exclusively.
  function useClick(project, step) {
    const folder = path.join(stateDir(project), '..', 'runbook-used');
    fs.mkdirSync(folder, { recursive: true });
    for (const e of runbookClicks(project, step)) {
      if (!/^[A-Za-z0-9-]{1,64}$/.test(e.id)) continue;
      try {
        fs.writeFileSync(path.join(folder, e.id), `${now().toISOString()}\n`, { flag: 'wx' });
        return true;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    return false;
  }
  // A step that uses its click once (steps 2, 4 and 5), and, with no sign-in at all, says so.
  const clicked = (step, fn) => (body, ctx) => (useClick(body.project, step) ? fn(body, ctx) : { ok: false, refused: NEEDS_CLICK });
  // Wraps a runbook route: where the key is gone and the director's sign-in is missing too, a
  // refusal from the host reads as the sign-in refusal.
  const signedIn = (fn) => async (body, ctx) => {
    let answer;
    try {
      answer = await fn(body, ctx);
    } catch (error) {
      if (ctx.signedOut && AUTH_FAILURE.test(error instanceof Error ? error.message : '')) refuse(PUSH_REFUSALS.ciSignIn);
      throw error;
    }
    if (ctx.signedOut && answer?.ok === false && AUTH_FAILURE.test(String(answer.refused ?? ''))) return { ok: false, refused: PUSH_REFUSALS.ciSignIn };
    return answer;
  };

  // A runner for git in the mirror with the connection's key.
  async function inMirror(project, ctx, fn) {
    const mirror = await mirrorFor(project);
    const keyed = gitIn(ctx.gitEnv);
    const must = async (args, what) => {
      const answer = await keyed('git', args, { cwd: mirror, input: '' });
      if (answer.code !== 0) throw new Error(ctx.signedOut && AUTH_FAILURE.test(answer.stderr) ? PUSH_REFUSALS.ciSignIn : `${what} failed`);
      return answer.stdout;
    };
    return fn({ mirror, keyed, must });
  }

  // Fetches the default branch into BASE_REF; resolves with its head commit and its first-parent history, newest first.
  async function defaultHistory(must, defaultBranch) {
    if (!plainBranch(defaultBranch)) throw new Error('the default branch is not known');
    await must(['fetch', '-q', '--no-tags', REMOTE, `+refs/heads/${defaultBranch}:${BASE_REF}`], 'fetching the default branch');
    const listed = await must(['rev-list', '--first-parent', BASE_REF], 'reading the default branch\'s history');
    const history = listed.split('\n').map((l) => l.trim()).filter(Boolean);
    return { head: history[0], history };
  }

  // Whether this pull request is the restore of step 3 (Rulings 42, 47): its head branch is
  // wheelhouse-restore-<sha12>; its base is the default branch; the director's step 3 click for
  // that commit is under a day old; the head commit's tree is that release's tree; and the head
  // sits on top of the default branch, so merging gives that tree. Resolves with
  // `{ matched: false }` for any other pull request, else `{ matched: true, ok, why }`.
  async function isRestoreMerge({ project, number, pr }, ctx) {
    const named = RESTORE_BRANCH.exec(typeof pr.headRef === 'string' ? pr.headRef : '');
    if (!named) return { matched: false };
    const no = (why) => ({ matched: true, ok: false, why });
    if (typeof pr.headSha !== 'string' || !/^[0-9a-f]{40,64}$/.test(pr.headSha)) return no('its head is not known');
    const sha12 = named[1];
    if (!runbookClick(project, 3, { sha12, maxAgeMs: RESTORE_MS })) return no('no step 3 click from the last 24 hours names this release');
    const adapter = await ctx.adapter();
    const defaultBranch = await defaultBranchOf(project, adapter);
    if (pr.baseRef !== defaultBranch) return no('its base is not the default branch');
    const source = recordOf(project).host === 'gitlab' ? `refs/merge-requests/${number}/head` : `refs/pull/${number}/head`;
    const prRef = `refs/wheelhouse/pr/${number}`;
    return oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ must, keyed, mirror }) => {
      try {
        const { history } = await defaultHistory(must, defaultBranch);
        await must(['fetch', '-q', '--no-tags', REMOTE, `+${source}:${prRef}`], 'fetching the pull request');
        const fetched = (await must(['rev-parse', '--verify', '--end-of-options', `${prRef}^{commit}`], 'reading the fetched head')).trim();
        if (fetched !== pr.headSha) return no('its head has moved since the host reported it');
        const target = history.slice(1).find((c) => c.startsWith(sha12));
        if (!target) return no('the release is not an earlier commit of the default branch');
        const [want, have] = await Promise.all([
          must(['rev-parse', '--verify', `${target}^{tree}`], 'reading the release'),
          must(['rev-parse', '--verify', `${pr.headSha}^{tree}`], 'reading the head'),
        ]);
        if (want.trim() !== have.trim()) return no('its files are not the chosen release\'s files');
        const onTop = await keyed('git', ['merge-base', '--is-ancestor', BASE_REF, pr.headSha], { cwd: mirror });
        return onTop.code === 0 ? { matched: true, ok: true } : no('its head is not on top of the default branch');
      } catch (error) {
        return no(error instanceof Error && error.message === PUSH_REFUSALS.ciSignIn ? PUSH_REFUSALS.ciSignIn : 'it could not be checked against the host');
      } finally {
        await keyed('git', ['update-ref', '-d', prRef], { cwd: mirror });
      }
    }));
  }

  const plainAnswer = (text, rest = {}) => ({ ok: true, message: text, ...rest });

  // Step 2.
  async function doCutAccess({ project }) {
    const { connection, host, repo } = recordOf(project);
    const base = host === 'gitlab' ? checkBaseUrl(connection.baseUrl ?? 'https://gitlab.com') : null;
    if (connection.mode !== 'narrow') {
      if (host === 'github') {
        return plainAnswer('Nothing was changed on this computer: the agents use the director\'s own GitHub sign-in, and only the director can revoke it. Still for the director: open the page below and revoke the sign-in that Wheelhouse uses.', { url: 'https://github.com/settings/applications' });
      }
      const apps = `${base}/-/user_settings/applications`;
      const tokens = `${base}/-/user_settings/personal_access_tokens`;
      return plainAnswer(`Nothing was changed on this computer: the agents use the director's own GitLab sign-in, and only the director can revoke it. Still for the director: revoke the sign-in on ${apps}, and check ${tokens} for any token of theirs that Wheelhouse uses.`, { url: apps });
    }
    if (host === 'github') {
      let keys = null;
      try { keys = readKey('github-app'); } catch { /* damaged: deleted below */ }
      const id = Number.isInteger(keys?.installationId) && keys.installationId > 0 ? keys.installationId : null;
      const url = id ? `https://github.com/settings/installations/${id}` : 'https://github.com/settings/installations';
      deleteKey('github-app');
      return plainAnswer('Done on this computer: the Wheelhouse app\'s keys were deleted from it, so nothing here can use them. Still for the director: the app is still installed on GitHub, and a copy of its keys would still work until the app is suspended or uninstalled. Open the page below and choose Suspend or Uninstall.', { url });
    }
    const name = `gitlab-project-${connection.projectId}`;
    let key = null;
    try { key = readKey(name); } catch { /* damaged: treated as none */ }
    const pasted = key?.kind === 'pasted-token';
    const url = pasted ? `${base}/-/user_settings/personal_access_tokens` : `${base}/${repo}/-/settings/access_tokens`;
    if (typeof key?.token !== 'string' || key.token === '') {
      return plainAnswer('No project key was found on this computer, so there was nothing to revoke from here. Still for the director: check the page below for any key that Wheelhouse made, and revoke it.', { url });
    }
    const api = gitlabApi({ baseUrl: base, token: key.token, fetch });
    const statusOf = async (call) => { try { return (await call()).status; } catch { return null; } };
    const revoked = (status) => status !== null && status >= 200 && status < 300;
    let status = await statusOf(() => api.delete('/personal_access_tokens/self'));
    // If GitLab will not revoke a key by itself, try it by its own number.
    if (status !== null && !revoked(status) && status !== 401 && Number.isInteger(key.id) && key.id > 0) {
      status = await statusOf(() => api.delete(`${projectPath(connection.projectId)}/access_tokens/${key.id}`));
    }
    if (revoked(status)) {
      deleteKey(name);
      return plainAnswer(pasted
        ? 'Done: GitLab revoked the token. It was the director\'s own token, pasted in at setup, so it stops working anywhere else they used it too; its file was deleted from this computer. The page below lists their personal access tokens, to check it is gone.'
        : 'Done: GitLab revoked the project key, and its file was deleted from this computer. Nothing is left for the director on this step.', { url });
    }
    if (status === 401) {
      return plainAnswer(`GitLab no longer accepts this key (HTTP 401), so it no longer works; its file was kept on this computer. Still for the director: open the page below and check that the key is gone.`, { url });
    }
    return {
      ok: false,
      refused: `GitLab did not revoke the ${pasted ? 'token' : 'project key'}${status === null ? ' (it could not be reached)' : ` (HTTP ${status})`}, so its file was kept on this computer. For the director: open the page below, find ${pasted ? 'the token' : 'the key Wheelhouse made'}, and revoke it.`,
      url,
    };
  }

  // Step 3, the first half: a pull request that puts the product back to an earlier release.
  async function doRestoreMain({ project, sha }, ctx) {
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) refuse('the commit must be given as a full 40-character ID');
    const sha12 = sha.slice(0, 12);
    if (!runbookClick(project, 3, { sha12 })) return { ok: false, refused: NEEDS_CLICK };
    const adapter = await ctx.adapter();
    const defaultBranch = await defaultBranchOf(project, adapter);
    const branch = `${RESTORE_PREFIX}${sha12}`;
    const onGithub = recordOf(project).host === 'github';
    const author = { GIT_AUTHOR_NAME: 'Wheelhouse', GIT_AUTHOR_EMAIL: 'wheelhouse@invalid', GIT_COMMITTER_NAME: 'Wheelhouse', GIT_COMMITTER_EMAIL: 'wheelhouse@invalid' };
    const made = await oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ mirror, keyed, must }) => {
      const { head, history } = await defaultHistory(must, defaultBranch);
      if (sha === head || !history.includes(sha)) return { refused: NOT_EARLIER };
      if (history.indexOf(sha) > 10) return { refused: NOT_AMONG };
      const tree = (await must(['rev-parse', '--verify', `${sha}^{tree}`], 'reading the release')).trim();
      if (tree === (await must(['rev-parse', '--verify', `${head}^{tree}`], 'reading the default branch')).trim()) {
        return { refused: 'the default branch already holds exactly those files' };
      }
      const commit = await keyed('git', ['commit-tree', tree, '-p', head, '-m', `Put the product back to release ${sha12}`], {
        cwd: mirror, input: '', env: { ...author, GIT_AUTHOR_DATE: now().toISOString(), GIT_COMMITTER_DATE: now().toISOString() },
      });
      if (commit.code !== 0) throw new Error('making the restore commit failed');
      await must(['update-ref', `refs/heads/${branch}`, commit.stdout.trim()], 'keeping the restore commit');
      // A CI file in the change: GitHub's app key may not push one, so the director's own sign-in does.
      let ci = true;
      try {
        const changes = await branchChanges({ mirror, sha: commit.stdout.trim(), defaultBranch, run: keyed });
        ci = touchesCi(changes.paths, changes.config);
      } catch { /* unreadable: counted as a CI change */ }
      return { commit: commit.stdout.trim(), mirror, ci };
    }));
    if (made.refused) return { ok: false, refused: made.refused };
    try {
      const pushed = await pushFrom({
        project, branch, source: made.mirror, refspec: branch, defaultBranch, allowStop: true, asDirector: onGithub && made.ci,
      }, ctx);
      if (!pushed.ok) {
        return { ok: false, refused: pushed.rejected ? `the branch ${branch} is already on the host with other contents: open its pull request, or ask the director to remove the branch` : pushed.refused };
      }
    } finally {
      await unkeyed('git', ['update-ref', '-d', `refs/heads/${branch}`], { cwd: made.mirror });
    }
    const opened = await adapter.openPr({
      head: branch,
      base: defaultBranch,
      title: `Put the product back to release ${sha12}`,
      body: `This puts the files back to exactly what they were at commit ${sha}. The director clicked the runbook's step 3 card for it.`,
    });
    return {
      ok: true, number: opened.number, url: opened.url, branch, head: made.commit,
      message: `Pull request ${opened.number} is open: it puts the files back to release ${sha12}. Next, the director approves it on its card; once CI has passed, the merge follows.${onGithub && made.ci ? ' This release changes CI files, so the branch was pushed with your own sign-in, and the merge will need your own sign-in too.' : ''}`,
    };
  }

  // Step 3, the second half: the merge, through the same gate as any other (it lets STOP pass for this branch only).
  async function doRestoreMerge(body, ctx) {
    const { project, number } = body;
    if (!Number.isInteger(number) || number < 1) refuse('the pull request number must be a whole number from 1');
    const pr = await (await ctx.adapter()).prState(number);
    if (!RESTORE_BRANCH.test(typeof pr?.headRef === 'string' ? pr.headRef : '')) refuse('that pull request is not a restore pull request');
    // On GitHub the app's key may not merge a change to CI files, as it may not push one: the
    // director's own sign-in does, with the same adapter call.
    let ci = false;
    if (recordOf(project).host === 'github' && !ctx.signedOut) {
      try {
        const defaultBranch = await defaultBranchOf(project, await ctx.adapter());
        const changes = await readChanges({ project, number, headSha: pr.headSha, defaultBranch }, ctx);
        ci = touchesCi(changes.paths, changes.config);
      } catch {
        ci = true; // unreadable: counted as a CI change
      }
    }
    if (!ci) return doMerge({ project, number }, ctx);
    let own = null;
    const director = {
      ...ctx,
      mode: 'quick',
      env: {},
      gitEnv: {},
      signedOut: true,
      adapter: async () => {
        own ??= Promise.resolve(adapterFor(project, { env: {}, envFor: async () => ({}), now }));
        return own;
      },
    };
    try {
      const answer = await doMerge({ project, number }, director);
      if (answer.ok === false && AUTH_FAILURE.test(String(answer.refused ?? ''))) return { ok: false, refused: PUSH_REFUSALS.ciSignIn };
      return answer;
    } catch (error) {
      if (AUTH_FAILURE.test(error instanceof Error ? error.message : '')) return { ok: false, refused: PUSH_REFUSALS.ciSignIn };
      throw error;
    }
  }

  // Step 4: the newest backup's events that the state branch lacks, added back and pushed.
  async function doRestoreState({ project }, ctx) {
    const folder = path.join(profileDir(), 'backups', project);
    let names = [];
    try { names = fs.readdirSync(folder).filter((f) => BACKUP_FILE.test(f)).sort(); } catch { /* none */ }
    if (names.length === 0) return { ok: false, refused: 'there is no backup of this project\'s records on this computer' };
    const bundle = path.join(folder, names.at(-1));
    return oneAtATime(`state:${project}`, async () => {
      await ensureStateClone(project, ctx);
      const dir = stateDir(project);
      const plain = (args) => stateGit(dir, args);
      if ((await plain(['bundle', 'verify', bundle])).code !== 0) return { ok: false, refused: 'the newest backup could not be verified, so nothing was put back' };
      let fetched = await plain(['fetch', '-q', '--no-tags', bundle, `+refs/heads/${STATE_BRANCH}:${BACKUP_REF}`]);
      if (fetched.code !== 0) fetched = await plain(['fetch', '-q', '--no-tags', bundle, `+refs/remotes/${REMOTE}/${STATE_BRANCH}:${BACKUP_REF}`]);
      if (fetched.code !== 0) return { ok: false, refused: 'the newest backup could not be read, so nothing was put back' };
      try {
        const pulled = await stateGit(dir, ['pull', '--rebase', REMOTE, STATE_BRANCH], ctx.gitEnv);
        if (pulled.code !== 0) await stateGit(dir, ['rebase', '--abort'], ctx.gitEnv);
        const listedAt = async (rev) => {
          const listed = await plain(['ls-tree', '-r', '-z', '--name-only', rev, '--', 'events/']);
          if (listed.code !== 0) throw new Error('listing the events failed');
          return listed.stdout.split('\0').filter(Boolean);
        };
        const have = new Set(await listedAt('HEAD'));
        const enrolled = readEnrolled();
        const added = [];
        let skipped = 0;
        for (const file of (await listedAt(BACKUP_REF)).filter((f) => !have.has(f))) {
          const read = await plain(['show', `${BACKUP_REF}:${file}`]);
          let event = null;
          try { event = JSON.parse(read.stdout); } catch { /* skipped below */ }
          const sound = read.code === 0 && EVENT_FILE.test(file) && event && typeof event === 'object' && !Array.isArray(event)
            && typeof event.id === 'string' && typeof event.at === 'string' && typeof event.kind === 'string' && typeof event.computer === 'string'
            && (PLAIN_KINDS.includes(event.kind) || PROTECTED_KINDS.includes(event.kind))
            && eventPath(event).replaceAll('\\', '/') === file
            && scanContent(read.stdout).length === 0
            && (!PROTECTED_KINDS.includes(event.kind) || verify(event, enrolled));
          if (!sound) { skipped += 1; continue; }
          const target = path.join(dir, file);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          try { fs.writeFileSync(target, read.stdout, { flag: 'wx' }); } catch { skipped += 1; continue; }
          added.push(file);
        }
        if (added.length === 0) {
          return plainAnswer(`Nothing needed putting back: every event in the newest backup is already on the state branch${skipped ? ` (${skipped} could not be checked and were left out)` : ''}.`, { added: 0, skipped });
        }
        const committed = (await plain(['add', '--', ...added])).code === 0 && (await plain(['commit', '-q', '-m', `Put back ${added.length} events from the backup`])).code === 0;
        if (!committed) {
          await plain(['reset', '-q', '--', ...added]);
          for (const f of added) fs.rmSync(path.join(dir, f), { force: true });
          return { ok: false, refused: 'the events could not be committed, so nothing was put back' };
        }
        const pushed = await pushOwn(project, STATE_BRANCH, ctx, { allowStop: true });
        if (!pushed.ok) {
          return { ok: false, refused: `${added.length} events were put back on this computer, but pushing them failed (${pushed.refused ?? 'the host did not take them'}); the next sync will push them`, added: added.length, skipped };
        }
        return plainAnswer(`Put back ${added.length} events from the newest backup, and pushed them${skipped ? `; ${skipped} could not be checked and were left out` : ''}. Nothing already on the branch was changed.`, { added: added.length, skipped });
      } finally {
        await plain(['update-ref', '-d', BACKUP_REF]);
      }
    });
  }

  // The end of a command's output, with any line that matched the secret scan hidden. The end is
  // cut at a line first, so a long line is never scanned whole and a secret is never cut in half.
  function shown(text) {
    let t = String(text).trim();
    if (t.length > 2 * MOST_OUTPUT) {
      t = t.slice(-2 * MOST_OUTPUT);
      const cut = t.indexOf('\n');
      if (cut >= 0) t = t.slice(cut + 1);
    }
    const lines = t.split(/\r\n|\r|\n/);
    for (const hit of scanText(t)) lines[hit.line - 1] = `[hidden: this line matched ${hit.pattern}]`;
    t = lines.join('\n');
    if (scanContent(t).length > 0) t = '[hidden: the output looked as if it held a secret]';
    return t.length > MOST_OUTPUT ? t.slice(-MOST_OUTPUT) : t;
  }

  // Step 5: the project's own containment command, in a fresh checkout of the default branch.
  function doContain({ project }, ctx) {
    return oneAtATime(`contain:${project}`, async () => {
      const adapter = await ctx.adapter();
      const defaultBranch = await defaultBranchOf(project, adapter);
      const dir = path.join(stateDir(project), '..', 'contain');
      const prepared = await oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ mirror, must }) => {
        await defaultHistory(must, defaultBranch);
        const { runbook: configured } = await baseConfig(must);
        const contain = configured?.contain;
        if (!contain) return null;
        fs.rmSync(dir, { recursive: true, force: true });
        await unkeyed('git', ['worktree', 'prune'], { cwd: mirror });
        fs.mkdirSync(path.dirname(dir), { recursive: true });
        await must(['worktree', 'add', '-q', '--detach', '--force', dir, BASE_REF], 'checking out the default branch');
        return contain;
      }));
      if (!prepared) return plainAnswer(NO_HARM, { none: true });
      const [file, ...args] = prepared.command;
      let result;
      try {
        result = await run(file, args, { cwd: dir, timeoutMs: CONTAIN_MS, limit: MOST_KEPT, baseEnv: withoutGitVars(process.env) });
      } catch {
        return { ok: false, refused: `the containment command (${prepared.describe}) could not be started` };
      }
      const output = shown(`${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`);
      if (result.timedOut) return { ok: false, refused: `the containment command (${prepared.describe}) did not finish in ten minutes and was stopped`, output };
      if (result.code !== 0) return { ok: false, refused: `the containment command (${prepared.describe}) failed with exit code ${result.code}`, output };
      return plainAnswer(`Ran the project's containment step: ${prepared.describe}.`, { output });
    });
  }

  // The last ten merges on the default branch, newest first, for the step 3 card. The head itself is
  // left out: putting the product back to it would change nothing.
  async function doCandidates({ project }, ctx) {
    const adapter = await ctx.adapter();
    const defaultBranch = await defaultBranchOf(project, adapter);
    return oneAtATime(`mirror:${project}`, () => inMirror(project, ctx, async ({ must }) => {
      await defaultHistory(must, defaultBranch);
      const listed = await must(['log', '--first-parent', '-n', '11', '--format=%H%x1f%cI%x1f%s', BASE_REF], 'reading the default branch\'s history');
      const candidates = listed.split('\n').filter(Boolean).slice(1).map((line) => {
        const [sha, at, title] = line.split('\x1f');
        return { sha, sha12: sha.slice(0, 12), at: new Date(at).toISOString(), title };
      });
      return { ok: true, candidates };
    }));
  }

  // These routes are not queued: STOP is read at the point their work begins.
  // It is read again after the adapter is ready, right before the host write.
  const writing = (call) => async (body, ctx) => {
    if (stopped()) return STOP_REFUSAL;
    const adapter = await ctx.adapter();
    if (stopped()) return STOP_REFUSAL;
    return { ok: true, result: await call(adapter, body) };
  };
  const pass = (call) => async (body, ctx) => ({ ok: true, result: await call(await ctx.adapter(), body) });
  const routes = {
    // A placeholder so the route exists: /stop/set is handled in `handle`, before the project lookup.
    '/stop/set': () => ({ ok: true }),
    '/runbook/cut-access': signedIn(clicked(2, doCutAccess)),
    '/runbook/restore-main': signedIn((body, ctx) => doRestoreMain(body, ctx)),
    '/runbook/restore-merge': signedIn((body, ctx) => oneAtATime(`merge:${body.project}`, () => doRestoreMerge(body, ctx))),
    '/runbook/restore-state': signedIn(clicked(4, doRestoreState)),
    '/runbook/contain': signedIn(clicked(5, doContain)),
    '/runbook/candidates': signedIn(doCandidates),
    '/push': (body, ctx) => oneAtATime(`push:${body.project}`, () => doPush(body, ctx)),
    '/merge': (body, ctx) => oneAtATime(`merge:${body.project}`, () => doMerge(body, ctx)),
    '/state/clone': stateRoute(async ({ project }, ctx) => {
      await cloneState({ project, remoteUrl: recordOf(project).remoteUrl, env: ctx.gitEnv });
      return { ok: true };
    }, { clone: false }),
    '/state/write': stateRoute(doWrite, { write: true }),
    '/state/record': signedIn(stateRoute(doRecord)),
    '/state/sync': stateRoute(async ({ project }, ctx) => ({
      ok: true, ...(await syncState({ project, push: pushFor(project, ctx), env: ctx.gitEnv })),
    })),
    '/state/views': stateRoute(async ({ project }) => ({ ok: true, views: await writeViews(project, { now }) })),
    '/lock/take': lockRoute(async ({ project }, ctx) => ({
      ok: true, result: await takeLock({ project, push: pushFor(project, ctx), now, env: ctx.gitEnv }),
    }), { write: true }),
    '/lock/touch': lockRoute(async ({ project }, ctx) => ({
      ok: true, result: await touchLock({ project, push: pushFor(project, ctx), now, env: ctx.gitEnv }),
    }), { write: true }),
    '/lock/read': lockRoute(async ({ project }, ctx) => ({ ok: true, result: await readLock({ project, env: ctx.gitEnv }) })),
    '/ci-push/line': (body) => {
      if (stopped()) return STOP_REFUSAL;
      if (!plainBranch(body.branch)) refuse('the branch name is not valid');
      if (typeof body.sha !== 'string' || !/^[0-9a-f]{40}$/.test(body.sha)) refuse('the commit must be written in full');
      return writePending(body.project, { branch: body.branch, sha: body.sha, at: now().toISOString() });
    },
    '/pr/open': async (body, ctx) => {
      if (stopped()) return STOP_REFUSAL;
      const adapter = await ctx.adapter();
      const defaultBranch = await defaultBranchOf(body.project, adapter);
      if (body.base !== defaultBranch) return { ok: false, refused: PUSH_REFUSALS.prBase };
      const spelled = checkRefspec(body.head, defaultBranch);
      if (!spelled.allowed) return { ok: false, refused: spelled.refused };
      if (spelled.branch === STATE_BRANCH || spelled.branch === LOCK_BRANCH) return { ok: false, refused: PUSH_REFUSALS.ownRequests };
      if (stopped()) return STOP_REFUSAL;
      return { ok: true, result: await adapter.openPr({ head: spelled.branch, base: body.base, title: body.title, body: body.body }) };
    },
    '/pr/update': writing((a, { number, title, body }) => a.updatePr({ number, title, body })),
    '/pr/state': signedIn(pass((a, { number }) => a.prState(number))),
    '/ci': pass((a, { sha }) => a.ciState(sha)),
    '/issue/create': writing((a, { title, body, labels }) => a.issue.create({ title, body, labels })),
    '/issue/update': writing((a, { number, body }) => a.issue.update({ number, body })),
    '/issue/list': pass((a, { label }) => a.issue.list({ label })),
  };

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://helper');
    if (url.pathname === '/health') return send(res, 200, { ok: true, ...(PLUGIN_VERSION ? { version: PLUGIN_VERSION } : {}) });
    const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : null;
    if (!route) {
      req.resume();
      return send(res, 404, { ok: false, refused: 'unknown request' });
    }
    if (req.method !== 'POST') {
      req.resume();
      return send(res, 405, { ok: false, refused: 'requests to the helper are POST' });
    }
    const raw = await readBody(req, res);
    if (raw === null) return undefined;
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return send(res, 400, { ok: false, refused: 'the request is not JSON' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return send(res, 400, { ok: false, refused: 'the request must be a JSON object' });
    }
    if (url.pathname === '/stop/set') {
      // Anyone may set STOP: a false alarm costs only a pause. No route lifts it.
      try {
        setStop({ by: 'helper', now });
        return send(res, 200, { ok: true });
      } catch {
        return send(res, 200, { ok: false, refused: 'STOP could not be recorded' });
      }
    }
    let ctx = null;
    try {
      const runbookRoute = url.pathname.startsWith('/runbook/');
      // runbook.js runs inside the sandbox, which cannot read ~/.wheelhouse: it sends its folder,
      // and the project is placed here.
      if (runbookRoute && body.cwd !== undefined) body = { ...body, project: placeFolder(body.cwd) };
      const project = checkProject(body.project);
      ctx = await contextFor(project, { fallBack: runbookRoute || FALL_BACK_ROUTES.includes(url.pathname) });
      onArrive(url.pathname); // for tests: the request is about to enter its queue
      const answer = await route(body, ctx);
      return send(res, 200, cleanDeep(answer, ctx.secrets));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'the request failed';
      // Every merge answer carries what was found in the changed files: nothing, when it failed first.
      const found = url.pathname === '/merge' ? { guardrailPaths: [], criticalAreas: [] } : {};
      return send(res, 200, { ok: false, refused: clean(message, ctx?.secrets ?? []) || 'the request failed', ...found });
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { ok: false, refused: 'the helper could not answer' });
    });
  });
  try {
    await new Promise((resolve, reject) => {
      const onError = async (error) => {
        if (error.code !== 'EADDRINUSE') return reject(error);
        // Another helper may have started between the probe and now: ask again,
        // and never remove what it made.
        const again = await probe(address);
        reject(new Error(again === 'helper' ? ALREADY : 'The helper\'s address is in use, so the helper was not started'));
      };
      server.once('error', onError);
      server.listen(address, () => {
        server.off('error', onError);
        resolve();
      });
    });
    if (!pipe) {
      try { fs.chmodSync(address, 0o600); } catch { /* not supported here */ }
    }
  } finally {
    releaseStart();
  }

  return {
    address,
    // Waits, too, for work queued after an answer (the mirror's tidy): on Windows a folder
    // a git process is working in can't be removed.
    close: async () => {
      await new Promise((resolve) => {
        server.close(() => {
          if (!pipe) fs.rmSync(address, { force: true });
          resolve();
        });
        server.closeAllConnections?.();
      });
      while (queues.size > 0) await Promise.allSettled([...queues.values()]);
    },
  };
}
