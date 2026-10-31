// scripts/checks/folder.js
// The check folders (spec 4.3): `tree` holds exactly one commit, fetched by the helper, with no link into the project, the
// home or any mirror. Its git directory, `tree.git`, sits beside it: a test may read that and never write it, so nothing
// a test leaves can steer the helper's next git call there. Every call names `tree.git` and `tree` itself, so a `.git` a
// test put in the tree is never read, and the `.git` file is written again each time.
//
// A job a test starts in a session of its own outlives its check, still holding the sandbox of that check: it can write
// what that profile names, for as long as it lives. So what a profile names decides whose checks it can reach:
// - A main-line check gets a new folder each time, its home inside it, which no earlier check's profile names, so nothing
//   left running can write it, and nothing the helper does there can be raced. It fetches its tools from nothing.
// - Each work has its own tree, git directory and home, which keep its build output between its heads. Another work's job
//   can't reach them, so it can't decide this work's check. A work's own job can, and the main line's clean check is what
//   stands behind that (spec 4.6).
// - The helper's own steps in a work's tree run in a narrow sandbox of their own (tidyProfile), so a folder swapped for a
//   link in the middle of a checkout leads nowhere.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { engineDir } from '../lib/paths.js';
import { run as realRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';

const PROJECT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function checksDir() {
  return path.join(engineDir(), 'checks');
}

const HEADS = 'heads';
const MAIN = 'main';
const SANDBOX = '/usr/bin/sandbox-exec';
const slotOf = (work) => crypto.createHash('sha256').update(String(work ?? '')).digest('hex').slice(0, 16);
const quoted = (p) => `"${String(p).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

// Where a check lives: a head's folders are its work's, and a main-line check names its own `run`. Under `~/.wheelhouse`, so
// every agent's denial covers it; the check's own sandbox opens only these folders.
export function checkPaths(project, { main = false, work = null, run = null } = {}) {
  if (typeof project !== 'string' || !PROJECT.test(project)) throw new Error('A check needs a project\'s own name');
  const root = path.join(checksDir(), project);
  const place = main ? path.join(root, MAIN, run) : path.join(root, HEADS, slotOf(work));
  return { root, tree: path.join(place, 'tree'), gitDir: path.join(place, 'tree.git'), home: path.join(place, 'home') };
}

// The sandbox of the helper's own steps in a tree something left running may still write: they can write that tree and what
// a checkout changes in the git directory, never its settings or hooks, and reach nothing else. It reads as it likes, as
// git reads nothing through a link in the tree and shows nothing it read.
export function tidyProfile({ tree, gitDir }) {
  const inGit = ['index', 'index.lock', 'HEAD', 'HEAD.lock', 'ORIG_HEAD', 'ORIG_HEAD.lock'].map((name) => `(literal ${quoted(path.join(gitDir, name))})`);
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(deny file-write*)',
    `(allow file-write* (subpath ${quoted(tree)}) (subpath ${quoted(path.join(gitDir, 'logs'))}) ${inGit.join(' ')} (literal "/dev/null"))`,
  ].join('\n');
}

// Runs a helper's step in that sandbox, on the Mac. Nowhere else does a check run, so there it is only the tests'.
const narrowed = (paths, run = realRun, platform = process.platform) => (platform !== 'darwin' ? run : (file, args, options) => run(SANDBOX, ['-p', tidyProfile(paths), file, ...args], options));

// Takes a folder away, in a sandbox that can write nothing else, so a link swapped in meanwhile leads nowhere.
async function removed(given) {
  const folder = fs.realpathSync(given);
  const step = narrowed({ tree: folder, gitDir: folder });
  const got = await step('/bin/sh', ['-c', 'chflags -R nouchg -- "$0" 2>/dev/null; chmod -R u+rwx -- "$0" 2>/dev/null; rm -rf -- "$0"', folder], {});
  if (got.code !== 0) throw new Error(`A check folder could not be taken away: ${String(got.stderr).trim()}`);
}

// Takes away the folders of every work not in `works`, once no check is running: a work's build output goes with it.
export async function sweepHeads(project, works) {
  const heads = path.join(checkPaths(project).root, HEADS);
  const open = new Set(works.map(slotOf));
  let found = [];
  try { found = fs.readdirSync(heads); } catch { return; }
  for (const slot of found) if (!open.has(slot)) await removed(path.join(heads, slot));
}

// The same folders by their real paths, which is how the sandbox matches them.
const realPaths = (paths) => {
  const root = fs.realpathSync(paths.root);
  return Object.fromEntries(Object.entries(paths).map(([name, p]) => [name, path.join(root, path.relative(paths.root, p))]));
};

// A folder of the check, where a link or a file left in its place is taken away, never followed.
export function realFolder(folder) {
  const seen = fs.lstatSync(folder, { throwIfNoEntry: false });
  if (seen && !seen.isDirectory()) fs.rmSync(folder, { force: true });
  fs.mkdirSync(folder, { recursive: true });
}

const must = async (git, args, what) => {
  const got = await git(args);
  if (got.code !== 0) throw new Error(`The check folder could not ${what}: ${String(got.stderr).trim()}`);
  return got;
};

// Brings a check folder to `commit`, fetched from `source`: the helper's mirror on a hosted project, the home on a local one,
// named on the command line so no remote stays configured. A path remote refuses a commit it doesn't advertise, so the
// helper writes a ref for it there first and takes it away after. A head keeps what the project's own .gitignore ignores,
// so builds reuse its work's earlier work; a main-line check starts in a new folder, so nothing an earlier check left can
// decide whether the main line is green. Gives the folders by their real paths.
export async function prepareFolder({ project, commit, main, work = null, source, git = safeGit, run: runner = realRun }) {
  const run = main ? crypto.randomBytes(8).toString('hex') : null;
  const named = checkPaths(project, { main, work, run });
  fs.mkdirSync(named.root, { recursive: true });
  if (main) {
    const places = path.join(named.root, MAIN);
    let earlier = [];
    try { earlier = fs.readdirSync(places); } catch { /* the first */ }
    // One that won't go holds nothing up: this check has a path of its own.
    for (const place of earlier) await removed(path.join(places, place)).catch(() => {});
  }
  for (const dir of [named.tree, named.home]) realFolder(dir);
  const paths = realPaths(named);
  if (!fs.existsSync(path.join(paths.gitDir, 'HEAD'))) await must(git({ cwd: paths.root, reach: 'local', look: 'never' }), ['init', '-q', '--bare', paths.gitDir], 'start');
  const step = narrowed(paths, runner);
  const inFolder = git({ cwd: paths.gitDir, workTree: paths.tree, reach: 'local' });
  const inTree = git({ cwd: paths.gitDir, workTree: paths.tree, reach: 'local', run: step });
  const inSource = git({ cwd: source, reach: 'local', list: 'project' });
  // `set -C`, so a link a leftover job puts here in the meantime is refused, never written through.
  const marked = await step('/bin/sh', ['-c', 'rm -rf -- "$0/.git" && set -C && printf \'gitdir: %s\\n\' "$1" > "$0/.git"', paths.tree, paths.gitDir], {});
  if (marked.code !== 0) throw new Error(`The check folder could not set itself up: ${String(marked.stderr).trim()}`);
  const ref = `refs/wheelhouse/check/${commit}`;
  await must(inSource, ['update-ref', ref, commit], `find ${commit}`);
  try {
    await must(inFolder, ['fetch', '-q', '--no-tags', source, `+${ref}:refs/wheelhouse/check`], 'fetch the commit');
  } finally {
    await inSource(['update-ref', '-d', ref]);
  }
  await must(inFolder, ['config', 'core.bare', 'false'], 'set itself up');
  await must(inTree, ['checkout', '-q', '--force', '--detach', commit], 'check the commit out');
  await must(inTree, ['clean', '-ffdq'], 'clean up');
  return paths;
}
