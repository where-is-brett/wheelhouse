// tests/probes/lib/hook-logger.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hookLogger = fileURLToPath(new URL('../../../probes/lib/hook-logger.js', import.meta.url));

test('hook-logger appends its stdin to hooks.jsonl and prints nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-home-'));
  const result = spawnSync(process.execPath, [hookLogger, '99-test', 'UserPromptSubmit'], {
    input: '{"prompt":"hi"}',
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  const file = path.join(home, '.wheelhouse-probes', '99-test', 'hooks.jsonl');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const last = lines.at(-1);
  assert.equal(last.event, 'UserPromptSubmit');
  assert.equal(last.input.prompt, 'hi');
  assert.ok(!Number.isNaN(Date.parse(last.at)));
});
