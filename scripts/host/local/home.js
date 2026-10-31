// scripts/host/local/home.js
// A project in git alone keeps its history in a home: a bare repository at <wheelhouseHome>/projects/<project>/home.git, a full
// copy made from the project's folder, which only the helper writes (spec 5.1). The sandbox denies ~/.wheelhouse to every
// agent, so the main version there is the truth. A mark inside it names this computer: no other can reach the home, so the
// mark stands where a hosted project has its lock branch (spec 7.3), and a home copied elsewhere reads as not held.
import fs from 'node:fs';
import path from 'node:path';
import { computerId, stateDir } from '../../lib/paths.js';
import { gitIn } from '../../lib/local-git.js';
import { run as realRun } from '../../lib/run.js';

const MARK = 'wheelhouse-home.json';
const HOME_WHAT = 'this project\'s home';
const FOLDER_WHAT = 'the project\'s folder';
// A branch's name as git keeps it, written so it can never be read as an option or a revision.
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]+(?<![/.])$/;

export const isBranchName = (branch) => typeof branch === 'string' && BRANCH.test(branch) && !branch.endsWith('.lock');

export const projectFolder = (project) => path.join(stateDir(project), '..');
export const homeDir = (project) => path.join(projectFolder(project), 'home.git');

// How git reaches this computer's repositories, for the steps here to take as `git`: `git(folder, options)` is gitIn.
export const gitRoute = ({ run = realRun } = {}) => (cwd, options = {}) => gitIn(cwd, { run, ...options });
// The home is Wheelhouse's own repository, so the strict list reads it. Git looks upwards from a folder that isn't a repository,
// so a damaged home is refused here, never left to land in whatever repository holds it.
export function homeGit(project, git) {
  const home = homeDir(project);
  if (!['HEAD', 'objects', 'refs'].every((name) => fs.existsSync(path.join(home, name)))) line('This project\'s home can\'t be read');
  return git(home, { list: 'own', what: HOME_WHAT });
}

const line = (text) => { throw new Error(text); };

// Makes the home from `folder`, once: it is built under another name and renamed when whole, so a failure leaves none. Its
// default branch is `branch`, or the one the folder is on. It has no link back: no remote, and no object it shares with the
// folder. Gives { made }, false when this computer's home is already there.
export async function makeHome({ project, folder, branch, git = gitRoute() }) {
  const home = homeDir(project);
  if (homeReadable(project)) return { made: false };
  if (fs.existsSync(home)) line('A home for this project is here already, from another computer, so it was left as it is');
  if (branch !== undefined && !isBranchName(branch)) line('That branch\'s name can\'t be used for the main version');
  fs.mkdirSync(path.dirname(home), { recursive: true });
  const part = fs.mkdtempSync(path.join(path.dirname(home), 'home-part-'));
  const made = path.join(part, 'home.git');
  try {
    // No template: nothing of this computer's git templates lands in the home.
    await git(folder, { reach: 'local', what: FOLDER_WHAT, refuse: () => line('The project\'s history could not be copied') })
      .must(['clone', '--bare', '--no-hardlinks', '--template=', '--quiet', folder, made], 'copy');
    if (fs.existsSync(path.join(made, 'shallow'))) line('The project\'s folder holds only part of its history, so a full copy can\'t be made');
    const inHome = git(made, { reach: 'local', what: HOME_WHAT, refuse: () => line('The project\'s history could not be copied') });
    // A folder that borrows objects from another repository hands the borrowing on: the home takes its own.
    const borrowed = path.join(made, 'objects', 'info', 'alternates');
    if (fs.existsSync(borrowed)) {
      await inHome.must(['repack', '-a', '-d', '-q'], 'copy');
      fs.rmSync(borrowed);
    }
    await inHome.must(['config', '--remove-section', 'remote.origin'], 'copy');
    if (branch !== undefined) {
      await inHome.must(['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`], 'copy');
      await inHome.must(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], 'copy');
    }
    fs.writeFileSync(path.join(made, MARK), `${JSON.stringify({ computer: computerId() })}\n`, { mode: 0o600 });
    fs.chmodSync(made, 0o700);
    fs.renameSync(made, home);
  } finally {
    fs.rmSync(part, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  return { made: true };
}

// Whether this computer holds the project's home: its mark names this computer.
export function homeReadable(project) {
  try {
    return JSON.parse(fs.readFileSync(path.join(homeDir(project), MARK), 'utf8'))?.computer === computerId();
  } catch {
    return false;
  }
}
