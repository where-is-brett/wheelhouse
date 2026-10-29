// scripts/setup/engine-parts.js
// What setup adds to this computer for the build engine (Archon design, section 14), in one place: the line on the
// one recommended card, whether the engine is wanted here, the engine's install and the broker's launcher (step 2),
// and the Wheelhouse plugin at user scope (step 6). Uninstall reads the same names to take each back.
//
// The plugin at user scope: an Archon step that names the plugin makes Claude Code write a user-scope entry for it
// (check 75), so setup installs it there once, on purpose, with the director's Go ahead, and uninstall removes it.
// The director hasn't ruled on this yet; PLUGIN_SCOPE is the one switch. With `install: false`, setup leaves the
// plugin's scope as it is and the card says nothing of it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineDir } from '../lib/paths.js';
import { enginePaths, launcherText, PATCH_MARK } from '../engine/archon/build.js';
import { installEngine } from '../engine/install.js';
import { newId } from './journal.js';

export const PLUGIN_SCOPE = Object.freeze({ install: true, plugin: 'wheelhouse@wheelhouse', scope: 'user' });

// The one card's line (spec 14.4), with the plugin's scope where setup adds it.
export const ENGINE_LINE = 'Install the build engine, Archon, with its usage reporting off.';
export const ENGINE_LINE_WITH_PLUGIN = 'Install the build engine, Archon, with its usage reporting off, and add Wheelhouse to Claude Code for your account so the engine\'s steps keep its safeguards.';
export const engineLine = (scope = PLUGIN_SCOPE) => (scope.install ? ENGINE_LINE_WITH_PLUGIN : ENGINE_LINE);

// Step 6's card line for the plugin's scope.
export const PLUGIN_SCOPE_LINE = 'Wheelhouse added to Claude Code for your account, so the build engine\'s steps keep its safeguards';

// The engine runs on the Mac only for now (spec 17, step 2); Windows is tried in its own sitting.
export const engineWanted = ({ platform = process.platform } = {}) => platform === 'darwin';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const brokerLauncher = (engine = engineDir()) => path.join(engine, 'broker', 'bin', 'gh');

// The broker's two-line launcher: the Node.js running setup, with the broker's script in this plugin.
export function brokerText({ node = process.execPath, root = PLUGIN_ROOT } = {}) {
  return `#!/bin/sh\nexec '${node}' '${path.join(root, 'scripts', 'engine', 'broker', 'gh.js')}' "$@"\n`;
}

const read = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
};

// Whether the engine is in: Wheelhouse's patched build from source, with its launcher and the pinned Bun.
export function engineInstalled(engine = engineDir()) {
  const p = enginePaths(engine);
  return read(p.launcher) === launcherText(engine) && (read(p.provider) ?? '').includes(PATCH_MARK) && fs.existsSync(p.bunBin);
}

// Step 2's changes for the engine: the engine's folder (built and checked) and the broker's launcher, each only
// when it isn't in as it should be.
export function engineChanges({ engine = engineDir(), node, root } = {}) {
  const changes = [];
  if (!engineInstalled(engine)) changes.push({ kind: 'folder', target: engine, action: 'engine', tool: 'archon' });
  const launcher = brokerLauncher(engine);
  if (read(launcher) !== brokerText({ node, root })) changes.push({ kind: 'file', target: launcher, action: 'broker' });
  return changes;
}

// Makes step 2's engine changes. A refused install throws its plain reason; the engine folder is as it was.
export async function applyEngine(changes, { record, run, fetch, arch, platform, install = installEngine, node, root, engine = engineDir() } = {}) {
  if (changes.some((c) => c.action === 'engine')) {
    const got = await install({ platform, arch, fetch, run, record, folder: engine });
    if (got?.ok !== true) throw new Error(got?.refused ?? 'the build engine was not installed');
  }
  for (const c of changes.filter((x) => x.action === 'broker')) {
    const before = read(c.target);
    record({ id: newId('chg'), kind: 'file', target: c.target, before, after: { tool: 'broker' } });
    fs.mkdirSync(path.dirname(c.target), { recursive: true });
    fs.writeFileSync(c.target, brokerText({ node, root }));
    fs.chmodSync(c.target, 0o755);
  }
}

// Claude Code's record of installed plugins, in the Claude folder given.
export const installedPluginsFile = (claudeHome) => path.join(claudeHome, 'plugins', 'installed_plugins.json');

// Whether the plugin is installed at the scope PLUGIN_SCOPE names.
export function pluginAtScope(claudeHome, scope = PLUGIN_SCOPE) {
  let data;
  try { data = JSON.parse(fs.readFileSync(installedPluginsFile(claudeHome), 'utf8')); } catch { return false; }
  const entries = data?.plugins?.[scope.plugin];
  return Array.isArray(entries) && entries.some((e) => e?.scope === scope.scope);
}

// Step 6's change for the plugin's scope, or none.
export function pluginScopeChanges({ claudeHome, platform, scope = PLUGIN_SCOPE } = {}) {
  if (!scope.install || !engineWanted({ platform }) || pluginAtScope(claudeHome, scope)) return [];
  return [{ kind: 'plugin-scope', target: installedPluginsFile(claudeHome), plugin: scope.plugin, scope: scope.scope, what: 'plugin' }];
}

// `claude plugin install <plugin> --scope <scope>`, recorded first. Claude Code writes its own record.
export async function applyPluginScope(change, { run, record, claudeProgram = 'claude' }) {
  record({ id: newId('chg'), kind: 'plugin-scope', target: change.target, before: null, after: { plugin: change.plugin, scope: change.scope } });
  const args = ['plugin', 'install', change.plugin, '--scope', change.scope];
  const got = await run(claudeProgram, args);
  if (got.code !== 0) throw new Error(`Claude Code didn't add ${change.plugin} for your account: ${String(got.stderr || got.stdout).trim().slice(0, 200)}`);
}

// The command uninstall runs to take the plugin's scope back.
export const pluginScopeRemoval = (change) => ['plugin', 'uninstall', change.after?.plugin ?? PLUGIN_SCOPE.plugin, '--scope', change.after?.scope ?? PLUGIN_SCOPE.scope];
