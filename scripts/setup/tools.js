// scripts/setup/tools.js
// Setup's step 2, the tools (design section 15): git, Node.js, and the host's command-line tool.
//
// Node.js comes before the plugin, always: the helper and every hook are Node.js, so this step
// cannot install it. The README's install section has the director check for it and install the
// LTS from nodejs.org themselves before Wheelhouse is installed; here a Node.js missing or below
// NODE_FLOOR stops setup with the README's own line (NODE_LINE), and nothing is installed.
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
// Where the public GitLab is blocked, the project's `glabFrom` setting (.claude/wheelhouse.json) reads
// `company <path or address>` and `glab` is taken from the company's own list instead: a JSON file
// shaped like GitLab's release (`tag_name`, and `assets.links` of { name, direct_asset_url, sha256? },
// with a `checksums.txt` link where the company has one). A path is read from disk, its files beside
// the list; an address is fetched over https only, no redirect followed, every file on the list's own
// host. The version in the list is checked against the file's, and the checksum where the list gives
// one. A list that gives none is named on step 2's card (`checksum: 'none'` on the change), and only
// that change, once the director has said Go ahead, lets the copy be used, and only the very file the
// plan hashed (`pin`). Nothing downloaded runs before then, and the one run at apply is `--version`.
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
import { HOST_TOOLS, toolFolder, fetchedPath, toolPath } from '../lib/host-tools.js';
import { wheelhouseHome } from '../lib/paths.js';
import { SETUP_TITLES, SETUP_LABEL } from '../state/card-lines.js';
import { setupCommand, allowRule } from '../protection/settings.js';
import { detectHost } from '../host/adapter.js';
import { readGitlabHosts } from '../host/gitlab-base.js';
import { caFile, exportSystemRoots, stageCaFile, caEnv, glabCaArgs, gitCaConfig, addressOf, failureKind, CERTIFICATE_NOT_IN_STORE } from '../host/company-ca.js';
import { composeCard, isTooLong } from '../cards/compose.js';
import { WHEELHOUSE_REPO } from '../lineage/manifest.js';
import { readJournal, newId } from './journal.js';
import { runClosed } from '../lib/setup-run.js';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const FLOOR = NODE_FLOOR.join('.');

// The README's Node.js line (Task 16 puts it in the README as it is). It covers a session whose
// every tool is refused with a message naming a Wheelhouse script, which is how the hooks fail
// with no `node` (check 35), as well as a Node.js that is missing or too old.
export const NODE_LINE = `Wheelhouse needs Node.js ${NODE_FLOOR[0]} or later. If this computer has none or an older one, or a Wheelhouse session refuses every tool with a message naming a Wheelhouse script and "node: command not found", install the LTS from nodejs.org, then ask again in the same conversation; if it still refuses, start a new session.`;

// The README's install line (Task 16, ruling R97): the form check 37 documented, pasted into a
// Desktop session opened on the product's folder, with `<tag>` standing for the release's tag.
// Check 37's sitting may change it, here only; the README tells the director to pick "this
// project" at its scope question (whether the user scope must be handled too is ruling R24's).
export const INSTALL_LINE = `/plugin install wheelhouse --marketplace ${WHEELHOUSE_REPO}#<tag>`;

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

// ---- glab from the company's own list ----

export const GLAB_FROM_LINE = 'glabFrom reads "gitlab" (glab\'s official release, the default) or "company <path or address>" (your company\'s own list), so setup did not fetch glab';
const ADDRESS_ONLY_HTTPS = 'A company\'s address is fetched only over https, so setup did not fetch glab from it';
const LIST_LIMIT = 1024 * 1024;

// Where `glab` comes from: { kind: 'gitlab', from: null } (the official release) or
// { kind: 'company', from } with `from` a path or an https address, as written in the setting.
export function glabSource({ setting } = {}) {
  const text = typeof setting === 'string' ? setting.trim() : '';
  if (text === '' || text === 'gitlab') return { kind: 'gitlab', from: null };
  const from = /^company(?:\s+(\S[\s\S]*))?$/.exec(text)?.[1]?.trim();
  if (!from) throw new Error(GLAB_FROM_LINE);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(from)) {
    let address = null;
    try {
      address = new URL(from);
    } catch { /* not an address */ }
    if (address?.protocol !== 'https:' || address.username || address.password || !address.hostname) throw new Error(ADDRESS_ONLY_HTTPS);
  }
  return { kind: 'company', from };
}

