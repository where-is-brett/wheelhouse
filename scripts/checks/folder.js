// scripts/checks/folder.js
// The check folder (spec 4.3): `tree` holds exactly one commit, fetched by the helper, with no link into the project, the
// home or any mirror. Its git directory, `tree.git`, sits beside it: a test may read that and never write it, so nothing
// a test leaves can steer the helper's next git call there. Every call names `tree.git` and `tree` itself, so a `.git` a
// test put in the tree is never read, and the `.git` file is written again each time.
import fs from 'node:fs';
import path from 'node:path';
import { engineDir } from '../lib/paths.js';
import { safeGit } from '../lib/safe-git.js';

const PROJECT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function checksDir() {
  return path.join(engineDir(), 'checks');
}

// Where a project's check lives. Under `~/.wheelhouse`, so every agent's denial covers it; the check's own sandbox opens
// only these folders.
export function checkPaths(project) {
  if (typeof project !== 'string' || !PROJECT.test(project)) throw new Error('A check needs a project\'s own name');
  const root = path.join(checksDir(), project);
  return { root, tree: path.join(root, 'tree'), gitDir: path.join(root, 'tree.git'), home: path.join(root, 'home'), mainHome: path.join(root, 'main-home') };
}

// The same folders by their real paths, which is how the sandbox matches them.
const realPaths = (paths) => {
  const root = fs.realpathSync(paths.root);
  return Object.fromEntries(Object.entries(paths).map(([name, p]) => [name, path.join(root, path.relative(paths.root, p))]));
};

// Empties a folder, a read-only folder inside it included. Links are removed, never followed.
function clearFolder(folder) {
  try {
    fs.rmSync(folder, { recursive: true, force: true });
    return;
  } catch { /* a read-only folder: opened below */ }
  const open = (dir) => {
    fs.chmodSync(dir, 0o700);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) open(path.join(dir, entry.name));
  };
  open(folder);
  fs.rmSync(folder, { recursive: true, force: true });
}

const must = async (git, args, what) => {
  const got = await git(args);
  if (got.code !== 0) throw new Error(`The check folder could not ${what}: ${String(got.stderr).trim()}`);
  return got;
};

// Brings the check folder to `commit`, fetched from `source`: the helper's mirror on a hosted project, the home on a local
// one, named on the command line so no remote stays configured. A path remote refuses a commit it doesn't advertise, so
// the helper writes a ref for it there first and takes it away after. A head keeps what the project's own .gitignore
// ignores, so builds reuse earlier work; a main-line check starts from an empty tree, so nothing an earlier head left can
// decide whether the main line is green. Gives the folders by their real paths.
export async function prepareFolder({ project, commit, main, source, git = safeGit }) {
  const named = checkPaths(project);
  fs.mkdirSync(named.root, { recursive: true });
  if (main) clearFolder(named.tree);
  for (const dir of [named.tree, named.home, named.mainHome]) fs.mkdirSync(dir, { recursive: true });
  const paths = realPaths(named);
  if (!fs.existsSync(path.join(paths.gitDir, 'HEAD'))) await must(git({ cwd: paths.root, reach: 'local', look: 'never' }), ['init', '-q', '--bare', paths.gitDir], 'start');
  const mark = path.join(paths.tree, '.git');
  clearFolder(mark);
  fs.writeFileSync(mark, `gitdir: ${paths.gitDir}\n`);
  const inFolder = git({ cwd: paths.gitDir, workTree: paths.tree, reach: 'local' });
  const inSource = git({ cwd: source, reach: 'local', list: 'project' });
  const ref = `refs/wheelhouse/check/${commit}`;
  await must(inSource, ['update-ref', ref, commit], `find ${commit}`);
  try {
    await must(inFolder, ['fetch', '-q', '--no-tags', source, `+${ref}:refs/wheelhouse/check`], 'fetch the commit');
  } finally {
    await inSource(['update-ref', '-d', ref]);
  }
  await must(inFolder, ['config', 'core.bare', 'false'], 'set itself up');
  await must(inFolder, ['checkout', '-q', '--force', '--detach', commit], 'check the commit out');
  await must(inFolder, ['clean', '-ffdq'], 'clean up');
  return paths;
}
