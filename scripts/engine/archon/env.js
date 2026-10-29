// scripts/engine/archon/env.js
// The one environment every Archon command runs in (spec 6.3). Nothing starts Archon any other way.
import fs from 'node:fs';
import path from 'node:path';
import { engineDir, archonHome } from '../../lib/paths.js';

// The switches that keep Archon's usage reporting off. They are applied last, so nothing overrides them.
export const TELEMETRY = Object.freeze({ ARCHON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', POSTHOG_API_KEY: 'off' });

// Folders with the system's own tools (git, bash, ps). The caller's PATH is never kept, since it may hold a real gh.
const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
// The few variables kept from the caller's environment. No token or host variable passes.
const KEPT = ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'TERM'];

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

// The environment for an Archon command. PATH is the broker's folder, the pinned Bun's, the folder of the Node the
// plugin's hooks run on (without it Claude Code doesn't load the plugin and Archon's steps fail), then the system
// folders: never the caller's PATH and never a folder holding a real gh, so a node folder with a gh beside it is
// swapped for a `node` link of Wheelhouse's own under <engine>/node/bin. `baseEnv`, `platform` and `nodeDir` are for tests.
export function archonEnv({ engine = engineDir(), home = archonHome(), claudeBin, copilotBin, nodeDir = path.dirname(process.execPath), baseEnv = process.env, platform = process.platform } = {}) {
  const env = {};
  for (const name of KEPT) if (baseEnv[name] !== undefined) env[name] = baseEnv[name];
  const node = holdsGh(nodeDir) ? nodeLink(engine, nodeDir, platform) : nodeDir;
  env.PATH = [path.join(engine, 'broker', 'bin'), path.join(engine, 'bun', 'bin'), node, ...SYSTEM_PATH].join(path.delimiter);
  env.ARCHON_HOME = home;
  if (claudeBin) env.CLAUDE_BIN_PATH = claudeBin;
  if (copilotBin) env.COPILOT_BIN_PATH = copilotBin;
  env.WHEELHOUSE_ENGINE_RUN = '1';
  return { ...env, ...TELEMETRY };
}
