// probes/38-host-tools/run.js
// Check 38: can `gh` and `glab` be fetched by a script from their official release archives,
// checked against the published checksums, unpacked with what the system ships and run, with
// no installer and no sign-in? Does everything in a new, empty folder under the temporary
// folder, times each part, and removes the folder at the end. Written for Node.js 22 or later,
// with no installs, on macOS and Windows.
//   node run.js [--tools gh,glab] [--tamper]
//     --tamper   changes one byte of each download before the checksum check, to show the
//                script refuses and stops (the run then exits 1 by design)
// Nothing here reads or uses the director's tokens: release assets of both tools are public,
// every request is anonymous, and the tools are run with an empty home folder and no token
// variables.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const SELF = fileURLToPath(import.meta.url);

export const SYSTEMS = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'darwin', arch: 'x64' },
  { platform: 'win32', arch: 'x64' },
  { platform: 'win32', arch: 'arm64' },
];

// How each tool names its archives. `os` is the word in the archive's name for each platform;
// the archive kind is zip or tar.gz, taken from the name.
export const TOOLS = {
  gh: {
    binary: 'gh',
    os: { darwin: 'macOS', win32: 'windows' },
    pattern: (osWord, archWord) => new RegExp(`^gh_[0-9][^_]*_${osWord}_${archWord}\\.(zip|tar\\.gz)$`),
  },
  glab: {
    binary: 'glab',
    os: { darwin: 'darwin', win32: 'windows' },
    pattern: (osWord, archWord) => new RegExp(`^glab_[0-9][^_]*_${osWord}_${archWord}\\.(zip|tar\\.gz)$`),
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
  const def = TOOLS[tool];
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

export class ChecksumError extends Error {}

// Refuses (throws) when the name is not on the list or the bytes do not match.
export function verifyChecksum(name, bytes, sums) {
  const expected = sums.get(name);
  if (!expected) throw new ChecksumError(`${name} is not on the published checksum list`);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new ChecksumError(`Checksum mismatch for ${name}: published ${expected}, downloaded ${actual}`);
  return actual;
}

// The release tag from a "releases/latest" redirect's address.
export function tagFromLocation(location) {
  const match = /\/releases\/tag\/([^/?#]+)$/.exec(location ?? '');
  if (!match) throw new Error(`Not a release address: ${location}`);
  return decodeURIComponent(match[1]);
}

export function binaryName(tool, platform = process.platform) {
  return TOOLS[tool].binary + (platform === 'win32' ? '.exe' : '');
}

// The unpacked tool's file: archives hold it under bin/, with or without a folder above it.
export function findBinary(dir, name) {
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === name) return full;
    }
  }
  throw new Error(`${name} not found under ${dir}`);
}

export function assertScratch(dir) {
  const resolved = path.resolve(dir);
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const roots = [os.tmpdir(), real(os.tmpdir())].map((root) => path.resolve(root));
  const inside = roots.some((root) => resolved !== root && resolved.startsWith(root + path.sep));
  if (!inside || !path.basename(resolved).startsWith('wheelhouse-check38-')) {
    throw new Error(`Refusing to touch ${resolved}: not a wheelhouse-check38 folder in the temporary folder`);
  }
}

// The command that unpacks an archive: the `tar` the system ships. macOS's and Windows's are
// both bsdtar, which reads zip as well as tar.gz. On Windows the System32 copy is named so a
// GNU tar from Git for Windows, which cannot read zip, is never picked up from the path.
export function unpackCommand(archive, into, { platform = process.platform, systemRoot = process.env.SystemRoot } = {}) {
  const tar = platform === 'win32' ? path.win32.join(systemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  return { file: tar, args: ['-xf', archive, '-C', into] };
}

// ---------- the run ----------

const HEADERS = { 'user-agent': 'wheelhouse-check38-probe' };

async function get(url, init = {}) {
  const response = await fetch(url, { headers: HEADERS, ...init });
  return response;
}

async function getBytes(url) {
  const response = await get(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function timed(timings, label, fn) {
  const start = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    timings[label] = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
  }
}

// Where each tool's official release lives. Neither needs a token.
const SOURCES = {
  gh: {
    async release() {
      // The "latest" address redirects to the tag's page: no API call, so no rate limit.
      const response = await get('https://github.com/cli/cli/releases/latest', { redirect: 'manual' });
      const tag = tagFromLocation(response.headers.get('location'));
      const version = tag.replace(/^v/, '');
      const base = `https://github.com/cli/cli/releases/download/${tag}`;
      const checksumName = `gh_${version}_checksums.txt`;
      const checksumText = (await getBytes(`${base}/${checksumName}`)).toString('utf8');
      return { tag, checksumName, checksumText, urlFor: (name) => `${base}/${name}`, names: [...parseChecksums(checksumText).keys()] };
    },
  },
  glab: {
    async release() {
      // GitLab's release API, anonymously: public projects' releases and their links need no token.
      const api = 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest';
      const response = await get(api, { redirect: 'follow' });
      if (!response.ok) throw new Error(`${api}: HTTP ${response.status}`);
      const release = await response.json();
      const links = release.assets.links;
      const byName = new Map(links.map((link) => [link.name, link.direct_asset_url]));
      const checksumName = 'checksums.txt';
      if (!byName.has(checksumName)) throw new Error('The release lists no checksums.txt');
      const checksumText = (await getBytes(byName.get(checksumName))).toString('utf8');
      return { tag: release.tag_name, checksumName, checksumText, urlFor: (name) => byName.get(name), names: [...byName.keys()] };
    },
  },
};

// Runs a command without a shell and keeps both output streams (codesign writes to stderr).
function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.error) return { ok: false, out: result.error.message };
  return { ok: result.status === 0, out, status: result.status };
}

// What the system says about a file that no browser or app marked as downloaded.
function systemEvidence(file) {
  if (process.platform === 'darwin') {
    const attributes = run('xattr', ['-l', file]).out;
    return {
      // Gatekeeper acts on a file only when it carries com.apple.quarantine, which a browser or
      // a mail app sets. com.apple.provenance, which macOS adds itself, does not ask anything.
      quarantined: attributes.includes('com.apple.quarantine'),
      attributes: attributes || '(none)',
      codesign: run('codesign', ['-dvv', file]).out,
      codesignVerify: run('codesign', ['--verify', '--strict', '--verbose=2', file]).out || 'valid',
      // The question Gatekeeper asks of a downloaded command-line tool: is the signature a
      // notarised Developer ID? (`-t exec` assesses apps and so says "not an app" for a tool.)
      spctlNotarised: run('spctl', ['--assess', '-t', 'open', '--context', 'context:primary-signature', '-vv', file]).out,
      spctlExec: run('spctl', ['--assess', '-t', 'exec', '-vv', file]).out,
    };
  }
  if (process.platform === 'win32') {
    const quoted = file.replaceAll("'", "''");
    const powershell = (command) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]).out;
    return {
      zoneIdentifier: powershell(`Get-Item -LiteralPath '${quoted}' -Stream Zone.Identifier -ErrorAction SilentlyContinue | Out-String`) || '(none)',
      authenticode: powershell(`(Get-AuthenticodeSignature -LiteralPath '${quoted}') | Format-List Status, StatusMessage, SignerCertificate | Out-String`),
    };
  }
  return {};
}

