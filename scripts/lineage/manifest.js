// scripts/lineage/manifest.js
// The manifest: what Wheelhouse pins of the upstream skill kits it runs on, with a
// fingerprint of each folder and file it uses (lineage/manifest.json). `write`
// is for Wheelhouse's release work: it fetches each upstream at its pinned commit
// into a new temporary folder and fingerprints the copy.
//   node scripts/lineage/manifest.js write
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_CODE_FLOOR } from '../lib/build-loop.js';
import { run, withoutGitVars } from '../lib/run.js';
import { fingerprintFile, fingerprintTree } from './fingerprint.js';

export const MANIFEST_PATH = 'lineage/manifest.json';
export const MODELS = 'the routing table in .claude/wheelhouse.json';
// The marketplace Wheelhouse installs the pinned copies through.
const MARKETPLACE = 'wheelhouse';

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

const repoRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// --- Reading ---

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isHashed = (list) => Array.isArray(list) && list.every((item) => isObject(item) && typeof item.path === 'string' && (typeof item.hash === 'string' || item.hash === null));

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
    && Array.isArray(manifest.upstreams)
    && manifest.upstreams.every((u) => isObject(u)
      && ['name', 'plugin', 'repo', 'ref', 'sha'].every((key) => typeof u[key] === 'string')
      && isHashed(u.folders) && isHashed(u.files));
  if (!ok) throw new Error(`The manifest ${MANIFEST_PATH} isn't in the form Wheelhouse expects`);
  return manifest;
}

// --- Finding what is installed ---

const sameFolder = (a, b) => typeof a === 'string' && typeof b === 'string'
  && path.resolve(a.replace(/\\/g, '/')).toLowerCase() === path.resolve(b.replace(/\\/g, '/')).toLowerCase();

// The project-scope install of `upstream` for `projectDir`, from Claude Code's record of
// installs: { dir, sha }, or null when there is none (or the record can't be read).
export function locateInstalled(upstream, { projectDir, claudeHome = path.join(os.homedir(), '.claude') } = {}) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(path.join(claudeHome, 'plugins', 'installed_plugins.json'), 'utf8'));
  } catch {
    return null;
  }
  const installs = record?.plugins?.[`${upstream.plugin}@${MARKETPLACE}`];
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

// Compares what is installed with the manifest. `locate(upstream)` gives { dir, sha } or
// null. Each mismatch names the upstream, the path (`*` for a missing install, `@commit`
// for a different commit) and the hash or commit wanted and found (null when absent).
export function checkInstalled({ manifest, locate = locateInstalled }) {
  const mismatches = [];
  for (const upstream of manifest.upstreams) {
    const installed = locate(upstream);
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
  const env = { GIT_TERMINAL_PROMPT: '0' };
  const git = async (...args) => {
    const result = await run('git', ['-c', 'core.autocrlf=false', ...args], { cwd: dir, baseEnv: withoutGitVars(), env, timeoutMs: 300000 });
    if (result.code !== 0) throw new Error(`git ${args[0]} failed for ${upstream.name}: ${result.stderr.trim().split('\n').pop()}`);
    return result.stdout.trim();
  };
  await git('init', '--quiet');
  await git('fetch', '--quiet', '--depth', '1', upstream.repo, upstream.sha);
  await git('-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD');
  const head = await git('rev-parse', 'HEAD');
  if (head !== upstream.sha) throw new Error(`${upstream.name} fetched ${head}, not ${upstream.sha}`);
}

// The manifest for the upstream copies in `roots` (name -> folder), fingerprinted.
export function buildManifest({ roots, version, upstreams = UPSTREAMS }) {
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
    claudeCode: { floor: CLAUDE_CODE_FLOOR },
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

function startedAsScript() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (Boolean(process.argv[1]) && startedAsScript()) {
  const [command] = process.argv.slice(2);
  if (command !== 'write') {
    process.stderr.write('usage: node scripts/lineage/manifest.js write\n');
    process.exit(2);
  }
  try {
    await writeManifest({ log: (line) => process.stdout.write(`${line}\n`) });
    process.stdout.write(`wrote ${MANIFEST_PATH}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
