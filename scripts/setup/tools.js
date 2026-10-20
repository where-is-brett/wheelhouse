// scripts/setup/tools.js
// Setup's step 2, the tools (design section 15): git, Node.js, and the host's command-line tool.
//
// Node.js comes before the plugin, always: the helper and every hook are Node.js, so this step
// cannot install it. The README's first pasted line has Claude check for it and start its
// official installer before Wheelhouse is installed; here a Node.js missing or below NODE_FLOOR
// stops setup with the README's own line (NODE_LINE), and nothing is installed.
//
// git is installed by its official route, started first and detached, so it runs while the
// director answers the next steps' questions: on macOS Apple's own command-line tools window
// (`xcode-select --install`); on Windows Git for Windows' official installer, fetched into a new,
// empty temporary folder, checked against the checksum its release page publishes, then opened,
// so the system shows its own prompt. Each installer is recorded in the journal as a `process`
// change as soon as it is started, before anything waits on it (ruling R47): it outlives a step
// whose time ran out, so a later plan of this step finds it still open, lists "waiting for the git
// installer already open", and starts no second one.
//
// `gh` or `glab` needs no installer and no password (check 38): each is fetched from its official
// release into <wheelhouseHome()>/tools/<tool>/, checked against the release's checksums before
// anything is written out of the archive, and unpacked with the system's own `tar`, never with
// -P. Only the helper runs that copy (scripts/lib/host-tools.js's toolPath), so nothing else needs
// it on the path. Which one: the host the project's `origin` names, or both while it names none.
//
// The step also writes one allow rule into the project's .claude/settings.local.json, by key, for
// setup's own command (ruling R43), so the playbook's calls before step 7 are not asked about
// each time. With everything here and the rule in, nothing is listed, and the step settles with
// no Go ahead (ruling R75).
//
// pickArchive, archWord, versionOf and parseChecksums are copied from probes/38-host-tools/run.js
// (ruling R47): a probe is frozen evidence, not a module the plugin loads.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as realRun } from '../lib/run.js';
import { NODE_FLOOR } from '../lib/setup-numbers.js';
import { HOST_TOOLS, toolFolder, fetchedPath } from '../lib/host-tools.js';
import { SETUP_TITLES, SETUP_LABEL } from '../state/card-lines.js';
import { setupCommand, allowRule } from '../protection/settings.js';
import { detectHost } from '../host/adapter.js';
import { readJournal, newId } from './journal.js';
import { runClosed } from '../lib/setup-run.js';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const FLOOR = NODE_FLOOR.join('.');

// The README's Node.js line (Task 16 puts it in the README as it is). It covers a session whose
// every tool is refused with a message naming a Wheelhouse script, which is how the hooks fail
// with no `node` (check 35), as well as a Node.js that is missing or too old.
export const NODE_LINE = `Wheelhouse needs Node.js ${NODE_FLOOR[0]} or later. If this computer has none or an older one, or a Wheelhouse session refuses every tool with a message naming a Wheelhouse script and "node: command not found", install the LTS from nodejs.org, then ask again in the same conversation; if it still refuses, start a new session.`;

// How often the step looks again while an installer runs, and how long the installer may go unseen,
// with git still missing, before the step says it closed (ruling R55): its window may take a
// moment to appear, git a moment to be found once it closes, and on a Mac whether `pgrep` sees
// Apple's window at all waits for the sitting, so completion is read only by xcode-select -p.
export const POLL_MS = 10 * 1000;
export const GONE_MS = 2 * 60 * 1000;

// macOS's own installer for the command-line tools, which `xcode-select --install` opens.
export const MAC_INSTALLER = 'Install Command Line Developer Tools';
// Git for Windows' installer is told to show its progress without asking the wizard's questions;
// Windows still asks to allow it, which is the director's one step.
export const GIT_INSTALLER_ARGS = ['/SILENT', '/NORESTART'];

const HEADERS = { 'user-agent': 'wheelhouse-setup' };