// The tool is run with an empty home folder and no token variables, so it can neither read
// nor change the director's sign-ins or settings.
function cleanEnvironment(home) {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'PATHEXT', 'COMSPEC', 'LANG'];
  const env = {};
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key];
  return { ...env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'), XDG_CONFIG_HOME: path.join(home, '.config'), NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1', GLAB_CHECK_UPDATE: 'false' };
}

export async function main(args) {
  const tools = (args.includes('--tools') ? args[args.indexOf('--tools') + 1] : 'gh,glab').split(',');
  const tamper = args.includes('--tamper');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-check38-'));
  assertScratch(scratch);
  const home = path.join(scratch, 'home');
  fs.mkdirSync(home);
  const report = { node: process.version, platform: process.platform, arch: process.arch, os: os.release(), tools: {} };
  let failure = null;
  try {
    for (const tool of tools) {
      if (!SOURCES[tool]) throw new Error(`Unknown tool ${tool}`);
      const timings = {};
      const entry = { timingsMs: timings };
      report.tools[tool] = entry;
      const release = await timed(timings, 'findRelease', () => SOURCES[tool].release());
      entry.tag = release.tag;
      entry.checksumFile = release.checksumName;
      entry.archives = Object.fromEntries(SYSTEMS.map(({ platform, arch }) => [`${platform} ${arch}`, pickArchive(tool, release.names, platform, arch)]));
      const sums = parseChecksums(release.checksumText);
      const name = pickArchive(tool, release.names, process.platform, process.arch);
      entry.archive = name;
      entry.version = versionOf(name);
      let bytes = await timed(timings, 'download', () => getBytes(release.urlFor(name)));
      entry.bytes = bytes.length;
      if (tamper) bytes = Buffer.concat([Buffer.from([bytes[0] ^ 1]), bytes.subarray(1)]);
      entry.sha256 = await timed(timings, 'checksum', async () => verifyChecksum(name, bytes, sums));
      const folder = path.join(scratch, tool);
      fs.mkdirSync(folder);
      const archivePath = path.join(scratch, name);
      fs.writeFileSync(archivePath, bytes);
      const command = unpackCommand(archivePath, folder);
      entry.unpackedWith = `${path.basename(command.file)} ${command.args[0]}`;
      await timed(timings, 'unpack', async () => execFileSync(command.file, command.args, { stdio: 'pipe' }));
      const binary = findBinary(folder, binaryName(tool));
      entry.binary = path.relative(folder, binary);
      if (process.platform !== 'win32') fs.chmodSync(binary, fs.statSync(binary).mode | 0o111);
      entry.archiveEvidence = systemEvidence(archivePath);
      entry.evidence = systemEvidence(binary);
      entry.versionRun = await timed(timings, 'versionRun', async () => run(binary, ['--version'], { cwd: home, env: cleanEnvironment(home) }));
      if (!entry.versionRun.ok) throw new Error(`${tool} --version failed: ${entry.versionRun.out}`);
      timings.total = Object.entries(timings).filter(([k]) => k !== 'total').reduce((sum, [, v]) => sum + v, 0);
    }
  } catch (error) {
    failure = error;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  report.scratchRemoved = !fs.existsSync(scratch);
  console.log(JSON.stringify(report, null, 2));
  if (failure) {
    console.error(`${failure instanceof ChecksumError ? 'Refused' : 'Failed'}: ${failure.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(SELF)) {
  await main(process.argv.slice(2));
}
