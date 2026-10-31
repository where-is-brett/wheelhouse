// scripts/host/local/backup.js
// The second copy of a project kept on this computer (spec 8.1): one file, `<project>.wheelhouse-backup`, a git bundle of the
// home, in a folder the director picks. A bundle is one file, so a sync service can't corrupt it the way it can a live
// repository. It is written beside its old copy and read back whole before the old one goes, since `git bundle verify` reads
// only the head of the file and passes one cut short. One earlier copy is kept. The private record never goes in it: it isn't in
// the home, and Wheelhouse's own branches, which a folder that once sat on a host may carry, are left out. `backup.json` beside
// the home says where the backups go and how the last try went. A drive that isn't plugged in is no fault.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { realOrNull } from '../../lib/local-git.js';
import { readProject } from '../../lib/projects.js';
import { run as realRun } from '../../lib/run.js';
import { gitRoute, homeDir, homeGit, projectFolder } from './home.js';

const RECORD = 'backup.json';
export const BACKUP_END = '.wheelhouse-backup';
const EARLIER_END = '.earlier';
const PART_END = '.part';
const DAY_MS = 24 * 60 * 60 * 1000;
const TOOL_WAIT_MS = 10 * 1000;
const PICK_WAIT_MS = 10 * 60 * 1000;
// Wheelhouse's own lines of work, never the project's history.
const OWN_LINE = /^refs\/heads\/wheelhouse[-/]/;
// Folders a cloud service keeps. They sit on this computer's disk, and the service sends what lands there off it (spec 8.1).
const KEPT_BY_CLOUD = /^(?:Library\/CloudStorage\/|Library\/Mobile Documents\/|iCloud Drive(?:\/|$)|Dropbox(?:\/|$| )|Google Drive(?:\/|$| )|GoogleDrive-|OneDrive(?:\/|$| )|Box(?:\/|$| ))/;

export const NOT_CHECKED_LINE = 'The new backup couldn\'t be checked, so the last good one was kept';
export const SAME_DISK_LINE = 'That folder is on the same disk as the project, so it would go with this computer';
export const INSIDE_LINE = 'That folder is inside the project, so it would go with this computer';
export const NO_FOLDER_LINE = 'That folder can\'t be found';

export const backupRecord = (project) => path.join(projectFolder(project), RECORD);
export const backupFile = (folder, project) => path.join(folder, `${project}${BACKUP_END}`);
export const earlierFile = (folder, project) => `${backupFile(folder, project)}${EARLIER_END}`;

const NO_BACKUP = Object.freeze({ folder: null, at: null, main: null, failedAt: null, triedAt: null, away: false, refused: null, pickRefused: null });

// How backups stand: { folder, at, main, failedAt, triedAt, away, refused, pickRefused }. `at` and `main` are the last backup
// written and read back, `failedAt` a try since that failed its check, `refused` why the folder no longer counts, and
// `pickRefused` why the one last picked didn't.
export function readBackup(project) {
  try {
    const kept = JSON.parse(fs.readFileSync(backupRecord(project), 'utf8'));
    return { ...NO_BACKUP, ...kept };
  } catch {
    return { ...NO_BACKUP };
  }
}

