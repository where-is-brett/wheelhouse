// scripts/update/old-helper.js
// Proving that a process is Wheelhouse's own helper before an update may stop it, and stopping it. Nothing here ends a
// process by its name: a process is stopped only by a process number that the proofs below have named, and any doubt
// gives { why } and stops nothing. Everything read from the record, from `lsof` or from `ps` is untrusted and parsed
// strictly. `run`, `kill`, `startTime`, `alive` and the clock are passed in, so a test never touches a real process.
import os from 'node:os';
import path from 'node:path';

// The line the board and the card give where the computer won't say which program holds the helper's address.
export const RESTART_LINE = "Wheelhouse can't tell which program is the old helper on this computer, so it leaves it running. The new helper takes over when the computer restarts, or when you sign out and in.";

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NOT_OURS = "not Wheelhouse's helper from the plugin cache at the reported version";

// A process start time as whole seconds since 1970, or null when it is not one of the two shapes read here: `ps`'s
// lstart ("Tue Nov  4 10:00:01 2026", local time) or an ISO time ("2026-11-04T10:00:01.123Z").
export function startSeconds(text) {
  if (typeof text !== 'string' || text.length > 64) return null;
  const iso = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,7})?Z$/.exec(text.trim());
  if (iso) {
    const ms = Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5], +iso[6]);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const ps = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +(\d{1,2}) (\d\d):(\d\d):(\d\d) (\d{4})$/.exec(text.trim());
  if (!ps) return null;
  const date = new Date(+ps[6], MONTHS.indexOf(ps[1]), +ps[2], +ps[3], +ps[4], +ps[5]);
  const ms = date.getTime();
  return Number.isFinite(ms) && date.getDate() === +ps[2] ? Math.floor(ms / 1000) : null;
}

const goodPid = (pid) => Number.isInteger(pid) && pid > 1 && pid <= 0x7fffffff;

