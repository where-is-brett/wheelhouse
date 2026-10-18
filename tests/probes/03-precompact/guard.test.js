// tests/probes/03-precompact/guard.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('../../../probes/03-precompact/guard.js', import.meta.url));

test('guard blocks the first three compactions and allows the fourth', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-home-'));
  const codes = [];
  for (let i = 0; i < 4; i += 1) {
    const result = spawnSync(process.execPath, [guard], {
      input: JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto' }),
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
    });
    codes.push(result.status);
    if (result.status === 2) assert.match(result.stderr, new RegExp(`probe: blocking compaction ${i + 1}`));
  }
  assert.deepEqual(codes, [2, 2, 2, 0]);
  const log = path.join(home, '.wheelhouse-probes', '03-precompact', 'guard.jsonl');
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => line.count), [1, 2, 3, 4]);
  assert.equal(lines[0].input.trigger, 'auto');
});
