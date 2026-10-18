// tests/probes/lib/log.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeLogDir, appendJsonl } from '../../../probes/lib/log.js';

function tempFolder(name = 'log-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function readLines(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

test('probeLogDir puts logs under .wheelhouse-probes in the home folder', () => {
  const home = tempFolder();
  const dir = probeLogDir('07-telemetry', home);
  assert.equal(dir, path.join(home, '.wheelhouse-probes', '07-telemetry'));
  assert.ok(fs.statSync(dir).isDirectory());
});

test('appendJsonl writes one line per record', async () => {
  const file = path.join(tempFolder(), 'records.jsonl');
  await appendJsonl(file, { n: 1 });
  await appendJsonl(file, { n: 2 });
  assert.deepEqual(readLines(file), [{ n: 1 }, { n: 2 }]);
});

test('appendJsonl redacts secrets at any depth', async () => {
  const file = path.join(tempFolder(), 'records.jsonl');
  await appendJsonl(file, {
    input: { headers: { Authorization: 'Bearer abc' }, gh_token: 'x', note: 'ok' },
    list: [{ password: 'p' }, { cookie: 'c', keep: 1 }],
    clientSecret: { nested: 'value' },
  });
  const [line] = readLines(file);
  assert.equal(line.input.headers.Authorization, '[redacted]');
  assert.equal(line.input.gh_token, '[redacted]');
  assert.equal(line.input.note, 'ok');
  assert.equal(line.list[0].password, '[redacted]');
  assert.equal(line.list[1].cookie, '[redacted]');
  assert.equal(line.list[1].keep, 1);
  assert.equal(line.clientSecret, '[redacted]');
});

test('appendJsonl works in a folder whose name has a space and an accent', async () => {
  const folder = path.join(tempFolder(), 'with space é');
  const file = path.join(folder, 'records.jsonl');
  await appendJsonl(file, { ok: true });
  assert.deepEqual(readLines(file), [{ ok: true }]);
});
