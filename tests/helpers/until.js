// tests/helpers/until.js
// Waiting in a test for something to happen. A test waits on the thing itself, checked every few
// milliseconds, and gives up only after a generous limit by the wall clock, so a busy computer
// makes it slower but never makes it fail. A count of tries is no limit: on a loaded computer each
// try takes longer than its sleep, and on an idle one the count runs out sooner than it reads.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

// How long a test waits for a thing it expects before it fails. Well inside the per-test limit
// `npm test` sets (package.json), so the failure says what was waited for.
export const WAIT_MS = 120 * 1000;

// until(check, { what, within, every }) -> check's first truthy answer. `check` may be async.
// Throws once `within` milliseconds have passed without one.
export async function until(check, { what = 'the condition', within = WAIT_MS, every = 20 } = {}) {
  const end = Date.now() + within;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`waited ${within} ms for ${what}`);
    await sleep(every);
  }
}

// How much longer the hooks and the mod's bridge wait on the real helper in a test file that
// calls waitLongerOnTheHelper (scripts/lib/helper-grace.js).
export const HELPER_GRACE_MS = 60 * 1000;

// For a test file that runs the real helper and checks what reaches it: the waits on it the hooks
// and the bridge keep get HELPER_GRACE_MS more, in this process and in every process it starts.
// What a test checks of those waits themselves it checks in a file that does not call this.
export function waitLongerOnTheHelper() {
  process.env.WHEELHOUSE_HELPER_GRACE_MS = String(HELPER_GRACE_MS);
}

// beforeTimer(work, ms) -> { inTime, value }: whether `work` (a promise, or a function giving one)
// settled before a timer of `ms` set at the same moment fired, and what it gave. Both wait on this
// process's event loop, so a loaded computer holds them back alike: a check that something gives
// up at its own limit, and not at a longer one or never, holds however busy the computer is. A
// `work` that rejects rejects here too.
export async function beforeTimer(work, ms) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ inTime: false }), ms); });
  try {
    const running = Promise.resolve(typeof work === 'function' ? work() : work).then((value) => ({ inTime: true, value }));
    return await Promise.race([running, late]);
  } finally {
    clearTimeout(timer);
  }
}

// nodeStartMs() -> how long a Node process that does nothing takes, now, from being started to
// having ended. A check of how soon a child process ends takes this off first: on a loaded
// computer starting Node can take seconds, before any limit of the child's own has begun.
export async function nodeStartMs() {
  const began = Date.now();
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', resolve);
  });
  return Date.now() - began;
}
