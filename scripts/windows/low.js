// scripts/windows/low.js
// Guarded, the low-integrity level for build commands on Windows (design section 12.2), on the
// normal-level side: the copy of Node.js labelled low that the runner (guarded.js) is started
// from, the labels on a feature's worktree so a low build can work there, the "no read up" lock
// on the helper's keys and the credential folders where Windows allows one, the runner's command
// (the one allow rule), and the self-test that says whether Guarded holds on this computer. It
// uses only Node.js, icacls and whoami: no administrator, nothing installed. Every icacls call
// and the low copy itself go through `run` (scripts/lib/run.js), and each Windows program is
// System32's own (windowsTool): with no SystemRoot to find it by, nothing is labelled.
//
// The copy of node.exe is made outside any session's budget: run as a program, this file makes
// it (copyLowNode), which the session start starts in the background when there is no complete
// copy (scripts/hooks/session-start.js).
//
// What check 52 (docs/checks/52-low-integrity.md) settles is held in the constants below, set
// for the design's expected answers until the director's Windows sitting gives the real ones.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandPath } from '../lib/command-path.js';
import { credentialPaths } from '../lib/credentials.js';
import { wheelhouseHome } from '../lib/paths.js';
import { KEPT_NORMAL, SELF_TEST_FLAG, windowsTool } from './guarded.js';
import { startedAsScript } from '../lib/started-as-script.js';

// The plugin this file sits in: scripts/windows/ is two folders down.
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RUNNER = path.join('scripts', 'windows', 'guarded.js');
export const LOW_NODE_SCRIPT = path.join('scripts', 'windows', 'low.js');

// The route that sets a "no read up" label without an administrator: null, or the call that sets
// it on one folder, `{ file, args: (folder) => [...] }`, with `file` a System32 program's name.
// Check 52 (LOCK_READS_ROUTE and LOCK_READS_CALL) tries icacls, PowerShell's Add-Type and
// node:ffi; none is confirmed yet, so nothing is locked and the Guarded card says the keys folder
// stays readable.
export const LOCK_READS_ROUTE = null;

// The plan's labels that would let local git commit from low, kept here and applied nowhere:
// the worktree's own admin folder under `<commonDir>/worktrees/` low, with its `commondir`,
// `gitdir` and `config.worktree` kept normal, and these folders of the common folder low. The
// object store and every feature's refs are shared with the main checkout and the other features,
// so until check 52 (`git-commit-low`, `label-reaches-existing-files`) shows a commit at low can
// be kept to one feature, Guarded labels only the worktree, and local git stays out of the runner:
// it is asked for and granted as at Ask (scripts/windows/guarded.js refuses it).
export const PLAN_GIT_LOW_LABELS = Object.freeze({
  adminFolder: '(OI)(CI)L',
  adminKeptNormal: Object.freeze(['commondir', 'gitdir', 'config.worktree']),
  commonFolders: Object.freeze([['objects'], ['refs', 'heads', 'feature'], ['logs', 'refs', 'heads', 'feature']]),
});

// Whether each label is put on what is already in a folder with `/T /C /Q` as well as set to be
// inherited. Check 52 (`label-reaches-existing-files`) says whether the plain call reaches files
// already there; the design expects it does.
export const LABEL_EXISTING = false;

// In the worktree, what stays at the normal level after the worktree is labelled low, so a build
// can't plant a hook or a setting: a folder with inheritance, a file on its own (KEPT_NORMAL,
// guarded.js, whose self-test tries each). The folders are made, empty, when they aren't there,
// so the name can't later be made at low. A missing .mcp.json isn't made: it would show in git
// and be committed (Ruling 30). So a build can make one at low during a run; the next labelling
// finds it low, puts it back at the normal level and that run asks, and until then
// `enableAllProjectMcpServers: false` in the Standard settings keeps its servers from starting
// unapproved. Check 52's note holds the question.
const KEPT_NORMAL_FOLDERS = KEPT_NORMAL.folders;
const KEPT_NORMAL_FILES = KEPT_NORMAL.files;

