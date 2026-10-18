// scripts/state/clone.js
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';
import { git } from './git.js';

export const STATE_BRANCH = 'wheelhouse-state';

const README = `<!-- README.md -->
# Wheelhouse state

This branch holds Wheelhouse's event log: small files under \`events/\`, one per event.
It has no source code. Do not edit these files by hand.
`;

async function isStateClone(dir, remoteUrl, env) {
  if (!fs.existsSync(path.join(dir, '.git'))) return false;
  const origin = await git(dir, ['config', '--get', 'remote.origin.url'], env);
  const branch = await git(dir, ['symbolic-ref', '--short', 'HEAD'], env);
  return origin.code === 0 && origin.stdout.trim() === remoteUrl && branch.code === 0 && branch.stdout.trim() === STATE_BRANCH;
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
  const dir = stateDir(project);
  if (fs.existsSync(path.join(dir, '.git'))) {
    // A pre-existing clone may hold committed events not yet pushed, so it is never cleared.
    const gitDir = path.join(dir, '.git');
    if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
      await git(dir, ['rebase', '--abort'], env);
    }
    if (await isStateClone(dir, remoteUrl, env)) return dir;
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
