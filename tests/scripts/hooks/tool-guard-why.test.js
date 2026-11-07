// tests/scripts/hooks/tool-guard-why.test.js
// A "why" session reads and searches; it never edits and never runs a shell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { decide } from '../../../scripts/hooks/tool-guard.js';

const input = (tool_name, tool_input = {}) => ({ cwd: os.tmpdir(), session_id: 's', hook_event_name: 'PreToolUse', permission_mode: 'plan', tool_name, tool_input });
const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';
const why = { WHEELHOUSE_ROLE: 'why' };

test('tool-guard refuses Edit, Write, MultiEdit, NotebookEdit and Bash in a why session', async () => {
  for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
    assert.ok(denied(await decide(input(tool, { file_path: '/work/a.txt' }), { env: why })), tool);
  }
  for (const tool of ['Bash', 'PowerShell', 'Monitor']) {
    assert.ok(denied(await decide(input(tool, { command: 'ls' }), { env: why })), tool);
  }
});

test('a why session is refused any tool but Read, Grep and Glob', async () => {
  assert.ok(denied(await decide(input('mcp__some__tool'), { env: why })));
  assert.ok(denied(await decide(input('Task'), { env: why })));
  assert.ok(denied(await decide(input('Edit', { file_path: '/work/a.txt' }), { env: { wheelhouse_role: 'why' } })), 'any spelling of the variable');
});

test('Read, Grep and Glob pass the why role on to the usual checks', async () => {
  for (const tool of ['Read', 'Grep', 'Glob']) {
    assert.ok(!denied(await decide(input(tool, { file_path: '/work/a.txt', pattern: 'x' }), { env: why })), tool);
  }
});

test('other sessions are unchanged', async () => {
  assert.ok(!denied(await decide(input('Edit', { file_path: '/work/a.txt' }), { env: {} })));
  assert.ok(!denied(await decide(input('Bash', { command: 'ls' }), { env: { WHEELHOUSE_ROLE: 'foreman' } })));
});
