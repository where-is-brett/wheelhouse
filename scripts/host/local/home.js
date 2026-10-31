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

// The branch the home's HEAD names: the project's main line.
export function homeBranch(project) {
  return /^ref:\s*refs\/heads\/(\S+)$/.exec(fs.readFileSync(path.join(homeDir(project), 'HEAD'), 'utf8').trim())?.[1] ?? null;
}

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
    markHome(made);
    fs.chmodSync(made, 0o700);
    fs.renameSync(made, home);
  } finally {
    fs.rmSync(part, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  return { made: true };
}

// Marks the repository at `dir` as this computer's.
export function markHome(dir) {
  fs.writeFileSync(path.join(dir, MARK), `${JSON.stringify({ computer: computerId() })}\n`, { mode: 0o600 });
}

// Whether this computer holds the project's home: its mark names this computer.
export function homeReadable(project) {
  try {
    return JSON.parse(fs.readFileSync(path.join(homeDir(project), MARK), 'utf8'))?.computer === computerId();
  } catch {
    return false;
  }
}

// The weekly look at a home, in place of protection reads (spec 7.7): nobody but this computer's user can reach it, git finds
// it whole, and its main version is where the helper left it. Gives { ok } or { ok: false, why }, in plain words.
export async function lookAtHome({ project, seen = null, git = gitRoute(), platform = process.platform }) {
  const home = homeDir(project);
  let mode;
  try {
    mode = fs.statSync(home).mode;
  } catch {
    return { ok: false, why: 'it can\'t be found' };
  }
  // Windows has no such bits: a user's own folder under their home is theirs.
  if (platform !== 'win32' && (mode & 0o077) !== 0) return { ok: false, why: 'other people on this computer can reach it' };
  let inHome;
  try {
    inHome = homeGit(project, git);
  } catch (error) {
    return { ok: false, why: error.message };
  }
  if (!(await inHome.ok(['fsck', '--no-progress', '--no-dangling']))) return { ok: false, why: 'its history is damaged' };
  const main = await inHome.call(['rev-parse', '--verify', '-q', 'HEAD^{commit}']);
  if (main.code !== 0) return { ok: false, why: 'its main version can\'t be read' };
  return seen === null || String(main.stdout).trim() === seen ? { ok: true } : { ok: false, why: 'its main version moved outside the helper' };
}
