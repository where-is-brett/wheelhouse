// scripts/state/lock.js
import fs from 'node:fs';
import path from 'node:path';
import { computerId, stateDir } from '../lib/paths.js';
import { git } from './git.js';

export const LOCK_BRANCH = 'wheelhouse-lock';
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const REMOTE_REF = `refs/remotes/origin/${LOCK_BRANCH}`;

function lockDir(project) {
  return path.join(stateDir(project), '..', 'lock');
}

function heldFile(project) {
  return path.join(stateDir(project), '..', 'lock-held.json');
}

// The counter this computer last took, or null.
export function heldCounter({ project }) {
  try {
    const kept = JSON.parse(fs.readFileSync(heldFile(project), 'utf8'));
    return Number.isInteger(kept?.counter) ? kept.counter : null;
  } catch {
    return null;
  }
}

function clearHeld(project) {
  fs.rmSync(heldFile(project), { force: true });
}

// The lock folder: a clone of only the lock branch, or an empty start on that branch
// (a free lock) when the remote has none. An existing folder is never cleared.
async function ensureClone(project, env) {
  const dir = lockDir(project);
  if (fs.existsSync(path.join(dir, '.git'))) {
    const gitDir = path.join(dir, '.git');
    if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
      await git(dir, ['rebase', '--abort'], env);
    }
    const branch = await git(dir, ['symbolic-ref', '--short', 'HEAD'], env);
    if (branch.code !== 0 || branch.stdout.trim() !== LOCK_BRANCH) {
      throw new Error(`The folder ${dir} holds a clone that is not this project's lock branch, so it was left alone`);
    }
    return dir;
  }
  const origin = await git(stateDir(project), ['remote', 'get-url', 'origin'], env);
  if (origin.code !== 0 || !origin.stdout.trim()) throw new Error('The project has no state clone to find the repository from');
  const remoteUrl = origin.stdout.trim();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const fail = (message) => {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(message);
  };
  const listed = await git(dir, ['ls-remote', '--heads', remoteUrl, LOCK_BRANCH], env);
  if (listed.code !== 0) fail('The lock repository could not be reached');
  if (listed.stdout.trim()) {
    const cloned = await git(dir, ['clone', '--single-branch', '--branch', LOCK_BRANCH, '--', remoteUrl, '.'], env);
    if (cloned.code !== 0) fail('The lock branch could not be cloned');
    return dir;
  }
  for (const args of [['init'], ['symbolic-ref', 'HEAD', `refs/heads/${LOCK_BRANCH}`], ['remote', 'add', 'origin', remoteUrl]]) {
    if ((await git(dir, args, env)).code !== 0) fail('The lock branch could not be started');
  }
  return dir;
}

// Fetches the lock branch. Returns false when the remote has none (a free lock);
// throws a plain error when the remote cannot be reached.
async function fetchRemote(dir, env) {
  const listed = await git(dir, ['ls-remote', '--heads', 'origin', LOCK_BRANCH], env);
  if (listed.code !== 0) throw new Error('The lock repository could not be reached');
  if (!listed.stdout.trim()) {
    await git(dir, ['update-ref', '-d', REMOTE_REF], env);
    return false;
  }
  const fetched = await git(dir, ['fetch', 'origin', `+refs/heads/${LOCK_BRANCH}:${REMOTE_REF}`], env);
  if (fetched.code !== 0) throw new Error('The lock branch could not be fetched');
  return true;
}

async function readRemoteLock(dir, present, env) {
  if (!present) return null;
  const shown = await git(dir, ['show', `${REMOTE_REF}:lock.json`], env);
  if (shown.code !== 0) return null;
  try {
    const lock = JSON.parse(shown.stdout);
    return lock && typeof lock === 'object' ? lock : null;
  } catch {
    return null;
  }
}

