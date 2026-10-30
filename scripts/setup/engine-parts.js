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
import { engineDir, archonHome } from '../lib/paths.js';
import { archonSettingsFile, archonSettingsOk, writeArchonSettings } from '../engine/archon/build.js';
import { engineWanted, engineInstalled, POLICY_FILE, ARCHON_CONFIG_FILE, ENGINE_FILES, WORKTREE_PATH, mirrorRulesFile } from '../engine/parts.js';

// What only reads, kept in scripts/engine/parts.js so the mod's bridge can reach it without setup's writers.
export { engineWanted, engineInstalled, POLICY_FILE, ARCHON_CONFIG_FILE, ENGINE_FILES, WORKTREE_PATH, mirrorRulesFile };
import { installEngine } from '../engine/install.js';
import { agentEngineChanges, applyAgentEngine } from '../agents/engine-parts.js';
import { newId } from './journal.js';

export const PLUGIN_SCOPE = Object.freeze({ install: true, plugin: 'wheelhouse@wheelhouse', scope: 'user' });

// The one card's line (spec 14.4), with the plugin's scope where setup adds it, or brings it up to date where an older
// Wheelhouse is there at that scope (part 3f): the engine's steps would load the older one's skills and hooks.
export const ENGINE_LINE = 'Install the build engine, Archon, with its usage reporting off.';
export const ENGINE_LINE_WITH_PLUGIN = 'Install the build engine, Archon, with its usage reporting off, and add Wheelhouse to Claude Code for your account so the engine\'s steps keep its safeguards.';
export const ENGINE_LINE_WITH_UPDATE = 'Install the build engine, Archon, with its usage reporting off, and bring Wheelhouse up to date in Claude Code for your account so the engine\'s steps keep its safeguards.';
export function engineLine(scope = PLUGIN_SCOPE, { claudeHome = null, version = ownVersion() } = {}) {
  if (!scope.install) return ENGINE_LINE;
  const there = claudeHome === null ? null : versionAtScope(claudeHome, scope);
  return there !== null && olderVersion(there, version) ? ENGINE_LINE_WITH_UPDATE : ENGINE_LINE_WITH_PLUGIN;
}

// Step 6's card lines for the plugin's scope.
export const PLUGIN_SCOPE_LINE = 'Wheelhouse added to Claude Code for your account, so the build engine\'s steps keep its safeguards';
export const pluginUpdateLine = (from, to) => `Wheelhouse in Claude Code for your account brought up to date, from ${from} to ${to}, so the build engine's steps keep its safeguards`;


const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const brokerLauncher = (engine = engineDir()) => path.join(engine, 'broker', 'bin', 'gh');

// The broker's two-line launcher: the Node.js running setup, with the broker's script in this plugin.
export function brokerText({ node = process.execPath, root = PLUGIN_ROOT } = {}) {
  return `#!/bin/sh\nexec '${node}' '${path.join(root, 'scripts', 'engine', 'broker', 'gh.js')}' "$@"\n`;
}

const read = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
};


// Step 2's changes for the engine: the engine's folder (built and checked), Archon's own settings naming Claude as the
// assistant its steps run with, the broker's launcher, and what the project's `agent` needs in the engine folder
// (scripts/agents/engine-parts.js), each only when it isn't in as it should be.
export function engineChanges({ engine = engineDir(), home = archonHome(), node, root, agent = null } = {}) {
  const changes = [];
  if (!engineInstalled(engine)) changes.push({ kind: 'folder', target: engine, action: 'engine', tool: 'archon' });
  if (!archonSettingsOk(home)) changes.push({ kind: 'file', target: archonSettingsFile(home), action: 'archon-settings' });
  const launcher = brokerLauncher(engine);
  if (read(launcher) !== brokerText({ node, root })) changes.push({ kind: 'file', target: launcher, action: 'broker' });
  changes.push(...agentEngineChanges(agent, { engine }));
  return changes;
}