// The project's `glabFrom` setting, read from its committed configuration without judging the rest
// of the file; undefined when there is none.
export function readGlabFrom(folder) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(folder, '.claude', 'wheelhouse.json'), 'utf8'))?.glabFrom;
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

const isAddress = (from) => /^https:\/\//i.test(from);

// The real path of a company's list on this computer. It must be written as a full path, and neither the
// path as written nor the real one it comes to (a symbolic link out of or into the folder is followed) may
// lie inside the project's folder: what is in the folder can be written by an agent working there, and glab
// runs with the director's own sign-in.
function outsideProject(from, folder) {
  if (!path.isAbsolute(from)) {
    throw new Error(`Your company's list at ${from} must be written as a full path or an https address, so setup did not fetch glab`);
  }
  let file;
  try {
    file = fs.realpathSync(from);
  } catch {
    throw new Error(`Your company's list at ${from} could not be read, so setup did not fetch glab`);
  }
  if (typeof folder === 'string') {
    const roots = [path.resolve(folder)];
    try {
      roots.push(fs.realpathSync(folder));
    } catch { /* the folder as given */ }
    const inside = (target, root) => {
      const rel = path.relative(root, target);
      return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
    };
    if ([path.resolve(from), file].some((target) => roots.some((root) => inside(target, root)))) {
      throw new Error(`Your company's list at ${from} is inside this project's folder, where an agent could change it, so setup did not fetch glab: keep the list outside the project`);
    }
  }
  return file;
}

// A source for a card: as it is when short, else its beginning and end with an ellipsis between.
const SHOWN_SOURCE = 64;
const shownSource = (from) => (from.length <= SHOWN_SOURCE ? from : `${from.slice(0, 40)}…${from.slice(-(SHOWN_SOURCE - 41))}`);

// The company's list read, on disk or at its address, as the release the fetch needs: its version
// (or null), the checksums it gives (from a `checksums.txt` link and from `sha256` on the links), the
// names, and how to read one file. Only the list and its checksum file are read here.
async function companyRelease({ from, folder, fetch }) {
  let listText;
  let bytesOf;
  if (isAddress(from)) {
    const listUrl = new URL(from);
    const resolve = (name, link) => {
      let url = null;
      try {
        url = new URL(link ?? name, listUrl);
      } catch { /* not an address */ }
      if (url === null || url.protocol !== 'https:' || url.host !== listUrl.host || url.username || url.password) {
        throw new Error(`${name} is not on the company's list host, so setup did not fetch it`);
      }
      return url.href;
    };
    const get = async (url) => {
      try {
        return await getOk(fetch, url, { redirect: 'error' });
      } catch (error) {
        const kind = failureKind(error);
        if (kind === 'certificate') {
          throw new Error(`The certificate at ${listUrl.host}, where your company's list is, isn't one this computer trusts, and setup never switches certificate checks off. Ask whoever looks after your company's computers to put the list and its files in a folder on this computer; the change to where Wheelhouse looks for them then reaches you as a card to approve`);
        }
        if (kind === 'unreachable') throw new Error(`Your company's list at ${listUrl.host} can't be reached from here, perhaps off the company network`);
        throw error;
      }
    };
    listText = await (await get(from)).text();
    bytesOf = { resolve, bytes: async (url) => Buffer.from(await (await get(url)).arrayBuffer()), text: async (url) => (await get(url)).text() };
  } else {
    const file = outsideProject(from, folder);
    const beside = path.dirname(file);
    const resolve = (name, link) => {
      const leaf = link ?? name;
      if (leaf === '' || leaf === '.' || leaf === '..' || path.basename(leaf) !== leaf || /[\\/]/.test(leaf)) throw new Error(`${name} is not beside the company's list, so setup did not use it`);
      return path.join(beside, leaf);
    };
    const read = (target) => {
      const info = fs.lstatSync(target);
      if (!info.isFile()) throw new Error(`${path.basename(target)} is not a plain file, so setup did not use it`);
      return fs.readFileSync(target);
    };
    try {
      if (fs.statSync(file).size > LIST_LIMIT) throw new Error('too large');
      listText = fs.readFileSync(file, 'utf8');
    } catch {
      throw new Error(`Your company's list at ${file} could not be read, so setup did not fetch glab`);
    }
    bytesOf = { resolve, bytes: async (target) => read(target), text: async (target) => read(target).toString('utf8') };
  }
  let list;
  try {
    list = JSON.parse(listText);
  } catch {
    throw new Error('Your company\'s list is not a readable list, so setup did not fetch glab');
  }
  const links = Array.isArray(list?.assets?.links) ? list.assets.links.filter((l) => l && typeof l.name === 'string') : [];
  if (links.length === 0) throw new Error('Your company\'s list names no files, so setup did not fetch glab');
  const byName = new Map(links.map((l) => [l.name, bytesOf.resolve(l.name, typeof l.direct_asset_url === 'string' ? l.direct_asset_url : undefined)]));
  const sums = new Map();
  if (byName.has('checksums.txt')) {
    for (const [name, sum] of parseChecksums(await bytesOf.text(byName.get('checksums.txt')))) sums.set(name, sum);
  }
  for (const l of links) {
    if (l.sha256 === undefined) continue;
    if (typeof l.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(l.sha256)) throw new Error(`The checksum the company's list gives for ${l.name} is not readable, so setup did not use it`);
    if (!sums.has(l.name)) sums.set(l.name, l.sha256.toLowerCase());
  }
  return {
    company: true,
    tag: typeof list.tag_name === 'string' && list.tag_name !== '' ? list.tag_name : null,
    checksumText: [...sums].map(([name, sum]) => `${sum}  ${name}`).join('\n'),
    names: [...byName.keys()],
    bytesFor: (name) => bytesOf.bytes(byName.get(name)),
  };
}

