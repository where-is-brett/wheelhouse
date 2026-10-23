// scripts/lib/login-start.js
// The sign-in start (design section 8.5): what starts Wheelhouse's helper when the person signs in to this
// computer, for them only and with no admin. On macOS a launch agent in their own LaunchAgents folder, run at
// load; on Windows a per-user start-up entry under HKCU's Run key, added with `reg add`. The install of the helper
// writes it (never on a work computer, where the company's endpoint security may treat one as suspicious), and
// uninstall removes it: only the entry it made, and only while it still holds what was written.
//
// What was written is recorded in Wheelhouse's home (login-start.json, { kind, path, content, at }), so uninstall
// knows there is one without looking through the person's own start-up items. The record is written before the
// entry, so an install cut short leaves a record uninstall can act on.
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

const agentsFolder = (home) => path.join(home, 'Library', 'LaunchAgents');

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
    return { kind: 'launch-agent', path: path.join(agentsFolder(home), PLIST), content: plist([node, file, 'start']) };
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
    return ours(record) ? { kind: record.kind, path: record.path, content: record.content, at: record.at } : null;
  } catch {
    return null;
  }
}

function writeWhole(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// Writes the entry loginEntry gave, for this person only: the launch agent's file, or `reg add` under HKCU. It
// takes effect at the next sign-in; the install starts the helper now itself. Throws in plain words.
export async function installLoginStart({ entry, run = realRun, now = () => new Date() } = {}) {
  if (!ours({ ...entry, at: '' })) throw new Error('That is not Wheelhouse\'s sign-in start');
  writeWhole(loginRecordFile(), `${JSON.stringify({ kind: entry.kind, path: entry.path, content: entry.content, at: now().toISOString() }, null, 2)}\n`);
  if (entry.kind === 'launch-agent') {
    writeWhole(entry.path, entry.content);
    return { written: entry.path };
  }
  const got = await run('reg', ['add', RUN_KEY, '/v', RUN_NAME, '/t', 'REG_SZ', '/d', entry.content, '/f']);
  if (got.code !== 0) throw new Error(`The start-up entry could not be added (${String(got.stderr ?? '').trim() || 'reg gave no reason'})`);
  return { written: entry.path };
}

// The Run value's data as `reg query` prints it, or null when the value isn't there.
async function runValue(run) {
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
export async function removeLoginStart({ run = realRun, platform = process.platform } = {}) {
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
      forget();
      return { removed: false, why: 'it was gone already' };
    }
    if (held !== record.content) return { removed: false, why: 'it was changed since Wheelhouse made it, so it was left' };
    fs.rmSync(record.path, { force: true });
    forget();
    return { removed: true };
  }
  const held = await runValue(run);
  if (held === null) {
    forget();
    return { removed: false, why: 'it was gone already' };
  }
  if (held !== record.content) return { removed: false, why: 'it was changed since Wheelhouse made it, so it was left' };
  const got = await run('reg', ['delete', RUN_KEY, '/v', RUN_NAME, '/f']);
  if (got.code !== 0) return { removed: false, why: `reg could not remove it (${String(got.stderr ?? '').trim() || 'no reason given'})` };
  forget();
  return { removed: true };
}
