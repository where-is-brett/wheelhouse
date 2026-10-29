// scripts/engine/stop.js
// All stop for the build engine (spec 12.3). Cancelling isn't trusted to be complete: check 78 found a process that
// had moved itself into its own session alive after a cancel that reported success. So before anything is cancelled,
// the process tree of each running run's owner is taken, with every process the continuation host started and any
// process already moved to the system that works in a run's folder. An owner is taken only where the engine says the
// process is its own: a pid the record names may since belong to another program, which is left alone and reported.
// Then the engine cancels its runs, and after
// `wait` whatever of that snapshot is still there is ended by its pid (its process group, where it leads one), and
// looked for once more. Nothing is ended by name, only by pid, and never the helper's own process or group.
// It knows only the engine interface (contract.js).
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { run as defaultRun } from '../lib/run.js';

export const STOP_WAIT_MS = 10 * 1000;
// How long an ended process is given to go before it is ended without the chance to tidy up, and before the last look.
export const KILL_GRACE_MS = 1000;
const LIST_MS = 10 * 1000;

// `ps -A -o pid=,ppid=,pgid=,command=` as [{ pid, ppid, pgid, command }]; a line that doesn't read is skipped.
export function parsePs(text) {
  return String(text ?? '').split(/\r?\n/).flatMap((line) => {
    const found = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(line);
    return found ? [{ pid: Number(found[1]), ppid: Number(found[2]), pgid: Number(found[3]), command: found[4] }] : [];
  });
}

// `lsof -w -d cwd -Fn` (a `p<pid>` line, then the folder's `n<path>` line) as a Map of pid to working folder.
export function parseLsof(text) {
  const cwds = new Map();
  let pid = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && Number.isInteger(pid)) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

// This computer's processes. None on Windows, where `taskkill /T` is to come (spec 12.3).
export async function listProcesses({ run = defaultRun, platform = process.platform } = {}) {
  if (platform === 'win32') return [];
  const got = await run('ps', ['-A', '-o', 'pid=,ppid=,pgid=,command='], { timeoutMs: LIST_MS });
  return got.code === 0 ? parsePs(got.stdout) : [];
}

// Each process's working folder, for the processes a run's folder holds. Empty where it can't be read.
export async function listCwds({ run = defaultRun, platform = process.platform } = {}) {
  if (platform === 'win32') return new Map();
  try {
    const got = await run('lsof', ['-w', '-d', 'cwd', '-Fn'], { timeoutMs: LIST_MS });
    return parseLsof(got.stdout);
  } catch {
    return new Map();
  }
}

