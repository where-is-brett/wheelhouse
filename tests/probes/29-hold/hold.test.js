// tests/probes/29-hold/hold.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../../../probes/29-hold/hold.js', import.meta.url));

function runHook(cwd, toolName, toolInput = {}) {
  return spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', cwd, tool_name: toolName, tool_input: toolInput }),
    encoding: 'utf8',
  });
}

function folder(marked) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hold-'));
  if (marked) fs.writeFileSync(path.join(dir, '.hold-probe'), '');
  return dir;
}

test('with the marker, Edit, Write and Bash are refused with "probe: held"', () => {
  const dir = folder(true);
  for (const tool of ['Edit', 'Write', 'Bash', 'PowerShell', 'MultiEdit']) {
    const result = runHook(dir, tool, { file_path: 'x', command: 'echo x' });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(output.hookEventName, 'PreToolUse');
    assert.equal(output.permissionDecision, 'deny');
    assert.equal(output.permissionDecisionReason, 'probe: held');
  }
});

test('with the marker, Read, Grep and Glob pass', () => {
  const dir = folder(true);
  for (const tool of ['Read', 'Grep', 'Glob']) {
    const result = runHook(dir, tool, { file_path: 'x' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '', tool);
  }
});

test('without the marker the hook stays silent for every tool', () => {
  const dir = folder(false);
  for (const tool of ['Read', 'Edit', 'Write', 'Bash']) {
    const result = runHook(dir, tool, { command: 'echo x' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '', tool);
  }
});

test('a marker beside the hook, with an unmarked session folder, stays silent', () => {
  const beside = fs.mkdtempSync(path.join(os.tmpdir(), 'hold-copy-'));
  const copy = path.join(beside, 'hold.js');
  fs.copyFileSync(hook, copy);
  fs.writeFileSync(path.join(beside, '.hold-probe'), '');
  const result = spawnSync(process.execPath, [copy], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', cwd: folder(false), tool_name: 'Bash', tool_input: { command: 'echo x' } }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
