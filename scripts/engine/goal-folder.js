// scripts/engine/goal-folder.js
// The folder a goal's checks run in (unattended goals plan, choice 11): Wheelhouse's own checkout of the main line, beside
// the merge queue's and under the engine folder, so nothing a check does reaches the project. It is made afresh each time,
// from `source`: a hosted project's fetch mirror, or the home of a project in git alone, which has no such mirror of its own.
// Archon holds the folder as a folder project, which it names after the folder, so its name is plain. Uninstall takes it away.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { engineDir } from '../lib/paths.js';
import { safeGit } from '../lib/safe-git.js';
import { run as realRun } from '../lib/run.js';

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function goalFolderOf(project, engine = engineDir()) {
  return path.join(engine, 'goal-checks', crypto.createHash('sha256').update(String(project)).digest('hex').slice(0, 16));
}

// prepareGoalFolder({ project, source, head, engine, run }) -> { ok: true, folder, head } | { ok: false, refused }
// Checks out `head`, or with none the default branch `source` names, with nothing a run before it left. The folder's
// repository names no remote and holds no settings of the project's.
export async function prepareGoalFolder({ project, source, head = null, engine = engineDir(), run = realRun } = {}) {
  if (!project || !source) return { ok: false, refused: 'a goal\'s checks need the project and where its main line is held' };
  if (head !== null && !FULL_SHA.test(head)) return { ok: false, refused: 'a goal\'s checks run on a whole commit' };
  const folder = goalFolderOf(project, engine);
  const git = (cwd) => safeGit({ run, cwd, reach: 'local', look: 'never', timeoutMs: 300000 });
  const must = async (cwd, args, why) => {
    const got = await git(cwd)(args);
    if (got.code !== 0) throw new Error(why);
    return String(got.stdout ?? '').trim();
  };
  try {
    const base = await must(source, ['symbolic-ref', '--short', 'HEAD'], 'the project\'s main line couldn\'t be named');
    if (!/^[A-Za-z0-9._/-]+$/.test(base) || base.includes('..')) throw new Error('the project\'s default branch has a name that can\'t be used');
    const tip = await must(source, ['rev-parse', '--verify', '-q', `refs/heads/${base}^{commit}`], 'the project\'s main line has no commit');
    const at = head ?? tip;
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    await must(folder, ['init', '-q'], 'the folder for the goal\'s checks could not be made');
    await must(folder, ['-c', 'protocol.file.allow=always', 'fetch', '-q', '--no-tags', '--no-recurse-submodules', source, `+refs/heads/${base}:refs/remotes/source/${base}`], 'the folder for the goal\'s checks could not be brought up to date');
    await must(folder, ['checkout', '-q', '--force', '--detach', at], 'the main line has no such commit');
    return { ok: true, folder, head: at };
  } catch (error) {
    return { ok: false, refused: error.message };
  }
}
