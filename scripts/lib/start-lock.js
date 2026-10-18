// scripts/lib/start-lock.js
// An exclusive file made with `wx`, held while something starts. Used where two starts at
// once must take turns: the state clone, and the helper's socket.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const STALE_MS = 10 * 60 * 1000;

// Whether the process that made a lock file is still running. A file that names no
// process is taken as alive, so only age can free it. EPERM means the process exists.
function holderAlive(file) {
  let pid;
  try {
    pid = Number.parseInt(fs.readFileSync(file, 'utf8'), 10);
  } catch {
    return true;
  }
  if (!Number.isInteger(pid) || pid < 1) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

// Takes the lock and resolves with a function that releases it. One whose process has gone,
// or that is `staleMs` old, is taken over: renamed to a name of its own and then removed, so
// a waiter never deletes a lock that someone else has just made in its place. After `waitMs`
// it rejects with `message`.
export async function takeStartLock(file, { message, waitMs, staleMs = STALE_MS }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(file, `${process.pid}\n`, { flag: 'wx' });
      return () => fs.rmSync(file, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    }
    let seen;
    try { seen = fs.readFileSync(file, 'utf8'); } catch { /* gone */ }
    try {
      if (!holderAlive(file) || Date.now() - fs.statSync(file).mtimeMs > staleMs) {
        const taken = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.stale`;
        fs.renameSync(file, taken); // only one waiter's rename finds the file
        if (seen !== undefined && fs.readFileSync(taken, 'utf8') !== seen) {
          // Not the file that was judged: someone made a fresh lock in between. Put it back
          // (link fails if yet another exists) before going on.
          try { fs.linkSync(taken, file); } catch { /* another lock stands */ }
        }
        fs.rmSync(taken, { force: true });
        continue;
      }
    } catch { /* it went away, or another waiter took it over: try again */ }
    if (Date.now() > until) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
