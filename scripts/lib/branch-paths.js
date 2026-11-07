// scripts/lib/branch-paths.js
// The paths a parked piece's branch has changed so far, read through the one git route. The dispatcher keeps those files
// back from other work while the piece waits for the director.
import { isBranchName } from '../host/local/home.js';

// Where a run keeps its own settings overlay (scripts/engine/order-copy.js): the run's, and never its work.
const OVERLAY_FILE = '.claude/settings.json';
const NO_EXTRAS = ['--no-ext-diff', '--no-textconv', '--no-renames'];

// `run(args)` the output of a git call, or a throw.
const runner = (git) => async (args) => {
  const got = await git(args);
  if (got?.code !== 0) throw new Error('git could not read that');
  return String(got.stdout ?? '');
};

async function commitOf(read, ref) {
  return (await read(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])).trim();
}

// The paths of the folder's work its commits don't show, read without taking git's lock from the run.
async function uncommitted(call, ...more) {
  const got = await call(['status', '--porcelain', '-z', '--no-renames', ...more], { env: { GIT_OPTIONAL_LOCKS: '0' } });
  if (got?.code !== 0) throw new Error('git could not read that');
  return String(got.stdout ?? '').split('\0').filter(Boolean).map((row) => row.slice(3)).filter((file) => file !== OVERLAY_FILE);
}

// Every path a parked piece's branch has changed so far: committed against the main line, plus what isn't committed, or
// null when it can't be read. `baseCommit` is the main line's head; a folder that hasn't that commit yet uses its own copy
// of the main line, since only where the branch left it matters here. It decides no gate: it only keeps files back.
export async function pathsSoFar({ folder, branch, git, baseCommit, mainBranch }) {
  if (!isBranchName(branch) || typeof folder !== 'string' || folder === '') return null;
  try {
    const { call } = git(folder);
    const read = runner(call);
    const head = await commitOf(read, `refs/heads/${branch}`);
    let base = null;
    for (const ref of [baseCommit, `refs/remotes/origin/${mainBranch}`, `refs/heads/${mainBranch}`]) {
      base = typeof ref === 'string' ? await commitOf(read, ref).catch(() => null) : null;
      if (base) break;
    }
    if (!base) return null;
    const committed = (await read(['diff', ...NO_EXTRAS, '--name-only', '-z', '--end-of-options', `${base}...${head}`, '--'])).split('\0').filter(Boolean);
    return [...new Set([...committed, ...await uncommitted(call, '--untracked-files=all')])];
  } catch {
    return null;
  }
}
