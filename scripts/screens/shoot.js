// scripts/screens/shoot.js
// Photographing one page of a preview in a hidden browser. The browser only ever opens the host's
// preview deployment (an https address), never a project's own files, and each run has a fresh
// profile folder that is removed afterwards. A page that fails to load, or loads with an error
// status, gives no picture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run as runProgram } from '../lib/run.js';
import { SCREEN_TIMEOUT_MS, SCREEN_SETTLE_MS } from '../lib/front-desk.js';
import { pixelHash } from './png.js';

// How many redirects on the preview's own host are followed before giving up.
const MOST_REDIRECTS = 5;
// How often, in milliseconds, the picture file is looked at while the browser runs.
const PICTURE_POLL_MS = 100;
// What Chrome's headless mode writes to stderr when the page failed to load or timed out.
const LOAD_FAILED = /Page load (failed|timed out)/;

// A variable from `env`, whatever the case of its name (Windows names them in any case).
function variable(env, name) {
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

// Where Chrome, then Edge, usually live on this platform.
function browserPlaces(platform, env) {
  if (platform === 'darwin') {
    const roots = ['/Applications', ...(env.HOME ? [path.posix.join(env.HOME, 'Applications')] : [])];
    return [
      ...roots.map((root) => path.posix.join(root, 'Google Chrome.app/Contents/MacOS/Google Chrome')),
      ...roots.map((root) => path.posix.join(root, 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge')),
    ];
  }
  if (platform === 'win32') {
    const [programs, programs86, local] = ['ProgramFiles', 'ProgramFiles(x86)', 'LocalAppData'].map((name) => variable(env, name));
    const under = (roots, rest) => roots.filter(Boolean).map((root) => path.win32.join(root, rest));
    return [
      ...under([programs, programs86, local], 'Google\\Chrome\\Application\\chrome.exe'),
      ...under([programs, programs86], 'Microsoft\\Edge\\Application\\msedge.exe'),
    ];
  }
  if (platform === 'linux') return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return [];
}

// The first Chrome or Edge found, or null when neither is installed.
export function findBrowser({ platform = process.platform, exists = fs.existsSync, env = process.env } = {}) {
  return browserPlaces(platform, env).find((place) => exists(place)) ?? null;
}

// The browser's arguments for one screenshot of `url` at `size`, written to `out`, with its profile
// in `profile`. The page's scripts get SCREEN_SETTLE_MS to draw first; the browser's sandbox stays on.
// The address goes last.
export function browserArgs({ url, size, profile, out }) {
  return [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--virtual-time-budget=${SCREEN_SETTLE_MS}`,
    `--user-data-dir=${profile}`,
    `--window-size=${size.width},${size.height}`,
    `--screenshot=${out}`,
    url,
  ];
}

// Whether `browser` is stopped once its picture is whole. Chrome and Edge on macOS stay running after
// writing the picture (check 34). Chrome writes none when the page fails to load, so a whole picture
// from it is the page; Edge photographs its own error page, so its picture counts only when it exits
// 0 by itself.
export function stopsAtPicture(browser) {
  return typeof browser === 'string' && /chrom/i.test(browser.split(/[\\/]/).at(-1));
}

// Runs `browser` once with `browserArgs`. With `stopAtPicture`, `out` is watched and the browser is
// stopped once the file holds a whole PNG. Resolves with `run`'s result; when the browser was stopped
// for a whole picture, it carries `stopped: true` and the picture's `hash`.
export async function runBrowser({ browser, url, size, profile, out, stopAtPicture = stopsAtPicture(browser), run = runProgram, timeoutMs = SCREEN_TIMEOUT_MS }) {
  const args = browserArgs({ url, size, profile, out });
  if (!stopAtPicture) return run(browser, args, { timeoutMs });
  const stop = new AbortController();
  let hash = null;
  const watch = setInterval(() => {
    let png;
    try { png = fs.readFileSync(out); } catch { return; }
    try { hash = pixelHash(png); } catch { return; /* not yet written in full */ }
    clearInterval(watch);
    stop.abort();
  }, PICTURE_POLL_MS);
  try {
    const result = await run(browser, args, { timeoutMs, signal: stop.signal });
    return result.stopped && hash ? { ...result, hash } : result;
  } finally {
    clearInterval(watch);
  }
}

// Reads the page's status before any browser runs, following redirects only while they stay on the
// page's own origin. Resolves to { ok: true, url } with the address that answered 2xx (not 204 or 205), or
// { ok: false, why }.
async function readStatus(url, fetch, timeoutMs) {
  const origin = new URL(url).origin;
  const signal = AbortSignal.timeout(timeoutMs);
  let at = url;
  for (let hop = 0; hop <= MOST_REDIRECTS; hop++) {
    let response;
    try {
      response = await fetch(at, { redirect: 'manual', signal });
    } catch {
      return { ok: false, why: 'the page did not load' };
    }
    try { await response.body?.cancel(); } catch { /* the body is not needed */ }
    const { status } = response;
    // 204 and 205 have no page to show: a blank picture would match at both commits.
    if (status === 204 || status === 205) return { ok: false, why: `the page answered ${status} with nothing to show` };
    if (status >= 200 && status < 300) return { ok: true, url: at };
    const location = status >= 300 && status < 400 ? response.headers.get('location') : null;
    if (!location) return { ok: false, why: `the page answered ${status}` };
    let next;
    try { next = new URL(location, at); } catch { return { ok: false, why: 'a redirect to nowhere' }; }
    if (next.origin !== origin) return { ok: false, why: 'a redirect off the preview' };
    at = next.href;
  }
  return { ok: false, why: 'too many redirects' };
}

// Photographs `url` at `size` with `browser`. Resolves to { ok: true, hash } with the picture's pixel
// hash, or { ok: false, why }; it never throws. A picture counts when the browser exits 0 after
// writing it, or when it was stopped because the file held a whole PNG (Chrome only, `stopsAtPicture`),
// and never when the browser says the page did not load.
export async function shoot({ browser, url, size, run = runProgram, fetch = globalThis.fetch, tmp = os.tmpdir(), timeoutMs = SCREEN_TIMEOUT_MS } = {}) {
  if (!browser) return { ok: false, why: 'no browser' };
  let address;
  try { address = new URL(url); } catch { return { ok: false, why: 'not an address' }; }
  if (address.protocol !== 'https:') return { ok: false, why: 'not an https address' };
  if (!Number.isInteger(size?.width) || !Number.isInteger(size?.height) || size.width < 1 || size.height < 1) return { ok: false, why: 'not a size' };

  const status = await readStatus(address.href, fetch, timeoutMs);
  if (!status.ok) return status;

  let profile;
  try {
    profile = await fs.promises.mkdtemp(path.join(tmp, 'wh-screen-'));
    const out = path.join(profile, 'screen.png');
    const result = await runBrowser({ browser, url: status.url, size, profile, out, run, timeoutMs });
    // Chrome's own word that the page did not load: whatever picture there is, it is not the page.
    if (LOAD_FAILED.test(result.stderr ?? '')) return { ok: false, why: 'the browser says the page did not load' };
    if (result.stopped && result.hash) return { ok: true, hash: result.hash };
    if (result.timedOut) return { ok: false, why: 'the browser timed out' };
    if (result.code !== 0) return { ok: false, why: `the browser exited with ${result.code}` };
    let png;
    try { png = await fs.promises.readFile(out); } catch { return { ok: false, why: 'the browser left no picture' }; }
    try { return { ok: true, hash: pixelHash(png) }; } catch (error) { return { ok: false, why: error.message }; }
  } catch (error) {
    return { ok: false, why: `the browser did not run: ${error.message}` };
  } finally {
    if (profile) await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}