// Makes step 2's engine changes. A refused install throws its plain reason; the engine folder is as it was.
export async function applyEngine(changes, { record, run, fetch, arch, platform, install = installEngine, node, root, engine = engineDir(), agentApply = applyAgentEngine } = {}) {
  if (changes.some((c) => c.action === 'engine')) {
    const got = await install({ platform, arch, fetch, run, record, folder: engine });
    if (got?.ok !== true) throw new Error(got?.refused ?? 'the build engine was not installed');
  }
  for (const c of changes.filter((x) => x.action === 'agent-engine')) await agentApply(c, { engine, record, fetch, arch, platform, run });
  // Archon's settings live in its own home, with its run history, which uninstall keeps or deletes whole on its own
  // card, so the journal doesn't hold them.
  for (const c of changes.filter((x) => x.action === 'archon-settings')) writeArchonSettings(path.dirname(c.target));
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

// The plugin's entry at the scope PLUGIN_SCOPE names, in Claude Code's record, or null.
function entryAtScope(claudeHome, scope) {
  let data;
  try { data = JSON.parse(fs.readFileSync(installedPluginsFile(claudeHome), 'utf8')); } catch { return null; }
  const entries = data?.plugins?.[scope.plugin];
  return Array.isArray(entries) ? entries.find((e) => e?.scope === scope.scope) ?? null : null;
}

// Whether the plugin is installed at the scope PLUGIN_SCOPE names.
export const pluginAtScope = (claudeHome, scope = PLUGIN_SCOPE) => entryAtScope(claudeHome, scope) !== null;

// The version installed at that scope, or null when none is there; one Claude Code didn't record reads as 'unknown'.
export function versionAtScope(claudeHome, scope = PLUGIN_SCOPE) {
  const entry = entryAtScope(claudeHome, scope);
  if (entry === null) return null;
  return typeof entry.version === 'string' && entry.version !== '' ? entry.version : 'unknown';
}

// The version of the Wheelhouse running setup, from its own manifest.
export function ownVersion(root = PLUGIN_ROOT) {
  try { return String(JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version); } catch { return '0'; }
}

// Whether version `a` is below `b`, comparing their three numbered parts in turn (0.1.2 is below 0.2.0). Only plain
// release versions are compared: either one that isn't (a hash, 'unknown') is taken as not below, so it is left alone.
const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;
export function olderVersion(a, b) {
  const [x, y] = [RELEASE.exec(String(a)), RELEASE.exec(String(b))];
  if (x === null || y === null) return false;
  for (let i = 1; i <= 3; i += 1) {
    if (Number(x[i]) !== Number(y[i])) return Number(x[i]) < Number(y[i]);
  }
  return false;
}

// Step 6's change for the plugin's scope, or none: its install, or, where an older version is there at that scope, its
// update to the version setting up, under the same Go ahead.
export function pluginScopeChanges({ claudeHome, platform, scope = PLUGIN_SCOPE, version = ownVersion() } = {}) {
  if (!scope.install || !engineWanted({ platform })) return [];
  const change = { kind: 'plugin-scope', target: installedPluginsFile(claudeHome), plugin: scope.plugin, scope: scope.scope, what: 'plugin' };
  const there = versionAtScope(claudeHome, scope);
  if (there === null) return [change];
  return olderVersion(there, version) ? [{ ...change, update: { from: there, to: version } }] : [];
}

// `claude plugin install <plugin> --scope <scope>`, or `claude plugin update` for an older one there, recorded first.
// Claude Code writes its own record.
export async function applyPluginScope(change, { run, record, claudeProgram = 'claude' }) {
  const update = change.update ?? null;
  record({ id: newId('chg'), kind: 'plugin-scope', target: change.target, before: update === null ? null : { version: update.from }, after: { plugin: change.plugin, scope: change.scope, ...(update === null ? {} : { version: update.to }) } });
  const args = ['plugin', update === null ? 'install' : 'update', change.plugin, '--scope', change.scope];
  const got = await run(claudeProgram, args);
  if (got.code !== 0) throw new Error(`Claude Code didn't ${update === null ? 'add' : 'bring up to date'} ${change.plugin} for your account: ${String(got.stderr || got.stdout).trim().slice(0, 200)}`);
}

// The command uninstall runs to take the plugin's scope back.
export const pluginScopeRemoval = (change) => ['plugin', 'uninstall', change.after?.plugin ?? PLUGIN_SCOPE.plugin, '--scope', change.after?.scope ?? PLUGIN_SCOPE.scope];

// The project's own files for the engine (spec 14.3 and check 76; 3b): the merge queue's maintainers policy, naming
// the identity the helper posts its review verdicts as, and Archon's project settings, which put its worktrees inside
// the project folder, under .wheelhouse/ (kept out of git), where the agents' sandbox already lets them work. A new
// setup puts both in setup's own commit; a project set up already gets them by the switch's pull request. `.archon/`
// is a guardrail from then on.

export const maintainersText = (logins) => `${JSON.stringify(logins)}\n`;
export const archonConfigText = () => [
  `# ${ARCHON_CONFIG_FILE}`,
  "# Archon's settings for this project, written by Wheelhouse's setup. Its worktrees go inside the project folder,",
  '# under .wheelhouse/, which git ignores here.',
  'worktree:',
  `  path: ${WORKTREE_PATH}`,
  '',
].join('\n');

// The text each engine file holds, for the login the helper posts as.
export function engineFileTexts(login) {
  return { [POLICY_FILE]: maintainersText([login]), [ARCHON_CONFIG_FILE]: archonConfigText() };
}