// How long the self-test has at a session start before it is counted as not ready, and how long
// a result counts.
export const SELF_TEST_MS = 3000;
export const SELF_TEST_DAY_MS = 24 * 60 * 60 * 1000;
const KEYS_MARKER = 'guarded-selftest-marker.txt';
// The self-test's scratch folders, in `<home>/windows`, labelled as a worktree is.
const SCRATCH_PREFIX = 'guarded-scratch-';
// A temporary copy, or a scratch folder, older than this was left by one that stopped part-way.
const LEFTOVER_MS = 10 * 60 * 1000;

export const lowNodePath = (home) => path.join(home, 'windows', 'low-node', 'node.exe');
export const selfTestFile = (home) => path.join(home, 'windows', 'guarded-selftest.json');

const lstatOf = (file) => {
  try {
    return fs.lstatSync(file);
  } catch {
    return null;
  }
};

// icacls, System32's own, or a throw when Windows' folder can't be known.
function icaclsOf(env) {
  const tool = windowsTool('icacls', env);
  if (tool === null) throw new Error('SystemRoot isn\'t a full path to Windows\' folder, so icacls can\'t be found safely');
  return tool;
}

// Runs icacls with `args`, or throws.
async function icacls(run, args, env, what) {
  const tool = icaclsOf(env);
  let result;
  try {
    result = await run(tool, args);
  } catch (error) {
    throw new Error(`icacls couldn't be started for ${what}: ${error.message}`);
  }
  if (result?.code !== 0) {
    const said = `${result?.stdout ?? ''} ${result?.stderr ?? ''}`.replace(/\s+/g, ' ').trim();
    throw new Error(`icacls refused ${what}${said ? `: ${said}` : ''}`);
  }
  return result;
}

// Sets the integrity label `spec` on `target` with icacls, or throws.
async function label(run, target, spec, env) {
  await icacls(run, [target, ...(LABEL_EXISTING ? ['/T', '/C', '/Q'] : []), '/setintegritylevel', spec], env, `to label ${target} ${spec}`);
}

// Whether icacls shows `target` labelled low: its Mandatory Label line names the low level.
async function labelledLow(run, target, env) {
  const result = await icacls(run, [target], env, `to show ${target}'s label`);
  return /Mandatory Label\\Low Mandatory Level/i.test(`${result.stdout ?? ''}`);
}

// Whether a complete copy of Node.js is there: a file the size of `execPath`.
export function lowNodeReady({ home, execPath = process.execPath }) {
  const have = lstatOf(lowNodePath(home));
  try {
    return have?.isFile() === true && have.size === fs.statSync(execPath).size;
  } catch {
    return false;
  }
}