// What a company's list says about the glab file this computer would take: its version and whether
// the list gives a checksum for it. Reads only.
async function describeCompany({ source, folder, fetch, platform, arch }) {
  const release = await companyRelease({ from: source.from, folder, fetch });
  const name = pickArchive('glab', release.names, platform, arch);
  const version = versionOf(name);
  checkListedVersion(release, version);
  if (parseChecksums(release.checksumText).has(name)) return { from: 'company', source: source.from, version, checksum: 'listed' };
  // No checksum to hold the file to: the file as it is now is hashed (a read, not a run) and the hash goes
  // in the change, so apply uses only that file.
  return { from: 'company', source: source.from, version, checksum: 'none', pin: crypto.createHash('sha256').update(await release.bytesFor(name)).digest('hex') };
}

function checkListedVersion(release, version) {
  if (release.tag !== null && release.tag.replace(/^v/, '') !== version) {
    throw new Error(`The company's list says ${release.tag}, but its glab file is ${version}, so setup did not use it`);
  }
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
export async function fetchHostTool({
  tool, platform = process.platform, arch = process.arch, fetch = globalThis.fetch, run = realRun, record,
  source = { kind: 'gitlab', from: null }, folder, pin, expectVersion,
} = {}) {
  if (!HOST_TOOLS.includes(tool)) throw new Error(`There is no host tool named ${tool}`);
  const company = source?.kind === 'company';
  if (company && tool !== 'glab') throw new Error(`A company's list gives glab only, not ${tool}`);
  const release = company ? await companyRelease({ from: source.from, folder, fetch }) : await SOURCES[tool](fetch);
  const sums = parseChecksums(release.checksumText);
  const name = pickArchive(tool, release.names, platform, arch);
  const version = versionOf(name);
  if (company) checkListedVersion(release, version);
  if (expectVersion !== undefined && expectVersion !== version) throw new Error(`The company's list now offers glab ${version}, not ${expectVersion} as the card said: ask for step 2's card again`);
  const tagged = release.tag ?? `v${version}`;
  // A copy the list gives no checksum for is used only if the card that said so named this very file:
  // `pin` is the hash the plan took of it.
  if (company && !sums.has(name) && pin === undefined) {
    throw new ChecksumError(`${name} has no checksum on the company's list, so setup did not use it until a card says so and you agree`);
  }
  const bytes = company ? await release.bytesFor(name) : await getBytes(fetch, official(release.urlFor(name), tool));
  if (!company || sums.has(name)) verifyChecksum(name, bytes, sums);
  else if (crypto.createHash('sha256').update(bytes).digest('hex') !== pin) {
    throw new ChecksumError(`${name} is not the file the card was shown, so setup did not use it: ask for step 2's card again`);
  }
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
    fs.writeFileSync(path.join(staged, 'version'), `${tagged}\n`);
    const ran = await run(program, ['--version']);
    if (ran.code !== 0) throw new Error(`${tool} was fetched but would not run`);
    let before = null;
    try {
      before = { version: fs.readFileSync(path.join(target, 'version'), 'utf8').trim() };
    } catch { /* none there, or none setup fetched */ }
    if (typeof record === 'function') {
      record({ id: newId('chg'), kind: 'folder', target, before: fs.existsSync(target) ? before ?? {} : null, after: { tool, version: tagged } });
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
    return [detectHost(url, readGitlabHosts(folder)) === 'github' ? 'gh' : 'glab'];
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

// ---- The company's own certificate authority (check 71) ----

// Gives a company GitLab's certificate authority to the tools, for that address only. The computer's
// own certificates are copied into <home>/ca/company.pem when the file is not there yet (or `refresh`
// asks for them again); `glab` is told the file for the host (`glab config set ca_cert`, in glab's own
// configuration, as it runs today). Git is not run and nothing of the person's git configuration is
// written: its settings come back as `gitConfig`, entries for the environment of a git call that
// reaches this address (withGitConfig), and Node.js's as `nodeEnv`. A step that applies it adds it to
// the journal as it does any other change. `verify({ file })`, when given, tries GitLab with the staged
// certificates alone and says 'certificate' when they still do not cover it: the file is then thrown away,
// glab is not run, and the step stops with CERTIFICATE_NOT_IN_STORE.
export async function applyCompanyCa({ base, home = wheelhouseHome(), platform = process.platform, run = realRun, refresh = false, verify } = {}) {
  // The address is checked first (https, or http on this computer): nothing is written or run for another.
  const address = addressOf(base);
  const file = caFile(home);
  // New certificates are staged beside the file and put in place only once glab has accepted it, so a
  // failure leaves the file as it was (or none), never one that says the work is done.
  const staged = refresh || !fs.existsSync(file) ? stageCaFile({ home, pem: await exportSystemRoots({ platform, run }) }) : null;
  if (staged !== null && typeof verify === 'function') {
    let kind;
    try {
      kind = await verify({ file: staged.temporary });
    } catch {
      kind = 'other';
    }
    if (kind === 'certificate') {
      staged.discard();
      throw new Error(CERTIFICATE_NOT_IN_STORE);
    }
  }
  const host = new URL(address).host;
  const set = await quietly(run, toolPath('glab', { platform }), glabCaArgs(host, file));
  if (set.code !== 0) {
    staged?.discard();
    throw new Error(`glab could not be given the company's certificate for ${host}`);
  }
  staged?.commit();
  return { file, glabHost: host, nodeEnv: caEnv(home), gitConfig: gitCaConfig(address, file, platform) };
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

// The card of a list with something on it: an empty list settles the step (ruling R75). A card is
// limited in length (CARD.chars), and a first run can list git's installer, both host tools and the
// permission rule at once, so the full wording is tried first and, when it does not compose, a terse one:
// one short clause for each, the source of a company's list shortened (all of it stays in the change,
// and so under the plan hash). The warning that a company's copy has no checksum is in both.
function cardFor(changes, status, platform) {
  const processes = changes.filter((x) => x.kind === 'process');
  const fetches = changes.filter((c) => c.action === 'fetch');
  const official = fetches.filter((c) => c.from !== 'company').map((c) => c.tool);
  const company = fetches.filter((x) => x.from === 'company');
  const rule = changes.some((c) => c.kind === 'json-key');
  const here = Object.entries(status).filter(([, s]) => s.ok).map(([tool, s]) => `${tool === 'node' ? 'Node.js' : tool} ${s.version}`);
  const full = [];
  for (const c of processes) full.push(c.action === 'wait' ? 'git: waiting for the git installer already open, which setup leaves to finish' : installLine(platform));
  if (official.length > 0) {
    full.push(`${official.join(' and ')}, the host's command-line ${official.length === 1 ? 'tool' : 'tools'}: fetched from ${official.length === 1 ? 'its' : 'their'} official release into Wheelhouse's tools folder, checked against the published checksums; a few seconds, nothing for you to do`);
  }
  for (const c of company) {
    full.push(`${c.tool}, from your company's list at ${c.source} (version ${c.version}); ${c.checksum === 'listed'
      ? 'checked against the checksum the list gives'
      : 'the list gives no checksum, so setup cannot check the file. Setup runs it once to read its version, and after that it is the glab Wheelhouse uses for your GitLab work, including your sign-in. Say Not now if unsure'}`);
  }
  if (rule) full.push('one permission rule in this project\'s .claude/settings.local.json, so setup\'s own command is not asked about each time');
  const terse = [];
  for (const c of processes) terse.push(c.action === 'wait' ? 'git: waiting for its installer' : 'git: its installer');
  if (official.length > 0) terse.push(`${official.join(' and ')}: official ${official.length === 1 ? 'release' : 'releases'}, checked`);
  for (const c of company) {
    terse.push(c.checksum === 'listed'
      ? `${c.tool}: from your company's list at ${shownSource(c.source)}, checked`
      : `${c.tool}: from your company's list at ${shownSource(c.source)}, no checksum; it becomes your glab for GitLab and sign-in; Not now if unsure`);
  }
  if (rule) terse.push('one permission rule');
  const card = (what) => ({
    kind: 'setup',
    level: 3,
    what,
    why: 'Wheelhouse keeps the project on GitHub or GitLab through git and the host\'s own tool.',
    options: [
      { label: SETUP_LABEL, says: 'Setup starts what is listed and moves on to its questions while it runs.' },
      { label: 'Not now', says: 'Setup waits at this step; nothing is installed.' },
    ],
    recommend: SETUP_LABEL,
    because: company.length > 0 ? 'setup needs them for the next steps' : 'each comes from its official source, and setup needs them for the next steps',
    meanwhile: 'Setup waits at this step; nothing is installed.',
  });
  const long = card(`Setup step 2, ${SETUP_TITLES[2]}: ${full.join('; ')}.${here.length > 0 ? ` Already here: ${here.join(', ')}.` : ''}`);
  try {
    composeCard({ ...long, target: { step: 2, hash: '0'.repeat(64) } });
    return long;
  } catch (error) {
    if (!isTooLong(error)) throw error;
    // too long: the terse card below
  }
  return card(`Setup step 2, ${SETUP_TITLES[2]}: ${terse.join('; ')}.`);
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
      for (const tool of hostTools) {
        if (status[tool].ok) continue;
        const change = { kind: 'folder', target: toolFolder(tool), action: 'fetch', tool };
        // Where the project's glabFrom names the company's own list, glab comes from there; what the list
        // says (its version, whether it gives a checksum) goes on the card before anything is fetched.
        const source = tool === 'glab' ? glabSource({ setting: readGlabFrom(ctx.folder) }) : null;
        if (source?.kind === 'company') Object.assign(change, await describeCompany({ source, folder: ctx.folder, fetch, platform, arch }));
        changes.push(change);
      }
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
      const fetches = changes.filter((c) => c.action === 'fetch').map((c) => (c.from === 'company'
        // What the card said: the list it named, the version it gave, and whether it gave a checksum.
        ? fetchHostTool({ tool: c.tool, platform, arch, fetch, run, record, source: glabSource({ setting: `company ${c.source}` }), folder: ctx.folder, expectVersion: c.version, ...(c.checksum === 'none' ? { pin: c.pin } : {}) })
        : fetchHostTool({ tool: c.tool, platform, arch, fetch, run, record })));
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
