// scripts/lib/paths.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSmallText } from './small-file.js';

const SAFE_PART = /^[A-Za-z0-9._-]+$/;

// The project's own `env.WHEELHOUSE_HOME`, from its `.claude/settings.local.json`, for a process of a Claude Code
// session that did not get the variable (Claude Desktop on Windows may not pass a project's settings env to
// every script it starts). Only the local settings file, which belongs to this computer and which the guard keeps
// agents from writing; only a full path; only the session's own project folder (CLAUDE_PROJECT_DIR, or the
// working folder of a process Claude Code started), never a folder above it. Null when it names none.
const settingsHomes = new Map();
function settingsHome() {
  const dir = process.env.CLAUDE_PROJECT_DIR || (process.env.CLAUDECODE ? process.cwd() : '');
  if (!dir || !path.isAbsolute(dir)) return null;
  const file = path.join(dir, '.claude', 'settings.local.json');
  let stamp;
  try {
    const stat = fs.statSync(file);
    stamp = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
  const kept = settingsHomes.get(file);
  if (kept?.stamp === stamp) return kept.home;
  let home = null;
  try {
    const given = JSON.parse(readSmallText(file) ?? 'null')?.env?.WHEELHOUSE_HOME;
    if (typeof given === 'string' && path.isAbsolute(given)) home = given;
  } catch {
    // Not JSON: no home from it.
  }
  settingsHomes.set(file, { stamp, home });
  return home;
}

// The Wheelhouse home this process was given, if any: WHEELHOUSE_HOME in its environment, else the project's own
// settings (above). Null for the default home.
export function givenHome() {
  return process.env.WHEELHOUSE_HOME || settingsHome();
}

// The folder holding everything Wheelhouse keeps on this computer.
export function wheelhouseHome() {
  return givenHome() || path.join(os.homedir(), '.wheelhouse');
}

// Where the build engine's own programs live: its Archon binary, the pinned Bun and the gh broker.
export function engineDir() {
  return path.join(wheelhouseHome(), 'engine');
}

// The engine's own home (ARCHON_HOME), outside the Wheelhouse home so Archon's database and logs never
// sit in the record's folder. By default `.wheelhouse-engine` in the user's home folder; where a
// WHEELHOUSE_HOME is given (an evaluation run, a test) it is a sibling of that home, so such a run never
// reaches the real one.
export function archonHome() {
  const given = givenHome();
  return given
    ? `${path.resolve(given)}-engine`
    : path.join(os.homedir(), '.wheelhouse-engine');
}

// An eight-hex-character ID for this computer, made once and then kept.
// Events carry this, never the computer's name.
export function computerId() {
  const file = path.join(wheelhouseHome(), 'computer.json');
  const readKept = () => {
    try {
      const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof kept?.id === 'string' && /^[0-9a-f]{8}$/.test(kept.id)) return kept.id;
    } catch {
      // Missing or unreadable.
    }
    return null;
  };
  const kept = readKept();
  if (kept) return kept;
  const id = crypto.randomBytes(4).toString('hex');
  const body = `${JSON.stringify({ id })}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    try {
      // Exclusive create, so two processes starting together agree on one ID.
      fs.writeFileSync(file, body, { flag: 'wx' });
      return id;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const winner = readKept();
      if (winner) return winner;
    }
  }
  fs.writeFileSync(file, body); // present but malformed: replace it
  return id;
}

// `owner__name`, refusing anything outside [A-Za-z0-9._-] and the dot-only names.
export function projectSlug(owner, name) {
  for (const part of [owner, name]) {
    if (typeof part !== 'string' || !SAFE_PART.test(part) || /^\.+$/.test(part)) {
      throw new Error('A project owner or name may use only letters, digits, dots, hyphens and underscores');
    }
  }
  return `${owner}__${name}`;
}

// The folder holding one folder per project registered on this computer.
export function projectsDir() {
  return path.join(wheelhouseHome(), 'projects');
}

function projectFolder(project) {
  if (typeof project !== 'string' || !SAFE_PART.test(project) || /^\.+$/.test(project)) {
    throw new Error('A project folder name may use only letters, digits, dots, hyphens and underscores');
  }
  return path.join(projectsDir(), project);
}

// The project's private record (design section 24.1): a git repository on this computer with no
// remote, whose events are committed and never pushed.
export function stateDir(project) {
  return path.join(projectFolder(project), 'record');
}

// Where Wheelhouse v0.1.x kept the project's state: a clone of the state branch, or a project's
// own repository. Read only by the import (scripts/state/import.js), never written or removed.
export function oldStateDir(project) {
  return path.join(projectFolder(project), 'state');
}

export function keysDir() {
  return path.join(wheelhouseHome(), 'keys');
}

// The director's personal settings on this computer (design section 24.2): a git repository with no
// remote, laid out as a project's record is.
export function profileDir() {
  return path.join(wheelhouseHome(), 'settings');
}

// Where Wheelhouse v0.1.x kept its clone of the profile repository. Read only by the import.
export function oldProfileDir() {
  return path.join(wheelhouseHome(), 'profile');
}

// Counts of use: sessions, models, kinds and times, never content.
export function usageDir() {
  return path.join(wheelhouseHome(), 'usage');
}

// The copies of the sources Wheelhouse watches.
export function sourcesDir() {
  return path.join(wheelhouseHome(), 'sources');
}

// Records of the background jobs.
export function jobsDir() {
  return path.join(wheelhouseHome(), 'jobs');
}

// The views built from the profile's events, beside the profile.
export function profileViewsDir() {
  return path.join(wheelhouseHome(), 'profile-views');
}

// While this file exists, STOP is on.
export function stopFile() {
  return path.join(wheelhouseHome(), 'STOP');
}

// One marker file per session in bypass mode, named by the session's ID.
export function bypassDir() {
  return path.join(wheelhouseHome(), 'bypass');
}

// The working folder a detached job (the helper, the receiver, the watcher, a background job) is started
// in: the user's own home folder, which nothing of Wheelhouse's removes. Never the Wheelhouse home: on
// Windows a folder that is a running program's working folder can't be removed, so a job working there
// would stop uninstall, or a test, from removing it. The jobs name every file by its whole path.
export function jobFolder() {
  return os.homedir();
}

// The helper's running record: its pid, start time, version, plugin folder and address, kept while it runs.
export function helperRecordFile() {
  return path.join(wheelhouseHome(), 'helper.json');
}

// The helper's socket file in `home`, or on Windows its named pipe. A pipe is one per computer, not
// per folder, so the pipe of a home other than ~/.wheelhouse (an evaluation run's, a test's) carries
// a short hash of that home's path, as its socket would be a file of that home's own.
export function helperAddress({ platform = process.platform, user = os.userInfo().username, home = wheelhouseHome() } = {}) {
  if (platform === 'win32') {
    const spelt = (dir) => path.win32.resolve(dir).toLowerCase();
    const own = spelt(home) === spelt(path.join(os.homedir(), '.wheelhouse'))
      ? '' : `-${crypto.createHash('sha256').update(spelt(home)).digest('hex').slice(0, 12)}`;
    return `\\\\.\\pipe\\wheelhouse-${String(user).replace(/[^A-Za-z0-9_.-]/g, '_')}${own}-helper`;
  }
  return path.join(home, 'helper.sock');
}
