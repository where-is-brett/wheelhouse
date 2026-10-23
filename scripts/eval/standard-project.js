// scripts/eval/standard-project.js
// Installs Wheelhouse into a scratch project as a real project has it at Standard protection, for
// the safety scenarios' `with` variants (tests/eval/main/13, 15 and 18): Standard's project
// settings (projectSettings: the deny rules and the sandbox) in .claude/settings.json; this
// computer's local settings (localSettings: the helper's socket) in .claude/settings.local.json;
// the project registered in the session's scratch Wheelhouse home, which the guards need to act
// (they act only in a registered project); and a scratch plugin named `wheelhouse` that holds the
// plugin's own guards (hooks/hooks.json's PreToolUse entries for the stop guard, the lineage hold
// and the tool guard, run from this repository by full path). The plugin's other hooks, the
// session start and the board's, are left out: they talk to the helper, and these sessions are a
// builder's, not the front desk's.
//
// The scratch Wheelhouse home stands in for ~/.wheelhouse, which Standard's rules deny by name
// (`Read(~/.wheelhouse/**)`, the sandbox's denyRead); the same rules are written for it, since the
// session's WHEELHOUSE_HOME names it. Nothing here touches the real home.
import fs from 'node:fs';
import path from 'node:path';
import { ATTRIBUTION_OFF, localSettings, mergeSettings, projectSettings } from '../protection/settings.js';
import { writeProject } from '../lib/projects.js';
import { REPO_ROOT } from './feature-project.js';
import { assertUnderTmp } from '../../probes/lib/scratch.js';

export const EVAL_PROJECT = 'eval-project';

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

// Standard's project settings as a scratch project holds them. The marketplace entry, the plugin
// switches and the compaction window are left out: a session loads the plugin from --plugin-dir,
// and none of the three changes what a guard does.
export function standardProjectSettings() {
  const { permissions, sandbox, disableAllHooks, enableAllProjectMcpServers } = projectSettings({ webDomains: [] });
  return { permissions, sandbox, disableAllHooks, enableAllProjectMcpServers, ...structuredClone(ATTRIBUTION_OFF) };
}

// Writes Standard's settings into `dir`. `home` is the session's scratch Wheelhouse home and
// `address` the helper's socket in it (the helper may not be running). The local settings are
// merged into any the set-up wrote already.
export function installStandardSettings(dir, { home, address }) {
  assertUnderTmp(dir);
  assertUnderTmp(home);
  write(path.join(dir, '.claude', 'settings.json'), `${JSON.stringify(standardProjectSettings(), null, 2)}\n`);
  const spellings = [...new Set([home, real(home)])];
  const standIn = {
    permissions: { deny: spellings.flatMap((h) => [`Read(/${h}/**)`, `Edit(/${h}/**)`]) },
    sandbox: { filesystem: { denyRead: spellings } },
  };
  const local = mergeSettings(localSettings({ address }), standIn);
  const file = path.join(dir, '.claude', 'settings.local.json');
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* none yet */ }
  write(file, `${JSON.stringify(mergeSettings(existing, local), null, 2)}\n`);
}

// Registers `dir` as a project in the scratch Wheelhouse home `home`, as setup would, so the
// guards act in it. The record names a made-up repository and holds no credential.
export function registerEvalProject(dir, home) {
  assertUnderTmp(home);
  const was = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    writeProject(EVAL_PROJECT, {
      folder: real(dir),
      remoteUrl: 'https://host.invalid/eval/project.git',
      host: 'github',
      repo: 'eval/project',
      connection: { host: 'github', mode: 'quick', project: 'eval/project' },
    });
  } finally {
    if (was === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = was;
  }
}

// The guards the plugin's hooks.json gives PreToolUse, as that file has them, with the plugin's
// folder written in.
const GUARDS = ['stop-guard.js', 'lineage-hold.js', 'tool-guard.js'];
export function guardHooks(root = REPO_ROOT) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8'));
  const entries = (config.hooks?.PreToolUse ?? []).map((entry) => ({
    ...entry,
    hooks: entry.hooks.filter((hook) => GUARDS.some((g) => hook.command.includes(`/${g}`)))
      .map((hook) => ({ ...hook, command: hook.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', root.split(path.sep).join('/')) })),
  })).filter((entry) => entry.hooks.length > 0);
  if (entries.flatMap((e) => e.hooks).length !== GUARDS.length) throw new Error('hooks/hooks.json does not hold the three PreToolUse guards this evaluation installs');
  return { hooks: { PreToolUse: entries } };
}

// A scratch plugin named `wheelhouse` under `root`, holding the guards and, when given, agents
// ({ name: text }). Resolves with its folder.
export function guardPlugin(root, { agents = {} } = {}) {
  assertUnderTmp(root);
  const plugin = path.join(root, 'plugin');
  write(path.join(plugin, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'wheelhouse', version: '0.0.0', description: 'Wheelhouse\'s guards, for one evaluation run.' }, null, 2)}\n`);
  write(path.join(plugin, 'hooks', 'hooks.json'), `${JSON.stringify(guardHooks(), null, 2)}\n`);
  for (const [name, text] of Object.entries(agents)) write(path.join(plugin, 'agents', `${name}.md`), text);
  return plugin;
}
