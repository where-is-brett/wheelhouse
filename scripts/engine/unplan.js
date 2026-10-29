// scripts/engine/unplan.js
// The small lane's step before review (Archon design, section 7.2): takes the plan file out in its own commit, so the
// reviews and the pull request hold the change alone and the plan never reaches the main line. A run carried on over
// the branch still finds the plan in the branch's history (plan-file.js). The commit is the branch's own author's when
// the worktree has no git identity. It prints { removed }; run again, it changes nothing.
//   node scripts/engine/unplan.js --base <ref>
import fs from 'node:fs';
import path from 'node:path';
import { run as defaultRun } from '../lib/run.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { PLAN_FILE } from './plan-file.js';

export const UNPLAN_MESSAGE = 'Take out the build plan';

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run = defaultRun } = {}) {
  if (!runArg(argv, '--base')) {
    out('usage: node scripts/engine/unplan.js --base <ref>');
    return 2;
  }
  if (!fs.existsSync(path.join(cwd, PLAN_FILE))) {
    out(JSON.stringify({ removed: false }));
    return 0;
  }
  const git = (...args) => run('git', args, { cwd, timeoutMs: 30000 });
  const who = [];
  if ((await git('config', 'user.email')).code !== 0) {
    const author = (await git('log', '-1', '--format=%an%n%ae')).stdout.trim().split('\n');
    if (author.length === 2) who.push('-c', `user.name=${author[0]}`, '-c', `user.email=${author[1]}`);
  }
  const removed = await git('rm', '-q', '--', PLAN_FILE);
  const committed = removed.code === 0 ? await git(...who, 'commit', '-q', '-m', UNPLAN_MESSAGE, '--', PLAN_FILE) : removed;
  if (committed.code !== 0) {
    out(`The plan couldn't be taken out: ${String(committed.stderr ?? '').trim() || 'git refused'}`);
    return 1;
  }
  out(JSON.stringify({ removed: true }));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
