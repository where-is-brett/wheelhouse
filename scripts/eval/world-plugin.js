// scripts/eval/world-plugin.js
// This checkout's Wheelhouse plugin, for an evaluation world on real Archon (archon-world.js) to run its steps with.
// Archon loads a step's named plugin only from Claude Code's record of installs, and its scope check fails a step
// that loads any other (a session-only plugin folder among them), so the world installs a copy of this checkout:
//   - a marketplace of the world's own, in the world's folder, under a name no one else uses
//     (wheelhouse-eval-<world>), holding a copy of the plugin's own files;
//   - added through Claude Code's plugin commands, which record it in the user's list of marketplaces;
//   - the plugin installed from it at project scope for the world's project, as wheelhouse@wheelhouse-eval-<world>,
//     the id the world's pack names in place of wheelhouse@wheelhouse;
//   - taken back when the world closes (the install, any user-scope entry for it that a step's plugin overlay left,
//     as check 75 saw one left for wheelhouse@wheelhouse, then the marketplace), or by the next world when a run was
//     killed first (sweepWorldPlugins).
// check() says whether the install Claude Code records for the project is this checkout's, by version and by the
// digest of its files, so a real play never passes on another release's guards.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as realRun } from '../lib/run.js';

export const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// A world's own marketplace, by name.
export const WORLD_MARKETPLACE = /^wheelhouse-eval-[a-z0-9]+$/;
// What of the checkout is the plugin: everything but its repository, its tests, its documents and its probes.
const LEFT_OUT = new Set(['.git', '.github', '.claude', 'node_modules', 'tests', 'docs', 'probes']);
// The files whose digest marks the plugin as this checkout's: those that run in a step.
const MARKED = ['.claude-plugin/plugin.json', 'hooks', 'scripts', 'adapters'];

const defaultConfig = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const versionOf = (dir) => readJson(path.join(dir, '.claude-plugin', 'plugin.json'))?.version ?? null;
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

// The digest of the plugin's marked files under `dir`, by relative path and content, links followed; null when one
// of them is missing.
export function pluginDigest(dir) {
  const hash = crypto.createHash('sha256');
  const add = (rel) => {
    const file = path.join(dir, rel);
    let stat;
    try { stat = fs.statSync(file); } catch { return false; }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) if (!add(path.join(rel, name))) return false;
      return true;
    }
    hash.update(`${rel.split(path.sep).join('/')}\0`);
    hash.update(fs.readFileSync(file));
    hash.update('\0');
    return true;
  };
  for (const rel of MARKED) if (!add(rel)) return null;
  return hash.digest('hex');
}

// The marketplace name for a world's folder (<tmp>/wh-aw-<id>).
export const marketplaceOf = (root) => `wheelhouse-eval-${path.basename(root).replace(/^wh-aw-/, '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;

// The plugin for one world: { id, install(), remove(), check() }. install() throws naming what failed; remove() never
// fails; check() gives { ok, why }.
export function worldPlugin({ claudeBin, folder, root, checkout = CHECKOUT, configDir = defaultConfig(), runClaude = realRun }) {
  const name = marketplaceOf(root);
  const id = `wheelhouse@${name}`;
  const market = path.join(root, 'marketplace');
  const claude = (args) => runClaude(claudeBin, args, { cwd: folder, timeoutMs: 300000 });
  let added = false;
  let installed = false;
  return {
    id,
    async install() {
      const copy = path.join(market, 'wheelhouse');
      fs.rmSync(market, { recursive: true, force: true });
      fs.mkdirSync(path.join(market, '.claude-plugin'), { recursive: true });
      fs.cpSync(checkout, copy, { recursive: true, filter: (from) => path.dirname(from) !== checkout || !LEFT_OUT.has(path.basename(from)) });
      fs.writeFileSync(path.join(market, '.claude-plugin', 'marketplace.json'), `${JSON.stringify({
        name, owner: { name: 'Wheelhouse evaluation' },
        plugins: [{ name: 'wheelhouse', source: './wheelhouse', description: 'This checkout of Wheelhouse, for one evaluation world.' }],
      }, null, 2)}\n`);
      const add = await claude(['plugin', 'marketplace', 'add', market]);
      if (add.code !== 0) throw new Error(`Claude Code could not add the evaluation's own marketplace: ${String(add.stderr || add.stdout).trim().split('\n')[0]}`);
      added = true;
      const got = await claude(['plugin', 'install', id, '--scope', 'project']);
      if (got.code !== 0) throw new Error(`Claude Code could not install this checkout's Wheelhouse for the evaluation's project: ${String(got.stderr || got.stdout).trim().split('\n')[0]}`);
      installed = true;
    },
    async remove() {
      if (installed) await claude(['plugin', 'uninstall', id, '--scope', 'project']).catch(() => null);
      const left = readJson(path.join(configDir, 'plugins', 'installed_plugins.json'))?.plugins?.[id];
      if (added && Array.isArray(left) && left.some((e) => e?.scope === 'user')) await claude(['plugin', 'uninstall', id, '--scope', 'user']).catch(() => null);
      if (added) await claude(['plugin', 'marketplace', 'remove', name]).catch(() => null);
      installed = false;
      added = false;
    },
    check() {
      const entries = readJson(path.join(configDir, 'plugins', 'installed_plugins.json'))?.plugins?.[id];
      const entry = (Array.isArray(entries) ? entries : []).find((e) => e?.scope === 'project' && typeof e.projectPath === 'string' && real(e.projectPath) === real(folder));
      if (!entry || typeof entry.installPath !== 'string') return { ok: false, why: `Claude Code records no install of ${id} for the evaluation's project, so the steps didn't run this checkout's Wheelhouse` };
      const want = versionOf(checkout);
      const got = versionOf(entry.installPath);
      if (got !== want) return { ok: false, why: `the steps ran Wheelhouse ${got ?? 'of no known version'}, not this checkout's ${want}` };
      if (pluginDigest(entry.installPath) !== pluginDigest(checkout)) return { ok: false, why: `the steps ran a copy of Wheelhouse ${want} whose files aren't this checkout's` };
      return { ok: true, why: `the steps ran this checkout's Wheelhouse ${want}` };
    },
  };
}

