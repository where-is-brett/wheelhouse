// tests/scripts/lib/homes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withHome } from '../../helpers/homes.js';

test('withHome removes its temporary folders', async () => {
  const before = process.env.WHEELHOUSE_HOME;
  let seen;
  // Synchronous work.
  const value = withHome((home) => {
    seen = home;
    assert.equal(process.env.WHEELHOUSE_HOME, home);
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(`${home}/x`, 'x');
    return 7;
  });
  assert.equal(value, 7);
  assert.equal(fs.existsSync(seen), false);
  assert.equal(fs.existsSync(seen.replace(/[\\/]home$/, '')), false, 'the folder above the home goes too');
  assert.equal(process.env.WHEELHOUSE_HOME, before);

  // Asynchronous work, and work that throws.
  let asyncSeen;
  assert.equal(await withHome(async (home) => { asyncSeen = home; fs.mkdirSync(home, { recursive: true }); return 'a'; }), 'a');
  assert.equal(fs.existsSync(asyncSeen.replace(/[\\/]home$/, '')), false);
  let thrownSeen;
  await assert.rejects(withHome(async (home) => { thrownSeen = home; throw new Error('boom'); }), /boom/);
  assert.equal(fs.existsSync(thrownSeen.replace(/[\\/]home$/, '')), false);
  assert.throws(() => withHome((home) => { thrownSeen = home; throw new Error('boom'); }), /boom/);
  assert.equal(fs.existsSync(thrownSeen.replace(/[\\/]home$/, '')), false);
  assert.equal(process.env.WHEELHOUSE_HOME, before);
});

// npm test loads tests/helpers/test-home.js before each test file (package.json).
const TEST_HOME = fileURLToPath(new URL('../../helpers/test-home.js', import.meta.url));
const REPORT = 'process.stdout.write(JSON.stringify({ home: process.env.WHEELHOUSE_HOME ?? null, there: fs.existsSync(process.env.WHEELHOUSE_HOME ?? "") }))';
function loaded(env) {
  const out = spawnSync(process.execPath, ['--import', pathToFileURL(TEST_HOME).href, '--input-type=module', '-e', `import fs from 'node:fs'; ${REPORT}`], { env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

test('a test process with no WHEELHOUSE_HOME gets a temporary home of its own, removed when it ends', () => {
  const { WHEELHOUSE_HOME: _, ...env } = process.env;
  const first = loaded(env);
  const second = loaded(env);
  assert.equal(typeof first.home, 'string');
  assert.equal(first.there, true);
  assert.notEqual(first.home, second.home, 'each process has its own');
  for (const { home } of [first, second]) {
    assert.equal(path.dirname(home), os.tmpdir(), home);
    assert.notEqual(home, path.join(os.homedir(), '.wheelhouse'));
    assert.equal(fs.existsSync(home), false, 'removed when the process ended');
  }
});

test('a WHEELHOUSE_HOME a test process was given is kept as it is', () => {
  const given = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-given-'));
  try {
    assert.deepEqual(loaded({ ...process.env, WHEELHOUSE_HOME: given }), { home: given, there: true });
    assert.equal(fs.existsSync(given), true, 'left in place');
  } finally {
    fs.rmSync(given, { recursive: true, force: true });
  }
});
