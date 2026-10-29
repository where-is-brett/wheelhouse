// tests/scripts/hooks/protected-tests.test.js
// The protected-tests guard (Archon design, section 11): in an engine run's step it refuses an edit that deletes a
// test file or adds a skip marker, unless the run's order lists the file; outside a run it does nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decide, changesOf } from '../../../scripts/hooks/protected-tests.js';
import { tempFolder } from '../../helpers/homes.js';

const engineEnv = (runId) => ({ WHEELHOUSE_ENGINE_RUN: '1', WORKFLOW_ID: runId, ARCHON_NODE_EXECUTION: JSON.stringify({ runId, path: ['implement'], invocation: 1, attempt: 1 }) });
const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';

function worktree() {
  const dir = tempFolder('wh-wt-');
  fs.mkdirSync(path.join(dir, '.git'));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'tests', 'price.test.js'), "test('price', () => { assert.equal(price(), 12); });\n");
  fs.writeFileSync(path.join(dir, 'tests', 'old.test.js'), "test('old', () => {});\n");
  return dir;
}

function helperWith(protectedFiles) {
  const asked = [];
  return { asked, client: { engine: { order: async (args) => { asked.push(args); return { ok: true, order: { protectedFiles } }; } } } };
}

test('control-check, deletion and skips are read from each tool', () => {
  const cwd = worktree();
  assert.deepEqual(changesOf({ tool_name: 'Bash', cwd, tool_input: { command: 'rm tests/price.test.js && echo done' } }).map((c) => c.kind), ['deletes']);
  assert.deepEqual(changesOf({ tool_name: 'Bash', cwd, tool_input: { command: 'git rm -q tests/price.test.js' } }).map((c) => c.kind), ['deletes']);
  assert.deepEqual(changesOf({ tool_name: 'Bash', cwd, tool_input: { command: 'mv tests/price.test.js /tmp/x.js' } }).map((c) => c.kind), ['deletes']);
  assert.deepEqual(changesOf({ tool_name: 'Bash', cwd, tool_input: { command: 'rm src/old.js' } }), []);
  assert.deepEqual(changesOf({ tool_name: 'Edit', cwd, tool_input: { file_path: 'tests/price.test.js', old_string: "test('price'", new_string: "test.skip('price'" } }).map((c) => c.kind), ['skips']);
  assert.deepEqual(changesOf({ tool_name: 'Write', cwd, tool_input: { file_path: 'tests/price.test.js', content: '' } }).map((c) => c.kind), ['deletes']);
  assert.deepEqual(changesOf({ tool_name: 'Write', cwd, tool_input: { file_path: 'tests/new.test.js', content: "test('new', () => { assert.ok(1); });\n" } }), []);
});

test('deleting a test file is refused in an engine run', async () => {
  const cwd = worktree();
  const { client, asked } = helperWith([]);
  const out = await decide({ tool_name: 'Bash', cwd, tool_input: { command: 'rm tests/price.test.js' } }, { env: engineEnv('run-1'), client });
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /delete the test tests\/price\.test\.js/);
  assert.deepEqual(asked, [{ runId: 'run-1' }]);
});

test('adding a skip marker is refused in an engine run', async () => {
  const cwd = worktree();
  const { client } = helperWith([]);
  const out = await decide({ tool_name: 'Edit', cwd, tool_input: { file_path: path.join(cwd, 'tests', 'price.test.js'), old_string: "test('price'", new_string: "test.skip('price'" } }, { env: engineEnv('run-1'), client });
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /skip a test in tests\/price\.test\.js/);
});

test('the same deletion is allowed when the order lists the file', async () => {
  const cwd = worktree();
  const { client } = helperWith(['tests/old.test.js']);
  assert.equal(await decide({ tool_name: 'Bash', cwd, tool_input: { command: 'rm tests/old.test.js' } }, { env: engineEnv('run-1'), client }), undefined);
  assert.ok(denied(await decide({ tool_name: 'Bash', cwd, tool_input: { command: 'rm tests/old.test.js tests/price.test.js' } }, { env: engineEnv('run-1'), client })));
});

test('the hook does nothing outside an engine run', async () => {
  const cwd = worktree();
  const { client, asked } = helperWith([]);
  for (const env of [{}, { ...engineEnv('run-1'), WHEELHOUSE_ENGINE_RUN: undefined }]) {
    assert.equal(await decide({ tool_name: 'Bash', cwd, tool_input: { command: 'rm tests/price.test.js' } }, { env, client }), undefined);
  }
  assert.deepEqual(asked, []);
});

test('a run whose order the helper can\'t give is refused only when a test would change', async () => {
  const cwd = worktree();
  const client = { engine: { order: async () => ({ ok: false, refused: 'the host helper could not be reached: is it running?' }) } };
  assert.ok(denied(await decide({ tool_name: 'Bash', cwd, tool_input: { command: 'rm tests/price.test.js' } }, { env: engineEnv('run-1'), client })));
  assert.equal(await decide({ tool_name: 'Bash', cwd, tool_input: { command: 'npm test' } }, { env: engineEnv('run-1'), client }), undefined);
});