// The official host of each release's files: every address fetched from a release is checked to
// be on it, over https, so a link in a release's list can't send setup elsewhere.
const OFFICIAL = { gh: 'github.com', glab: 'gitlab.com', git: 'github.com' };
function official(url, tool) {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch { /* not an address */ }
  if (parsed?.protocol !== 'https:' || parsed.hostname !== OFFICIAL[tool] || parsed.username || parsed.password || parsed.port) {
    throw new Error(`A ${tool} release file is not on ${OFFICIAL[tool]}, so setup did not fetch it`);
  }
  return url;
}
const GIT_FOR_WINDOWS = 'https://github.com/git-for-windows/git/releases';

// ---- Copied from probes/38-host-tools/run.js ----

const ARCHIVES = {
  gh: {
    os: { darwin: 'macOS', win32: 'windows' },
    pattern: (osWord, arch) => new RegExp(`^gh_[0-9][^_]*_${osWord}_${arch}\\.(zip|tar\\.gz)$`),
  },
  glab: {
    os: { darwin: 'darwin', win32: 'windows' },
    pattern: (osWord, arch) => new RegExp(`^glab_[0-9][^_]*_${osWord}_${arch}\\.(zip|tar\\.gz)$`),
  },
};

export function archWord(arch) {
  if (arch === 'x64') return 'amd64';
  if (arch === 'arm64') return 'arm64';
  throw new Error(`No archive for processor "${arch}"`);
}

// The one archive for a system, picked from a list of names (a checksum list's or a release's
// links). Installers and packages (.msi, .pkg, .exe) never match. Throws unless exactly one does.
export function pickArchive(tool, names, platform, arch) {
  const def = ARCHIVES[tool];
  if (!def) throw new Error(`Unknown tool ${tool}`);
  const osWord = def.os[platform];
  if (!osWord) throw new Error(`No archive for system "${platform}"`);
  const wanted = def.pattern(osWord, archWord(arch));
  const found = names.filter((name) => wanted.test(name));
  if (found.length !== 1) {
    throw new Error(`Expected one ${tool} archive for ${platform} ${arch}, found ${found.length}${found.length ? `: ${found.join(', ')}` : ''}`);
  }
  return found[0];
}

export function versionOf(archiveName) {
  const match = /^(?:gh|glab)_([0-9][^_]*)_/.exec(archiveName);
  if (!match) throw new Error(`No version in ${archiveName}`);
  return match[1];
}

// A checksum list: one "<64 hex>  <name>" per line ("*" before the name marks binary mode).
export function parseChecksums(text) {
  const sums = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (!match) throw new Error(`Unreadable checksum line: ${line.slice(0, 80)}`);
    sums.set(match[2], match[1].toLowerCase());
  }
  return sums;
}

// ---- Checking and fetching ----

export class ChecksumError extends Error {}

// Refuses (throws) when the name is not on the list or the bytes do not match.
function verifyChecksum(name, bytes, sums) {
  const expected = sums.get(name);
  if (!expected) throw new ChecksumError(`${name} is not on the published checksum list, so setup did not use it`);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new ChecksumError(`${name} does not match its published checksum, so setup did not use it`);
}

