// scripts/profile/store.js
// The director's profile (design section 5.5): the settings that follow them to every
// project, as events on the `wheelhouse-profile` branch of a small private repository
// that setup makes. Each computer keeps a clone of it at ~/.wheelhouse/profile/, which
// also holds the enrolled keys (keys/, never committed) and the weekly backups of each
// project's state (backups/). Only the helper changes the clone.
import fs from 'node:fs';
import path from 'node:path';
import { profileDir, profileViewsDir, wheelhouseHome } from '../lib/paths.js';
import { takeStartLock } from '../lib/start-lock.js';
import { git, sameRemote } from '../state/git.js';
import { writeViews } from '../state/views.js';

export const PROFILE_BRANCH = 'wheelhouse-profile';

const TRACKING = `refs/remotes/origin/${PROFILE_BRANCH}`;
// Where a weekly backup sits in the profile: backups/<project>/<YYYY-MM-DD>.bundle.
export const BUNDLE_PATH = /^backups\/[A-Za-z0-9._-]+\/\d{4}-\d{2}-\d{2}\.bundle$/;
const EXCLUDE_LINE = '/keys/';
// Any user part in a scheme address (`https://<token>@host/...`, `https://user:pass@host/...`),
// except a plain user name on ssh://, which names the account and carries no key.
const CREDENTIALS = /^(?!ssh:\/\/[^/@:\s]+@)[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s]*@/i;

const README = `<!-- README.md -->
# Wheelhouse profile

This branch holds the director's profile: small files under \`events/\`, one per event,
and weekly backups of each project's state under \`backups/\`.
It has no source code. Do not edit these files by hand.
`;

