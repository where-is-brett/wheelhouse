// tests/probes/12-locked/locked-hook.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../../../probes/12-locked/locked-hook.js', import.meta.url));

function runHook(cwd, command) {
  return spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', cwd, tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
  });
}

function folder(marked) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locked-'));
  if (marked) fs.writeFileSync(path.join(dir, '.wheelhouse-locked-probe'), '');
  return dir;
}

test('without the marker the hook stays silent', () => {
  const result = runHook(folder(false), 'echo locked-probe x');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('with the marker the probe command is refused', () => {
  const result = runHook(folder(true), 'echo locked-probe x');
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, 'PreToolUse');
  assert.equal(output.permissionDecision, 'deny');
  assert.equal(output.permissionDecisionReason, 'probe: refused by the managed hook');
});

test('with the marker other commands pass', () => {
  const result = runHook(folder(true), 'ls');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});