// The release tag from a "releases/latest" redirect's address.
function tagFromLocation(location) {
  const match = /\/releases\/tag\/([^/?#]+)$/.exec(location ?? '');
  if (!match) throw new Error('The release page did not name its latest release');
  return decodeURIComponent(match[1]);
}

async function getOk(fetch, url, init = {}) {
  const response = await fetch(url, { headers: HEADERS, ...init });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response;
}
const getBytes = async (fetch, url) => Buffer.from(await (await getOk(fetch, url)).arrayBuffer());
const getText = async (fetch, url) => (await getOk(fetch, url)).text();

// The latest release's tag, read from the "latest" address's redirect: no API call, so no rate limit.
async function latestTag(fetch, releases) {
  const response = await fetch(`${releases}/latest`, { headers: HEADERS, redirect: 'manual' });
  return tagFromLocation(response.headers.get('location'));
}

// Where each host tool's official release lives. Neither needs a token.
const SOURCES = {
  gh: async (fetch) => {
    const tag = await latestTag(fetch, 'https://github.com/cli/cli/releases');
    const base = `https://github.com/cli/cli/releases/download/${tag}`;
    const checksumText = await getText(fetch, `${base}/gh_${tag.replace(/^v/, '')}_checksums.txt`);
    return { tag, checksumText, names: [...parseChecksums(checksumText).keys()], urlFor: (name) => `${base}/${name}` };
  },
  glab: async (fetch) => {
    // GitLab's release API, anonymously: public projects' releases and their links need no token.
    const release = await (await getOk(fetch, 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest')).json();
    const byName = new Map((release?.assets?.links ?? []).map((link) => [link.name, link.direct_asset_url]));
    if (!byName.has('checksums.txt')) throw new Error('The glab release lists no checksums.txt');
    const checksumText = await getText(fetch, official(byName.get('checksums.txt'), 'glab'));
    return { tag: release.tag_name, checksumText, names: [...byName.keys()], urlFor: (name) => byName.get(name) };
  },
};

// The command that unpacks an archive: the `tar` the system ships, which on macOS and Windows is
// bsdtar and reads zip as well as tar.gz. On Windows the System32 copy is named, so a GNU tar from
// Git for Windows, which cannot read zip, is never picked up from the path. Never with -P, so tar
// strips a leading / and refuses a path with `..`, and nothing lands outside `into`. `archive` and
// `into` are given relative to the folder tar runs in, since Windows' tar reads its arguments in
// the system's code page, which a home folder's name may fall outside.
export function unpackCommand(archive, into, { platform = process.platform, systemRoot = process.env.SystemRoot } = {}) {
  const tar = platform === 'win32' ? path.win32.join(systemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  return { file: tar, args: ['-xf', archive, '-C', into] };
}

// The unpacked program: archives hold it under bin/, with or without a folder above it. A link is
// never taken for it.
function findBinary(dir, name) {
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name === name) return full;
    }
  }
  throw new Error(`The archive held no ${name}`);
}

// Fetches `gh` or `glab` into <wheelhouseHome()>/tools/<tool>/ (check 38): the latest release's
// archive for this system, checked against the release's checksums before anything is written,
// unpacked in a new folder beside it, run once, and only then put in place, with the release's tag
// kept beside it in `version`. `record(change)`, when given, gets the folder's change just before
// it is put in place. Gives the program's path and version.
export async function fetchHostTool({ tool, platform = process.platform, arch = process.arch, fetch = globalThis.fetch, run = realRun, record } = {}) {
  if (!HOST_TOOLS.includes(tool)) throw new Error(`There is no host tool named ${tool}`);
  const release = await SOURCES[tool](fetch);
  const sums = parseChecksums(release.checksumText);
  const name = pickArchive(tool, release.names, platform, arch);
  const version = versionOf(name);
  const bytes = await getBytes(fetch, official(release.urlFor(name), tool));
  verifyChecksum(name, bytes, sums);
  const target = toolFolder(tool);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const work = fs.mkdtempSync(path.join(path.dirname(target), `.${tool}-`));
  try {
    const archive = path.join(work, name);
    fs.writeFileSync(archive, bytes, { flag: 'wx' });
    const unpacked = path.join(work, 'unpacked');
    fs.mkdirSync(unpacked);
    const unpack = unpackCommand(name, path.basename(unpacked), { platform });
    const opened = await run(unpack.file, unpack.args, { cwd: work });
    if (opened.code !== 0) throw new Error(`${tool}'s archive could not be unpacked: ${(opened.stderr || opened.stdout || '').trim().slice(0, 200)}`);
    const binary = `${tool}${platform === 'win32' ? '.exe' : ''}`;
    const staged = path.join(work, tool);
    fs.mkdirSync(path.join(staged, 'bin'), { recursive: true });
    const program = path.join(staged, 'bin', binary);
    fs.copyFileSync(findBinary(unpacked, binary), program);
    if (platform !== 'win32') fs.chmodSync(program, 0o755);
    fs.writeFileSync(path.join(staged, 'version'), `${release.tag}\n`);
    const ran = await run(program, ['--version']);
    if (ran.code !== 0) throw new Error(`${tool} was fetched but would not run`);
    let before = null;
    try {
      before = { version: fs.readFileSync(path.join(target, 'version'), 'utf8').trim() };
    } catch { /* none there, or none setup fetched */ }
    if (typeof record === 'function') {
      record({ id: newId('chg'), kind: 'folder', target, before: fs.existsSync(target) ? before ?? {} : null, after: { tool, version: release.tag } });
    }
    if (fs.existsSync(target)) fs.renameSync(target, path.join(work, 'earlier'));
    fs.renameSync(staged, target);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return { path: fetchedPath(tool, { platform }), version };
}

// ---- What is on this computer ----

function versionIn(text) {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text ?? '');
  return match ? match.slice(1, 4).map((n) => Number(n ?? 0)) : null;
}

function atLeast(version, floor) {
  for (let i = 0; i < floor.length; i += 1) {
    if ((version[i] ?? 0) !== floor[i]) return (version[i] ?? 0) > floor[i];
  }
  return true;
}

async function quietly(run, file, args, options) {
  try {
    return await (options === undefined ? run(file, args) : run(file, args, options));
  } catch {
    return { code: 1, stdout: '', stderr: '' };
  }
}

// A program's path on the path, or null.
async function onPath(name, { platform, run }) {
  const got = await quietly(run, platform === 'win32' ? 'where' : 'which', [name]);
  if (got.code !== 0) return null;
  return String(got.stdout).split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

// Where Git for Windows puts git. The helper's own path was read when it started, so a git
// installed since then is found here, not on it.
function windowsGit(env) {
  const roots = [env.ProgramFiles, env.ProgramW6432, env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  return roots.map((root) => path.win32.join(root, 'Git', 'cmd', 'git.exe')).find((file) => fs.existsSync(file)) ?? null;
}

async function findTool(tool, { platform, run, env }) {
  if (tool === 'git' && platform === 'darwin') {
    // /usr/bin/git is there before Apple's command-line tools are, and running it opens Apple's
    // window, so it counts only once xcode-select says the tools are in (R47).
    const file = await onPath('git', { platform, run });
    if ((await quietly(run, 'xcode-select', ['-p'])).code === 0) return file ?? '/usr/bin/git';
    return file === null || file === '/usr/bin/git' ? null : file;
  }
  if (tool === 'git' && platform === 'win32') return (await onPath('git', { platform, run })) ?? windowsGit(env);
  if (HOST_TOOLS.includes(tool)) {
    const fetched = fetchedPath(tool, { platform });
    if (fs.existsSync(fetched)) return fetched;
  }
  return onPath(tool, { platform, run });
}

// The address the folder's `origin` names, read from its own git settings, since git itself may
// not be here yet; null when it names none.
export function originUrl(folder) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(folder, '.git', 'config'), 'utf8');
  } catch {
    return null;
  }
  const section = /^\s*\[remote\s+"origin"\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m.exec(text)?.[1] ?? '';
  return /^\s*url\s*=\s*(.+?)\s*$/m.exec(section)?.[1] ?? null;
}

// The host tools this project needs: the one for the host its `origin` names, or both while it
// names none (a new product's host is chosen at step 3).
export function hostToolsFor(folder) {
  const url = originUrl(folder);
  if (url === null) return [...HOST_TOOLS];
  try {
    return [detectHost(url) === 'github' ? 'gh' : 'glab'];
  } catch {
    return [...HOST_TOOLS];
  }
}

// What is on this computer, tool by tool: whether it was found, its version and path, and whether
// it is good enough (`ok`): Node.js at NODE_FLOOR or later; git, gh and glab when they run. `tools`
// names which to look at: git, node, and the host tools given (both when none are).
export async function toolsStatus({ platform = process.platform, run = realRun, hostTools = HOST_TOOLS, tools, env = process.env } = {}) {
  const names = tools ?? ['git', 'node', ...hostTools];
  const status = {};
  for (const tool of names) {
    const file = await findTool(tool, { platform, run, env });
    const ran = file === null ? null : await quietly(run, file, ['--version']);
    const version = ran?.code === 0 ? versionIn(`${ran.stdout}\n${ran.stderr}`) : null;
    status[tool] = {
      found: file !== null,
      version: version === null ? null : version.join('.'),
      path: file,
      ok: version !== null && (tool !== 'node' || atLeast(version, NODE_FLOOR)),
    };
  }
  return status;
}

// Why setup stops for this computer's Node.js: the README's line, and what was found.
export function nodeRefusal(node) {
  const found = node?.found ? `this computer's Node.js is ${node.version ?? 'one whose version could not be read'}` : 'Node.js was not found on this computer';
  return `${NODE_LINE} (Setup stopped here, and installed nothing: ${found}; it needs ${FLOOR} or later.)`;
}

// ---- The installers ----

// What the director does for git's installer on each system.
export const WAITS_FOR = { darwin: 'click', win32: 'admin' };

// The command that opens an installer so that Windows asks to allow it: PowerShell's
// Start-Process, which prints the installer's process id. The installer's path reaches it through
// the environment (`env`), never inside the command's own text, where PowerShell would read any of
// ' ‘ ’ ‚ ‛ in an account's name as the end of a quoted string.
export function openCommand(file, args = [], { systemRoot = process.env.SystemRoot } = {}) {
  const list = args.length > 0 ? ` -ArgumentList ${args.map((a) => `'${a}'`).join(',')}` : '';
  if (!args.every((a) => /^[A-Za-z0-9/_-]+$/.test(a))) throw new Error('An installer\'s arguments are plain switches');
  return {
    file: path.win32.join(systemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoProfile', '-NonInteractive', '-Command', `(Start-Process -FilePath $env:WHEELHOUSE_INSTALLER${list} -PassThru).Id`],
    env: { WHEELHOUSE_INSTALLER: file },
  };
}

// Git for Windows' installer for this processor, picked from the names on the release's checksum
// table; the portable and minimal builds never match. Throws unless exactly one does.
export function pickInstaller(names, arch) {
  const word = arch === 'x64' ? '64-bit' : arch === 'arm64' ? 'arm64' : null;
  if (word === null) throw new Error(`No Git for Windows installer for processor "${arch}"`);
  const found = names.filter((name) => new RegExp(`^Git-[0-9][^-]*-${word}\\.exe$`).test(name));
  if (found.length !== 1) throw new Error(`Expected one Git for Windows installer for ${arch}, found ${found.length}`);
  return found[0];
}

// The checksum table in a Git for Windows release's notes, as its page shows it (rows of
// <td>name</td><td>sha-256</td>, a cell perhaps with attributes) or as written (name | sha-256).
export function notesChecksums(text) {
  const sums = new Map();
  for (const m of String(text).matchAll(/([A-Za-z0-9][A-Za-z0-9._-]*\.(?:exe|zip))\s*(?:<\/td>\s*<td[^>]*>|\|)\s*([0-9a-fA-F]{64})(?![0-9a-fA-F])/g)) {
    sums.set(m[1], m[2].toLowerCase());
  }
  return sums;
}

// Fetches Git for Windows' latest installer into a new, empty folder under `tempRoot`, after its
// bytes match the checksum the release publishes; nothing is written before. `record(change)` gets
// the folder's change at once after the folder is made.
async function fetchGitInstaller({ arch, fetch, tempRoot, record }) {
  const tag = await latestTag(fetch, GIT_FOR_WINDOWS);
  const sums = notesChecksums(await getText(fetch, official(`${GIT_FOR_WINDOWS}/tag/${encodeURIComponent(tag)}`, 'git')));
  const name = pickInstaller([...sums.keys()], arch);
  const bytes = await getBytes(fetch, official(`${GIT_FOR_WINDOWS}/download/${encodeURIComponent(tag)}/${name}`, 'git'));
  verifyChecksum(name, bytes, sums);
  const folder = fs.mkdtempSync(path.join(tempRoot, 'wheelhouse-git-'));
  if (typeof record === 'function') record({ id: newId('chg'), kind: 'folder', target: folder, before: null, after: { tool: 'git', installer: name } });
  const file = path.join(folder, name);
  fs.writeFileSync(file, bytes, { flag: 'wx' });
  return file;
}

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// The process id of macOS's command-line tools window, or null while there is none.
async function macInstallerPid(run) {
  const got = await quietly(run, 'pgrep', ['-f', MAC_INSTALLER]);
  const pid = Number(String(got.stdout).split(/\s+/).find(Boolean));
  return got.code === 0 && Number.isInteger(pid) ? pid : null;
}

// Starts git's official installer, detached from this process, so it runs on whatever happens to
// the step: on macOS `xcode-select --install`, which hands over to Apple's own window; on Windows
// Git for Windows' installer, fetched and checked first, then opened through Start-Process so
// Windows asks to allow it. Gives whether it started, what the director does, and the installer's
// process id and program, for its `process` change. `record` gets a Windows installer's folder.
export async function startInstaller({
  tool = 'git', platform = process.platform, arch = process.arch, run = realRun, fetch = globalThis.fetch,
  tempRoot = os.tmpdir(), record, sleep = pause,
} = {}) {
  if (tool !== 'git') throw new Error(`Setup has no installer for ${tool}`);
  if (platform === 'darwin') {
    const got = await quietly(run, 'xcode-select', ['--install']);
    if (got.code !== 0) return { started: false, waitsFor: WAITS_FOR.darwin, why: (got.stderr || got.stdout || '').trim() };
    let pid = null;
    for (let look = 0; look < 5 && pid === null; look += 1) {
      pid = await macInstallerPid(run);
      if (pid === null) await sleep(1000);
    }
    return { started: true, waitsFor: WAITS_FOR.darwin, pid, image: MAC_INSTALLER };
  }
  if (platform === 'win32') {
    const file = await fetchGitInstaller({ arch, fetch, tempRoot, record });
    const open = openCommand(file, GIT_INSTALLER_ARGS);
    const got = await quietly(run, open.file, open.args, { env: open.env });
    const pid = Number(String(got.stdout).trim());
    if (got.code !== 0 || !Number.isInteger(pid)) return { started: false, waitsFor: WAITS_FOR.win32, why: 'the installer was not allowed to start' };
    return { started: true, waitsFor: WAITS_FOR.win32, pid, image: file };
  }
  throw new Error('Setup installs git on macOS and Windows; on this system, install git and ask again');
}

// Whether an installer recorded as a `process` change is still open: on macOS Apple's window, on
// Windows the recorded process id still running the recorded program.
async function stillOpen(change, { platform, run }) {
  const { pid, image } = change.after ?? {};
  if (platform === 'darwin') return (await macInstallerPid(run)) !== null;
  if (platform === 'win32' && Number.isInteger(pid) && typeof image === 'string') {
    const got = await quietly(run, 'tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
    return got.code === 0 && String(got.stdout).toLowerCase().includes(`"${path.win32.basename(image).toLowerCase()}"`);
  }
  return false;
}

// The newest installer for `tool` the journal records, from any run uninstall hasn't closed, while it
// is still open; else null.
export async function openInstaller(tool, { platform = process.platform, run = realRun } = {}) {
  const started = readJournal().runs.filter((r) => !runClosed(r)).flatMap((r) => r?.changes ?? [])
    .filter((c) => c?.kind === 'process' && c.after?.tool === tool)
    .sort((a, b) => String(a.after.startedAt).localeCompare(String(b.after.startedAt)));
  const newest = started.at(-1);
  return newest && (await stillOpen(newest, { platform, run })) ? newest : null;
}

// ---- Step 2 ----

function installLine(platform) {
  if (platform === 'darwin') return 'git: Apple\'s command-line tools, in Apple\'s own window (click Install, then Agree); 5 to 15 minutes, while you answer the next questions';
  return 'git: Git for Windows\' official installer, checked against its published checksum; Windows asks you to allow it (Yes, or an administrator\'s password); 2 to 5 minutes, while you answer the next questions';
}

// What the director does for the list, in plain words.
function directorFor(changes, platform) {
  if (changes.some((c) => c.kind === 'process' && c.action === 'install')) {
    return platform === 'darwin' ? 'One click, then Install and Agree in Apple\'s window' : 'One click, then Yes when Windows asks to allow the installer';
  }
  return 'One click';
}

// The card of a list with something on it: an empty list settles the step (ruling R75).
function cardFor(changes, status, platform) {
  const lines = [];
  for (const c of changes.filter((x) => x.kind === 'process')) {
    lines.push(c.action === 'wait' ? 'git: waiting for the git installer already open, which setup leaves to finish' : installLine(platform));
  }
  const fetched = changes.filter((c) => c.action === 'fetch').map((c) => c.tool);
  if (fetched.length > 0) {
    lines.push(`${fetched.join(' and ')}, the host's command-line ${fetched.length === 1 ? 'tool' : 'tools'}: fetched from ${fetched.length === 1 ? 'its' : 'their'} official release into Wheelhouse's tools folder, checked against the published checksums; a few seconds, nothing for you to do`);
  }
  if (changes.some((c) => c.kind === 'json-key')) lines.push('one permission rule in this project\'s .claude/settings.local.json, so setup\'s own command is not asked about each time');
  const here = Object.entries(status).filter(([, s]) => s.ok).map(([tool, s]) => `${tool === 'node' ? 'Node.js' : tool} ${s.version}`);
  const what = `Setup step 2, ${SETUP_TITLES[2]}: ${lines.join('; ')}.${here.length > 0 ? ` Already here: ${here.join(', ')}.` : ''}`;
  return {
    kind: 'setup',
    level: 3,
    what,
    why: 'Wheelhouse keeps the project on GitHub or GitLab through git and the host\'s own tool.',
    options: [
      { label: SETUP_LABEL, says: 'Setup starts what is listed and moves on to its questions while it runs.' },
      { label: 'Not now', says: 'Setup waits at this step; nothing is installed.' },
    ],
    recommend: SETUP_LABEL,
    because: 'each comes from its official source, and setup needs them for the next steps',
    meanwhile: 'Setup waits at this step; nothing is installed.',
  };
}

// The allow rules in a settings file, as they are; an empty list when there is no file. A file that
// is not a JSON object, or rules that are not a list, stop the step, naming the file.
function allowRules(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${file} is not a JSON object, so setup has left it as it was`);
  const allow = data.permissions?.allow;
  if (allow === undefined) return [];
  if (!Array.isArray(allow)) throw new Error(`${file} holds permissions.allow that is not a list, so setup has left it as it was`);
  return allow;
}

// Step 2. `run`, `fetch` and `sleep` are the step's ways out, for tests; `pollMs` how often it looks
// while an installer runs; `tempRoot` where a Windows installer is fetched to.
export function toolsStep({
  run = realRun, fetch = globalThis.fetch, arch = process.arch, pluginRoot = PLUGIN_ROOT, env = process.env,
  pollMs = POLL_MS, sleep = pause, tempRoot = os.tmpdir(),
} = {}) {
  return {
    n: 2,
    title: SETUP_TITLES[2],
    long: true,
    async plan(ctx) {
      const platform = ctx.platform ?? process.platform;
      const hostTools = hostToolsFor(ctx.folder);
      const status = await toolsStatus({ platform, run, hostTools, env });
      if (!status.node.ok) throw new Error(nodeRefusal(status.node));
      const changes = [];
      if (!status.git.ok) {
        if (!Object.hasOwn(WAITS_FOR, platform)) throw new Error('Setup installs git on macOS and Windows; on this system, install git and ask again');
        changes.push(await openInstaller('git', { platform, run })
          ? { kind: 'process', target: 'git', action: 'wait' }
          : { kind: 'process', target: 'git', action: 'install', waitsFor: WAITS_FOR[platform] });
      }
      for (const tool of hostTools) if (!status[tool].ok) changes.push({ kind: 'folder', target: toolFolder(tool), action: 'fetch', tool });
      const rule = allowRule(setupCommand(pluginRoot, { platform }));
      if (rule !== null) {
        const file = path.join(ctx.folder, '.claude', 'settings.local.json');
        const allow = allowRules(file);
        if (!allow.includes(rule)) changes.push({ kind: 'json-key', target: file, key: ['permissions', 'allow'], after: [...allow, rule] });
      }
      // Nothing to do settles the step, with no Go ahead (ruling R75).
      if (changes.length === 0) return { settled: { record: { nothing: true } } };
      return { changes, card: cardFor(changes, status, platform), director: directorFor(changes, platform) };
    },
    // Starts every installer at once, first, and fetches the host tools meanwhile; writes the rule
    // once each installer's start is recorded; then waits, looking every pollMs, until git is in
    // (on a Mac, by xcode-select -p alone), no installer has been seen for GONE_MS with git still
    // missing, or STOP comes on. A long step: the helper has already handed back, so the next
    // steps' questions are asked while this runs.
    async apply(ctx, changes) {
      const platform = ctx.platform ?? process.platform;
      const now = ctx.now ?? (() => new Date());
      const { record } = ctx;
      const installs = changes.filter((c) => c.kind === 'process' && c.action === 'install').map(async (c) => {
        // No second installer while one is open, should one have been opened since the plan.
        if (await openInstaller(c.target, { platform, run })) return;
        const started = await startInstaller({ tool: c.target, platform, arch, run, fetch, tempRoot, record, sleep });
        if (!started.started) throw new Error(`the ${c.target} installer did not start${started.why ? `: ${started.why}` : ''}`);
        record({ id: newId('chg'), kind: 'process', target: started.image, before: null, after: { tool: c.target, pid: started.pid, startedAt: now().toISOString(), image: started.image } });
      });
      const fetches = changes.filter((c) => c.action === 'fetch').map((c) => fetchHostTool({ tool: c.tool, platform, arch, fetch, run, record }));
      // The rule is written once every installer's start is recorded, so a write that fails can't
      // leave an installer open that the journal doesn't know about.
      const failed = (await Promise.allSettled([...installs, ...fetches])).find((r) => r.status === 'rejected');
      if (failed) throw failed.reason;
      for (const c of changes.filter((x) => x.kind === 'json-key')) ctx.applyJsonKey({ file: c.target, key: c.key, value: c.after });
      const waiting = [...new Set(changes.filter((c) => c.kind === 'process').map((c) => c.target))];
      let seenAt = now().getTime();
      while (waiting.length > 0) {
        if (ctx.stopped?.()) throw new Error('STOP came on while the installer ran; it is left to finish');
        const status = await toolsStatus({ platform, run, tools: waiting, env });
        if (waiting.every((tool) => status[tool].ok)) break;
        const open = await Promise.all(waiting.filter((tool) => !status[tool].ok).map((tool) => openInstaller(tool, { platform, run })));
        if (open.every(Boolean)) seenAt = now().getTime();
        else if (now().getTime() - seenAt >= GONE_MS) throw new Error(`the ${waiting.join(' and ')} installer closed before it finished; a fresh Go ahead starts it again`);
        await sleep(pollMs);
      }
      return [];
    },
  };
}