// Takes back what a world whose run was killed left behind: a project-scope install of a world's plugin for a world
// folder that is gone or whose opener has ended, a user-scope entry for a world's plugin whose marketplace is kept in
// such a folder, and that marketplace. `leftBehind(root)` and
// `worldOf(projectPath)` are the kits' sweep's own (world-kits.js). Returns what was taken back, as [{ what, where }].
export async function sweepWorldPlugins({ claudeBin, configDir = defaultConfig(), worldOf, leftBehind, runClaude = realRun }) {
  const taken = [];
  // Each world marketplace whose world was left behind, by name, with where it is kept.
  const stale = new Map();
  const markets = readJson(path.join(configDir, 'plugins', 'known_marketplaces.json')) ?? {};
  for (const [name, known] of Object.entries(markets)) {
    if (!WORLD_MARKETPLACE.test(name)) continue;
    const where = known?.source?.path ?? known?.installLocation;
    const root = typeof where === 'string' && path.basename(where) === 'marketplace' ? worldOf(path.join(path.dirname(where), 'project')) : null;
    if (root && leftBehind(root)) stale.set(name, where);
  }
  const installs = readJson(path.join(configDir, 'plugins', 'installed_plugins.json'))?.plugins ?? {};
  for (const [id, entries] of Object.entries(installs)) {
    const [plugin, market] = id.split('@');
    if (plugin !== 'wheelhouse' || !WORLD_MARKETPLACE.test(market ?? '')) continue;
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry?.scope === 'user' && stale.has(market)) {
        const got = await runClaude(claudeBin, ['plugin', 'uninstall', id, '--scope', 'user'], { cwd: os.tmpdir(), timeoutMs: 120000 }).catch(() => null);
        if (got?.code === 0) taken.push({ what: id, where: 'user' });
        continue;
      }
      const root = entry?.scope === 'project' ? worldOf(entry.projectPath) : null;
      if (!root || !leftBehind(root)) continue;
      const made = !fs.existsSync(root) ? root : !fs.existsSync(entry.projectPath) ? entry.projectPath : null;
      try {
        fs.mkdirSync(entry.projectPath, { recursive: true });
        const got = await runClaude(claudeBin, ['plugin', 'uninstall', id, '--scope', 'project'], { cwd: entry.projectPath, timeoutMs: 120000 }).catch(() => null);
        if (got?.code === 0) taken.push({ what: id, where: entry.projectPath });
      } finally {
        if (made) fs.rmSync(made, { recursive: true, force: true });
      }
    }
  }
  for (const [name, where] of stale) {
    const got = await runClaude(claudeBin, ['plugin', 'marketplace', 'remove', name], { cwd: os.tmpdir(), timeoutMs: 120000 }).catch(() => null);
    if (got?.code === 0) taken.push({ what: name, where });
  }
  return taken;
}