// A process number is alive when a signal of 0 reaches it; one that exists but isn't ours still counts as alive.
export function pidAlive(pid, { kill = process.kill.bind(process) } = {}) {
  if (!goodPid(pid)) return false;
  try { kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

const lines = (text) => String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// The plugin cache's folder: plugins/cache in the Claude folder, which is CLAUDE_CONFIG_DIR when that is set, else ~/.claude.
// A helper started by a bare `node` name (not a full path) is still refused: the check needs the executable's full path, so
// nothing is stopped and the restart line applies.
export function defaultCacheRoot({ home = os.homedir(), env = process.env } = {}) {
  const claude = env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : path.join(home, '.claude');
  return path.join(claude, 'plugins', 'cache');
}

// Whether a process is Node.js running exactly the helper's script from this release's folder in the cache, and nothing
// else. `exe` is the executable's own path as the system reports it (not read out of the command line); its base name
// must be node (node.exe on Windows) and the command line must be that program and the script, two arguments and no
// more. Windows names compare without regard to case, and a Windows program may be in quotes.
export function isOwnHelperCommand(command, { exe, cacheRoot, version, platform }) {
  if (typeof command !== 'string' || typeof exe !== 'string' || typeof version !== 'string') return false;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) return false;
  const win = platform === 'win32';
  const script = [String(cacheRoot).replace(/[\\/]+$/, ''), 'wheelhouse', 'wheelhouse', version, 'scripts', 'host', 'helper-main.js'].join(win ? '\\' : '/');
  const base = exe.split(win ? /[\\/]/ : /\//).pop();
  if (!(win ? /^node\.exe$/i : /^node$/).test(base) || exe.trim() !== exe) return false;
  if (!win && !exe.startsWith('/')) return false;
  const fold = (s) => (win ? s.toLowerCase() : s);
  const accepted = win ? [`${exe} ${script}`, `"${exe}" ${script}`] : [`${exe} ${script}`];
  return accepted.some((c) => fold(c) === fold(command.trim()));
}

const PIPE_SCRIPT = (address) => [
  '$ErrorActionPreference = "Stop"',
  'if ($ExecutionContext.SessionState.LanguageMode -ne "FullLanguage") { exit 3 }',
  'Add-Type -TypeDefinition \'using System; using System.IO.Pipes; using System.Runtime.InteropServices; public static class WhPipe { [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint pid); public static uint Of(string name) { using (var c = new NamedPipeClientStream(".", name, PipeDirection.InOut)) { c.Connect(2000); uint pid; if (!GetNamedPipeServerProcessId(c.SafePipeHandle.DangerousGetHandle(), out pid)) throw new Exception("no"); return pid; } } }\'',
  `[WhPipe]::Of('${address.replace(/^\\\\\.\\pipe\\/, '').replace(/'/g, "''")}')`,
].join('; ');

// A Windows process's owner, start, program and command line, from one PowerShell call, tab-separated:
// "<domain>\<user>", the start as an ISO time in UTC, the executable's path, the command line.
const OWNER_SCRIPT = (pid) => [
  '$ErrorActionPreference = "Stop"',
  `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'`,
  '$o = Invoke-CimMethod -InputObject $p -MethodName GetOwner',
  '"{0}\\{1}`t{2}`t{3}`t{4}" -f $o.Domain, $o.User, $p.CreationDate.ToUniversalTime().ToString(\'o\'), $p.ExecutablePath, $p.CommandLine',
].join('; ');

const POWERSHELL = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];

// Asks the operating system which process serves `address` and checks it beyond doubt: exactly one process, this user's,
// Node.js running the helper's script from the plugin cache at `version` (what /health reported). Gives
// { pid, startTime, command } or { why }. `run(file, args, opts)` gives { code, stdout }. This is the only place a process
// number is read from the system, for the recorded helper and the unrecorded one alike.
export async function inspectAddress({ address, platform = process.platform, run, user = os.userInfo().username, version, cacheRoot = defaultCacheRoot() }) {
  if (typeof address !== 'string' || address === '' || /[\0\r\n]/.test(address)) return { why: 'no address' };
  if (typeof version !== 'string') return { why: 'version not reported' };
  try {
    return platform === 'win32'
      ? await inspectOnWindows({ address, run, user, version, cacheRoot })
      : await inspectOnUnix({ address, platform, run, user, version, cacheRoot });
  } catch {
    return { why: 'not told' };
  }
}

async function inspectOnUnix({ address, platform, run, user, version, cacheRoot }) {
  const held = await run('lsof', ['-t', '--', address], { timeoutMs: 5000 });
  const found = lines(held.stdout);
  if (found.length === 0) return { why: 'nothing at the address' };
  if (found.some((l) => !/^\d{1,10}$/.test(l))) return { why: 'not told' };
  const pids = [...new Set(found.map(Number))];
  if (pids.length !== 1) return { why: 'more than one process at the address' };
  const pid = pids[0];
  if (!goodPid(pid)) return { why: 'not told' };
  const shown = await run('ps', ['-o', 'user=,lstart=,command=', '-p', String(pid)], { timeoutMs: 5000 });
  const row = lines(shown.stdout);
  if (row.length !== 1) return { why: 'not told' };
  const m = /^(\S+)\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \w{3} +\d{1,2} \d\d:\d\d:\d\d \d{4})\s+(\S.*)$/.exec(row[0]);
  if (!m || startSeconds(m[2]) === null) return { why: 'not told' };
  if (m[1] !== user) return { why: "another user's process" };
  const named = await run('ps', ['-o', 'comm=', '-p', String(pid)], { timeoutMs: 5000 });
  const comm = lines(named.stdout);
  if (comm.length !== 1) return { why: 'not told' };
  if (!isOwnHelperCommand(m[3], { exe: comm[0], cacheRoot, version, platform })) return { why: NOT_OURS };
  return { pid, startTime: m[2], command: m[3] };
}

async function inspectOnWindows({ address, run, user, version, cacheRoot }) {
  const told = await run('powershell.exe', [...POWERSHELL, PIPE_SCRIPT(address)], { timeoutMs: 15000 });
  if (told.code !== 0) return { why: 'not told' };
  const found = lines(told.stdout);
  if (found.length !== 1 || !/^\d{1,10}$/.test(found[0]) || !goodPid(Number(found[0]))) return { why: 'not told' };
  const pid = Number(found[0]);
  const shown = await run('powershell.exe', [...POWERSHELL, OWNER_SCRIPT(pid)], { timeoutMs: 15000 });
  if (shown.code !== 0) return { why: 'not told' };
  const row = lines(shown.stdout);
  if (row.length !== 1) return { why: 'not told' };
  const parts = row[0].split('\t');
  if (parts.length !== 4 || parts.some((x) => !x)) return { why: 'not told' };
  const [owner, startTime, exe, command] = parts;
  if (startSeconds(startTime) === null) return { why: 'not told' };
  if (owner.split('\\').pop().toLowerCase() !== String(user).toLowerCase()) return { why: "another user's process" };
  if (!isOwnHelperCommand(command, { exe, cacheRoot, version, platform: 'win32' })) return { why: NOT_OURS };
  return { pid, startTime, command };
}

