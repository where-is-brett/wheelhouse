// scripts/lib/agent-control.js
// The files and folders that steer an agent, in every project and in the home folder (design
// section 6.5): its hooks, instructions, skills, settings, connectors and editor tasks. A change to
// one is a guardrail change, so a pull request that touches one needs the director, and an agent
// may not write to one. Reading them stays allowed. This file imports none of the guards: the gate,
// the tool guard, the deny rules and the Windows runner each read this list from here.
import path from 'node:path';

// Written for the merge gate's glob (scripts/gate/glob.js) from a project's root: `**/X` is X in
// any folder, `dir/**` is everything under dir.
export const AGENT_CONTROL = Object.freeze([
  '.github/hooks/**', '.github/copilot/**', '.github/agents/**', '.github/skills/**', '.github/instructions/**', '.github/prompts/**',
  '.github/copilot-instructions.md', '.github/mcp.json', '.github/lsp.json', '.github/plugin/**',
  '**/AGENTS.md', '**/GEMINI.md', '.agents/**', 'plugin.json', '.plugin/**', 'com.github.copilot/**',
  '.vscode/**', '.codex/**', '.cursor/**', '.gemini/**', '.gitattributes',
]);

// Where another agent setup keeps its instructions in a project, from its folder, for the survey
// (scripts/survey/look.js, design section 15, ruling A1): a list to look in, not a shape the
// project must have. `/**` is every file under that folder. Wheelhouse's own skills and agents come
// from its plugin, never from the project's .claude/ folder.
export const OTHER_SETUP_PATHS = Object.freeze([
  '.claude/skills/**', '.claude/agents/**', 'AGENTS.md', '.cursor/rules/**', '.cursorrules',
  '.github/copilot-instructions.md', '.windsurfrules',
]);
// The files of another setup the briefing names first, by the name a director is likeliest to know.
export const OTHER_SETUP_NAMED_FIRST = Object.freeze(['AGENTS.md', '.cursorrules', '.windsurfrules', '.github/copilot-instructions.md']);

// What the tool guard says when it refuses a write to one of them.
export const CONTROL_FILE = 'That file steers an agent, so changing it is a guardrail change: ask the director';

// The folders in the home folder that steer an agent, from the home folder, with forward slashes:
// those every system has, and VS Code's user settings folder where each system keeps it.
const HOME_EVERY_SYSTEM = Object.freeze(['.copilot', '.agents', '.vscode/extensions']);
const USER_SETTINGS = Object.freeze({
  darwin: 'Library/Application Support/Code/User',
  win32: 'AppData/Roaming/Code/User',
  linux: '.config/Code/User',
});

// Every system's home folders together, for the project's settings file, which every computer shares.
export function homeControlPaths() {
  return [...HOME_EVERY_SYSTEM, USER_SETTINGS.darwin, USER_SETTINGS.win32, USER_SETTINGS.linux];
}

// The folders of this computer's home that steer an agent, as full paths for `platform`. On Windows
// VS Code's user settings are in %APPDATA%\Code\User, from `env` (its name in any case), or in the
// home folder's AppData\Roaming when APPDATA is not set. `home` is always given: tests pass their
// own, never the real one.
export function homeControlFolders({ home, platform = process.platform, env = {} } = {}) {
  if (typeof home !== 'string' || home === '') throw new Error('The home folder is needed');
  const windows = platform === 'win32';
  const join = windows ? path.win32.join : path.posix.join;
  const common = HOME_EVERY_SYSTEM.map((p) => join(home, ...p.split('/')));
  if (windows) {
    const key = Object.keys(env ?? {}).find((k) => k.toLowerCase() === 'appdata');
    const roaming = key !== undefined && typeof env[key] === 'string' && env[key] !== '' ? env[key] : join(home, 'AppData', 'Roaming');
    return [...common, join(roaming, 'Code', 'User')];
  }
  return [...common, join(home, ...USER_SETTINGS[platform === 'darwin' ? 'darwin' : 'linux'].split('/'))];
}

