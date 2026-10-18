// scripts/state/clone.js
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';
import { takeStartLock } from '../lib/start-lock.js';
import { git, sameRemote } from './git.js';

export const STATE_BRANCH = 'wheelhouse-state';

const README = `<!-- README.md -->
# Wheelhouse state

This branch holds Wheelhouse's event log: small files under \`events/\`, one per event.
It has no source code. Do not edit these files by hand.
`;

// 'ours' for a clone of this remote's state branch; 'half-made' for one a crash cut
// short (no remote, or no copy of the remote's state branch); 'unreadable' when git cannot
// read the clone's settings; 'other' for any other.
async function kindOfClone(dir, remoteUrl, env) {
  const origin = await git(dir, ['config', '--get', 'remote.origin.url'], env);
  // git config exits 1 when the setting is simply not there; any other failure is a broken config.
  if (origin.code !== 0 && origin.code !== 1) return 'unreadable';
  if (origin.code !== 0 || !origin.stdout.trim()) return 'half-made';
  if (!sameRemote(origin.stdout.trim(), remoteUrl)) return 'other';
  const branch = await git(dir, ['symbolic-ref', '--short', 'HEAD'], env);
  if (branch.code !== 0 || branch.stdout.trim() !== STATE_BRANCH) return 'other';
  const tracked = await git(dir, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${STATE_BRANCH}`], env);
  return tracked.code === 0 ? 'ours' : 'half-made';
}

// Tries to start the branch here. Returns true when it is pushed, false when the push
// was rejected (another computer may have started it first). Leaves nothing behind on failure.
async function startBranch(dir, remoteUrl, env) {
  const steps = [
    ['init'],
    ['symbolic-ref', 'HEAD', `refs/heads/${STATE_BRANCH}`],
    ['remote', 'add', 'origin', remoteUrl],
  ];
  for (const args of steps) {
    if ((await git(dir, args, env)).code !== 0) return false;
  }
  fs.writeFileSync(path.join(dir, 'README.md'), README);
  for (const args of [['add', '--', 'README.md'], ['commit', '-m', 'Start the state branch'], ['push', '-u', 'origin', STATE_BRANCH]]) {
    if ((await git(dir, args, env)).code !== 0) return false;
  }
  return true;
}

// Clones only the state branch into the project's state folder, or makes the branch
// as an orphan with a README (pushed with plain `git push`) when the remote has none.
// A folder that already holds a clone of this remote's state branch is reused (an interrupted
// rebase is aborted first); any other clone is refused and left alone; a folder with no clone is cleared. A failed start never leaves a half-made clone: if the push loses
// a race, the folder is cleared and the winner's branch is cloned instead.
export async function cloneState({ project, remoteUrl, env }) {
  // Two calls at once on one computer (two helpers, or two sessions) take turns, so
  // the second finds the first's clone and reuses it.
  const dir = stateDir(project);
  const release = await takeStartLock(`${dir}.lock`, {
    message: 'Another start of the state clone is taking too long, so this one gave up',
    waitMs: 6 * 60 * 1000,
  });
  try {
    return await cloneStateAlone({ project, remoteUrl, env });
  } finally {
    release();
  }
}

async function cloneStateAlone({ project, remoteUrl, env }) {
  const dir = stateDir(project);
  if (fs.existsSync(path.join(dir, '.git'))) {
    // A pre-existing clone may hold committed events not yet pushed, so it is never cleared.
    const gitDir = path.join(dir, '.git');
    if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
      await git(dir, ['rebase', '--abort'], env);
    }
    const kind = await kindOfClone(dir, remoteUrl, env);
    if (kind === 'ours') return dir;
    if (kind === 'unreadable') throw new Error(`The state clone's settings can't be read, so the folder ${dir} was left alone`);
    if (kind === 'half-made') {
      throw new Error(`The folder ${dir} was left half-made when an earlier start was cut short. Delete the folder and run again.`);
    }
    throw new Error(`The folder ${dir} holds a clone that is not this project's state branch, so it was left alone`);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const listed = await git(dir, ['ls-remote', '--heads', remoteUrl, STATE_BRANCH], env);
    if (listed.code !== 0) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new Error('The state repository could not be reached');
    }
    if (listed.stdout.trim()) {
      const cloned = await git(dir, ['clone', '--single-branch', '--branch', STATE_BRANCH, '--', remoteUrl, '.'], env);
      if (cloned.code !== 0) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw new Error('The state branch could not be cloned');
      }
      return dir;
    }
    if (await startBranch(dir, remoteUrl, env)) return dir;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  throw new Error('The state branch could not be started');
}