// Where the profile's repository is, as setup wrote it to ~/.wheelhouse/profile.json:
// { remoteUrl, host, repo, connection }. Null while the file is missing or damaged.
export function profileRemote() {
  let found;
  try {
    found = JSON.parse(fs.readFileSync(path.join(wheelhouseHome(), 'profile.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!found || typeof found !== 'object' || Array.isArray(found)) return null;
  const { remoteUrl, host, repo, connection } = found;
  if (typeof remoteUrl !== 'string' || remoteUrl.trim() === '' || CREDENTIALS.test(remoteUrl)) return null;
  if (typeof host !== 'string' || typeof repo !== 'string' || repo === '') return null;
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)) return null;
  return { remoteUrl, host, repo, connection };
}

const step = async (dir, args, env, why) => {
  const done = await git(dir, args, env);
  if (done.code !== 0) throw new Error(why);
  return done;
};

// Adds keys/ to the clone's own exclude file, keeping whatever is there.
function excludeKeys(dir) {
  const file = path.join(dir, '.git', 'info', 'exclude');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
  if (text.split(/\r?\n/).some((line) => line.trim() === EXCLUDE_LINE)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${EXCLUDE_LINE}\n`);
}

// 'ours' for a whole clone of this remote's profile branch, 'started' for one an earlier
// start left part-way, 'other' for anything else. A clone is whole once the branch's
// upstream is set: the last step of joining the branch, or of starting it.
const MERGE_KEY = `branch.${PROFILE_BRANCH}.merge`;
async function kindOfClone(dir, remoteUrl, env) {
  const origin = await git(dir, ['config', '--get', 'remote.origin.url'], env);
  if (origin.code !== 0 && origin.code !== 1) return 'other';
  if (origin.code === 0 && origin.stdout.trim() !== '' && !sameRemote(origin.stdout.trim(), remoteUrl)) return 'other';
  const branch = await git(dir, ['symbolic-ref', '--short', 'HEAD'], env);
  if (branch.code !== 0 || branch.stdout.trim() !== PROFILE_BRANCH) return 'other';
  if (origin.code !== 0 || origin.stdout.trim() === '') return 'started';
  const tracked = await git(dir, ['rev-parse', '--verify', '-q', TRACKING], env);
  const head = await git(dir, ['rev-parse', '--verify', '-q', 'HEAD'], env);
  const upstream = await git(dir, ['config', '--get', MERGE_KEY], env);
  const whole = tracked.code === 0 && head.code === 0 && upstream.stdout.trim() === `refs/heads/${PROFILE_BRANCH}`;
  return whole ? 'ours' : 'started';
}

// Takes the remote's branch into the folder without touching the files already there:
// the branch and the index move to the remote's commit, and only the files missing from
// the folder are written out. Nothing under keys/ is ever written. Each step can be run
// again, so a join cut short is done again from the start; setting the upstream comes
// last and marks the clone as whole.
async function joinBranch(dir, env) {
  await step(dir, ['update-ref', `refs/heads/${PROFILE_BRANCH}`, TRACKING], env, 'The profile branch could not be taken in');
  await step(dir, ['reset', '-q'], env, 'The profile branch could not be taken in');
  const missing = await step(dir, ['ls-files', '--deleted', '-z'], env, 'The profile branch could not be read');
  const files = missing.stdout.split('\0').filter((f) => f !== '' && !f.startsWith('keys/'));
  // A bundle here that differs from the branch's at the same path is the same project's
  // backup of the same day from another computer: the same state, so the branch's is taken.
  const differing = await step(dir, ['diff', '--name-only', '-z'], env, 'The profile branch could not be read');
  files.push(...differing.stdout.split('\0').filter((f) => BUNDLE_PATH.test(f)));
  for (let at = 0; at < files.length; at += 100) {
    await step(dir, ['checkout', '-q', '--', ...files.slice(at, at + 100)], env, 'The profile\'s files could not be written out');
  }
  await step(dir, ['config', `branch.${PROFILE_BRANCH}.remote`, 'origin'], env, 'The profile clone could not be set up');
  await step(dir, ['config', MERGE_KEY, `refs/heads/${PROFILE_BRANCH}`], env, 'The profile clone could not be set up');
}

// Starts the branch with a README as its first commit (or the one an earlier start made
// and did not push). True when it is pushed; false when the push was refused (another
// computer may have started it first), with the commit taken back.
async function startBranch(dir, env) {
  const readme = path.join(dir, 'README.md');
  const hadReadme = fs.existsSync(readme);
  const started = (await git(dir, ['rev-parse', '--verify', '-q', 'HEAD'], env)).code === 0;
  if (!started && !hadReadme) fs.writeFileSync(readme, README);
  const committed = started || ((await git(dir, ['add', '--', 'README.md'], env)).code === 0
    && (await git(dir, ['commit', '-q', '-m', 'Start the profile branch', '--', 'README.md'], env)).code === 0);
  if (committed && (await git(dir, ['push', '-q', 'origin', `${PROFILE_BRANCH}:refs/heads/${PROFILE_BRANCH}`], env)).code === 0) {
    await git(dir, ['update-ref', TRACKING, 'HEAD'], env);
    await step(dir, ['config', `branch.${PROFILE_BRANCH}.remote`, 'origin'], env, 'The profile clone could not be set up');
    await step(dir, ['config', MERGE_KEY, `refs/heads/${PROFILE_BRANCH}`], env, 'The profile clone could not be set up');
    return true;
  }
  await git(dir, ['update-ref', '-d', `refs/heads/${PROFILE_BRANCH}`], env);
  await git(dir, ['rm', '-q', '--cached', '--ignore-unmatch', '--', 'README.md'], env);
  if (!hadReadme) fs.rmSync(readme, { force: true });
  return false;
}

// Makes profileDir() a clone of the remote's profile branch in place, keeping the files
// already there (keys/, backups/), with keys/ in the clone's info/exclude. Makes the
// branch with its first commit when the remote has none. A folder holding a clone of
// another repository or branch is left alone.
export async function ensureProfileClone({ remote, env = {} }) {
  if (!remote || typeof remote.remoteUrl !== 'string' || remote.remoteUrl === '') throw new Error('The profile isn\'t set up on this computer yet');
  const dir = profileDir();
  fs.mkdirSync(dir, { recursive: true });
  const release = await takeStartLock(`${dir}.lock`, {
    message: 'Another start of the profile clone is taking too long, so this one gave up',
    waitMs: 6 * 60 * 1000,
  });
  try {
    return await ensureAlone(dir, remote.remoteUrl, env);
  } finally {
    release();
  }
}

async function ensureAlone(dir, remoteUrl, env) {
  const gitDir = path.join(dir, '.git');
  if (fs.existsSync(gitDir)) {
    if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
      await git(dir, ['rebase', '--abort'], env);
    }
    const kind = await kindOfClone(dir, remoteUrl, env);
    if (kind === 'other') throw new Error(`The folder ${dir} holds a clone of another repository or branch, so it was left alone`);
    excludeKeys(dir);
    if (kind === 'ours') return { made: false };
  } else {
    await step(dir, ['init', '-q'], env, 'The profile clone could not be made');
    await step(dir, ['symbolic-ref', 'HEAD', `refs/heads/${PROFILE_BRANCH}`], env, 'The profile clone could not be made');
    excludeKeys(dir);
  }
  const origin = await git(dir, ['config', '--get', 'remote.origin.url'], env);
  if (origin.code !== 0 || origin.stdout.trim() === '') {
    await step(dir, ['remote', 'add', '-t', PROFILE_BRANCH, 'origin', remoteUrl], env, 'The profile clone could not be set up');
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const listed = await git(dir, ['ls-remote', '--heads', 'origin', PROFILE_BRANCH], env);
    if (listed.code !== 0) throw new Error('The profile repository could not be reached');
    if (listed.stdout.trim() !== '') {
      await step(dir, ['fetch', '-q', '--no-tags', 'origin', `+refs/heads/${PROFILE_BRANCH}:${TRACKING}`], env, 'The profile branch could not be fetched');
      await joinBranch(dir, env);
      return { made: true };
    }
    if (await startBranch(dir, env)) return { made: true };
  }
  throw new Error('The profile branch could not be started');
}

// The profile's events, built as the state's are, written whole to profileViewsDir().
export function writeProfileViews({ now = () => new Date() } = {}) {
  return writeViews(undefined, { now, dir: profileDir(), out: profileViewsDir() });
}

// The views last written, read back; null when there are none or one can't be read.
// Between the two renames of a write only the `.old` folder is there, so it is read then.
export function readProfileViews() {
  const out = profileViewsDir();
  for (const folder of [out, `${out}.old`]) {
    let names;
    try {
      names = fs.readdirSync(folder).filter((n) => n.endsWith('.json'));
    } catch {
      continue;
    }
    if (names.length === 0) return null;
    const views = {};
    try {
      for (const name of names) views[name.slice(0, -'.json'.length)] = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
    } catch {
      return null;
    }
    return views;
  }
  return null;
}