// Makes the copy of Node.js the runner starts from: `execPath` to a temporary name beside
// `<home>/windows/low-node/node.exe`, renamed into place when it is whole, after removing
// temporary copies left by a copy that stopped part-way. Nothing to do when a complete copy is
// there. It takes as long as it takes, so it runs in the background, never in a session's budget.
export function copyLowNode({ home, execPath = process.execPath, now = () => new Date() }) {
  const copy = lowNodePath(home);
  const dir = path.dirname(copy);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (!/^node\.exe\.[0-9a-f]+\.tmp$/.test(name)) continue;
    const old = path.join(dir, name);
    try {
      if (now().getTime() - fs.statSync(old).mtimeMs > LEFTOVER_MS) fs.rmSync(old, { force: true });
    } catch { /* gone already */ }
  }
  if (lowNodeReady({ home, execPath })) return copy;
  const have = lstatOf(copy);
  if (have !== null && !have.isFile()) fs.rmSync(copy, { recursive: true, force: true });
  const temp = `${copy}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.copyFileSync(execPath, temp);
    fs.renameSync(temp, copy);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return copy;
}

// The copy of Node.js labelled low: a complete copy (copyLowNode) labelled low with icacls. Only
// the copy is labelled; its folder stays at the normal level, so a low process can't add files
// beside it. Resolves with the copy's path; rejects when there is no complete copy, or it can't be
// labelled.
export async function lowNode({ run, home, execPath = process.execPath, env = process.env }) {
  if (!lowNodeReady({ home, execPath })) throw new Error('There is no complete copy of Node.js to label low yet');
  const copy = lowNodePath(home);
  await label(run, copy, 'L', env);
  return copy;
}

// The real path of `p`, or null.
const realOf = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};

// Throws unless `worktree` is a linked worktree of the project whose common folder is `commonDir`:
// its `.git` file points into `<commonDir>/worktrees/`. Nothing outside the project is labelled.
function checkWorktree(worktree, commonDir) {
  const refuse = () => { throw new Error(`${worktree} isn't a linked worktree of this project, so it isn't labelled`); };
  if (typeof worktree !== 'string' || !path.isAbsolute(worktree) || typeof commonDir !== 'string') refuse();
  const dot = path.join(worktree, '.git');
  if (!lstatOf(dot)?.isFile()) refuse();
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dot, 'utf8'));
  const admin = pointer ? realOf(path.resolve(worktree, pointer[1])) : null;
  const common = realOf(commonDir);
  if (admin === null || common === null || path.dirname(admin) !== path.join(common, 'worktrees')) refuse();
}

// Labels `folder` low, inherited by what is in it, and each entry kept at the normal level that is
// there back at the normal level. Rejects at the first label refused.
async function labelKeepingNormal(folder, { run, env }) {
  await label(run, folder, '(OI)(CI)L', env);
  for (const name of [...KEPT_NORMAL_FILES, ...KEPT_NORMAL_FOLDERS]) {
    const target = path.join(folder, name);
    const stat = lstatOf(target);
    if (stat === null) continue;
    await label(run, target, stat.isDirectory() ? '(OI)(CI)M' : 'M', env);
  }
}

// Labels a feature's worktree for Guarded, before each run there: the worktree low, inherited by
// what is in it, and its .git file, .claude, .mcp.json and .vscode at the normal level. A missing
// .claude or .vscode is made, empty, first; a missing .mcp.json isn't (KEPT_NORMAL_FILES says
// why). Only the worktree is labelled (PLAN_GIT_LOW_LABELS says why): the common folder, its
// hooks and config included, never is. A .mcp.json found labelled low (made at low since the last
// run) is put back at the normal level and the labelling then rejects, so that run gets the Ask
// rules. Rejects, at the first label refused, when any can't be set.
export async function labelWorktree(worktree, { run, commonDir, env = process.env }) {
  checkWorktree(worktree, commonDir);
  icaclsOf(env);
  for (const name of [...KEPT_NORMAL_FOLDERS, ...KEPT_NORMAL_FILES]) {
    if (lstatOf(path.join(worktree, name))?.isSymbolicLink()) throw new Error(`${path.join(worktree, name)} is a link, so the worktree isn't labelled`);
  }
  const mcp = path.join(worktree, '.mcp.json');
  const mcpWasLow = lstatOf(mcp) !== null && await labelledLow(run, mcp, env);
  for (const name of KEPT_NORMAL_FOLDERS) {
    if (lstatOf(path.join(worktree, name)) === null) fs.mkdirSync(path.join(worktree, name));
  }
  await labelKeepingNormal(worktree, { run, env });
  if (mcpWasLow) throw new Error(`${mcp} was labelled low, so a build may have written it; it is back at the normal level, and this run asks`);
}

