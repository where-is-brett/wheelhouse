// scripts/lib/process-start.js
// Whether a process is running, and when processes started, as the system says. They sit apart from the watcher's
// waker so the seat and the session role can use them without loading the waker's whole graph; the waker re-exports them.
import { run as runProgram } from './run.js';
import { PS_ENV } from './start-time.js';

// Whether a process with this id is running. EPERM means it exists.
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// When each of these processes started, as the system says it, in one call:
// `ps -o pid=,lstart= -p <pids>` on macOS and Linux (in the C locale, so the
// month comes before the day whatever the computer's own locale), Win32_Process's
// CreationDate through one PowerShell call on Windows. A Map from pid to the
// start time, or to null when it can't be had (the process has gone, or the
// system won't say).
export async function processStartTimes(pids, { platform = process.platform, run = runProgram } = {}) {
  const wanted = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  const found = new Map(wanted.map((pid) => [pid, null]));
  if (wanted.length === 0) return found;
  try {
    const filter = wanted.map((pid) => `ProcessId=${pid}`).join(' OR ');
    const answer = platform === 'win32'
      ? await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CreationDate.ToUniversalTime().ToString('o') }`,
      ], { timeoutMs: 15000 })
      : await run('ps', ['-o', 'pid=,lstart=', '-p', wanted.join(',')], { timeoutMs: 5000, env: PS_ENV });
    for (const line of String(answer.stdout ?? '').split(/\r?\n/)) {
      const m = /^\s*(\d+)\s+(\S.*?)\s*$/.exec(line);
      if (m && found.has(Number(m[1]))) found.set(Number(m[1]), m[2]);
    }
  } catch { /* none can be had */ }
  return found;
}

// When one process started, or null.
export async function processStartTime(pid, options = {}) {
  return (await processStartTimes([pid], options)).get(pid) ?? null;
}
