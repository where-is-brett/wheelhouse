// scripts/lineage/manifest.js
// The manifest: what Wheelhouse pins of the upstream skill kits it runs on, with a
// fingerprint of each folder and file it uses (lineage/manifest.json). `write`
// is for Wheelhouse's release work: it fetches each upstream at its pinned commit
// into a new temporary folder and fingerprints the copy. `verify` is CI's lineage
// job: it fetches each upstream the same way and checks the manifest, the register's
// anchors and carried text, and the marketplace's pins against what it fetched.
//   node scripts/lineage/manifest.js write
//   node scripts/lineage/manifest.js verify
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_CODE_FLOOR } from '../lib/build-loop.js';
import { run } from '../lib/run.js';
import { reachFor, safeGit } from '../lib/safe-git.js';
import { readCopies } from './copies.js';
import { fingerprintFile, fingerprintTree } from './fingerprint.js';
import { checkAnchors, checkCarried, readRegister } from './register.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { AGENT_PINS } from '../agents/pins.js';
import { ENGINE_PINS, manifestPins } from '../engine/pins.js';

export const MANIFEST_PATH = 'lineage/manifest.json';
export const MODELS = 'the routing table in .claude/wheelhouse.json';
// The marketplace Wheelhouse installs the pinned copies through.
export const MARKETPLACE = 'wheelhouse';
// Wheelhouse's own repository on GitHub, named once: the project's settings fetch the
// marketplace from it, and the gate reads a release's tag from its https address.
export const WHEELHOUSE_REPO = 'where-is-brett/wheelhouse';
export const WHEELHOUSE_URL = `https://github.com/${WHEELHOUSE_REPO}.git`;

// The pins (check 24) and what Wheelhouse uses of each upstream. Paths are relative to
// the upstream's repository root.
export const UPSTREAMS = Object.freeze([
  {
    name: 'superpowers',
    plugin: 'superpowers',
    repo: 'https://github.com/obra/superpowers.git',
    ref: 'v7.0.0',
    sha: 'bb92a77741419a4ab5f06e711a283343f1ada0c3',
    folders: [
      'brainstorming', 'using-git-worktrees', 'writing-plans', 'subagent-driven-development', 'executing-plans',
      'test-driven-development', 'systematic-debugging', 'dispatching-parallel-agents', 'requesting-code-review',
      'receiving-code-review', 'verification-before-completion', 'finishing-a-development-branch', 'using-superpowers',
    ].map((skill) => `skills/${skill}`),
    files: ['hooks/session-start', 'hooks/hooks.json', 'LICENSE'],
  },
  {
    name: 'mattpocock-skills',
    plugin: 'mattpocock-skills',
    repo: 'https://github.com/mattpocock/skills.git',
    ref: 'v1.3.1',
    sha: '24fe0ef7737efae15c87225755e9f6f5965e4888',
    folders: ['tdd', 'code-review', 'prototype', 'domain-modeling', 'implement'].map((skill) => `skills/engineering/${skill}`),
    files: ['LICENSE'],
  },
]);

// The sources of skill copies (skills/*/SOURCE.md) that aren't among the kits above, pinned the same way. A copy
// taken from a kit is pinned by the kit's own entry. These are never installed or fingerprinted for a project.
export const COPY_SOURCES = Object.freeze([
  {
    name: 'frontend-design',
    repo: 'https://github.com/anthropics/claude-plugins-official.git',
    ref: '1.1.1',
    sha: 'f8c5e7a1dcb71b10cb74586224b5401f3de5db28',
  },
]);

const repoRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// --- Reading ---

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
// The agents' pins (`agents`, ruling P8-18): each agent's name, with the version of its command line it is pinned to.
const PIN = /^\d+\.\d+\.\d+$/;
const pinsOk = (agents) => isObject(agents) && Object.entries(agents).every(([name, pin]) => /^[a-z0-9-]{1,64}$/.test(name) && isObject(pin) && typeof pin.cli === 'string' && PIN.test(pin.cli));
const isHashed = (list) => Array.isArray(list) && list.every((item) => isObject(item) && typeof item.path === 'string' && typeof item.hash === 'string');

