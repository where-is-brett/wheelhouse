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

export function stateDir(project) {
  if (typeof project !== 'string' || !SAFE_PART.test(project) || /^\.+$/.test(project)) {
    throw new Error('A project folder name may use only letters, digits, dots, hyphens and underscores');
  }
  return path.join(projectsDir(), project, 'state');
}

export function keysDir() {
  return path.join(wheelhouseHome(), 'keys');
}

export function profileDir() {
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
