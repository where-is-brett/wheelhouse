// scripts/host/retire-helper.js
// Moving a session on to this copy's helper when the one answering is from an older copy of the plugin.
import { run as runProgram } from '../lib/run.js';

// A version as its numbers ([0, 2, 3]), or null when it is not dotted numbers (a pre-release tag is cut off).
export function versionParts(version) {
  if (typeof version !== 'string') return null;
  const match = /^v?(\d+(?:\.\d+)*)(?:[-+].*)?$/.exec(version.trim());
  return match ? match[1].split('.').map(Number) : null;
}

// True only when `version` is plainly older than `own`; a newer, equal or unreadable one is not.
export function isOlder(version, own) {
  const a = versionParts(version);
  const b = versionParts(own);
  if (a === null || b === null) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

const HELPER_MAIN = /scripts[\\/]host[\\/]helper-main\.js/;

// The process ids of Node processes running the helper's script, by command line. Empty when the list can't be read.
export async function helperProcesses({ platform = process.platform, run = runProgram } = {}) {
  try {
    if (platform === 'win32') {
      const got = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"], { timeoutMs: 4000, platform });
      if (got.code !== 0 || !got.stdout.trim()) return [];
      const parsed = JSON.parse(got.stdout);
      return (Array.isArray(parsed) ? parsed : [parsed]).filter((p) => HELPER_MAIN.test(String(p?.CommandLine ?? ''))).map((p) => Number(p.ProcessId));
    }
    const got = await run('ps', ['-axo', 'pid=,command='], { timeoutMs: 4000, platform });
    if (got.code !== 0) return [];
    return got.stdout.split('\n').flatMap((line) => {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      return m && /(^|[\\/ ])node(\.exe)?\s/.test(m[2]) && HELPER_MAIN.test(m[2]) ? [Number(m[1])] : [];
    });
  } catch {
    return [];
  }
}

// Ends a helper that has no retire route (one from before it existed), by its process id: only when exactly one
// process is running the helper's script, and never this process. Its work can't be checked, so it is a last resort.
export async function stopByProcess({ processes = helperProcesses, kill = (pid) => process.kill(pid, 'SIGTERM'), self = process.pid } = {}) {
  const pids = (await processes()).filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== self);
  if (pids.length !== 1) return false;
  try { kill(pids[0]); return true; } catch { return false; }
}