const killByPid = (pid, signal) => process.kill(pid, signal);
const short = (command) => (command.length > 60 ? `${command.slice(0, 57)}...` : command);
const inside = (dir, folder) => {
  const relative = path.relative(folder, dir);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

// The processes of `runs` ([{ id, folder? }]) and of `processes` ([{ pid, name }], those the continuation host
// started), with their trees: each { pid, pgid, command, name, own }. A run's owner is taken only where
// `engine.ownsProcess(command)` says it is the engine's; one it doesn't own is named in `leftAlone`.
async function snapshotOf({ engine, runs = [], processes = [], list, cwds, self }) {
  const listed = async () => { try { return await list(); } catch { return []; } };
  const engines = (command) => {
    try { return engine.ownsProcess?.(command) === true; } catch { return false; }
  };
  const leftAlone = [];
  const owners = [];
  const folders = [];
  for (const run of runs) {
    try {
      const pid = (await engine.inspect(run.id))?.ownerPid;
      if (Number.isInteger(pid) && pid > 1) owners.push(pid);
    } catch { /* a run that can't be read is cancelled all the same */ }
    if (typeof run.folder === 'string' && run.folder !== '') folders.push(run.folder);
  }
  const table = await listed();
  const byPid = new Map(table.map((p) => [p.pid, p]));
  const own = byPid.get(self);
  const kept = new Map();
  const add = (pid, name) => {
    const p = byPid.get(pid);
    if (!p || pid <= 1 || pid === self || kept.has(pid)) return;
    kept.set(pid, { pid, pgid: p.pgid, command: p.command, name, own: own !== undefined && p.pgid === own.pgid });
    for (const child of table) if (child.ppid === pid) add(child.pid, `"${short(child.command)}" (process ${child.pid})`);
  };
  for (const p of processes) if (Number.isInteger(p?.pid)) add(p.pid, `${p.name ?? 'a process the engine started'} (process ${p.pid})`);
  for (const pid of owners) {
    const p = byPid.get(pid);
    if (!p || kept.has(pid)) continue;
    if (engines(p.command)) add(pid, `"${short(p.command)}" (process ${pid})`);
    else leftAlone.push(`"${short(p.command)}" (process ${pid})`);
  }
  if (folders.length > 0) {
    let where = new Map();
    try { where = await cwds(); } catch { /* no folders to go by */ }
    for (const p of table) {
      const cwd = where.get(p.pid);
      if (p.ppid === 1 && typeof cwd === 'string' && folders.some((folder) => inside(cwd, folder))) {
        add(p.pid, `"${short(p.command)}" (process ${p.pid}, in the work's folder)`);
      }
    }
  }
  return { snapshot: [...kept.values()], leftAlone };
}

// Ends what of `snapshot` is still there after `wait`: SIGTERM, then SIGKILL for what outlives `grace`, each by pid
// (its process group, where it leads one, never the helper's own). The same pid running the same command counts as
// still there, so a pid taken since is left alone. -> { ended, survivors }, by name.
async function endSnapshot(snapshot, { list, kill, wait, grace, sleep }) {
  const ended = [];
  const survivors = [];
  if (snapshot.length === 0) return { ended, survivors };
  const listed = async () => { try { return await list(); } catch { return []; } };
  const alive = async () => {
    const now = new Map((await listed()).map((p) => [p.pid, p]));
    return snapshot.filter((p) => now.get(p.pid)?.command === p.command);
  };
  const end = (targets, signal) => {
    for (const p of targets) {
      const pid = p.pgid === p.pid && !p.own ? -p.pid : p.pid;
      try { kill(pid, signal); } catch { /* it has gone */ }
    }
  };
  if (wait > 0) await sleep(wait);
  const left = await alive();
  if (left.length > 0) {
    end(left, 'SIGTERM');
    await sleep(grace);
    const stubborn = await alive();
    if (stubborn.length > 0) {
      end(stubborn, 'SIGKILL');
      await sleep(grace);
    }
    const still = new Set((await alive()).map((p) => p.pid));
    for (const p of left) (still.has(p.pid) ? survivors : ended).push(p.name);
  }
  return { ended, survivors };
}

// stopEngine({ engine, processes, kill, list, cwds, wait, sleep, reason, self, afterSnapshot, known }) ->
//   { cancelled, paused, refused, ended, survivors, leftAlone, trouble? }
// `processes` are those the continuation host started ([{ pid, name }]); `list()` gives [{ pid, ppid, pgid, command }]
// and `cwds()` a Map of pid to working folder (ps and lsof by default); `kill(pid, signal)` ends one (a negative pid,
// its group); `self` is the helper's own pid. `ended` and `survivors` are the processes ended and those still left,
// by name; `refused` the runs whose cancel the engine refused; `paused` the runs waiting on an answer, which the
// engine doesn't cancel and which stay paused; `leftAlone` the processes named as a run's owner that
// `engine.ownsProcess(command)` doesn't own. `afterSnapshot()` is awaited once the processes are taken and before any
// run is cancelled (or once the engine has failed), so what it ends (the continuation host's wake) is in the snapshot.
// `known` are the runs started and not seen end, handed to the engine's stopAll for a run its list may not show yet.
export async function stopEngine({
  engine, processes = [], kill = killByPid, list = listProcesses, cwds = listCwds, wait = STOP_WAIT_MS, grace = KILL_GRACE_MS,
  sleep = delay, reason = 'All stop', self = process.pid, afterSnapshot = () => {}, known = [],
} = {}) {
  let snapshot = null;
  let leftAlone = [];
  let told = false;
  const tell = async () => {
    if (told) return;
    told = true;
    try { await afterSnapshot(); } catch { /* All stop goes on */ }
  };
  async function take(runs = []) {
    ({ snapshot, leftAlone } = await snapshotOf({ engine, runs, processes, list, cwds, self }));
    await tell();
  }

  let result;
  try {
    result = await engine.stopAll(reason, { beforeCancel: take, known });
  } catch (error) {
    result = { cancelled: [], survivors: [], paused: [], trouble: `The engine couldn't cancel its runs: ${error instanceof Error ? error.message : 'unknown'}` };
  }
  // No run was running (or the engine couldn't say): the host's own processes are still looked at.
  if (snapshot === null) await take([]);
  await tell();
  const { ended, survivors } = await endSnapshot(snapshot, { list, kill, wait, grace, sleep });
  return {
    cancelled: result?.cancelled ?? [],
    paused: result?.paused ?? [],
    refused: result?.survivors ?? [],
    ended,
    survivors,
    leftAlone,
    ...(result?.trouble ? { trouble: result.trouble } : {}),
  };
}

// endRun({ engine, run: { id, folder? }, kill, list, cwds, grace, sleep, self }) -> { ended, survivors, leftAlone }
// One run's process tree ended by pid, as All stop ends every run's, for a run the engine wouldn't stop at its cap.
// No other run is touched, and nothing is cancelled.
export async function endRun({
  engine, run, kill = killByPid, list = listProcesses, cwds = listCwds, grace = KILL_GRACE_MS, sleep = delay, self = process.pid,
} = {}) {
  const { snapshot, leftAlone } = await snapshotOf({ engine, runs: [run], list, cwds, self });
  const { ended, survivors } = await endSnapshot(snapshot, { list, kill, wait: 0, grace, sleep });
  return { ended, survivors, leftAlone };
}

// cancelRuns({ engine, runIds, end }) -> { cancelled, refused, survivors }
// Only the runs named, as one project's uninstall cancels its own while other projects stay on the one engine (part
// 3f, M4): each the engine says is still going or paused is cancelled, then its process tree ended by pid (endRun). A run
// the engine says has ended, or doesn't know, is left. `refused` names the runs whose cancel the engine refused, and
// `survivors` the processes still left, by name.
export async function cancelRuns({ engine, runIds = [], reason = 'Uninstall', end = (run) => endRun({ engine, run }) } = {}) {
  const cancelled = [];
  const refused = [];
  const survivors = [];
  for (const id of runIds) {
    let status = 'unknown';
    try { status = (await engine.inspect(id))?.status ?? 'unknown'; } catch { /* asked to cancel all the same */ }
    if (status === 'ended') continue;
    let got;
    try { got = await engine.act(id, { cancel: { reason } }); } catch { got = null; }
    if (got?.ok === true) cancelled.push(id);
    else if (status === 'running' || status === 'paused') refused.push(id);
    survivors.push(...(await end({ id })).survivors);
  }
  return { cancelled, refused, survivors };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// What All stop did to the engine, in plain words for the Logbook.
export function stopWords({ cancelled = [], paused = [], refused = [], ended = [], survivors = [], leftAlone = [], trouble } = {}) {
  const lines = [];
  if (trouble) lines.push(`${trouble}.`);
  lines.push(cancelled.length > 0 ? `All stop cancelled ${plural(cancelled.length, 'run')} of the engine.` : 'All stop found no engine run under way to cancel.');
  if (paused.length > 0) lines.push(`${plural(paused.length, 'run')} waiting on an answer ${paused.length === 1 ? 'stays' : 'stay'} paused, and nothing carries ${paused.length === 1 ? 'it' : 'them'} on while All stop is on.`);
  if (refused.length > 0) lines.push(`The engine wouldn't cancel ${plural(refused.length, 'run')}.`);
  if (ended.length > 0) lines.push(`Wheelhouse ended ${plural(ended.length, 'process', 'processes')} the engine left running: ${ended.join(', ')}.`);
  if (leftAlone.length > 0) lines.push(`Wheelhouse left ${plural(leftAlone.length, 'process', 'processes')} alone that the engine's record gave as a run's owner but that ${leftAlone.length === 1 ? "isn't" : "aren't"} the engine's: ${leftAlone.join(', ')}.`);
  if (survivors.length > 0) lines.push(`${plural(survivors.length, 'process is', 'processes are')} still running after All stop: ${survivors.join(', ')}. Wheelhouse couldn't end ${survivors.length === 1 ? 'it' : 'them'}.`);
  return lines.join(' ');
}