// The manifest in `root`'s lineage folder; throws when it is missing or is not a manifest.
export function readManifest(root = repoRoot()) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), 'utf8'));
  } catch {
    throw new Error(`The manifest ${MANIFEST_PATH} can't be read`);
  }
  const ok = isObject(manifest) && manifest.v === 1
    && typeof manifest.wheelhouse?.version === 'string'
    && typeof manifest.claudeCode?.floor === 'string'
    && typeof manifest.models === 'string'
    && (manifest.agents === undefined || pinsOk(manifest.agents))
    && (manifest.copies === undefined || isHashed(manifest.copies))
    && Array.isArray(manifest.upstreams)
    && manifest.upstreams.every((u) => isObject(u)
      && ['name', 'plugin', 'repo', 'ref', 'sha'].every((key) => typeof u[key] === 'string')
      && isHashed(u.folders) && isHashed(u.files));
  if (!ok) throw new Error(`The manifest ${MANIFEST_PATH} isn't in the form Wheelhouse expects`);
  return manifest;
}

// --- Finding what is installed ---

// Claude Code records a project's folder with its links resolved (on macOS /var is /private/var),
// so each side is compared as given and as its real path.
const realOrSame = (dir) => {
  try { return fs.realpathSync(dir); } catch { return dir; }
};
const spelled = (dir) => path.resolve(dir.replace(/\\/g, '/')).toLowerCase();
const sameFolder = (a, b) => typeof a === 'string' && typeof b === 'string'
  && [a, realOrSame(a)].some((x) => [b, realOrSame(b)].some((y) => spelled(x) === spelled(y)));

// The user's Claude folder: CLAUDE_CONFIG_DIR when it is set, else ~/.claude.
export function claudeHome(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// The project-scope install of `upstream` for `projectDir`, from Claude Code's record of
// installs: { dir, sha }, or null when there is none (or the record can't be read).
// `marketplace` is Wheelhouse's own unless a probe names a scratch one.
export function locateInstalled(upstream, { projectDir, claudeHome: home = claudeHome(), marketplace = MARKETPLACE } = {}) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(path.join(home, 'plugins', 'installed_plugins.json'), 'utf8'));
  } catch {
    return null;
  }
  const installs = record?.plugins?.[`${upstream.plugin}@${marketplace}`];
  if (!Array.isArray(installs)) return null;
  const found = installs.find((install) => isObject(install) && install.scope === 'project' && sameFolder(install.projectPath, projectDir)
    && typeof install.installPath === 'string' && typeof install.gitCommitSha === 'string');
  return found ? { dir: found.installPath, sha: found.gitCommitSha } : null;
}

// --- Checking ---

function hashAt(dir, relative, hasher) {
  const parts = relative.split('/');
  if (relative === '' || path.isAbsolute(relative) || parts.includes('..')) return null;
  try {
    return hasher(path.join(dir, ...parts)).hash;
  } catch {
    return null;
  }
}

