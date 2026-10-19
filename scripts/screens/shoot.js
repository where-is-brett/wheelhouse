// scripts/screens/shoot.js
// Photographing one page of a preview in a hidden browser. The browser only ever opens the host's
// preview deployment (an https address on a public host), never a project's own files or a page on
// this computer or its local network, and each run has a fresh profile folder that is removed
// afterwards. A page that fails to load, or loads with an error status, gives no picture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run as runProgram } from '../lib/run.js';
import { SCREEN_TIMEOUT_MS, SCREEN_SETTLE_MS } from '../lib/front-desk.js';
import { pixelHash } from './png.js';
import { publicHttps } from './pages.js';

// How many redirects on the preview's own host are followed before giving up.
const MOST_REDIRECTS = 5;
// How often, in milliseconds, the picture file is looked at while the browser runs.
const PICTURE_POLL_MS = 100;
// What Chrome's headless mode writes to stderr when the page failed to load or timed out.
const LOAD_FAILED = /Page load (failed|timed out)/;
// The start of every profile folder's name in the temporary folder.
const PROFILE_PREFIX = 'wh-screen-';
// How many times removing a profile folder is tried again while a file in it is still held.
const PROFILE_RETRIES = 3;
// A profile folder older than this is one an earlier run left behind, and is cleared out.
export const PROFILE_LEFT_MS = 60 * 60 * 1000;

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

// Whether `browser` is Chrome (or Chromium): the one browser whose pictures are trusted so far, and
// the one stopped once its picture is whole. Chrome and Edge on macOS stay running after writing the
// picture (check 34). Chrome writes none when the page fails to load; Edge photographs its own error
// page and says nothing, so until check 34's Windows run shows how Edge reports a failed load there,
// `shoot` takes no picture from it.
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

// Removes a browser profile folder, trying again while a stopped browser's helpers still hold a file
// in it (Windows). Resolves with whether the folder is gone; never rejects. The probe for check 34
// uses it too, to see whether profiles are left behind.
export async function removeProfile(profile) {
  try {
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: PROFILE_RETRIES });
  } catch { /* whether it is gone is looked at below */ }
  return !fs.existsSync(profile);
}

// Clears out of `tmp` the profile folders earlier runs left behind more than PROFILE_LEFT_MS ago.
// A folder in use is far younger: one run is limited to SCREEN_TIMEOUT_MS.
async function sweepProfiles(tmp) {
  let names;
  try { names = await fs.promises.readdir(tmp); } catch { return; }
  for (const name of names.filter((n) => n.startsWith(PROFILE_PREFIX))) {
    const folder = path.join(tmp, name);
    try {
      const found = await fs.promises.lstat(folder);
      if (found.isDirectory() && Date.now() - found.mtimeMs > PROFILE_LEFT_MS) await removeProfile(folder);
    } catch { /* gone already */ }
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
// hash, or { ok: false, why }; it never throws. Only Chrome is used so far (`stopsAtPicture`). Its
// picture counts when it exits 0 after writing it, or when it was stopped because the file held a
// whole PNG, and never when it says the page did not load. A whole picture is the page as the browser
// drew it: an error status the browser alone was given (a 500 body, a protection page) still gives a
// picture, and only the status read beforehand covers it.
export async function shoot({ browser, url, size, run = runProgram, fetch = globalThis.fetch, tmp = os.tmpdir(), timeoutMs = SCREEN_TIMEOUT_MS } = {}) {
  if (!browser) return { ok: false, why: 'no browser' };
  if (!stopsAtPicture(browser)) return { ok: false, why: "only Chrome's pictures are trusted so far" };
  const address = publicHttps(url);
  if (address === null) return { ok: false, why: 'not an https address on a public host' };
  if (!Number.isInteger(size?.width) || !Number.isInteger(size?.height) || size.width < 1 || size.height < 1) return { ok: false, why: 'not a size' };

  const status = await readStatus(address, fetch, timeoutMs);
  if (!status.ok) return status;

  await sweepProfiles(tmp);
  let profile;
  try {
    profile = await fs.promises.mkdtemp(path.join(tmp, PROFILE_PREFIX));
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
    if (profile) await removeProfile(profile);
  }
}
