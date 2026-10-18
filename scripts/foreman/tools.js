// scripts/foreman/tools.js
// The foreman's allowed tools (rulings R45, R63), passed by the watcher to each
// foreman it starts with --allowedTools: `Read`, and one `Bash(<command>:*)`
// rule for each of its two scripts, in the form the waker uses for feature
// build commands (scripts/protection/settings.js). A `Bash(x:*)` rule allows
// `x` and `x` followed by a space and anything, so each allows only that
// script, by its full path, quoted, in this plugin.
//
// These are Wheelhouse's own scripts, not project code, so unlike the build
// commands (ruling R56) they are given on Windows too. There the path is
// written with forward slashes, which node and Git Bash both take, so no
// backslash in a rule can be read as an escape. A plugin root that is not a
// full path, or holds a character that would change what the command or the
// rule means inside double quotes (`"`, `$`, a backtick, a backslash, the
// rule's wildcard `*`, a line break), is refused.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The plugin this file sits in: scripts/foreman/ is two folders down.
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SCRIPTS = Object.freeze({ wake: 'scripts/foreman/wake.js', act: 'scripts/foreman/act.js' });

// The plugin root as it is written in a command: forward slashes on Windows.
function rootOf(pluginRoot, platform) {
  const refuse = () => { throw new Error(`The plugin's folder can't be given to the foreman as a command: ${JSON.stringify(pluginRoot)}`); };
  if (typeof pluginRoot !== 'string' || pluginRoot === '') refuse();
  let root = pluginRoot;
  if (platform === 'win32') {
    if (!/^[A-Za-z]:[\\/]/.test(root)) refuse();
    root = root.replaceAll('\\', '/');
  } else if (!path.posix.isAbsolute(root)) refuse();
  if (/["$`\\*\r\n\0]/.test(root)) refuse();
  return root.replace(/\/+$/, '');
}

// The exact command that runs each of the foreman's scripts, for its playbook
// and for its rules: `{ wake, act }`.
export function foremanCommands(pluginRoot = PLUGIN_ROOT, { platform = process.platform } = {}) {
  const root = rootOf(pluginRoot, platform);
  return {
    wake: `node "${root}/${SCRIPTS.wake}"`,
    act: `node "${root}/${SCRIPTS.act}"`,
  };
}

// The foreman's allowed tools: Read, and exactly its two scripts.
export function foremanTools(pluginRoot = PLUGIN_ROOT, { platform = process.platform } = {}) {
  const { wake, act } = foremanCommands(pluginRoot, { platform });
  return ['Read', `Bash(${wake}:*)`, `Bash(${act}:*)`];
}
