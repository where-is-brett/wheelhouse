// scripts/eval/archon-engine.js
// The engine the counted evaluation's world on real Archon runs (archon-world.js), installed as setup installs it:
// Archon built from source at its pin with Wheelhouse's patch, once, into a cache outside ~/.wheelhouse, and each
// world's engine folder laid over that cache with its own launcher, Bun config, broker launcher and pack.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPack } from '../engine/pack-build.js';
import { WHEELHOUSE_PLUGIN } from '../engine/pack-check.js';
import { buildFromSource, enginePaths, launcherText } from '../engine/archon/build.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The cache the engine is built into once: never under ~/.wheelhouse, so the director's own engine is never touched.
export function engineCache(env = process.env) {
  return env.WHEELHOUSE_EVAL_ARCHON || path.join(os.homedir(), '.wheelhouse-evals', 'engine');
}

// Whether `cache` holds a finished build: the launcher, the patched source and the pinned Bun.
export function cacheBuilt(cache) {
  const p = enginePaths(cache);
  return fs.existsSync(p.launcher) && fs.existsSync(p.provider) && fs.existsSync(p.bunBin);
}

// Builds the engine into `cache` unless it is built already (network: Archon's source and its packages, the pinned
// Bun). A build cut short is moved aside, never removed, since buildFromSource refuses a folder that holds a source.
export async function prepareEngine({ cache = engineCache(), build = buildFromSource, log = () => {} } = {}) {
  if (cacheBuilt(cache)) return cache;
  if (fs.existsSync(cache)) fs.renameSync(cache, `${cache}.unfinished-${Date.now()}`);
  fs.mkdirSync(cache, { recursive: true });
  log(`Building Archon from source into ${cache}; this happens once`);
  await build({ engine: cache });
  return cache;
}

// The broker's launcher, as setup writes it: the Node.js running the evaluation, with the broker's script here.
export const brokerText = ({ node = process.execPath, root = PLUGIN_ROOT } = {}) => `#!/bin/sh\nexec '${node}' '${path.join(root, 'scripts', 'engine', 'broker', 'gh.js')}' "$@"\n`;

// Every step of the built pack at `dir` named to load `plugin` in place of the Wheelhouse plugin (WHEELHOUSE_PLUGIN):
// the evaluation's own install of this checkout (world-plugin.js).
export function namePlugin(dir, plugin) {
  const swap = (node) => {
    if (Array.isArray(node)) return node.map(swap);
    if (node === null || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, key === 'plugins' && Array.isArray(value) ? value.map((p) => (p === WHEELHOUSE_PLUGIN ? plugin : p)) : swap(value)]));
  };
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.yaml')) fs.writeFileSync(file, `${JSON.stringify(swap(JSON.parse(fs.readFileSync(file, 'utf8'))), null, 2)}\n`);
    }
  };
  walk(path.join(dir, '.archon', 'workflows'));
}

// The world's engine folder over the cache: Bun by hard link and the source by symbolic link, the launcher and Bun config the folder's own
// (the launcher names its folder's paths), the broker's launcher, and the pack built from this checkout.
export function linkEngine({ cache, engine, plugin = null }) {
  const from = enginePaths(cache);
  const to = enginePaths(engine);
  fs.mkdirSync(to.bunDir, { recursive: true });
  // Bun by a hard link (a copy where the folders are on different disks), not a symbolic one: a process started from a
  // symbolic link is listed by its target, and All stop ends only a process listed under the world's own engine folder.
  try { fs.linkSync(from.bunBin, to.bunBin); } catch { fs.copyFileSync(from.bunBin, to.bunBin); fs.chmodSync(to.bunBin, 0o755); }
  fs.mkdirSync(path.dirname(to.launcher), { recursive: true });
  fs.symlinkSync(from.src, to.src);
  fs.writeFileSync(to.bunfig, '# Empty: Bun reads this in place of a bunfig.toml in the folder Archon starts in.\n');
  fs.writeFileSync(to.launcher, launcherText(engine));
  fs.chmodSync(to.launcher, 0o755);
  const broker = path.join(engine, 'broker', 'bin', 'gh');
  fs.mkdirSync(path.dirname(broker), { recursive: true });
  fs.writeFileSync(broker, brokerText());
  fs.chmodSync(broker, 0o755);
  buildPack({ out: path.join(engine, 'pack') });
  if (plugin) namePlugin(path.join(engine, 'pack'), plugin);
  return { broker, packDir: path.join(engine, 'pack') };
}