// Sets a "no read up" label on each of `paths` by `route` (LOCK_READS_ROUTE). `{ held: true }`
// only when there is a route and every call succeeded; `{ held: false }` where the computer has no
// route, and nothing is run.
export async function lockReads(paths, { run, route = LOCK_READS_ROUTE, env = process.env }) {
  if (route === null || !Array.isArray(paths) || paths.length === 0) return { held: false };
  let held = true;
  for (const folder of paths) {
    try {
      const tool = windowsTool(route.file, env);
      if (tool === null) return { held: false };
      const result = await run(tool, route.args(folder));
      if (result?.code !== 0) held = false;
    } catch {
      held = false;
    }
  }
  return { held };
}

// The command a feature session runs a build command through at Guarded, and the prefix of its
// one allow rule: the low copy of node.exe and the runner, each as an allow rule writes a path.
export function guardedCommand({ home, pluginRoot = PLUGIN_ROOT, platform = process.platform }) {
  const join = platform === 'win32' ? path.win32.join : path.join;
  return `${commandPath(join(home, 'windows', 'low-node', 'node.exe'), { platform })} ${commandPath(join(pluginRoot, RUNNER), { platform })}`;
}

// The helper's keys folder and the credential folders of design section 12.2 that are on this
// computer, for the "no read up" lock.
function readLockedPaths(home, homeDir) {
  const credentials = credentialPaths('win32').map((c) => path.join(homeDir, ...c.split('/'))).filter((p) => lstatOf(p) !== null);
  return [path.join(home, 'keys'), ...credentials];
}

// The last line of `stdout` that is a JSON object, or null.
function lastJson(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const value = JSON.parse(lines[i]);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* not the one */ }
  }
  return null;
}

const NOT_READY = Object.freeze({ lowStarts: false, writeHeld: false, keysReadHeld: false });

// A scratch folder in `<home>/windows` (never in the project), labelled as labelWorktree labels a
// worktree: the folder low, and in it a .git file, .claude, .mcp.json and .vscode, each at the
// normal level. Scratch folders left by a self-test that stopped part-way are removed first.
async function scratchWorktree({ run, home, env, now }) {
  const dir = path.join(home, 'windows');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(SCRATCH_PREFIX)) continue;
    const old = path.join(dir, name);
    try {
      if (now().getTime() - fs.lstatSync(old).mtimeMs > LEFTOVER_MS) fs.rmSync(old, { recursive: true, force: true });
    } catch { /* gone already */ }
  }
  const scratch = path.join(dir, `${SCRATCH_PREFIX}${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(scratch);
  try {
    for (const name of KEPT_NORMAL_FOLDERS) fs.mkdirSync(path.join(scratch, name));
    for (const name of KEPT_NORMAL_FILES) fs.writeFileSync(path.join(scratch, name), `A stand-in for a worktree's ${name}, for the Guarded self-test.\n`);
    await labelKeepingNormal(scratch, { run, env });
    return scratch;
  } catch (error) {
    fs.rmSync(scratch, { recursive: true, force: true });
    throw error;
  }
}

async function tryGuarded({ run, home, worktree, pluginRoot, execPath, env, homeDir, timeoutMs, now }) {
  const node = await lowNode({ run, home, execPath, env });
  const keys = path.join(home, 'keys');
  fs.mkdirSync(keys, { recursive: true });
  await lockReads(readLockedPaths(home, homeDir), { run, env });
  const marker = path.join(keys, KEYS_MARKER);
  fs.writeFileSync(marker, 'A marker for the Guarded self-test: a build at low integrity should not be able to read it.\n');
  let scratch = null;
  try {
    scratch = await scratchWorktree({ run, home, env, now });
    const result = await run(node, [path.join(pluginRoot, RUNNER), SELF_TEST_FLAG, home, marker, scratch], { cwd: worktree ?? home, timeoutMs });
    const seen = lastJson(result?.stdout);
    if (result?.code !== 0 || seen?.low !== true) return { ...NOT_READY };
    // The write is held only when the write outside and every try on the kept entries were refused.
    return { lowStarts: true, writeHeld: seen.writeHeld === true && seen.keptHeld === true, keysReadHeld: seen.readHeld === true };
  } finally {
    if (scratch !== null) {
      try {
        fs.rmSync(scratch, { recursive: true, force: true });
      } catch { /* the next self-test removes it */ }
    }
  }
}

