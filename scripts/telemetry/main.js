// scripts/telemetry/main.js
// The usage receiver as a process: listens on the computer itself, keeps the counts Claude
// Code sends, summarises yesterday and prunes old counts once a day. Started detached by a
// session start; it exits at once when another copy already holds the port. The last uninstall on
// this computer stops it (stopReceiver).
//
// It answers a request first and writes after: the write runs on the next turn of the event
// loop, in the order the requests came, so a slow disk never holds up the session that sent
// the counts. The daily summary and prune run in this process too, because they and the
// writes share series.json and are safe together only when one process does all of them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startReceiver } from './receiver.js';
import { addPoints as addToStore, summariseDay, pruneUsage } from '../usage/store.js';
import { TELEMETRY_PORT } from '../lib/core-numbers.js';
import { usageDir } from '../lib/paths.js';
import { pidAlive, processStartTime } from '../watcher/waker.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 10 * 60 * 1000;

// The port to listen on: `port` in usage/receiver.json when it holds a usable one, else the usual.
export function receiverPort() {
  try {
    const port = JSON.parse(fs.readFileSync(path.join(usageDir(), 'receiver.json'), 'utf8'))?.port;
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  } catch { /* none, or unreadable: the usual port */ }
  return TELEMETRY_PORT;
}

// What the receiver does with a request's points: keeps them on the next turn, after the
// answer has been written. A write that fails loses those counts and nothing else.
export function recordsHandler({ addPoints = addToStore, now = () => new Date() } = {}) {
  return (points) => {
    setImmediate(() => {
      try {
        addPoints(points, { now });
      } catch { /* these counts are lost; the next request is unaffected */ }
    });
  };
}

// Summarises the day before `now` and prunes. One failing does not stop the other.
export function maintain({ now, summarise = summariseDay, prune = pruneUsage }) {
  try {
    summarise(new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10));
  } catch { /* tried again tomorrow */ }
  try {
    prune({ now });
  } catch { /* tried again tomorrow */ }
}

// Runs `maintain` now and again on the first check of each new UTC day. Returns a stop function.
export function everyDay({ now = () => new Date(), checkMs = CHECK_EVERY_MS, work = maintain } = {}) {
  let last = null;
  const check = () => {
    const at = now();
    const today = at.toISOString().slice(0, 10);
    if (today === last) return;
    last = today;
    work({ now: at });
  };
  const first = setImmediate(check);
  const timer = setInterval(check, checkMs);
  timer.unref();
  return () => { clearImmediate(first); clearInterval(timer); };
}

export async function startUsageReceiver({ port = receiverPort(), now = () => new Date(), addPoints = addToStore } = {}) {
  const receiver = await startReceiver({ port, onRecords: recordsHandler({ addPoints, now }) });
  const stopDaily = everyDay({ now });
  return {
    port: receiver.port,
    close: async () => { stopDaily(); await receiver.close(); },
  };
}

// Where a running receiver writes its process id, so it can be found and stopped.
export const receiverPidFile = () => path.join(usageDir(), 'receiver.pid');

// How long after the receiver started it may have written its pid file.
const PID_WRITTEN_MS = 2 * 60 * 1000;

// Stops the usage receiver, as the last uninstall on this computer does (ruling R89): { stopped,
// why? }, `why: 'not running'` when none runs. Only the process its pid file names is stopped, and
// only while it is still that process: alive, and started before the file was written (a pid
// reused since the receiver ended started later). A start time the system won't give stops nothing
// (it fails closed), and says so.
export async function stopReceiver({ alive = pidAlive, kill = process.kill, startTime = processStartTime } = {}) {
  let pid;
  let writtenMs;
  try {
    const file = receiverPidFile();
    writtenMs = fs.statSync(file).mtimeMs;
    pid = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
  } catch {
    return { stopped: false, why: 'not running' };
  }
  if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) return { stopped: false, why: 'not running' };
  const started = Date.parse((await startTime(pid)) ?? '');
  if (!Number.isFinite(started) || started > writtenMs + PID_WRITTEN_MS) return { stopped: false, why: 'its process could not be told apart from another, so it was left running' };
  try {
    kill(pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') return { stopped: false, why: `it could not be stopped (${error?.code ?? 'no reason given'})` };
  }
  return { stopped: true };
}

function startedAsScript() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (process.argv[1] && startedAsScript()) {
  const pidFile = receiverPidFile();
  try {
    const receiver = await startUsageReceiver();
    // Only so the receiver can be found and stopped; removed when it ends.
    try {
      fs.mkdirSync(path.dirname(pidFile), { recursive: true });
      fs.writeFileSync(pidFile, `${process.pid}\n`);
    } catch { /* the receiver works without it */ }
    const stop = () => {
      try {
        if (fs.readFileSync(pidFile, 'utf8').trim() === String(process.pid)) fs.rmSync(pidFile, { force: true });
      } catch { /* already gone */ }
      receiver.close().then(() => process.exit(0), () => process.exit(1));
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  } catch (error) {
    // Another copy holds the port: it is doing the work.
    process.exit(error?.code === 'EADDRINUSE' ? 0 : 1);
  }
}
