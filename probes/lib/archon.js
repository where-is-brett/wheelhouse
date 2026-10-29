// probes/lib/archon.js
// A scratch Archon for the early checks (74 to 79): the pinned release's binary and a pinned Bun, downloaded
// into a folder under the system's temporary folder and checked against pinned checksums, with Archon's home
// there too. Every probe runs Archon through archonRun, which refuses an environment without the three
// telemetry switches (spec 6.3). Nothing here runs at load time, and nothing touches ~/.archon.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { run as defaultRun } from '../../scripts/lib/run.js';
import { assertUnderTmp } from './scratch.js';

export const ARCHON_VERSION = '0.13.0';
// The newest Bun release at least two weeks old on 29 October 2026 (bun-v1.4.3, published 10 October 2026).
export const BUN_VERSION = '1.4.3';

// Checksums pinned from the releases' own lists on 29 October 2026; a download that doesn't match is refused.
export const PINNED = Object.freeze({
  'archon-darwin-arm64': '80a4919d01fd08057a7b6e4bd848c73fa5f497554b01c937d1b945eda049d6db',
  'archon-darwin-x64': 'ef4050d566fc31a150a411079290d3674c36153577e2e26d4398ba31b6f104ea',
  'bun-darwin-aarch64.zip': '80afd4c069b46a6fa8f3ec520bebc750a7843e4a8d5b9583d29ad436c00a3403',
  'bun-darwin-x64.zip': '62660e6438eb872278877acca77e1152d5d031324df368d4a81b428211489d2d',
});

const ARCHON_RELEASE = `https://github.com/coleam00/Archon/releases/download/v${ARCHON_VERSION}`;
const BUN_RELEASE = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}`;

// The switches that keep Archon's usage reporting off, and the values they must have.
export const TELEMETRY = Object.freeze({ ARCHON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', POSTHOG_API_KEY: 'off' });

// Folders with the system's own tools (git, bash, ps). The caller's PATH is never kept, since it may hold a real gh.
const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
// The few variables kept from the caller's environment. No token or host variable passes.
const KEPT = ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'TERM'];

// The full environment of spec 6.3. `ghDir` (E3's broker) and `nodeDir` (the Node the Copilot CLI runs on) are
// added to PATH only when passed.
export function archonEnv({ home, bunDir, claudeBin, copilotBin, ghDir, nodeDir, extra = {}, baseEnv = process.env } = {}) {
  if (!home || !bunDir) throw new Error('archonEnv needs the scratch home and the Bun folder');
  const env = {};
  for (const name of KEPT) if (baseEnv[name] !== undefined) env[name] = baseEnv[name];
  const dirs = [bunDir];
  if (ghDir) dirs.push(ghDir);
  if (nodeDir) dirs.push(nodeDir);
  env.PATH = [...dirs, ...SYSTEM_PATH].join(path.delimiter);
  env.ARCHON_HOME = home;
  if (claudeBin) env.CLAUDE_BIN_PATH = claudeBin;
  if (copilotBin) env.COPILOT_BIN_PATH = copilotBin;
  return { ...env, ...extra, ...TELEMETRY };
}

// The first JSON object in `stdout`: the whole text, or else the last line that parses.
function parseJson(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* not one document */ }
  const lines = text.split(/\r?\n/).reverse();
  for (const line of lines) {
    try { const value = JSON.parse(line); if (value && typeof value === 'object') return value; } catch { /* next */ }
  }
  return null;
}

// Runs `archon <args>` with exactly `env`. Refuses, running nothing, when ARCHON_HOME or a telemetry switch is missing.
export async function archonRun(args, { env, cwd, run = defaultRun, bin, timeoutMs, signal, onOutput } = {}) {
  if (!env || !env.ARCHON_HOME) throw new Error('Refusing to run Archon: ARCHON_HOME is not set');
  for (const [name, value] of Object.entries(TELEMETRY)) {
    if (env[name] !== value) throw new Error(`Refusing to run Archon: ${name} is not ${value}`);
  }
  if (!bin) throw new Error('archonRun needs the path of the scratch binary');
  const result = await run(bin, args, { cwd, env, baseEnv: {}, timeoutMs, signal, onOutput });
  return { code: result.code, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut === true, json: parseJson(result.stdout) };
}

// The JSON lines of `attention --watch --json`, from an array of lines or a block of text. Blank lines and
// lines that aren't JSON objects are skipped.
export function readEvents(input) {
  const lines = Array.isArray(input) ? input : String(input ?? '').split(/\r?\n/);
  const events = [];
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value)) events.push(value);
    } catch { /* not an event */ }
  }
  return events;
}

// The checksum a `sha256sum`-style list gives for `name`.
export function checksumFor(list, name) {
  for (const line of String(list).split(/\r?\n/)) {
    const [sum, file] = line.trim().split(/\s+/);
    if (file === name || file === `*${name}`) return sum;
  }
  throw new Error(`The list has no checksum for ${name}`);
}

async function download(url, fetcher) {
  const response = await fetcher(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Downloads `name` from `release`, checks it against the release's list and the pinned checksum, and writes it.
async function fetchChecked({ release, name, list, into, fetcher }) {
  const body = await download(`${release}/${name}`, fetcher);
  const got = sha256(body);
  const listed = checksumFor(list, name);
  if (got !== listed) throw new Error(`${name}: checksum ${got} is not the release's ${listed}`);
  if (PINNED[name] && got !== PINNED[name]) throw new Error(`${name}: checksum ${got} is not the pinned ${PINNED[name]}`);
  const file = path.join(into, name);
  fs.writeFileSync(file, body);
  return file;
}

