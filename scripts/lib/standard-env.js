// scripts/lib/standard-env.js
// The environment Wheelhouse's own background processes (the helper and each project's watcher) start with, built from
// scratch so which session started them no longer matters (design 12A.1). Nothing of the starting session's environment
// comes with it: no sign-in variable, no base address, no entry point, no stray variable of a terminal.
//
// What it holds: HOME (on Windows USERPROFILE, APPDATA, LOCALAPPDATA, SystemRoot and TEMP in its place); PATH, with the
// folder of the Node.js that runs this process and of the `claude` recorded in the home; LANG, LC_ALL and LC_CTYPE when set;
// and WHEELHOUSE_HOME, always, so the process serves one home. On Windows it holds Windows' own system settings too
// (SYSTEM_NAMES, the director's ruling of 26 November 2026): the command interpreter, the program extensions and the
// program and shared-program folders. They are set for the computer, not for a logon or a session, and without them a
// program the process starts can't find cmd.exe, the program extensions or its install folder. No user name, home drive
// or temporary folder of a logon comes with them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathWithNode, readRecordedClaude } from './claude.js';

const WINDOWS_NAMES = ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'TEMP'];
export const SYSTEM_NAMES = [
  'ComSpec', 'PATHEXT', 'windir', 'SystemDrive', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData',
  'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432', 'ALLUSERSPROFILE',
];
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
    for (const name of [...WINDOWS_NAMES, ...SYSTEM_NAMES]) {
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

// How a home is written in a lock or a record: under the person's home folder it is written from `~`, so the file names
// no user. homeOf reads it back.
export function homeLabel(home, { homedir = os.homedir() } = {}) {
  const resolved = path.resolve(home);
  const rel = path.relative(path.resolve(homedir), resolved);
  if (rel === '') return '~';
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return `~${path.sep}${rel}`;
  return resolved;
}

// The home a lock's text or a record names, or null: a lock holds the process id on its first line and the home on its
// second; a record (helper.json) holds `home`. One written from `~` is read against the person's home folder.
export function homeOf(lockOrRecord, { homedir = os.homedir() } = {}) {
  const named = typeof lockOrRecord === 'string' ? lockOrRecord.split(/\r?\n/)[1]?.trim() : lockOrRecord?.home;
  if (typeof named !== 'string' || named === '') return null;
  if (named === '~') return path.resolve(homedir);
  if (/^~[\\/]/.test(named)) return path.join(path.resolve(homedir), named.slice(2));
  return named;
}

// Whether two paths name the same folder: by their real paths where they resolve (a link is followed), and without
// telling case apart on macOS and Windows, whose usual disks don't.
export function sameFolder(a, b, { platform = process.platform } = {}) {
  const real = (p) => {
    try { return fs.realpathSync.native(p); } catch { return null; }
  };
  const fold = (p) => (platform === 'darwin' || platform === 'win32' ? p.toLowerCase() : p);
  const ra = real(a);
  const rb = real(b);
  if (ra !== null && rb !== null && fold(ra) === fold(rb)) return true;
  return fold(path.resolve(a)) === fold(path.resolve(b));
}

// Whether `home` is the default Wheelhouse home, `.wheelhouse` in the person's home folder. A link to it, or the same path
// in another case on macOS or Windows, is the default home too: a watcher of the default home never takes it for a
// throwaway one.
export function isDefaultHome(home, { homedir = os.homedir(), platform = process.platform } = {}) {
  return sameFolder(home, path.join(homedir, '.wheelhouse'), { platform });
}

// A throwaway home's processes stop an hour after the last session of that home ends (design 12A.2): a session's start,
// and its tool calls and its end (touchLastSession), record the time here, in the home, and the watcher reads it. The
// record holds the time alone.
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

// Records the time as recordLastSession does, unless a time under `gapMs` old is recorded already: a session's hooks call
// it on every tool call, so a long session keeps its home's processes running without writing at each call.
export const TOUCH_GAP_MS = 5 * 60 * 1000;
// A home that isn't there is not made again here.
export function touchLastSession(home, { now = () => new Date(), gapMs = TOUCH_GAP_MS } = {}) {
  if (!fs.existsSync(home)) return false;
  const at = lastSessionAt(home);
  if (at !== null && now().getTime() - at >= 0 && now().getTime() - at < gapMs) return false;
  return recordLastSession(home, { now });
}

// When a session of the home last ran (ms), or null when none is recorded or the record doesn't read.
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
export function throwawayIdle(home, { now = () => new Date(), homedir, platform } = {}) {
  if (isDefaultHome(home, { ...(homedir === undefined ? {} : { homedir }), ...(platform === undefined ? {} : { platform }) })) return false;
  const at = lastSessionAt(home);
  return at !== null && now().getTime() - at > THROWAWAY_IDLE_MS;
}
