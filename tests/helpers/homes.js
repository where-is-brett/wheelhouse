// tests/helpers/homes.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { helperAddress } from '../../scripts/lib/paths.js';

const unix = process.platform !== 'win32';

// A short temporary home, so a socket inside it stays within the Unix path limit on macOS.
export function shortHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wh-'));
}

// A helper address for a test: a socket in the home, or on Windows a pipe
// that is never the real user's.
export function testAddress(home) {
  return unix
    ? path.join(home, 'helper.sock')
    : helperAddress({ platform: 'win32', user: `test-${crypto.randomBytes(4).toString('hex')}` });
}

// Runs fn with WHEELHOUSE_HOME set to `home`, putting the old value back afterwards.
export async function as(home, fn) {
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try { return await fn(); } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
  }
}
