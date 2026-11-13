// probes/copilot-t3/helper.js
// Wheelhouse's helper for the trial's scratch home, started the way real use starts it (scripts/hooks/session-start.js: the
// plugin's helper-main.js, detached, in the user's own folder, with the company CA settings) and stopped when the run ends.
// The Copilot session's guard refuses every write while no helper answers, so the stage cannot do without it. Only the helper of
// the trial's own home is ever started or stopped: never ~/.wheelhouse's, and only a process this module spawned is signalled.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { caEnv } from '../../scripts/host/company-ca.js';
import { helperClient } from '../../scripts/host/helper-client.js';
import { helperAddress, jobFolder } from '../../scripts/lib/paths.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sameFolder = (a, b) => {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  return real(a) === real(b);
};

// `startTrialHelper({ home })` -> { stop() }. Resolves once the helper answers in `home`; throws when it never does.
export async function startTrialHelper({ home, spawn = nodeSpawn, pluginRoot = ROOT, waitMs = 15000, pollMs = 200, graceMs = 3000, env = process.env } = {}) {
  if (typeof home !== 'string' || home === '') throw new Error('The helper needs the trial\'s own Wheelhouse home');
  // The helper runs in the user's own folder, so a relative home would land somewhere other than the one checked here.
  home = path.resolve(home);
  if (sameFolder(home, path.join(os.homedir(), '.wheelhouse'))) throw new Error('The trial never starts a helper for the real Wheelhouse home');
  fs.mkdirSync(home, { recursive: true });
  const client = helperClient({ address: helperAddress({ home }), timeout: 2000 });
  const answers = async () => (await client.health())?.ok === true;
  let child = null;
  if (!(await answers())) {
    child = spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'host', 'helper-main.js')], {
      cwd: jobFolder(), detached: true, windowsHide: true, stdio: 'ignore', env: { ...env, ...caEnv(home), WHEELHOUSE_HOME: home },
    });
    child.on('error', () => {});
    child.unref();
    const until = Date.now() + waitMs;
    let up = false;
    while (!up && Date.now() < until) {
      await sleep(pollMs);
      up = await answers();
    }
    if (!up) {
      stopChild(child);
      throw new Error(`Wheelhouse's helper did not answer in the trial's home within ${waitMs / 1000} seconds`);
    }
  }
  let stopped = false;
  return {
    spawned: child !== null,
    async stop() {
      if (stopped) return;
      stopped = true;
      if (child === null) {
        // One an earlier attempt left running in this home: asked to close, never signalled by a pid this run did not spawn.
        await client.retire();
        return;
      }
      stopChild(child);
      const until = Date.now() + graceMs;
      while (Date.now() < until && await answers()) await sleep(pollMs);
      if (await answers()) signal(child, 'SIGKILL');
    },
  };
}

function stopChild(child) {
  signal(child, 'SIGTERM');
}

// The helper was started detached as its own group, so off Windows the group is signalled and anything it started goes with it.
function signal(child, name) {
  const pid = child.pid;
  if (process.platform !== 'win32' && Number.isInteger(pid) && pid > 1) {
    try { process.kill(-pid, name); return; } catch { /* fall back to the helper alone */ }
  }
  try { child.kill(name); } catch { /* already gone */ }
}