// Writes a self-test result where guardedReady reads it.
function writeSelfTest(home, result) {
  const file = selfTestFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(result)}\n`);
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// The self-test: makes the low copy, locks reads of the helper's keys folder and the credential
// folders where Windows allows it, places a marker beside the helper's keys, makes a scratch
// folder in `<home>/windows` labelled as a worktree is (scratchWorktree), then starts the runner
// from the low copy, which checks it is low, tries to write in `<home>`, to read the marker, and
// to write into, rename and remove each entry kept at the normal level in the scratch folder. The
// scratch folder is removed afterwards. `writeHeld` is true only when the write in `<home>` and
// every one of those tries were refused. Resolves with `{ at, lowStarts, writeHeld, keysReadHeld }`,
// written to `<home>/windows/guarded-selftest.json`. One that can't finish within `timeoutMs` is
// not ready (`timedOut: true`, so the next session start tries again), and so is one that fails.
export async function selfTest({
  run, home, worktree, now = () => new Date(), pluginRoot = PLUGIN_ROOT, execPath = process.execPath, env = process.env,
  homeDir = os.homedir(), timeoutMs = SELF_TEST_MS,
}) {
  const at = now().toISOString();
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ ...NOT_READY, timedOut: true }), timeoutMs); });
  const tried = tryGuarded({ run, home, worktree, pluginRoot, execPath, env, homeDir, timeoutMs, now }).catch(() => ({ ...NOT_READY }));
  const found = await Promise.race([tried, late]);
  clearTimeout(timer);
  const result = { at, ...found };
  try {
    writeSelfTest(home, result);
  } catch { /* unread, it counts as not ready */ }
  return result;
}

// The latest self-test result when it is under a day old at `now` (and not from a time to come),
// on Windows; null otherwise, and for anything missing or unreadable.
export function readSelfTest({ home, now = () => new Date(), platform = process.platform } = {}) {
  if (platform !== 'win32' || typeof home !== 'string') return null;
  try {
    const file = selfTestFile(home);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 4096) return null;
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (kept === null || typeof kept !== 'object' || Array.isArray(kept) || typeof kept.at !== 'string') return null;
    const age = now().getTime() - Date.parse(kept.at);
    if (!(age >= 0 && age < SELF_TEST_DAY_MS)) return null;
    return {
      at: kept.at, lowStarts: kept.lowStarts === true, writeHeld: kept.writeHeld === true, keysReadHeld: kept.keysReadHeld === true, timedOut: kept.timedOut === true,
    };
  } catch {
    return null;
  }
}

// Whether Guarded holds on this computer: a self-test under a day old found the runner low, a
// write outside the worktree refused, and the entries kept at the normal level in a folder
// labelled as a worktree is held against a write, a rename and a removal.
export function guardedReady(options) {
  const result = readSelfTest(options);
  return result !== null && result.lowStarts && result.writeHeld;
}

// What the Guarded card (GUARDED_CARD) and the Unattended card's Use Guarded are told of a
// self-test result: the write held only where the runner started at low.
export function guardedCardInput(result) {
  return { writesHeld: result?.lowStarts === true && result?.writeHeld === true, readsHeld: result?.keysReadHeld === true };
}

// Whether a session start should run the self-test again: none under a day old, or the last ran
// out of time.
export function needsSelfTest({ home, now = () => new Date() } = {}) {
  const result = readSelfTest({ home, now, platform: 'win32' });
  return result === null || result.timedOut;
}

// Run as a program (the session start starts it in the background): makes the copy of Node.js.
if (startedAsScript(import.meta.url)) {
  try {
    copyLowNode({ home: wheelhouseHome() });
  } catch {
    process.exitCode = 1;
  }
}
