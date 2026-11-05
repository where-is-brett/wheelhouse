// scripts/lib/login-start.js
// The sign-in start (design section 8.5): what starts Wheelhouse's helper when the person signs in to this
// computer, for them only and with no admin. On macOS a launch agent in their own LaunchAgents folder, run at
// load and every minute after, so a helper that dies is back within one (unattended goals design, section 9.4; the
// start command leaves a running helper alone); on Windows a per-user start-up entry under HKCU's Run key, added with
// `reg add`. The install of the helper
// writes it (never on a work computer, where the company's endpoint security may treat one as suspicious), and
// uninstall removes it: only the entry it made, and only while it still holds what was written.
//
// What was written is recorded in Wheelhouse's home (login-start.json, { kind, path, content, at }), so uninstall
// knows there is one without looking through the person's own start-up items. The record is written before the
// entry, so an install cut short leaves a record uninstall can act on.
//
// launchd reads an entry only when it loads it, and holds a loaded entry whether or not its file is there. So the
// install loads the agent, a computer with another form of it has it written again and loaded again once
// (renewedEntry, reloadLoginStart), and removing the agent unloads it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run as realRun } from './run.js';
import { wheelhouseHome } from './paths.js';

export const LAUNCH_AGENT_LABEL = 'dev.wheelhouse.helper';
export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export const RUN_NAME = 'Wheelhouse helper';
const PLIST = `${LAUNCH_AGENT_LABEL}.plist`;
const KINDS = Object.freeze({ 'launch-agent': 'darwin', 'run-entry': 'win32' });
const START_EVERY_SECONDS = 60;

export const loginRecordFile = () => path.join(wheelhouseHome(), 'login-start.json');

const unsafe = (value) => new Error(`The sign-in start can't be written safely with this path: ${JSON.stringify(value)}`);

function fullPath(value, platform, what) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (typeof value !== 'string' || !p.isAbsolute(value)) throw new Error(`The sign-in start needs the full path of ${what}, and was given ${JSON.stringify(value)}`);
  if (/[\0\r\n]/.test(value)) throw unsafe(value);
  return value;
}

const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\'', '&apos;');

