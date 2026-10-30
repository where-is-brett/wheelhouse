// scripts/engine/unplan.js
// The small lane's step before review (Archon design, section 7.2): takes the plan file out in its own commit, so the
// reviews and the pull request hold the change alone and the plan never reaches the main line. A run carried on over
// the branch still finds the plan in the branch's history (plan-file.js). The commit is the branch's own author's when
// the worktree names no git identity. Git runs behind Wheelhouse's fence (safe-git.js), since the worktree is one an
// agent controls. It prints { removed }; run again, it changes nothing.
//   node scripts/engine/unplan.js --base <ref>
import fs from 'node:fs';
import path from 'node:path';
import { run as defaultRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { PLAN_FILE } from './plan-file.js';

export const UNPLAN_MESSAGE = 'Take out the build plan';

// The environment that commits as the branch's last author when the worktree names no git identity: the fence shuts
// out the global config. `git` is a fenced git.
export async function authorEnv(git) {
  if ((await git(['config', 'user.email'])).code === 0) return {};
  const [name, email] = String((await git(['log', '-1', '--format=%an%n%ae'])).stdout ?? '').trim().split('\n');
  return name && email ? { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email } : {};
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run = defaultRun } = {}) {
  if (!runArg(argv, '--base')) {
    out('usage: node scripts/engine/unplan.js --base <ref>');
    return 2;
  }
  if (!fs.existsSync(path.join(cwd, PLAN_FILE))) {
    out(JSON.stringify({ removed: false }));
    return 0;
  }
  // The fence alone: the worktree's own settings are an agent's to write, and nothing here runs its hooks or filters.
  const fenced = safeGit({ run, cwd, look: 'never', timeoutMs: 30000 });
  const git = (args, options) => fenced(args, options);
  const env = await authorEnv(git);
  const removed = await git(['rm', '-q', '--', PLAN_FILE]);
  const committed = removed.code === 0 ? await git(['commit', '-q', '-m', UNPLAN_MESSAGE, '--', PLAN_FILE], { env }) : removed;
  if (committed.code !== 0) {
    out(`The plan couldn't be taken out: ${String(committed.stderr ?? '').trim() || 'git refused'}`);
    return 1;
  }
  out(JSON.stringify({ removed: true }));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