// Installs the scratch engine under `root`: bin/archon, bun/bun and home/. Then adds the Claude provider, which
// needs the network. `claudeBin` defaults to ~/.local/bin/claude.
export async function installScratch({ root, run = defaultRun, fetcher = fetch, arch = process.arch, claudeBin } = {}) {
  assertUnderTmp(root);
  const archonArch = arch === 'arm64' ? 'arm64' : 'x64';
  const bunArch = arch === 'arm64' ? 'aarch64' : 'x64';
  const dl = path.join(root, 'dl');
  const binDir = path.join(root, 'bin');
  const bunDir = path.join(root, 'bun');
  const home = path.join(root, 'home');
  for (const dir of [dl, binDir, bunDir, home]) fs.mkdirSync(dir, { recursive: true });

  const archonList = (await download(`${ARCHON_RELEASE}/checksums.txt`, fetcher)).toString('utf8');
  const archonFile = await fetchChecked({ release: ARCHON_RELEASE, name: `archon-darwin-${archonArch}`, list: archonList, into: dl, fetcher });
  const archonBin = path.join(binDir, 'archon');
  fs.renameSync(archonFile, archonBin);
  fs.chmodSync(archonBin, 0o755);

  const bunList = (await download(`${BUN_RELEASE}/SHASUMS256.txt`, fetcher)).toString('utf8');
  const zip = await fetchChecked({ release: BUN_RELEASE, name: `bun-darwin-${bunArch}.zip`, list: bunList, into: dl, fetcher });
  const unzip = await run('/usr/bin/unzip', ['-q', '-o', zip, '-d', dl]);
  if (unzip.code !== 0) throw new Error(`unzip failed: ${unzip.stderr}`);
  fs.renameSync(path.join(dl, `bun-darwin-${bunArch}`, 'bun'), path.join(bunDir, 'bun'));
  fs.chmodSync(path.join(bunDir, 'bun'), 0o755);

  const claude = claudeBin ?? path.join(os.homedir(), '.local', 'bin', 'claude');
  const env = archonEnv({ home, bunDir, claudeBin: claude });
  const added = await archonRun(['provider', 'add', 'claude'], { env, run, bin: archonBin, cwd: root, timeoutMs: 300000 });
  if (added.code !== 0) throw new Error(`archon provider add claude failed: ${(added.stderr || added.stdout).slice(0, 500)}`);
  return { archonBin, bunDir, home, claudeBin: claude };
}

// Removes the scratch root. On macOS it goes to the Trash (nothing is deleted outright); elsewhere it is removed.
export async function cleanScratch(root, { run = defaultRun, platform = process.platform } = {}) {
  assertUnderTmp(root);
  if (!fs.existsSync(root)) return;
  if (platform === 'darwin' && fs.existsSync('/usr/bin/trash')) {
    const result = await run('/usr/bin/trash', [root]);
    if (result.code === 0 && !fs.existsSync(root)) return;
    throw new Error(`Could not move ${root} to the Trash: ${result.stderr.trim()}`);
  }
  await fs.promises.rm(root, { recursive: true, force: true });
}

// Gives every file under `dir` named `<name>.fixture` its real name. Test files a probe seeds into a scratch project
// are kept in the repository with that suffix, so the repository's own test runners never pick them up.
export function unfixture(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) unfixture(file);
    else if (entry.name.endsWith('.fixture')) fs.renameSync(file, file.slice(0, -'.fixture'.length));
  }
}