function plist(args) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${LAUNCH_AGENT_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...args.map((a) => `    <string>${xml(a)}</string>`),
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>StartInterval</key>',
    `  <integer>${START_EVERY_SECONDS}</integer>`,
    // The start command leaves the helper running and exits; launchd would otherwise end what it started.
    '  <key>AbandonProcessGroup</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    '  <string>/dev/null</string>',
    '  <key>StandardErrorPath</key>',
    '  <string>/dev/null</string>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

// A path in double quotes on a Windows command line; a quote inside it can't be kept, so it is refused.
function windowsQuoted(value) {
  if (/["]/.test(value)) throw unsafe(value);
  return `"${value}"`;
}

// needsLoginStart({ projects }) -> boolean
//   projects  [{ project, engine }]: each project's effective `engine` setting ('wheelhouse' or 'archon')
// Whether this computer needs the helper started at sign-in for the engine: a project builds on Archon, which
// carries on with no session open. An agent whose install makes its own sign-in start isn't asked about here.
export function needsLoginStart({ projects = [] } = {}) {
  return projects.some((p) => p?.engine === 'archon');
}

const agentsFolder = (home) => path.join(home, 'Library', 'LaunchAgents');

// Whether this process runs with a Wheelhouse home of its own (an evaluation run, a trial, a test) rather than the
// default `.wheelhouse` in the person's home folder.
function isolatedHome() {
  const given = process.env.WHEELHOUSE_HOME;
  if (!given) return false;
  return path.resolve(given) !== path.resolve(path.join(os.homedir(), '.wheelhouse'));
}

// The folder the launch agent's file goes in. The person's real LaunchAgents folder belongs to the default Wheelhouse
// home only: a process with a home of its own keeps its agent file inside that home, so a trial run can't rewrite the
// person's real one. WHEELHOUSE_LOGIN_START names another folder to hold it, for a run told to. A caller that names
// some other home folder than the person's own (a test's temporary one) gets that one's LaunchAgents folder.
export function loginAgentsFolder({ home = os.homedir() } = {}) {
  const told = process.env.WHEELHOUSE_LOGIN_START;
  if (typeof told === 'string' && told !== '' && path.isAbsolute(told)) return path.basename(told) === 'LaunchAgents' ? told : path.join(told, 'LaunchAgents');
  if (isolatedHome() && path.resolve(home) === path.resolve(os.homedir())) return path.join(wheelhouseHome(), 'LaunchAgents');
  return agentsFolder(home);
}

// Whether a call to the computer's own launchd or registry would reach the person's real sign-in start: the real
// `run`, in a process whose home isn't the default, with no folder told. Such a process only writes its files.
const reachesComputer = (run) => run === realRun && isolatedHome() && !process.env.WHEELHOUSE_LOGIN_START;

// loginEntry({ platform, node, root, script, home }) -> { kind, path, content } | null
//   node    the full path of the Node.js that runs the start command
//   root    the Wheelhouse folder (a full path)
//   script  the start command's file, relative to `root`, written with forward slashes
//   home    the person's home folder (macOS), where their LaunchAgents folder is
// Null on a system with no sign-in start known (neither macOS nor Windows).
export function loginEntry({ platform = process.platform, node = process.execPath, root, script, home = os.homedir() } = {}) {
  if (typeof script !== 'string' || script === '' || script.startsWith('/') || script.split('/').includes('..')) throw new Error('The sign-in start needs the start command\'s script, relative to the Wheelhouse folder');
  if (platform !== 'darwin' && platform !== 'win32') return null;
  fullPath(node, platform, 'Node.js');
  fullPath(root, platform, 'the Wheelhouse folder');
  if (platform === 'darwin') {
    fullPath(home, platform, 'the home folder');
    const file = path.posix.join(root, script);
    return { kind: 'launch-agent', path: path.join(loginAgentsFolder({ home }), PLIST), content: plist([node, file, 'start']) };
  }
  const file = path.win32.join(root, ...script.split('/'));
  return { kind: 'run-entry', path: `${RUN_KEY}\\${RUN_NAME}`, content: `${windowsQuoted(node)} ${windowsQuoted(file)} start` };
}

// Whether a record names an entry this module would write: a launch agent of Wheelhouse's own name in a
// LaunchAgents folder, or the Run value of Wheelhouse's own name. A record naming anything else is not followed.
function ours(record) {
  if (record === null || typeof record !== 'object' || typeof record.content !== 'string' || typeof record.at !== 'string') return false;
  if (record.kind === 'launch-agent') {
    return typeof record.path === 'string' && path.isAbsolute(record.path) && path.basename(record.path) === PLIST && path.basename(path.dirname(record.path)) === 'LaunchAgents';
  }
  return record.kind === 'run-entry' && record.path === `${RUN_KEY}\\${RUN_NAME}`;
}

// The sign-in start Wheelhouse recorded making on this computer, or null when there is none (or the record is
// damaged or names something that isn't Wheelhouse's entry).
export function loginStartRecord() {
  try {
    const record = JSON.parse(fs.readFileSync(loginRecordFile(), 'utf8'));
    if (!ours(record)) return null;
    const made = Array.isArray(record.made) ? record.made.filter((d) => typeof d === 'string') : [];
    // `next`, while a reload hasn't finished: the text the file may already hold.
    return { kind: record.kind, path: record.path, content: record.content, at: record.at, ...(made.length ? { made } : {}), ...(typeof record.next === 'string' ? { next: record.next } : {}) };
  } catch {
    return null;
  }
}

// The entry to write and load in place of the one recorded here, or null when that one is what this version, in this
// folder, would write, there is none, or it wasn't made for this system. After an update that moves the agent to the
// version running. `node`, `root` and `script` are as for loginEntry.
export function renewedEntry({ platform = process.platform, node = process.execPath, root, script } = {}) {
  const record = loginStartRecord();
  if (record?.kind !== 'launch-agent' || KINDS[record.kind] !== platform) return null;
  const entry = { ...loginEntry({ platform, node, root, script, home: os.homedir() }), path: record.path };
  return entry.content === record.content ? null : entry;
}

// `launchctl bootout`: launchd lets go of the agent. A running helper isn't its job, since the start command left it
// running and exited (AbandonProcessGroup), so it carries on. An agent not loaded answers with a failure, which is fine.
async function unload(run, uid) {
  if (reachesComputer(run)) return;
  try {
    await run('launchctl', ['bootout', `gui/${uid}/${LAUNCH_AGENT_LABEL}`]);
  } catch { /* nothing more can be done here: the entry goes all the same */ }
}

// launchd reads the file at `file` now: { code, stderr }. Loading it runs the start command at once.
async function load(run, file, uid) {
  if (reachesComputer(run)) return { code: 0, stderr: '' };
  await unload(run, uid);
  try {
    return await run('launchctl', ['bootstrap', `gui/${uid}`, file]);
  } catch (error) {
    return { code: 1, stderr: error.message };
  }
}

// A test process is told, by tests/helpers/test-home.js, which folder is the person's real LaunchAgents folder, and may
// never write into it: a test that reaches it fails here instead of changing the person's sign-in start.
function refuseRealAgents(file) {
  const real = process.env.WHEELHOUSE_TEST_REAL_LAUNCH_AGENTS;
  if (real && inside(path.resolve(file), path.resolve(real))) throw new Error(`A test tried to write the real launch agents folder: ${file}`);
}

function writeWhole(file, text) {
  refuseRealAgents(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// Writes the entry loginEntry gave, for this person only: the launch agent's file, loaded at once, so a helper that
// dies is back within a minute from today; or `reg add` under HKCU, which takes effect at the next sign-in. An agent
// launchd won't load now loads at the next sign-in, so that stops nothing. Throws in plain words.
export async function installLoginStart({ entry, run = realRun, now = () => new Date(), uid = process.getuid?.() } = {}) {
  if (!ours({ ...entry, at: '' })) throw new Error('That is not Wheelhouse\'s sign-in start');
  // The LaunchAgents folder, and the Library folder above it, where the write makes them: removing the agent removes them.
  const made = entry.kind === 'launch-agent' ? [path.dirname(entry.path), path.dirname(path.dirname(entry.path))].filter((dir) => !fs.existsSync(dir)) : [];
  writeWhole(loginRecordFile(), `${JSON.stringify({ kind: entry.kind, path: entry.path, content: entry.content, at: now().toISOString(), ...(made.length ? { made } : {}) }, null, 2)}\n`);
  if (entry.kind === 'launch-agent') {
    writeWhole(entry.path, entry.content);
    await load(run, entry.path, uid);
    return { written: entry.path };
  }
  if (reachesComputer(run)) return { written: entry.path };
  const got = await run('reg', ['add', RUN_KEY, '/v', RUN_NAME, '/t', 'REG_SZ', '/d', entry.content, '/f']);
  if (got.code !== 0) throw new Error(`The start-up entry could not be added (${String(got.stderr ?? '').trim() || 'reg gave no reason'})`);
  return { written: entry.path };
}

// The folders a trial or a test leaves its copies in.
function tempFolders() {
  const found = new Set(['/tmp', '/private/tmp', '/var/folders', '/private/var/folders']);
  for (const dir of [os.tmpdir(), process.env.TMPDIR].filter((d) => typeof d === 'string' && d !== '')) {
    found.add(path.resolve(dir));
    try { found.add(fs.realpathSync(dir)); } catch { /* not there */ }
  }
  return [...found];
}

const inside = (file, dir) => {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// Whether a launch agent that differs from the record is a stray copy of Wheelhouse's own (a run from a throwaway
// checkout left it) and so may be replaced with the real one. It must be shaped exactly as this module writes it:
// node, Wheelhouse's start command, `start`. And that start command must be in a Wheelhouse plugin install, be a
// path that no longer exists, or be under a temporary folder. Anything else (another program, or a start command
// anywhere else that is still there) is the person's own and is left. Nothing here ever adopts what the agent runs:
// the file is only replaced, with the entry the caller made from the running install.
function strayAgent(held, entry) {
  const args = [...String(held).matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1].replaceAll('&quot;', '"').replaceAll('&apos;', '\'').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
  // Label, node, script, `start`, then the two /dev/null paths.
  const [label, node, script, verb] = args;
  if (args.length !== 6 || label !== LAUNCH_AGENT_LABEL || verb !== 'start') return false;
  if (!path.posix.isAbsolute(node) || !path.posix.isAbsolute(script) || script.split('/').includes('..') || !/\/scripts\/agents\/copilot\/start-helper\.js$/.test(script)) return false;
  // Byte for byte what this module writes for those two paths, so no extra key (a different program, a keep-alive) rides along.
  if (held !== plist([node, script, 'start'])) return false;
  if (/\/\.claude\/plugins\/cache\/[^/]+\/wheelhouse\//.test(script) || /\/\.copilot\/wheelhouse\//.test(script)) return true;
  if (tempFolders().some((dir) => inside(script, dir))) return true;
  return !fs.existsSync(script);
}

// Writes `entry` over the launch agent recorded here and has launchd load it: { reloaded: true }, or { reloaded: false,
// why }. An entry changed since it was made, or taken away, is left, unless the change is a stray copy of Wheelhouse's own start command (strayAgent), which is replaced: { reloaded: true, tookOver: true }. The record names the new text before the file
// holds it, as the install's does, and takes it as the entry's only once it is loaded: a reload cut short or refused
// is tried again at the next start of the helper, and uninstall knows either form.
export async function reloadLoginStart({ run = realRun, entry, now = () => new Date(), uid = process.getuid?.() } = {}) {
  const record = loginStartRecord();
  if (record?.kind !== 'launch-agent' || record.path !== entry?.path) return { reloaded: false, why: 'none was made' };
  let held;
  try {
    held = fs.readFileSync(record.path, 'utf8');
  } catch (error) {
    return { reloaded: false, why: error.code === 'ENOENT' ? 'it was taken away, so it was left' : `it could not be read (${error.code ?? 'no reason given'})` };
  }
  let tookOver = false;
  if (held !== record.content && held !== record.next) {
    if (!strayAgent(held, entry)) return { reloaded: false, why: 'it was changed since Wheelhouse made it, so it was left' };
    tookOver = true;
  }
  const { next: _, ...rest } = record;
  writeWhole(loginRecordFile(), `${JSON.stringify({ ...rest, next: entry.content }, null, 2)}\n`);
  writeWhole(entry.path, entry.content);
  const got = await load(run, entry.path, uid);
  if (got.code !== 0) return { reloaded: false, why: `launchd would not load it (${String(got.stderr ?? '').trim() || 'no reason given'}); it loads at the next sign-in` };
  writeWhole(loginRecordFile(), `${JSON.stringify({ ...rest, content: entry.content, at: now().toISOString() }, null, 2)}\n`);
  return tookOver ? { reloaded: true, tookOver: true } : { reloaded: true };
}

// The Run value's data as `reg query` prints it, or null when the value isn't there.
async function runValue(run) {
  if (reachesComputer(run)) return null;
  const got = await run('reg', ['query', RUN_KEY, '/v', RUN_NAME]);
  if (got.code !== 0) return null;
  for (const line of String(got.stdout ?? '').split(/\r?\n/)) {
    const m = /^\s+(.+?)\s{4}REG_(?:EXPAND_)?SZ\s{4}(.*)$/.exec(line);
    if (m && m[1] === RUN_NAME) return m[2];
  }
  return null;
}

// Removes the sign-in start Wheelhouse made, and nothing else: { removed: true }, or { removed: false, why }.
// An entry changed since it was made is left, with its record, so a later uninstall says so again.
export async function removeLoginStart({ run = realRun, platform = process.platform, uid = process.getuid?.() } = {}) {
  const record = loginStartRecord();
  if (record === null) return { removed: false, why: 'none was made' };
  if (KINDS[record.kind] !== platform) return { removed: false, why: 'it was made for another system' };
  const forget = () => fs.rmSync(loginRecordFile(), { force: true });
  if (record.kind === 'launch-agent') {
    let held;
    try {
      held = fs.readFileSync(record.path, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') return { removed: false, why: `it could not be read (${error.code ?? 'no reason given'})` };
      await unload(run, uid);
      forget();
      return { removed: false, why: 'it was gone already' };
    }
    if (held !== record.content && held !== record.next) return { removed: false, why: 'it was changed since Wheelhouse made it, so it was left' };
    await unload(run, uid);
    fs.rmSync(record.path, { force: true });
    // Only the two folders above the agent, and only while empty.
    const above = [path.dirname(record.path), path.dirname(path.dirname(record.path))];
    for (const dir of above.filter((d) => Array.isArray(record.made) && record.made.includes(d))) {
      try { fs.rmdirSync(dir); } catch { /* not empty, or gone */ }
    }
    forget();
    return { removed: true };
  }
  const held = await runValue(run);
  if (held === null) {
    forget();
    return { removed: false, why: 'it was gone already' };
  }
  if (held !== record.content) return { removed: false, why: 'it was changed since Wheelhouse made it, so it was left' };
  if (reachesComputer(run)) { forget(); return { removed: true }; }
  const got = await run('reg', ['delete', RUN_KEY, '/v', RUN_NAME, '/f']);
  if (got.code !== 0) return { removed: false, why: `reg could not remove it (${String(got.stderr ?? '').trim() || 'no reason given'})` };
  forget();
  return { removed: true };
}
