// scripts/lib/paths.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SAFE_PART = /^[A-Za-z0-9._-]+$/;

// The folder holding everything Wheelhouse keeps on this computer.
export function wheelhouseHome() {
  return process.env.WHEELHOUSE_HOME || path.join(os.homedir(), '.wheelhouse');
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
  return process.env.WHEELHOUSE_HOME
    ? `${path.resolve(process.env.WHEELHOUSE_HOME)}-engine`
    : path.join(os.homedir(), '.wheelhouse-engine');
}

// This computer's ID as it is kept, or null when it is missing or can't be read: makes none, for a caller the sandbox
// keeps out of the Wheelhouse home.
export function keptComputerId() {
  try {
    const kept = JSON.parse(fs.readFileSync(path.join(wheelhouseHome(), 'computer.json'), 'utf8'));
    if (typeof kept?.id === 'string' && /^[0-9a-f]{8}$/.test(kept.id)) return kept.id;
  } catch {
    // Missing or unreadable.
  }
  return null;
}

// An eight-hex-character ID for this computer, made once and then kept.
// Events carry this, never the computer's name.
export function computerId() {
  const file = path.join(wheelhouseHome(), 'computer.json');
  const kept = keptComputerId();
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
      const winner = keptComputerId();
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

// Where Wheelhouse v0.1.x kept the project's state: a clone of the state branch, or a Lean project's
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
