// scripts/lib/standard-env.js
// The environment Wheelhouse's own background processes (the helper and each project's watcher) start with, built from
// scratch so which session started them no longer matters (design 12A.1). Nothing of the starting session's environment
// comes with it: no sign-in variable, no base address, no entry point, no stray variable of a terminal.
//
// What it holds: HOME (on Windows USERPROFILE, APPDATA, LOCALAPPDATA, SystemRoot and TEMP in its place); PATH, with the
// folder of the Node.js that runs this process and of the `claude` recorded in the home; LANG, LC_ALL and LC_CTYPE when set;
// and WHEELHOUSE_HOME, always, so the process serves one home.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathWithNode, readRecordedClaude } from './claude.js';

const WINDOWS_NAMES = ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'TEMP'];
const LOCALE_NAMES = ['LANG', 'LC_ALL', 'LC_CTYPE'];

// The value of a variable of `env`; on Windows the name's case is not told apart.
function valueOf(env, name, platform) {
  if (typeof env[name] === 'string' && env[name] !== '') return env[name];
  if (platform !== 'win32') return undefined;
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key !== undefined && typeof env[key] === 'string' && env[key] !== '' ? env[key] : undefined;
}

// standardEnv({ home, platform, env, claudePath, exists, execPath }) -> object
//   home        the Wheelhouse home the process serves: WHEELHOUSE_HOME in the result
//   env         the environment the values are read from (the starting process's); none of it is passed on whole
//   claudePath  the full path of `claude`, whose folder joins PATH; read from the home's claude-path.json when not given
export function standardEnv({
  home, platform = process.platform, env = process.env, claudePath, exists, execPath,
} = {}) {
  if (typeof home !== 'string' || home === '') throw new Error('A standard environment needs the Wheelhouse home it serves');
  const out = {};
  if (platform === 'win32') {
    for (const name of WINDOWS_NAMES) {
      const value = valueOf(env, name, platform);
      if (value !== undefined) out[name] = value;
    }
  } else {
    out.HOME = valueOf(env, 'HOME', platform) ?? os.homedir();
  }
  const key = platform === 'win32' ? (Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'Path') : 'PATH';
  const given = valueOf(env, 'PATH', platform) ?? '';
  const recorded = claudePath !== undefined ? claudePath : readRecordedClaude({ WHEELHOUSE_HOME: home });
  const flavour = platform === 'win32' ? path.win32 : path.posix;
  const sep = platform === 'win32' ? ';' : ':';
  let folders = given.split(sep).filter(Boolean);
  if (typeof recorded === 'string' && flavour.isAbsolute(recorded)) {
    const folder = flavour.dirname(recorded);
    if (!folders.includes(folder)) folders = [folder, ...folders];
  }
  const withNode = pathWithNode({ [key]: folders.join(sep) }, {
    platform, ...(exists ? { exists } : {}), ...(execPath ? { execPath } : {}),
  });
  out[key] = withNode[key];
  for (const name of LOCALE_NAMES) {
    const value = valueOf(env, name, platform);
    if (value !== undefined) out[name] = value;
  }
  out.WHEELHOUSE_HOME = home;
  return out;
}

// The home a lock's text or a record names, or null: a lock holds the process id on its first line and the home on its
// second; a record (helper.json) holds `home`.
export function homeOf(lockOrRecord) {
  if (typeof lockOrRecord === 'string') {
    const home = lockOrRecord.split(/\r?\n/)[1];
    return typeof home === 'string' && home.trim() !== '' ? home.trim() : null;
  }
  return typeof lockOrRecord?.home === 'string' && lockOrRecord.home !== '' ? lockOrRecord.home : null;
}

// Whether `home` is the default Wheelhouse home, `.wheelhouse` in the person's home folder.
export function isDefaultHome(home, { homedir = os.homedir() } = {}) {
  return path.resolve(home) === path.resolve(path.join(homedir, '.wheelhouse'));
}

// A throwaway home's processes stop an hour after the last session of that home ends (design 12A.2): a session's start
// records the time here, in the home, and the watcher reads it.
export const LAST_SESSION_FILE = 'last-session.json';
export const THROWAWAY_IDLE_MS = 60 * 60 * 1000;

export function recordLastSession(home, { now = () => new Date() } = {}) {
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, LAST_SESSION_FILE), `${JSON.stringify({ at: now().toISOString() })}\n`);
    return true;
  } catch {
    return false;
  }
}

// When a session of the home last started (ms), or null when none is recorded or the record doesn't read.
export function lastSessionAt(home) {
  try {
    const at = Date.parse(JSON.parse(fs.readFileSync(path.join(home, LAST_SESSION_FILE), 'utf8'))?.at);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

// Whether a throwaway home has been idle past the hour: not the default home, with a recorded session older than that.
// A home with no record is not idle: the processes are left to end by the other rules.
export function throwawayIdle(home, { now = () => new Date(), homedir } = {}) {
  if (isDefaultHome(home, homedir === undefined ? {} : { homedir })) return false;
  const at = lastSessionAt(home);
  return at !== null && now().getTime() - at > THROWAWAY_IDLE_MS;
}