function keepBackup(project, changes) {
  const file = backupRecord(project);
  const part = `${file}.${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(part, `${JSON.stringify({ ...readBackup(project), ...changes }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(part, file);
}

function isDirectory(folder) {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

const insideOf = (root, place) => {
  const from = path.relative(root, place);
  return from === '' || (!from.startsWith('..') && !path.isAbsolute(from));
};
function keptByCloud(place, userHome) {
  const home = realOrNull(userHome);
  if (home === null || !insideOf(home, place)) return false;
  return KEPT_BY_CLOUD.test(path.relative(home, place).split(path.sep).join('/'));
}

// Whether `folder` counts as a place for this project's backup: not inside the project, and off its disk, or kept by a cloud
// service. `root` is the project's folder, for a project not registered yet. { ok } or { ok: false, why }.
export function backupPlace({ folder, project, root = readProject(project)?.folder, stat = fs.statSync, userHome = os.homedir() }) {
  const place = typeof folder === 'string' && path.isAbsolute(folder) ? realOrNull(folder) : null;
  if (place === null || !isDirectory(place)) return { ok: false, why: NO_FOLDER_LINE };
  const own = realOrNull(root);
  if (own === null) return { ok: false, why: 'The project\'s folder can\'t be found' };
  if (insideOf(own, place)) return { ok: false, why: INSIDE_LINE };
  if (stat(place).dev === stat(own).dev && !keptByCloud(place, userHome)) return { ok: false, why: SAME_DISK_LINE };
  return { ok: true };
}

// The director's choice of folder, once it counts. A new folder holds nothing yet, so the next try writes there.
export function chooseBackupFolder({ project, folder, ...how }) {
  const place = backupPlace({ folder, project, ...how });
  if (!place.ok) return place;
  keepBackup(project, { folder: realOrNull(folder), at: null, main: null, failedAt: null, triedAt: null, away: false, refused: null, pickRefused: null });
  return { ok: true };
}

// Why the folder last picked didn't count, for the row to say until another is chosen. The folder in use stays as it was.
export function noteBackupFolderRefused(project, why) {
  keepBackup(project, { pickRefused: why });
}

// Reads the file back whole: `bundle verify`, then a full copy, which fails on anything cut short or damaged. Gives the main
// version it holds, which must be one the home has.
async function readBack({ project, file, git }) {
  const home = git(homeDir(project), { list: 'own', reach: 'local', what: 'this project\'s home', refuse: () => { throw new Error(NOT_CHECKED_LINE); } });
  await home.must(['bundle', 'verify', '--quiet', file], 'verify');
  const dir = fs.mkdtempSync(path.join(projectFolder(project), 'backup-check-'));
  try {
    const copy = path.join(dir, 'copy.git');
    await home.must(['clone', '--bare', '--no-hardlinks', '--template=', '--quiet', file, copy], 'copy');
    const main = await git(copy, { list: 'own', what: 'the new backup', refuse: () => { throw new Error(NOT_CHECKED_LINE); } }).must(['rev-parse', '--verify', '-q', 'HEAD^{commit}'], 'main');
    await home.must(['cat-file', '-e', `${main}^{commit}`], 'main');
    return main;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

// Writes the backup: { written, verifiedAt, main }, { skipped: 'away' } for a folder that isn't here, { skipped: 'place', why }
// for one that doesn't count, or { failed } with the old copy left as it was.
export async function writeBackup({ project, folder, git = gitRoute(), now = () => new Date(), ...how }) {
  if (!isDirectory(folder)) return { skipped: 'away' };
  const place = backupPlace({ folder, project, ...how });
  if (!place.ok) return { skipped: 'place', why: place.why };
  const file = backupFile(folder, project);
  const part = `${file}${PART_END}`;
  try {
    const home = homeGit(project, git);
    const listed = await home.must(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags'], 'list');
    const refs = listed.split('\n').filter((ref) => ref !== '' && !OWN_LINE.test(ref));
    await home.must(['bundle', 'create', '--quiet', part, 'HEAD', ...refs], 'create');
    const main = await readBack({ project, file: part, git });
    if (fs.existsSync(file)) fs.renameSync(file, earlierFile(folder, project));
    fs.renameSync(part, file);
    return { written: file, verifiedAt: now().toISOString(), main };
  } catch {
    fs.rmSync(part, { force: true });
    return { failed: NOT_CHECKED_LINE };
  }
}

// One try at the folder the director chose, and what it came to, for the status to read. Gives writeBackup's answer.
export async function backUp({ project, git = gitRoute(), now = () => new Date(), ...how }) {
  const { folder } = readBackup(project);
  if (folder === null) return { skipped: 'none' };
  const triedAt = now().toISOString();
  const got = await writeBackup({ project, folder, git, now, ...how });
  if (got.written !== undefined) keepBackup(project, { at: got.verifiedAt, main: got.main, failedAt: null, triedAt, away: false, refused: null });
  else if (got.failed !== undefined) keepBackup(project, { failedAt: triedAt, triedAt, away: false, refused: null });
  else keepBackup(project, { triedAt, away: got.skipped === 'away', refused: got.why ?? null });
  return got;
}

// Whether the daily try should write: there is something new, and either a day has passed, or the drive that was away is back.
export function backupDue({ project, main, now = () => new Date() }) {
  const kept = readBackup(project);
  if (kept.folder === null || kept.main === main) return false;
  if (kept.away) return isDirectory(kept.folder);
  const tried = Date.parse(kept.triedAt);
  return Number.isNaN(tried) || now().getTime() - tried >= DAY_MS;
}

const THE_DATE = /(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/;

// Whether Time Machine has a destination, and when it last finished: `last` is null where it can't be read, which asks for
// Full Disk Access on most Macs. Only macOS has it.
export async function timeMachine({ run = realRun, platform = process.platform } = {}) {
  const off = { on: false, last: null };
  if (platform !== 'darwin') return off;
  const ask = async (word) => {
    try {
      return await run('tmutil', [word], { timeoutMs: TOOL_WAIT_MS });
    } catch {
      return null;
    }
  };
  const destination = await ask('destinationinfo');
  if (destination?.code !== 0 || !/^\s*(?:Name|ID)\s*:/m.test(String(destination.stdout))) return off;
  const latest = await ask('latestbackup');
  const found = latest?.code === 0 ? THE_DATE.exec(String(latest.stdout)) : null;
  if (found === null) return { on: true, last: null };
  const [, year, month, day, hour, minute, second] = found.map(Number);
  return { on: true, last: new Date(year, month - 1, day, hour, minute, second).toISOString() };
}

const PICK_WORDS = 'Choose a folder for this project\'s backup: an external drive, or a folder a cloud service keeps.';
const WINDOWS_PICK = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${PICK_WORDS.replace(/'/g, '\'\'')}'; if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }`;

// The system's own window for picking a folder: its path, or null when it is closed or this system has none.
export async function pickFolder({ run = realRun, platform = process.platform } = {}) {
  const asked = {
    darwin: ['osascript', ['-e', `POSIX path of (choose folder with prompt "${PICK_WORDS}")`]],
    win32: ['powershell.exe', ['-NoProfile', '-STA', '-Command', WINDOWS_PICK]],
  }[platform];
  if (asked === undefined) return null;
  try {
    const got = await run(asked[0], asked[1], { timeoutMs: PICK_WAIT_MS });
    const folder = String(got.stdout ?? '').trim().replace(/(?<=.)[/\\]$/, '');
    return got.code === 0 && folder !== '' ? folder : null;
  } catch {
    return null;
  }
}
