// tests/probes/haiku-trial/spare-bug.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { makeTestProject } from '../../../probes/haiku-trial/seed.js';
import { applySpareBug } from '../../../probes/haiku-trial/spare-bug.js';

function fresh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-spare-'));
  const dir = path.join(root, 'project');
  makeTestProject({ dir, git: false });
  return { dir, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function monthOfIn(dir, tz, input) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST')) delete env[key];
  if (tz) env.TZ = tz;
  else delete env.TZ;
  const url = pathToFileURL(path.join(dir, 'src/lib/dates.js')).href;
  const script = 'import(process.argv[1]).then((m) => console.log(m.monthOf(process.argv[2])))';
  const run = spawnSync(process.execPath, ['-e', script, url, input], { env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

test('applies when monthOf is used', () => {
  const { dir, done } = fresh();
  try {
    fs.appendFileSync(path.join(dir, 'src/server.js'), "\nimport { monthOf } from './lib/dates.js';\nvoid monthOf;\n");
    const result = applySpareBug(dir);
    assert.equal(result.applied, true);
    assert.equal(result.file, 'src/lib/dates.js');
    for (const tz of [undefined, 'Australia/Sydney']) {
      assert.equal(monthOfIn(dir, tz, '31/08/2026'), '2026-09');
      assert.equal(monthOfIn(dir, tz, '15/08/2026'), '2026-08');
    }
  } finally {
    done();
  }
});

test('does not apply when monthOf is unused', () => {
  const { dir, done } = fresh();
  try {
    const file = path.join(dir, 'src/lib/dates.js');
    const before = fs.readFileSync(file);
    const result = applySpareBug(dir);
    assert.equal(result.applied, false);
    assert.match(result.why, /monthOf/);
    assert.ok(before.equals(fs.readFileSync(file)));
  } finally {
    done();
  }
});

test('does not apply when dates.js is gone', () => {
  const { dir, done } = fresh();
  try {
    fs.rmSync(path.join(dir, 'src/lib/dates.js'));
    const result = applySpareBug(dir);
    assert.equal(result.applied, false);
    assert.match(result.why, /dates\.js/);
  } finally {
    done();
  }
});
