// tests/helpers/test-home.js
// Loaded before every test file by `npm test` (package.json, `--import`). A test process that
// wasn't given a WHEELHOUSE_HOME gets a temporary one of its own, removed when the process ends,
// so code a test reaches outside its own home (an event made at load time, a helper request still
// running after its test's home was put back) can never write the director's real ~/.wheelhouse.
// A home the process was given is left as it is.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.WHEELHOUSE_HOME) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-test-home-'));
  process.env.WHEELHOUSE_HOME = home;
  process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }));
}
