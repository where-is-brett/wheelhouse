// scripts/watcher/control-files.js
// The files in a feature's folder that steer agents, checked before every wake (design section 6.2,
// ruling P7-13), for every agent. A hook or instruction file a build plants, or one it changes, could
// steer or switch off the guards of the session woken next, so the watcher wakes no session whose
// folder holds such a file that is new or changed since the folder was made.
//
// What is read: every path in the worktree matching AGENT_CONTROL (scripts/lib/agent-control.js),
// under `.claude/` (but not `.claude/worktrees/`), or named CLAUDE.md, CLAUDE.local.md or .mcp.json
// in any folder (ruling P7-33: the check's own list, not AGENT_CONTROL), each mapped to the sha256
// of its bytes. The walk uses `fs` alone, never git, since the folder is one an agent controls. It
// skips the feature's own `.wheelhouse/` folder, and every `.git` and `node_modules` folder that
// isn't inside a folder that steers agents (packages ship their own AGENTS.md and .github/, which
// agents don't take instructions from unless working inside them; inside `.claude/` or `.github/`
// such a folder is one like any other). A path reached through a link is read where it really is:
// it maps to `link:<real path>:<hash>`, or to `dangling` when the link leads nowhere. A folder
// reached through a link is walked under that link's name, every time it is reached: only a folder
// already twice on the way down from the root (a loop) is not entered again, and WALK_CAP bounds
// the rest. Anything that isn't a regular file maps to `special`.
//
// Between the check and the session's start, a process an earlier session left running could still
// write; the tool guard and the sandbox are the first line against that, and this check the second.
//
// The record of the files as the folder was made (the baseline) is kept where no session can reach
// it, in <home>/projects/<p>/watcher/control/<work>.json, written by the foreman's start straight
// after the worktree is made (scripts/foreman/act.js).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AGENT_CONTROL } from '../lib/agent-control.js';
import { SLUG } from '../lib/build-loop.js';
import { stateDir } from '../lib/paths.js';
import { matchGlob } from '../gate/glob.js';

// The paths under `.claude/` steer Claude Code; its worktrees folder holds other features' folders.
const CLAUDE_FOLDER = '.claude/**';
const NOT_CONTROL = '.claude/worktrees/**';
// Claude Code's own instruction and connector files, in any folder: checked here, though agents may write them.
const CHECKED_TOO = Object.freeze(['**/CLAUDE.md', '**/CLAUDE.local.md', '**/.mcp.json']);
// The folders that steer agents, as prefixes: inside one, a `.git` or `node_modules` folder is walked.
const CONTROL_FOLDERS = Object.freeze([...new Set(['.claude', '.github', '.agents',
  ...AGENT_CONTROL.filter((p) => p.endsWith('/**') && !p.startsWith('**/')).map((p) => p.slice(0, -3))])]);
// The most entries one walk reads before it gives up: a folder that large is refused, not woken.
export const WALK_CAP = 200000;
const CHUNK = 64 * 1024;
const SMALL_BYTES = 8 * 1024 * 1024;