// The control patterns that are plain names: no glob character once a trailing `/**` is taken off,
// and no folder above them. A name with a glob can't be labelled or denied by name; a name below a
// folder (such as .github/hooks) has a parent that is not kept, which could be moved away with it.
// `folders` are the patterns that ended in `/**`, `files` the rest, each in the list's order.
export function plainControlNames() {
  const folders = [];
  const files = [];
  for (const pattern of AGENT_CONTROL) {
    const folder = pattern.endsWith('/**');
    const name = folder ? pattern.slice(0, -3) : pattern;
    if (/[*?[\]/]/.test(name)) continue;
    (folder ? folders : files).push(name);
  }
  return { folders, files };
}

// The control patterns as the sandbox's write list names them: `./name`, folders without `/**`,
// and none with a wildcard (its list skips wildcards on Linux and WSL2). A name that may sit in any
// folder (`**/X`) is named as the one in the project's root, the one place a literal path can reach.
export function controlWritePaths() {
  return AGENT_CONTROL.map((p) => (p.endsWith('/**') ? p.slice(0, -3) : p.startsWith('**/') ? p.slice(3) : p))
    .filter((p) => !/[*?[\]]/.test(p)).map((p) => `./${p}`);
}

// The director's own git settings files (their sign-in, proxy and certificate). A push runs with them
// (scripts/lib/safe-git.js, the push reaches), so an agent that could write one could name a credential helper
// that is handed the key, or a rewrite that sends a push elsewhere. They are protected as the files above are.
export const GIT_SETTINGS = 'That file holds the director\'s own git settings (their sign-in, proxy and certificate), so changing it is not done from here: ask the director';
const HOME_GIT_SETTINGS = Object.freeze(['.gitconfig', '.config/git/config']);
const SYSTEM_GIT_SETTINGS = Object.freeze([
  '/etc/gitconfig', '/usr/local/etc/gitconfig', '/opt/homebrew/etc/gitconfig',
  '/Library/Developer/CommandLineTools/usr/share/git-core/gitconfig', '/Applications/Xcode.app/Contents/Developer/usr/share/git-core/gitconfig',
]);

// The home folder's git settings files, from the home folder, with forward slashes, for the project's settings file.
export function homeGitSettingsPaths() {
  return [...HOME_GIT_SETTINGS];
}
// The system's git settings files on the systems that have them in a fixed place (absolute), for the sandbox's write list.
export function systemGitSettingsPaths() {
  return [...SYSTEM_GIT_SETTINGS];
}

// Every git settings file of this computer, as full paths for `platform`: the home folder's two, the one under
// XDG_CONFIG_HOME, the system's, and on Windows %PROGRAMDATA%\Git\config and Git for Windows' own.
export function gitSettingsFiles({ home, platform = process.platform, env = {} } = {}) {
  if (typeof home !== 'string' || home === '') throw new Error('The home folder is needed');
  const windows = platform === 'win32';
  const join = windows ? path.win32.join : path.posix.join;
  const get = (name) => {
    const key = Object.keys(env ?? {}).find((k) => (windows ? k.toLowerCase() === name.toLowerCase() : k === name));
    return key !== undefined && typeof env[key] === 'string' && env[key] !== '' ? env[key] : null;
  };
  const files = HOME_GIT_SETTINGS.map((p) => join(home, ...p.split('/')));
  const xdg = get('XDG_CONFIG_HOME');
  if (xdg !== null) files.push(join(xdg, 'git', 'config'));
  if (!windows) return [...files, ...SYSTEM_GIT_SETTINGS];
  const programData = get('PROGRAMDATA') ?? 'C:\\ProgramData';
  const programFiles = [get('ProgramFiles') ?? 'C:\\Program Files', get('ProgramFiles(x86)')].filter((p) => p !== null);
  return [...files, join(programData, 'Git', 'config'), ...programFiles.flatMap((p) => [join(p, 'Git', 'etc', 'gitconfig'), join(p, 'Git', 'mingw64', 'etc', 'gitconfig')])];
}
