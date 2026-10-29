// scripts/eval/world-kits.js
// The skill kits an evaluation world on real Archon (archon-world.js) installs for its throwaway project at project
// scope, through Claude Code's own plugin commands, and takes back: when the world closes, and, for a world whose run
// was killed first, when the next world opens (sweepWorldInstalls). Kept apart from the world, whose git calls a
// scan reads, since these commands are Claude Code's, not git's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run as realRun } from '../lib/run.js';
import { MARKETPLACE, UPSTREAMS } from '../lineage/manifest.js';

// The skill kits setup pins for each project (lineage/manifest.json), as Claude Code names them. Without their
// project-scope install, every Wheelhouse session start in the project, an engine step's among them, finds the
// installed skills differ from the manifest and holds the project's edits and commands, its structured output too.
export const KITS = Object.freeze(UPSTREAMS.map((upstream) => `${upstream.plugin}@${MARKETPLACE}`));

// A world's folder in the temporary folder, and the file in it naming the process that opened it.
const WORLD_FOLDER = /^wh-aw-[A-Za-z0-9]+$/;
export const OWNER_FILE = '.world-owner';
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

// Takes back the kits a world installed at project scope and never removed, as when its run was killed. Only those
// entries in Claude Code's record of installs (<configDir>/plugins/installed_plugins.json) are touched: one of KITS,
// project scope, for the project folder of a world in `tmp` that is gone, or whose opener has ended. Each is removed
// by Claude Code itself, run in that folder; a folder that is gone is made for it, then removed again. Returns the
// entries taken back, as [{ kit, projectPath }].
export async function sweepWorldInstalls({
  claudeBin, configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), tmp = os.tmpdir(),
  isAlive = alive, runClaude = realRun,
} = {}) {
  let record;
  try { record = JSON.parse(fs.readFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), 'utf8')); } catch { return []; }
  const tmps = new Set([path.resolve(tmp)]);
  try { tmps.add(fs.realpathSync(tmp)); } catch { /* no temporary folder: its own spelling only */ }
  const worldOf = (projectPath) => {
    if (typeof projectPath !== 'string' || path.basename(projectPath) !== 'project') return null;
    const root = path.dirname(projectPath);
    return WORLD_FOLDER.test(path.basename(root)) && tmps.has(path.dirname(root)) ? root : null;
  };
  const leftBehind = (root) => {
    let pid = NaN;
    try { pid = Number(fs.readFileSync(path.join(root, OWNER_FILE), 'utf8').trim()); } catch { /* no owner: left behind */ }
    return !(Number.isInteger(pid) && pid > 0 && isAlive(pid));
  };
  const stale = [];
  for (const kit of KITS) {
    for (const entry of Array.isArray(record?.plugins?.[kit]) ? record.plugins[kit] : []) {
      const root = entry?.scope === 'project' ? worldOf(entry.projectPath) : null;
      if (root && leftBehind(root)) stale.push({ kit, projectPath: entry.projectPath, root });
    }
  }
  const taken = [];
  for (const { kit, projectPath, root } of stale) {
    const made = !fs.existsSync(root) ? root : !fs.existsSync(projectPath) ? projectPath : null;
    try {
      fs.mkdirSync(projectPath, { recursive: true });
      const got = await runClaude(claudeBin, ['plugin', 'uninstall', kit, '--scope', 'project'], { cwd: projectPath, timeoutMs: 120000 }).catch(() => null);
      if (got?.code === 0) taken.push({ kit, projectPath });
    } finally {
      if (made) fs.rmSync(made, { recursive: true, force: true });
    }
  }
  return taken;
}

// The kits for one world's project folder: install() puts each in at project scope, or throws naming the one that
// failed; remove() takes back those it put in, never failing.
export function worldKits({ claudeBin, folder, runClaude = realRun }) {
  const claude = (args) => runClaude(claudeBin, args, { cwd: folder, timeoutMs: 300000 });
  const installed = [];
  return {
    async install() {
      for (const kit of KITS) {
        const got = await claude(['plugin', 'install', kit, '--scope', 'project']);
        if (got.code !== 0) throw new Error(`Claude Code could not install ${kit} for the evaluation's project: ${String(got.stderr || got.stdout).trim().split('\n')[0]}`);
        installed.push(kit);
      }
    },
    async remove() {
      for (const kit of installed.splice(0)) await claude(['plugin', 'uninstall', kit, '--scope', 'project']).catch(() => null);
    },
  };
}
