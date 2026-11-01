// tests/helpers/test-home.js
// Loaded before every test file by `npm test` (package.json, `--import`). A test process that
// wasn't given a WHEELHOUSE_HOME gets a temporary one of its own, removed when the process ends,
// so code a test reaches outside its own home (an event made at load time, a helper request still
// running after its test's home was put back) can never write the director's real ~/.wheelhouse.
// A home the process was given is left as it is.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// launchd is the computer's own: a scratch home doesn't keep a test off the real `dev.wheelhouse.helper`. Code reaches
// launchctl by name, so a test process, and all it starts, finds a stand-in that refuses. A folder in the repository
// rather than a temporary one, so a helper that outlives its test still finds it.
if (process.platform !== 'win32') {
  const noLaunchctl = fileURLToPath(new URL('./no-launchctl', import.meta.url));
  const found = (process.env.PATH ?? '').split(path.delimiter);
  if (found[0] !== noLaunchctl) process.env.PATH = [noLaunchctl, ...found.filter((p) => p !== noLaunchctl)].join(path.delimiter);
}

// On Windows the temporary folder can come spelt with a short name (C:\Users\RUNNER~1 on CI's
// runner) while git and the real path give the long one, so a test's own folder and what the code
// reads back from git would name one place two ways. Each process, and what it starts, uses the
// long spelling.
if (process.platform === 'win32') {
  const long = fs.realpathSync.native(os.tmpdir());
  process.env.TEMP = long;
  process.env.TMP = long;
}

if (!process.env.WHEELHOUSE_HOME) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-test-home-'));
  process.env.WHEELHOUSE_HOME = home;
  process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }));
}