// Compares what is installed for the project in `projectDir` with the manifest.
// `locate(upstream, { projectDir, claudeHome })` gives { dir, sha } or null. Each mismatch
// names the upstream, the path (`*` for a missing install, `@commit` for a different
// commit) and the hash or commit wanted and found (null when absent).
export function checkInstalled({ manifest, projectDir, claudeHome: home, locate = locateInstalled }) {
  const mismatches = [];
  for (const upstream of manifest.upstreams) {
    const installed = locate(upstream, { projectDir, claudeHome: home });
    if (!installed) {
      mismatches.push({ upstream: upstream.name, path: '*', want: upstream.sha, got: null });
      continue;
    }
    if (installed.sha !== upstream.sha) mismatches.push({ upstream: upstream.name, path: '@commit', want: upstream.sha, got: installed.sha });
    for (const [list, hasher] of [[upstream.folders, fingerprintTree], [upstream.files, fingerprintFile]]) {
      for (const { path: relative, hash } of list) {
        const got = hashAt(installed.dir, relative, hasher);
        if (got !== hash) mismatches.push({ upstream: upstream.name, path: relative, want: hash, got });
      }
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

// --- Writing ---

// Fetches `upstream` at its pinned commit, shallow, into `dir` (a new, empty folder).
export async function fetchUpstream(upstream, dir) {
  // `dir` is a new, empty folder of Wheelhouse's own, so there is no config of anyone else's to look
  // at: the fence alone.
  const fenced = safeGit({ run, cwd: dir, reach: reachFor(upstream.repo), look: 'never', timeoutMs: 300000 });
  const git = async (...args) => {
    const result = await fenced(['-c', 'core.autocrlf=false', ...args]);
    if (result.code !== 0) throw new Error(`git ${args[0]} failed for ${upstream.name}: ${result.stderr.trim().split('\n').pop()}`);
    return result.stdout.trim();
  };
  await git('init', '--quiet');
  await git('fetch', '--quiet', '--depth', '1', upstream.repo, upstream.sha);
  await git('-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD');
  const head = await git('rev-parse', 'HEAD');
  if (head !== upstream.sha) throw new Error(`${upstream.name} fetched ${head}, not ${upstream.sha}`);
}

// The agents' pins as the manifest holds them, from scripts/agents/pins.js.
export const agentPins = (pins = AGENT_PINS) => Object.fromEntries(Object.entries(pins).map(([name, pin]) => [name, { cli: pin.cli }]));

// The manifest for the upstream copies in `roots` (name -> folder), fingerprinted.
export function buildManifest({ roots, version, upstreams = UPSTREAMS, pins = AGENT_PINS, engine = ENGINE_PINS, copiesRoot = repoRoot() }) {
  return {
    v: 1,
    wheelhouse: { version },
    upstreams: upstreams.map((upstream) => {
      const root = roots[upstream.name];
      return {
        name: upstream.name,
        plugin: upstream.plugin,
        repo: upstream.repo,
        ref: upstream.ref,
        sha: upstream.sha,
        folders: upstream.folders.map((folder) => ({ path: folder, hash: fingerprintTree(path.join(root, ...folder.split('/'))).hash })),
        files: upstream.files.map((file) => ({ path: file, hash: fingerprintFile(path.join(root, ...file.split('/'))).hash })),
      };
    }),
    // Wheelhouse's own skill copies, for the hold of a project whose steps read them (scripts/lineage/check.js).
    copies: readCopies(copiesRoot).map(({ name }) => ({ path: `skills/${name}`, hash: fingerprintTree(path.join(copiesRoot, 'skills', name)).hash })),
    claudeCode: { floor: CLAUDE_CODE_FLOOR },
    agents: agentPins(pins),
    engine: manifestPins(engine),
    models: MODELS,
  };
}

// Fetches every upstream afresh and writes lineage/manifest.json under `root`. Returns
// the manifest. Each fetch goes into its own new folder under the temporary folder, removed after.
export async function writeManifest({ root = repoRoot(), fetchTo = fetchUpstream, log = () => {} } = {}) {
  const version = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const made = [];
  try {
    const roots = {};
    for (const upstream of UPSTREAMS) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wh-lineage-${upstream.name}-`));
      made.push(dir);
      await fetchTo(upstream, dir);
      roots[upstream.name] = dir;
      const started = process.hrtime.bigint();
      const sizes = upstream.folders.map((folder) => fingerprintTree(path.join(dir, ...folder.split('/'))).files);
      log(`${upstream.name}: ${sizes.length} folders, ${sizes.reduce((a, b) => a + b, 0)} files fingerprinted in ${Number(process.hrtime.bigint() - started) / 1e6} ms`);
    }
    const manifest = buildManifest({ roots, version });
    fs.mkdirSync(path.join(root, 'lineage'), { recursive: true });
    fs.writeFileSync(path.join(root, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- Verifying ---

export const MARKETPLACE_PATH = '.claude-plugin/marketplace.json';
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Fetches every upstream the manifest under `root` names, at its commit, into its own new
// temporary folder (removed after), and checks: each listed folder's and file's fingerprint
// is the manifest's; the register's anchors and carried text are found there; the
// marketplace pins each upstream at the manifest's commit; and the pins in this script
// (`upstreams`), the agents' pins (`pins`) and the engine's pins (`engine`) are the manifest's. `log` takes a line for each thing found. Resolves with
// { ok, broken }.
export async function verifyManifest({ root = repoRoot(), fetchTo = fetchUpstream, upstreams = UPSTREAMS, pins = AGENT_PINS, engine = ENGINE_PINS, log = () => {} } = {}) {
  const broken = [];
  const say = (line) => log(line);
  const breaks = (line) => { broken.push(line); say(`broken: ${line}`); };
  const manifest = readManifest(root);
  const register = readRegister(root);
  let marketplace = null;
  try {
    marketplace = JSON.parse(fs.readFileSync(path.join(root, ...MARKETPLACE_PATH.split('/')), 'utf8'));
  } catch {
    breaks(`${MARKETPLACE_PATH} can't be read`);
  }
  const made = [];
  try {
    const roots = {};
    for (const upstream of manifest.upstreams) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wh-lineage-${upstream.name}-`));
      made.push(dir);
      try {
        await fetchTo(upstream, dir);
      } catch (error) {
        breaks(`${upstream.name} could not be fetched at ${upstream.sha}: ${error instanceof Error ? error.message : 'unknown error'}`);
        continue;
      }
      roots[upstream.name] = dir;
      let differ = 0;
      for (const [list, hasher] of [[upstream.folders, fingerprintTree], [upstream.files, fingerprintFile]]) {
        for (const { path: relative, hash } of list) {
          const got = hashAt(dir, relative, hasher);
          if (got === hash) continue;
          differ += 1;
          breaks(`${upstream.name} ${relative}: ${got === null ? 'not there' : `fingerprint ${got}, the manifest has ${hash}`}`);
        }
      }
      const listed = upstream.folders.length + upstream.files.length;
      if (differ === 0) say(`${upstream.name} ${upstream.ref} (${upstream.sha}): ${count(upstream.folders.length, 'folder')} and ${count(upstream.files.length, 'file')}, all as the manifest has them`);
      else say(`${upstream.name} ${upstream.ref} (${upstream.sha}): ${differ} of ${listed} differ from the manifest`);
    }
    const anchors = checkAnchors({ register, roots });
    for (const a of anchors) breaks(`anchor gone: ${a.id}: ${a.file}: ${a.text}`);
    const carried = checkCarried({ register, roots });
    for (const id of carried) breaks(`carried text's source changed: ${id}`);
    const unchecked = [...new Set([...register.overrides, ...register.carried].map((item) => item.upstream))].filter((name) => !roots[name]);
    for (const name of unchecked) breaks(`the register's ${name} entries could not be checked: no copy of ${name} was fetched`);
    const anchorCount = register.overrides.reduce((n, o) => n + (roots[o.upstream] ? o.anchors.length : 0), 0);
    say(`register ${register.version}: ${anchorCount - anchors.length} of ${count(anchorCount, 'anchor')} found, ${register.carried.length - carried.length} of ${count(register.carried.length, 'carried text')} unchanged`);
  } finally {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
  }
  if (marketplace !== null) {
    const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
    for (const upstream of manifest.upstreams) {
      const source = plugins.find((p) => p?.name === upstream.plugin)?.source;
      const pinned = isObject(source) && source.source === 'url' && source.url === upstream.repo && source.ref === upstream.ref && source.sha === upstream.sha;
      if (pinned) say(`${MARKETPLACE_PATH} pins ${upstream.plugin} at ${upstream.ref} (${upstream.sha})`);
      else breaks(`${MARKETPLACE_PATH} does not pin ${upstream.plugin} at the manifest's ${upstream.repo} ${upstream.ref} (${upstream.sha})`);
    }
  }
  const named = (list) => JSON.stringify(list.map(({ name, plugin, repo, ref, sha }) => [name, plugin, repo, ref, sha]));
  if (named(upstreams) !== named(manifest.upstreams)) breaks(`the pins in scripts/lineage/manifest.js are not the manifest's: write the manifest again`);
  if (JSON.stringify(manifest.agents ?? null) !== JSON.stringify(agentPins(pins))) breaks(`the agents' pins in scripts/agents/pins.js are not the manifest's: write the manifest again`);
  if (JSON.stringify(manifest.engine ?? null) !== JSON.stringify(manifestPins(engine))) breaks(`the engine's pins in scripts/engine/pins.js are not the manifest's: write the manifest again`);
  say(broken.length === 0 ? 'lineage ok' : `lineage broken: ${broken.length}`);
  return { ok: broken.length === 0, broken };
}

if (startedAsScript(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  if (!['write', 'verify'].includes(command) || rest.length > 0) {
    process.stderr.write('usage: node scripts/lineage/manifest.js write | verify\n');
    process.exit(2);
  }
  const log = (line) => process.stdout.write(`${line}\n`);
  try {
    if (command === 'verify') {
      process.exitCode = (await verifyManifest({ log })).ok ? 0 : 1;
    } else {
      await writeManifest({ log });
      process.stdout.write(`wrote ${MANIFEST_PATH}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
