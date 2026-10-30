// scripts/engine/archon/env.js
// The one environment every Archon command runs in (spec 6.3). Nothing starts Archon any other way.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineDir, archonHome } from '../../lib/paths.js';
import { PERMISSION_MODE } from './build.js';
import { copilotCliPaths } from './copilot-cli.js';

// The switches that keep Archon's usage reporting off. They are applied last, so nothing overrides them.
export const TELEMETRY = Object.freeze({ ARCHON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', POSTHOG_API_KEY: 'off' });

// Folders with the system's own tools (git, bash, ps). The caller's PATH is never kept, since it may hold a real gh.
const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
// The few variables kept from the caller's environment. No token or host variable passes. WHEELHOUSE_HOME, where set
// (an evaluation's home), is kept so a step's hooks use the same Wheelhouse home as the helper.
const KEPT = ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'TERM', 'WHEELHOUSE_HOME'];

// The plugin's own folder, where the pack's script steps find Wheelhouse's scripts.
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const holdsGh = (dir) => ['gh', 'gh.exe', 'gh.cmd', 'gh.bat'].some((name) => fs.existsSync(path.join(dir, name)));

// A folder of Wheelhouse's own holding only a `node` that is the running Node, for a Node that lives in a
// folder with a real gh beside it (Homebrew's). Made once; a link where the system allows one, else a copy.
function nodeLink(engine, nodeDir, platform) {
  const name = platform === 'win32' ? 'node.exe' : 'node';
  const dir = path.join(engine, 'node', 'bin');
  const link = path.join(dir, name);
  if (!fs.existsSync(link)) {
    const target = nodeDir === path.dirname(process.execPath) ? process.execPath : path.join(nodeDir, name);
    fs.mkdirSync(dir, { recursive: true });
    try { fs.symlinkSync(target, link); } catch { fs.copyFileSync(target, link); }
  }
  return dir;
}

// The fetch mirror's rules (setup's list in <engine>/mirrors/rules.json, { <project>: <its address> }) as git's
// environment settings: each project's address read from the helper's mirror in the engine folder, so Archon's git
// needs no key (Archon design, section 12.4). A name or address that isn't plain is left out.
const SAFE_PROJECT = /^[A-Za-z0-9._-]+$/;
function mirrorConfig(engine) {
  let rules;
  try { rules = JSON.parse(fs.readFileSync(path.join(engine, 'mirrors', 'rules.json'), 'utf8')); } catch { return {}; }
  if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) return {};
  const pairs = Object.entries(rules).filter(([project, url]) => SAFE_PROJECT.test(project) && typeof url === 'string' && /^https:\/\/[^\s]+$/.test(url));
  if (pairs.length === 0) return {};
  const out = { GIT_CONFIG_COUNT: String(pairs.length) };
  pairs.forEach(([project, url], i) => {
    out[`GIT_CONFIG_KEY_${i}`] = `url.${path.join(engine, 'mirrors', `${project}.git`)}.insteadOf`;
    out[`GIT_CONFIG_VALUE_${i}`] = url;
  });
  return out;
}

// The environment for an Archon command. PATH is the broker's folder, the pinned Bun's, the folder of the Node the
// plugin's hooks run on (without it Claude Code doesn't load the plugin and Archon's steps fail), then the system
// folders: never the caller's PATH and never a folder holding a real gh, so a node folder with a gh beside it is
// swapped for a `node` link of Wheelhouse's own under <engine>/node/bin. WHEELHOUSE_ROOT is the plugin's folder, for the
// pack's script steps. COPILOT_BIN_PATH names the Copilot CLI in the engine folder and COPILOT_HOME its clean home
// (copilot-cli.js), each only when it is there; the caller's own COPILOT_HOME never passes. `baseEnv`, `platform`,
// `nodeDir` and `root` are for tests.
export function archonEnv({ engine = engineDir(), home = archonHome(), claudeBin, copilotBin, nodeDir = path.dirname(process.execPath), baseEnv = process.env, platform = process.platform, root = PLUGIN_ROOT } = {}) {
  const env = {};
  for (const name of KEPT) if (baseEnv[name] !== undefined) env[name] = baseEnv[name];
  const node = holdsGh(nodeDir) ? nodeLink(engine, nodeDir, platform) : nodeDir;
  env.PATH = [path.join(engine, 'broker', 'bin'), path.join(engine, 'bun', 'bin'), node, ...SYSTEM_PATH].join(path.delimiter);
  env.ARCHON_HOME = home;
  if (claudeBin) env.CLAUDE_BIN_PATH = claudeBin;
  const copilot = copilotCliPaths(engine);
  const bin = copilotBin ?? (fs.existsSync(copilot.bin) ? copilot.bin : null);
  if (bin) env.COPILOT_BIN_PATH = bin;
  if (fs.statSync(copilot.home, { throwIfNoEntry: false })?.isDirectory()) env.COPILOT_HOME = copilot.home;
  // gh's config folder named as one that isn't there, so a real gh in a system folder on PATH, after the broker's,
  // finds no sign-in in the caller's folder; the broker's gh reads none (check 81).
  env.GH_CONFIG_DIR = path.join(engine, 'broker', 'no-gh-config');
  env.WHEELHOUSE_ENGINE_RUN = '1';
  env.WHEELHOUSE_ROOT = root;
  // Wheelhouse's patch (build.js) starts Claude steps in this mode instead of bypass mode, so the sandbox holds.
  env.ARCHON_CLAUDE_PERMISSION_MODE = PERMISSION_MODE;
  Object.assign(env, mirrorConfig(engine));
  return { ...env, ...TELEMETRY };
}
