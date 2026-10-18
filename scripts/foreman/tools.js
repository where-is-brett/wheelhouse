// scripts/foreman/tools.js
// The foreman's allowed tools (rulings R45, R63), passed by the watcher to each
// foreman it starts with --allowedTools: `Read`, and one `Bash(<command>:*)`
// rule for each of its two scripts, in the form the waker uses for feature
// build commands (scripts/protection/settings.js). A `Bash(x:*)` rule allows
// `x` and `x` followed by a space and anything, so each allows only that
// script, by its full path, in this plugin.
//
// These are Wheelhouse's own scripts, not project code, so unlike the build
// commands (ruling R56) they are given on Windows too. There the path is
// written with forward slashes, which node and Git Bash both take, and through
// npm's claude.cmd shim each rule goes on a cmd.exe command line, which
// refuses any argument holding `"` or `%` (scripts/lib/claude.js). So the
// script's path is in single quotes, which bash reads literally and cmd passes
// through.
//
// The plugin root is checked against an allow-list, as build commands are
// (scripts/gate/guardrails.js): a full path of letters, digits and `._/@=-`,
// with single spaces between words, and on Windows a drive letter and its
// colon in front. Nothing else can reach a rule: no quote, `$`, `%`, `*`,
// comma or parenthesis, any of which could change what the command or the
// rule means, or how --allowedTools is split.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The plugin this file sits in: scripts/foreman/ is two folders down.
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SCRIPTS = Object.freeze({ wake: 'scripts/foreman/wake.js', act: 'scripts/foreman/act.js' });

// A full path in the allowed characters: each part after a slash is words of
// those characters with single spaces between them.
const ALLOWED_PATH = /^(\/[A-Za-z0-9._@=-]+( [A-Za-z0-9._@=-]+)*)+\/?$/;

// The plugin root as it is written in a command: on Windows, forward slashes
// after its drive letter.
function rootOf(pluginRoot, platform) {
  const refuse = () => { throw new Error(`The plugin's folder can't be given to the foreman as a command: ${JSON.stringify(pluginRoot)}`); };
  if (typeof pluginRoot !== 'string') refuse();
  let drive = '';
  let rest = pluginRoot;
  if (platform === 'win32') {
    const m = /^([A-Za-z]:)([\\/].*)$/s.exec(pluginRoot);
    if (m === null) refuse();
    drive = m[1];
    rest = m[2].replaceAll('\\', '/');
  }
  if (!ALLOWED_PATH.test(rest)) refuse();
  return `${drive}${rest.replace(/\/$/, '')}`;
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

// The foreman's allowed tools: Read, and exactly its two scripts.
export function foremanTools(pluginRoot = PLUGIN_ROOT, { platform = process.platform } = {}) {
  const { wake, act } = foremanCommands(pluginRoot, { platform });
  return ['Read', `Bash(${wake}:*)`, `Bash(${act}:*)`];
}