// The recorded helper, proved. The record is not trusted on its own, and nor is whatever answers /health: anything that
// can write a file can plant a record, and anything that can listen can answer. So all of these must agree: the record's
// process is alive, its start time is the recorded one to the second, /health at the address gives the same pid, and the
// operating system says that same process serves the address, is this user's, and is Node.js running the helper's script
// from the plugin cache at the version /health gave. `read()` gives the record or null (null: { why: 'no record' }, and the
// caller falls back to findByAddress); a record without a start time is not proof. Gives { pid, startTime, command } or
// { why }; the start time and command are the system's own, kept for reprove().
export async function proveRecorded({ client, read, startTime, alive, address, platform, run, user, cacheRoot }) {
  let record;
  try { record = read(); } catch { record = null; }
  if (!record || typeof record !== 'object') return { why: 'no record' };
  const pid = record.pid;
  if (!goodPid(pid)) return { why: 'record unreadable' };
  const recorded = startSeconds(record.startTime);
  if (recorded === null) return { why: 'not proven' };
  let isAlive = false;
  try { isAlive = (await alive(pid)) === true; } catch { /* not alive */ }
  if (!isAlive) return { why: 'record is for a process that has gone' };
  let now;
  try { now = startSeconds(await startTime(pid)); } catch { now = null; }
  if (now === null) return { why: 'start time not told' };
  if (now !== recorded) return { why: 'process number reused' };
  let health;
  try { health = await client.health(); } catch { health = null; }
  if (health?.ok !== true || health.pid !== pid) return { why: 'address gives another process' };
  const seen = await inspectAddress({ address, platform, run, user, version: health.version, cacheRoot });
  if (seen.why) return seen;
  if (seen.pid !== pid) return { why: 'the system names another process at the address' };
  if (startSeconds(seen.startTime) !== recorded) return { why: 'process number reused' };
  return seen;
}

// The unrecorded helper (0.2.6 or earlier), found by its address alone: the one process there, when it is beyond doubt
// Wheelhouse's own helper of `version`. Gives { pid, startTime, command } or { why }.
export function findByAddress(options) {
  return inspectAddress(options);
}

// Looks at the address again and gives the same answer as a proof, or { why }. Called just before a process is stopped, with
// the options the proof was made with (and the version it was made at).
export function reprove(options) {
  return inspectAddress(options);
}

// Waits until the helper's address no longer answers, up to `timeoutMs`: true when it went quiet.
export async function waitForQuiet({ client, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), timeoutMs = 20000, everyMs = 250 }) {
  const end = now() + timeoutMs;
  for (;;) {
    let answering = false;
    try { answering = (await client.health())?.ok === true; } catch { answering = false; }
    if (!answering) return true;
    if (now() >= end) return false;
    await sleep(everyMs);
  }
}

// Stops one proved process: SIGTERM on macOS, process.kill(pid) with no signal on Windows. `proof` is what a proof gave
// ({ pid, startTime, command }). The director's card may have waited a long time since, so `reprove(proof)` looks again
// just before the stop and must give the same pid, the same start time to the second and the same command; any difference
// stops nothing. Then `wait()` says whether the address went quiet. This process is never stopped.
export async function stopProved({ proof, reprove: again, platform = process.platform, kill = process.kill.bind(process), wait }) {
  const pid = proof?.pid;
  if (!goodPid(pid) || pid === process.pid) return { why: 'not a process that may be stopped' };
  const wanted = startSeconds(proof.startTime);
  if (wanted === null || typeof proof.command !== 'string' || proof.command === '') return { why: 'not a process that may be stopped' };
  let now;
  try { now = await again(proof); } catch { now = null; }
  if (!now || now.why || now.pid !== pid || startSeconds(now.startTime) !== wanted || now.command !== proof.command) {
    return { why: 'the process is no longer the one that was proved' };
  }
  try {
    if (platform === 'win32') kill(pid); else kill(pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') return { why: 'the stop was refused' };
  }
  let quiet = false;
  try { quiet = (await wait()) === true; } catch { quiet = false; }
  return quiet ? { stopped: true } : { why: 'still answering after the stop' };
}
