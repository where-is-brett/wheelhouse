// scripts/screens/browser.js
// Finding the browser the helper photographs pages with, and telling Chrome from Edge. It imports
// only fs and path, so the board's health line can ask whether Chrome is here without loading the
// browser runner (shoot.js).
import fs from 'node:fs';
import path from 'node:path';

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

// Whether `browser` is Chrome (or Chromium), by its program's name: only Chrome's pictures are
// trusted so far (check 34).
export function isChrome(browser) {
  return typeof browser === 'string' && /chrom/i.test(browser.split(/[\\/]/).at(-1));
}