// The walk's refusal of a folder with more than WALK_CAP entries: the wake waits, with its card.
export class TooManyFiles extends Error {}

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function lstatOf(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

// Whether `rel` (from the worktree's root, with `/`) names a file that steers agents. Names are
// matched in any case on macOS and Windows, whose file systems take them so.
export function isControlPath(rel, { platform = process.platform } = {}) {
  const ignoreCase = platform === 'darwin' || platform === 'win32';
  if (matchGlob(NOT_CONTROL, rel, { ignoreCase })) return false;
  return [CLAUDE_FOLDER, ...AGENT_CONTROL, ...CHECKED_TOO].some((p) => matchGlob(p, rel, { ignoreCase }));
}

// Whether `rel` lies inside a folder that steers agents.
function insideControlFolder(rel, platform) {
  const ignoreCase = platform === 'darwin' || platform === 'win32';
  const fold = (x) => (ignoreCase ? x.toLowerCase() : x);
  return CONTROL_FOLDERS.some((f) => fold(rel).startsWith(`${fold(f)}/`));
}

// The sha256 of a regular file's bytes, or `special` when it isn't one. Opened without waiting, so
// a pipe put in a file's place can't hold the watcher up.
function hashOf(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
  } catch (error) {
    if (error.code === 'ENOENT') return 'dangling';
    throw error;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) return 'special';
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(CHUNK);
    for (;;) {
      const n = fs.readSync(fd, buffer, 0, CHUNK, null);
      if (n === 0) break;
      hash.update(buffer.subarray(0, n));
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

// The files that steer agents in `worktree`, as a Map from each path (from the root, with `/`) to
// the sha256 of its bytes, `link:<real path>:<hash>` for one reached through a link, `dangling` or
// `special`. Read with `fs` only. Throws when the folder can't be read or holds over WALK_CAP entries.
export function controlFilesState(worktree, { platform = process.platform, walkCap = WALK_CAP } = {}) {
  const root = fs.realpathSync.native(worktree);
  const state = new Map();
  let entries = 0;
  const control = (rel) => isControlPath(rel, { platform });
  const skipped = (name, rel) => rel === '.wheelhouse' || ((name === '.git' || name === 'node_modules') && !insideControlFolder(rel, platform));
  // The real folders on the way down to the one being walked, so a loop ends: a folder is entered
  // again only while it is on that way at most once (a link to the root, say, is walked once under
  // its own name).
  const onTheWay = [root];
  const timesOnTheWay = (real) => onTheWay.filter((d) => d === real).length;
  const enter = (dir, prefix, throughLink) => {
    onTheWay.push(dir);
    try {
      walk(dir, prefix, throughLink);
    } finally {
      onTheWay.pop();
    }
  };

  const walk = (dir, prefix, throughLink) => {
    for (const name of fs.readdirSync(dir).sort()) {
      entries += 1;
      if (entries > walkCap) throw new TooManyFiles(`the folder holds over ${walkCap} entries`);
      const rel = prefix === '' ? name : `${prefix}/${name}`;
      if (skipped(name, rel)) continue;
      const full = path.join(dir, name);
      const stat = lstatOf(full);
      if (stat === null) continue; // gone while it was read
      if (stat.isSymbolicLink()) {
        let real;
        try {
          real = fs.realpathSync.native(full);
        } catch {
          if (control(rel)) state.set(rel, 'dangling');
          continue;
        }
        const target = lstatOf(real);
        if (target?.isDirectory()) {
          if (timesOnTheWay(real) >= 2) continue; // a loop
          enter(real, rel, true);
        } else if (control(rel)) {
          state.set(rel, `link:${real}:${hashOf(real)}`);
        }
      } else if (stat.isDirectory()) {
        enter(full, rel, throughLink);
      } else if (control(rel)) {
        const hash = hashOf(full);
        state.set(rel, throughLink ? `link:${full}:${hash}` : hash);
      }
    }
  };
  walk(root, '', false);
  return state;
}

// --- The baseline ---

export function controlDir(project) {
  return path.join(path.dirname(stateDir(project)), 'watcher', 'control');
}

export function baselineFile(project, work) {
  if (typeof work !== 'string' || !SLUG.test(work)) throw new Error('A work id is lower-case letters, digits and hyphens');
  return path.join(controlDir(project), `${work}.json`);
}

const raisedFile = (project, work) => path.join(controlDir(project), `${work}.raised.json`);

// Makes the control folder, refusing any part of it that is there but isn't a real folder.
function controlFolder(project) {
  const dir = controlDir(project);
  for (const d of [path.dirname(dir), dir]) {
    const before = lstatOf(d);
    if (before !== null && !before.isDirectory()) throw new Error("The watcher's control folder isn't a real folder");
    if (before === null) fs.mkdirSync(d, { recursive: true });
    if (!lstatOf(d)?.isDirectory()) throw new Error("The watcher's control folder isn't a real folder");
  }
  return dir;
}

function writeWhole(file, value) {
  const stat = lstatOf(file);
  if (stat !== null && !stat.isFile()) throw new Error(`${path.basename(file)} isn't a regular file`);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID().slice(0, 12)}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value)}\n`, { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function readSmall(file) {
  const stat = lstatOf(file);
  if (stat === null || !stat.isFile() || stat.size > SMALL_BYTES) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Records the agent files of `worktree` as the baseline of the feature `work`: as they are now, or
// as `state` (a Map controlFilesState gave) says, so what is kept is what the director was shown.
export function writeBaseline(project, work, worktree, { now = () => new Date(), platform = process.platform, state = null } = {}) {
  const file = baselineFile(project, work);
  const files = Object.fromEntries(state ?? controlFilesState(worktree, { platform }));
  controlFolder(project);
  writeWhole(file, { v: 1, worktree: path.resolve(worktree), at: now().toISOString(), files });
  return file;
}

// The feature's baseline, { files: Map, at }, or null when there is none for this worktree, or it can't be read.
function baselineOf(project, work, worktree) {
  const kept = readSmall(baselineFile(project, work));
  if (!isPlain(kept) || kept.v !== 1 || !isPlain(kept.files) || typeof kept.worktree !== 'string' || typeof kept.at !== 'string') return null;
  if (kept.worktree !== path.resolve(worktree)) return null;
  if (!Object.values(kept.files).every((v) => typeof v === 'string')) return null;
  return { files: new Map(Object.entries(kept.files)), at: kept.at };
}

// The feature's baseline as a Map, or null when there is none for this worktree, or it can't be read.
export function readBaseline(project, work, worktree) {
  return baselineOf(project, work, worktree)?.files ?? null;
}

// The paths of `state` that are new or changed since `baseline`, in order. A path that has gone
// steers nothing, so it doesn't count.
export function changedPaths(baseline, state) {
  return [...state].filter(([p, value]) => baseline.get(p) !== value).map(([p]) => p).sort();
}

const hashOfText = (text) => crypto.createHash('sha256').update(text).digest('hex');

// How the feature's folder stands before a wake: { ok: true } when its agent files match the
// baseline; otherwise { ok: false, why, paths, hash, state, since }. `why` is `changed` (the new or
// changed `paths`), `no-record` (no baseline for this worktree) or `too-many` (over WALK_CAP
// entries). `hash` names what was found, so the same finding is raised once and the director's
// Keep line names it; `state` is the files as found (null for too-many), to be kept as they were
// shown; `since` is when the baseline was kept (null without one). Throws when the folder can't be read.
export function checkControlFiles(project, work, worktree, { platform = process.platform, walkCap = WALK_CAP } = {}) {
  const where = path.resolve(worktree);
  const baseline = baselineOf(project, work, worktree);
  const since = baseline?.at ?? null;
  let state;
  try {
    state = controlFilesState(worktree, { platform, walkCap });
  } catch (error) {
    if (!(error instanceof TooManyFiles)) throw error;
    return { ok: false, why: 'too-many', paths: [], hash: hashOfText(`too many files\n${where}`), state: null, since };
  }
  if (baseline === null) {
    return { ok: false, why: 'no-record', paths: [], hash: hashOfText(`no record\n${where}\n${JSON.stringify([...state])}`), state, since };
  }
  const paths = changedPaths(baseline.files, state);
  if (paths.length === 0) return { ok: true };
  return { ok: false, why: 'changed', paths, hash: hashOfText(JSON.stringify(paths.map((p) => [p, state.get(p)]))), state, since };
}

// The watcher's own last finding raised for the feature, { hash, why, paths, at }, as it raised
// it, or null. Kept here, under the home, so the Keep a director confirms is matched against what
// the watcher found and said, never against a record in the state.
export function raisedOf(project, work) {
  const kept = readSmall(raisedFile(project, work));
  if (!isPlain(kept) || typeof kept.hash !== 'string' || typeof kept.why !== 'string' || typeof kept.at !== 'string') return null;
  if (!Array.isArray(kept.paths) || !kept.paths.every((p) => typeof p === 'string')) return null;
  return { hash: kept.hash, why: kept.why, paths: kept.paths, at: kept.at };
}

// Keeps `raised` ({ hash, why, paths, at }) as the feature's last finding raised, or (null) clears
// it once its files match again.
export function markRaised(project, work, raised) {
  const file = raisedFile(project, work);
  if (raised === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  controlFolder(project);
  writeWhole(file, raised);
}