// Puts the local lock branch level with the fetched remote, or empties it when the remote has none.
async function resetToRemote(dir, present, env) {
  if (present) {
    await git(dir, ['checkout', '-q', '-B', LOCK_BRANCH, REMOTE_REF], env);
    await git(dir, ['reset', '-q', '--hard', REMOTE_REF], env);
  } else {
    await git(dir, ['update-ref', '-d', `refs/heads/${LOCK_BRANCH}`], env);
    fs.rmSync(path.join(dir, 'lock.json'), { force: true });
    await git(dir, ['rm', '-q', '--cached', '--ignore-unmatch', '--', 'lock.json'], env);
  }
}

async function commitAndPush(dir, lock, message, push, env) {
  fs.writeFileSync(path.join(dir, 'lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  for (const args of [['add', '--', 'lock.json'], ['commit', '-q', '-m', message]]) {
    const r = await git(dir, args, env);
    if (r.code !== 0) throw new Error('The lock could not be written');
  }
  let result;
  try {
    result = await push(dir, LOCK_BRANCH);
  } catch {
    throw new Error('The lock could not be pushed');
  }
  return result ?? { ok: false };
}

export async function readLock({ project, env }) {
  const dir = await ensureClone(project, env);
  return readRemoteLock(dir, await fetchRemote(dir, env), env);
}

export async function takeLock({ project, push, now = () => new Date(), env }) {
  const me = computerId();
  const dir = await ensureClone(project, env);
  const present = await fetchRemote(dir, env);
  const current = await readRemoteLock(dir, present, env);
  const at = now();
  if (current && current.computer !== me) {
    const last = Date.parse(current.lastWriteAt);
    if (Number.isFinite(last) && at.getTime() - last < STALE_AFTER_MS) {
      return { taken: false, holder: current.computer, since: current.lastWriteAt };
    }
  }
  await resetToRemote(dir, present, env);
  const counter = (Number.isInteger(current?.counter) ? current.counter : 0) + 1;
  const stamp = at.toISOString();
  const lock = { computer: me, counter, takenAt: stamp, lastWriteAt: stamp };
  const result = await commitAndPush(dir, lock, `Take the lock, counter ${counter}`, push, env);
  if (result.ok) {
    fs.mkdirSync(path.dirname(heldFile(project)), { recursive: true });
    fs.writeFileSync(heldFile(project), `${JSON.stringify({ counter })}\n`);
    return { taken: true, counter };
  }
  const nowPresent = await fetchRemote(dir, env).catch(() => present);
  await resetToRemote(dir, nowPresent, env);
  if (result.rejected === 'non-fast-forward') {
    const winner = await readRemoteLock(dir, nowPresent, env);
    return { taken: false, holder: winner?.computer ?? 'unknown', since: winner?.lastWriteAt ?? '' };
  }
  throw new Error('The lock could not be pushed');
}

export async function touchLock({ project, push, now = () => new Date(), env }) {
  const me = computerId();
  const dir = await ensureClone(project, env);
  const present = await fetchRemote(dir, env);
  const current = await readRemoteLock(dir, present, env);
  const held = heldCounter({ project });
  if (!current || current.computer !== me || held === null || current.counter !== held) return { touched: false };
  await resetToRemote(dir, present, env);
  const lock = { ...current, lastWriteAt: now().toISOString() };
  const result = await commitAndPush(dir, lock, `Keep the lock, counter ${held}`, push, env);
  if (result.ok) return { touched: true };
  const nowPresent = await fetchRemote(dir, env).catch(() => present);
  await resetToRemote(dir, nowPresent, env);
  if (result.rejected === 'non-fast-forward') return { touched: false };
  throw new Error('The lock could not be pushed');
}

export async function holdsLock({ project, counter, env }) {
  try {
    const me = computerId();
    const dir = await ensureClone(project, env);
    const current = await readRemoteLock(dir, await fetchRemote(dir, env), env);
    const held = heldCounter({ project });
    if (!current || current.computer !== me || (held !== null && current.counter !== held)) {
      if (held !== null) clearHeld(project);
    }
    return Boolean(current) && current.computer === me && current.counter === counter;
  } catch {
    return false;
  }
}
