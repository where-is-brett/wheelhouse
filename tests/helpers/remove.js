// tests/helpers/remove.js
// Removes a test's temporary folder, trying again while it is busy: background work a test
// started (a helper's queue, a git process on its way out) may still be writing there, and on
// Windows a folder stays held a moment after the programs in it have ended. Gives up after 30
// seconds and throws what the last try threw.
import fs from 'node:fs';

const BUSY = new Set(['ENOTEMPTY', 'EBUSY', 'EPERM', 'EMFILE', 'ENFILE']);
const LIMIT_MS = 30000;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function removeFolder(dir) {
  const until = Date.now() + LIMIT_MS;
  for (let wait = 50; ; wait = Math.min(wait * 2, 1000)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!BUSY.has(error.code) || Date.now() + wait > until) throw error;
      pause(wait);
    }
  }
}
