// scripts/foreman/tools.js
// The foreman's allowed tools (rulings R45, R63, R98), passed by the watcher to
// each foreman it starts with --allowedTools: `Read`, its own skill, and one
// `Bash(<command>:*)` rule for each of its two scripts, in the form the waker uses for feature
// build commands (scripts/protection/settings.js). A `Bash(x:*)` rule allows
// `x` and `x` followed by a space and anything, so each allows only that
// script, by its full path, in this plugin.
//
// These are Wheelhouse's own scripts, not project code, so unlike the build
// commands (ruling R56) they are given on Windows too. Each script's path is
// written as scripts/lib/command-path.js writes a path into an allow rule:
// forward slashes, a drive letter on Windows, in single quotes, and only from
// an allow-list of characters.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandPath } from '../lib/command-path.js';

// The plugin this file sits in: scripts/foreman/ is two folders down.
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SCRIPTS = Object.freeze({ wake: 'scripts/foreman/wake.js', act: 'scripts/foreman/act.js' });

// The plugin root as it is written in a command, without its quotes: on
// Windows, forward slashes after its drive letter.
function rootOf(pluginRoot, platform) {
  try {
    return commandPath(pluginRoot, { platform }).slice(1, -1);
  } catch {
    throw new Error(`The plugin's folder can't be given to the Bosun as a command: ${JSON.stringify(pluginRoot)}`);
  }
}

// The exact command that runs each of the foreman's scripts, for its playbook
// and for its rules: `{ wake, act }`.
export function foremanCommands(pluginRoot = PLUGIN_ROOT, { platform = process.platform } = {}) {
  const root = rootOf(pluginRoot, platform);
  return {
    wake: `node '${root}/${SCRIPTS.wake}'`,
    act: `node '${root}/${SCRIPTS.act}'`,
  };
}

// The foreman's playbook, as Claude Code names a plugin's skill: the plugin's
// name (.claude-plugin/plugin.json), a colon, the skill's (skills/foreman).
export const FOREMAN_SKILL = 'wheelhouse:foreman';

// The foreman's allowed tools: Read, exactly its two scripts, and exactly its
// own skill (ruling R98). `Skill(name)` is Claude Code's rule for one skill by
// its exact name, which for a plugin's skill is `plugin:skill`
// (https://code.claude.com/docs/en/skills, read 19 October 2026).
export function foremanTools(pluginRoot = PLUGIN_ROOT, { platform = process.platform } = {}) {
  const { wake, act } = foremanCommands(pluginRoot, { platform });
  return ['Read', `Bash(${wake}:*)`, `Bash(${act}:*)`, `Skill(${FOREMAN_SKILL})`];
}
