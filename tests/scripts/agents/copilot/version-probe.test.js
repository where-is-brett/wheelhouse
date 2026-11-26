// tests/scripts/agents/copilot/version-probe.test.js
// The version probe (scripts/agents/copilot/version-probe.js): it reads the Copilot CLI's version in its own environment
// and in a copy started as the watcher is, prints both and the names the watcher's environment lacks, and writes nothing
// in the home. A stand-in `copilot` answers as the real one does; no Copilot program is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempFolder } from '../../../helpers/homes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PROBE = path.join(ROOT, 'scripts', 'agents', 'copilot', 'version-probe.js');
const unix = process.platform !== 'win32';

function probe(pathFolders) {
  const user = tempFolder('wh-probe-user-');
  const home = path.join(user, '.wheelhouse');
  fs.mkdirSync(home);
  const result = spawnSync(process.execPath, [PROBE], {
    encoding: 'utf8', timeout: 60000,
    env: { HOME: user, WHEELHOUSE_HOME: home, PATH: [...pathFolders, '/usr/bin', '/bin'].join(':'), WH_PROBE_STRAY: 'x', TMPDIR: process.env.TMPDIR ?? '/tmp' },
  });
  return { ...result, home };
}

test('the probe reads the version in this shell and as the watcher does, and names what the watcher\'s environment lacks', { skip: !unix }, () => {
  const bin = tempFolder('wh-probe-bin-');
  fs.writeFileSync(path.join(bin, 'copilot'), "#!/bin/sh\nprintf 'GitHub Copilot CLI 1.0.105.\\nRun '\\''copilot update'\\'' to check for updates.\\n'\n", { mode: 0o755 });
  const { status, stdout, home } = probe([bin]);
  assert.equal(status, 0, stdout);
  assert.equal(stdout.match(/Copilot CLI: 1\.0\.105/g)?.length, 2, stdout);
  assert.match(stdout, /As the watcher reads it:/);
  assert.match(stdout, /lacks \(names only\): .*WH_PROBE_STRAY/);
  assert.doesNotMatch(stdout, /=x\b/, 'no value is printed');
  assert.deepEqual(fs.readdirSync(home), [], 'nothing is written in the home');
});

test('with no copilot to be found, the probe says why and exits 1', { skip: !unix }, () => {
  const { status, stdout } = probe([]);
  assert.equal(status, 1);
  assert.match(stdout, /why not read: copilot (not found on the PATH|--version could not be started)/);
});
