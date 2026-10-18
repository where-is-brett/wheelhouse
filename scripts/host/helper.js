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
import { helperAddress, stateDir, stopFile } from '../lib/paths.js';
import { run as realRun, withoutGitVars } from '../lib/run.js';
import { gateDecision } from '../gate/conditions.js';
import { scrub } from './adapter.js';
import { childEnv } from './connection.js';
import { listEvents } from '../state/events.js';
import { scanContent, scanText } from '../state/secret-scan.js';
import { buildViews, latestFor } from '../state/views.js';
import { readEnrolled } from '../state/signing.js';
import { heldCounter, holdsLock } from '../state/lock.js';

export const STATE_BRANCH = 'wheelhouse-state';
export const LOCK_BRANCH = 'wheelhouse-lock';
const REMOTE = 'origin';
const INCOMING = 'refs/wheelhouse/incoming';
const MOST_BODY = 1024 * 1024;
const PROBE_MS = 1000;
const PIPE = /^\\\\[.?]\\pipe\\/i;
// Git for Windows reads "/dev/null" as its null device too.
const NO_FILE = '/dev/null';
const LOCK_REASON = 'this computer no longer holds the lock';

const FOLDER_MS = 60 * 1000;
const HOST_MS = 5 * 60 * 1000;

// Every git call the helper makes: no prompting, no replace refs. Each starts
// from the helper's environment with every inherited GIT_* variable removed.
const GIT_BASE = { GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' };
// No system or user config: for calls that need no sign-in, and for the narrow
// connection, whose key travels in the environment. The quick connection keeps
// them, because the director's own sign-in is found through them.
const ISOLATED = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NO_FILE };

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
  stateFolder: 'the state branch is pushed only from the project\'s own state clone',
  lockFolder: 'the lock branch is pushed only from the project\'s own lock clone',
  unchecked: 'the commits being pushed could not be checked',
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
  return found.length > 0 ? `the state push was refused because ${file} matched: ${found.join(', ')}` : null;
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
  address = helperAddress(), adapterFor, envFor, now = () => new Date(), run = realRun,
} = {}) {
  if (typeof adapterFor !== 'function') throw new Error('The helper needs an adapterFor function');
  if (typeof envFor !== 'function') throw new Error('The helper needs an envFor function');
  const pipe = PIPE.test(address);
  if (!pipe && Buffer.byteLength(address) > socketLimit(process.platform)) {
    throw new Error(`The helper's socket path is too long for this system (${Buffer.byteLength(address)} bytes, at most ${socketLimit(process.platform)}): set WHEELHOUSE_HOME to a shorter folder`);
  }

  const found = await probe(address);
  if (found === 'helper') throw new Error(ALREADY);
  if (found === 'other') throw new Error(OTHER);
  if (!pipe) {
    let stat = null;
    try { stat = fs.lstatSync(address); } catch { /* nothing there */ }
    if (stat && !stat.isSocket()) throw new Error('There is a file at the helper\'s address that is not a socket, so it was left alone');
    if (stat) fs.rmSync(address, { force: true });
    fs.mkdirSync(path.dirname(address), { recursive: true });
  }

  const sharedEnv = serialisePerProject((project) => envFor(project));

  // Each request reads the environment once, before anything else, keeps its
  // secrets for scrubbing that request's answer, and gives that same
  // environment to the adapter.
  async function contextFor(project) {
    const { mode, env } = connectionOf(await sharedEnv(project));
    let adapter = null;
    return {
      mode,
      env,
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

  async function doPush({ project, dir, refspec }, ctx) {
    const adapter = await ctx.adapter();
    const defaultBranch = await defaultBranchOf(project, adapter);
    const spelled = checkRefspec(refspec, defaultBranch);
    if (!spelled.allowed) return { ok: false, refused: spelled.refused };
    const { branch } = spelled;
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) refuse('the folder to push from must be a full path');
    let isDir = false;
    try { isDir = fs.statSync(dir).isDirectory(); } catch { /* missing */ }
    if (!isDir) refuse('the folder to push from was not found');
    // State and lock pushes come only from the clones the helper's own code
    // keeps: an agent's copy of either branch is never pushed. The objects are
    // then read from the clone's own resolved path, never from `dir`, so a
    // link repointed after this check cannot change where they come from.
    let source = dir;
    if (branch === STATE_BRANCH || branch === LOCK_BRANCH) {
      const own = branch === STATE_BRANCH ? stateDir(project) : path.join(stateDir(project), '..', 'lock');
      const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
      const ownReal = real(own);
      if (ownReal === null || real(dir) !== ownReal) {
        return { ok: false, refused: branch === STATE_BRANCH ? PUSH_REFUSALS.stateFolder : PUSH_REFUSALS.lockFolder };
      }
      source = ownReal;
    }
    if (branch !== STATE_BRANCH && branch !== LOCK_BRANCH && !(await lockHeld(project, ctx))) {
      return { ok: false, refused: LOCK_REASON };
    }

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

    const pushed = await keyed('git', ['push', '--no-verify', '--porcelain', REMOTE, `${checked.sha}:refs/heads/${branch}`], { cwd: mirror });
    if (pushed.code === 0) return { ok: true };
    if (pushed.timedOut) return { ok: false, refused: 'the host did not answer the push in time' };
    const refused = pushed.stdout.split('\n').find((line) => line.startsWith('!') && line.includes(`refs/heads/${branch}`));
    if (refused && /\((?:non-fast-forward|fetch first)\)/.test(refused)) return { ok: false, rejected: 'non-fast-forward' };
    const detail = clean(pushed.stderr, ctx.secrets);
    return { ok: false, refused: `git could not push the branch${detail ? `: ${detail}` : ''}` };
  }

  async function doMerge(body, ctx) {
    const { project, number } = body;
    if (!Number.isInteger(number) || number < 1) refuse('the pull request number must be a whole number from 1');
    const adapter = await ctx.adapter();
    const pr = await adapter.prState(number);
    if (pr?.state !== 'open') return { ok: false, refused: `pull request ${number} is not open`, reasons: [`pull request ${number} is not open`] };
    const headSha = pr.headSha;
    const ci = await adapter.ciState(headSha);
    const skipped = [];
    const enrolled = readEnrolled();
    const views = buildViews(listEvents(stateDir(project), { report: () => {}, skipped }), enrolled, { damaged: skipped, now });
    const decision = gateDecision({
      // STOP is read here as well: the file turns it on whatever the caller says.
      stop: fs.existsSync(stopFile()) ? true : body.stop,
      bypass: body.bypass,
      holdsLock: await lockHeld(project, ctx),
      headSha,
      ci,
      // Every merge needs a review; the caller may only add the approval and guardrail conditions.
      reviewRequired: true,
      approvalRequired: body.approvalRequired !== false,
      touchesGuardrails: body.touchesGuardrails !== false,
      review: latestFor(views.reviews, number),
      approval: latestFor(views.approvals, number),
      enrolled,
    });
    if (!decision.allow) return { ok: false, refused: decision.reasons.join('; '), reasons: decision.reasons };
    const merged = await adapter.merge({ number, sha: headSha });
    if (merged?.merged === true) return { ok: true, merged: true, sha: headSha };
    return { ok: false, refused: merged?.reason || 'the host did not merge the pull request' };
  }

  const pass = (call) => async (body, ctx) => ({ ok: true, result: await call(await ctx.adapter(), body) });
  const routes = {
    '/push': (body, ctx) => oneAtATime(`push:${body.project}`, () => doPush(body, ctx)),
    '/merge': (body, ctx) => oneAtATime(`merge:${body.project}`, () => doMerge(body, ctx)),
    '/pr/open': pass((a, { head, base, title, body }) => a.openPr({ head, base, title, body })),
    '/pr/update': pass((a, { number, title, body }) => a.updatePr({ number, title, body })),
    '/pr/state': pass((a, { number }) => a.prState(number)),
    '/ci': pass((a, { sha }) => a.ciState(sha)),
    '/issue/create': pass((a, { title, body, labels }) => a.issue.create({ title, body, labels })),
    '/issue/update': pass((a, { number, body }) => a.issue.update({ number, body })),
    '/issue/list': pass((a, { label }) => a.issue.list({ label })),
  };

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://helper');
    if (url.pathname === '/health') return send(res, 200, { ok: true });
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
    let ctx = null;
    try {
      const project = checkProject(body.project);
      ctx = await contextFor(project);
      const answer = await route(body, ctx);
      return send(res, 200, cleanDeep(answer, ctx.secrets));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'the request failed';
      return send(res, 200, { ok: false, refused: clean(message, ctx?.secrets ?? []) || 'the request failed' });
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { ok: false, refused: 'the helper could not answer' });
    });
  });
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

  return {
    address,
    close: () => new Promise((resolve) => {
      server.close(() => {
        if (!pipe) fs.rmSync(address, { force: true });
        resolve();
      });
      server.closeAllConnections?.();
    }),
  };
}
