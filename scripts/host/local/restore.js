// scripts/host/local/restore.js
// A project brought back from its backup (spec 8.1), on a computer with no home for it: the file is read whole, the home is made
// from it under another name and renamed when whole, with this computer's mark, so a damaged backup leaves nothing. A folder
// that is empty then gets the main version. One that holds anything is left as it is.
import fs from 'node:fs';
import path from 'node:path';
import { homeBranch, homeDir, homeReadable, gitRoute, isBranchName, markHome } from './home.js';
import { BACKUP_END, MAIN_MARK } from './backup.js';
import { FOLDER_REMOTE } from './folder.js';

export const UNREADABLE_LINE = 'That backup could not be read, so nothing was brought back';

// The project a backup file is of, by its name.
export const projectOfBackup = (file) => path.basename(file, BACKUP_END);

// A typed answer as a backup file's full path, as a file dragged into the chat writes it, or null.
export function backupNamed(text) {
  if (typeof text !== 'string') return null;
  const said = text.trim().replace(/^(['"])(.*)\1$/, '$2').replace(/\\ /g, ' ');
  return said.endsWith(BACKUP_END) && (path.isAbsolute(said) || path.win32.isAbsolute(said)) ? said : null;
}

const hasNothing = (folder) => fs.readdirSync(folder).length === 0;

async function makeFromBackup({ file, project, git }) {
  const home = homeDir(project);
  fs.mkdirSync(path.dirname(home), { recursive: true });
  const part = fs.mkdtempSync(path.join(path.dirname(home), 'home-part-'));
  const made = path.join(part, 'home.git');
  const refuse = () => { throw new Error(UNREADABLE_LINE); };
  try {
    await git(part, { reach: 'local', list: 'own', what: 'the backup', refuse }).must(['clone', '--bare', '--no-hardlinks', '--template=', '--quiet', file, made], 'copy');
    const inHome = git(made, { reach: 'local', list: 'own', what: 'this project\'s home', refuse });
    await inHome.must(['bundle', 'verify', '--quiet', file], 'verify');
    const heads = await inHome.must(['bundle', 'list-heads', file], 'main');
    const branch = heads.split('\n').map((head) => head.split(' ')[1] ?? '').find((ref) => ref.startsWith(MAIN_MARK))?.slice(MAIN_MARK.length);
    if (!isBranchName(branch)) refuse();
    await inHome.must(['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`], 'main');
    await inHome.must(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], 'main');
    await inHome.must(['config', '--remove-section', 'remote.origin'], 'copy');
    markHome(made);
    fs.chmodSync(made, 0o700);
    fs.renameSync(made, home);
  } finally {
    fs.rmSync(part, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

// The main version into a folder with no git: git starts there on the home's branch, and it is checked out over the folder,
// which `isEmpty` has said holds nothing of the director's. A failure leaves no git behind.
async function fillFolder({ project, folder, git }) {
  const branch = homeBranch(project);
  const dotGit = path.join(folder, '.git');
  const here = git(folder, { reach: 'local', what: 'the project\'s folder', refuse: () => { throw new Error('The project couldn\'t be put in this folder'); } });
  try {
    await here.must(['init', '-q', '-b', branch], 'init');
    await here.must(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', homeDir(project), `+refs/heads/${branch}:refs/remotes/${FOLDER_REMOTE}/${branch}`], 'fetch');
    // The checkout writes over what is in its way: step 1's settings may go, and nothing else of the folder's.
    const tracked = await here.must(['ls-tree', '-r', '--name-only', `refs/remotes/${FOLDER_REMOTE}/${branch}`, '--', '.claude'], 'read');
    const held = tracked.split(/\r?\n/).filter((file) => file !== '' && file !== '.claude/settings.json' && fs.existsSync(path.join(folder, ...file.split('/'))));
    if (held.length > 0) throw new Error(`This folder holds files of its own (${held.slice(0, 5).join(', ')}), so the project wasn't put over them`);
    await here.must(['checkout', '-q', '-f', '-B', branch, `refs/remotes/${FOLDER_REMOTE}/${branch}`], 'checkout');
  } catch (error) {
    fs.rmSync(dotGit, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    throw error;
  }
}

// restoreProject -> the project's name. `project` is the name to keep it under, the file's by default. Safe to repeat.
export async function restoreProject({ file, folder, project = projectOfBackup(file), git = gitRoute(), isEmpty = hasNothing }) {
  if (!homeReadable(project)) {
    if (fs.existsSync(homeDir(project))) throw new Error('A home for this project is here already, so it was left as it is');
    await makeFromBackup({ file, project, git });
  }
  if (!fs.existsSync(path.join(folder, '.git')) && isEmpty(folder)) await fillFolder({ project, folder, git });
  return project;
}
