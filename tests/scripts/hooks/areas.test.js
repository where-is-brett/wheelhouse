// tests/scripts/hooks/areas.test.js
// The areas guard (unattended goals design, section 6): in an engine run whose order carries a goal's areas it refuses a
// write, or a shell delete or move, outside them; with no areas it does nothing; and when the helper can't say, it refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decide, pathsOf } from '../../../scripts/hooks/areas.js';
import { tempFolder } from '../../helpers/homes.js';

const engineEnv = (runId) => ({ WHEELHOUSE_ENGINE_RUN: '1', WORKFLOW_ID: runId, ARCHON_NODE_EXECUTION: JSON.stringify({ runId, path: ['implement'], invocation: 1, attempt: 1 }) });
const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';
const AREAS = { may: ['src/orders/**', 'tests/orders/**'], wontTouch: ['tests/orders/export.test.js'] };

function worktree() {
  const dir = tempFolder('wh-areas-wt-');
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}
function helperWith(areas) {
  const asked = [];
  return { asked, client: { engine: { areas: async (args) => { asked.push(args); return { ok: true, areas }; } } } };
}
const write = (cwd, file) => ({ tool_name: 'Write', cwd, tool_input: { file_path: file, content: 'x' } });
const bash = (cwd, command) => ({ tool_name: 'Bash', cwd, tool_input: { command } });

test('the paths each tool would change are read', () => {
  const cwd = worktree();
  assert.deepEqual(pathsOf(write(cwd, 'src/a.js')).map((p) => path.relative(cwd, p)), ['src/a.js']);
  assert.deepEqual(pathsOf({ tool_name: 'NotebookEdit', cwd, tool_input: { notebook_path: 'n.ipynb' } }).map((p) => path.relative(cwd, p)), ['n.ipynb']);
  assert.deepEqual(pathsOf(bash(cwd, 'rm -f a.js b.js && echo done')).map((p) => path.relative(cwd, p)), ['a.js', 'b.js']);
  assert.deepEqual(pathsOf(bash(cwd, 'git rm -q a.js')).map((p) => path.relative(cwd, p)), ['a.js']);
  assert.deepEqual(pathsOf(bash(cwd, 'mv a.js b.js')).map((p) => path.relative(cwd, p)), ['a.js', 'b.js']);
  assert.deepEqual(pathsOf(bash(cwd, 'git mv a.js b.js')).map((p) => path.relative(cwd, p)), ['a.js', 'b.js']);
  assert.deepEqual(pathsOf(bash(cwd, 'cp a.js b.js')).map((p) => path.relative(cwd, p)), ['b.js']);
  assert.deepEqual(pathsOf(bash(cwd, 'npm test')), []);
  assert.deepEqual(pathsOf({ tool_name: 'Read', cwd, tool_input: { file_path: 'a.js' } }), []);
});

test('a write outside may is refused', async () => {
  const cwd = worktree();
  const { client, asked } = helperWith(AREAS);
  const out = await decide(write(cwd, path.join(cwd, 'src/users/b.js')), { env: engineEnv('run-1'), client });
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /src\/users\/b\.js/);
  assert.deepEqual(asked, [{ runId: 'run-1' }]);
});

test('a write inside may passes', async () => {
  const cwd = worktree();
  assert.equal(await decide(write(cwd, 'src/orders/a.js'), { env: engineEnv('run-1'), client: helperWith(AREAS).client }), undefined);
});

test('a goal\'s check file can\'t be edited', async () => {
  const cwd = worktree();
  const out = await decide({ tool_name: 'Edit', cwd, tool_input: { file_path: 'tests/orders/export.test.js', old_string: 'a', new_string: 'b' } }, { env: engineEnv('run-1'), client: helperWith(AREAS).client });
  assert.ok(denied(out));
});

test('a shell delete outside the areas is refused, and one inside passes', async () => {
  const cwd = worktree();
  const { client } = helperWith(AREAS);
  assert.ok(denied(await decide(bash(cwd, 'rm src/users/b.js'), { env: engineEnv('run-1'), client })));
  assert.ok(denied(await decide(bash(cwd, 'rm tests/orders/export.test.js'), { env: engineEnv('run-1'), client })));
  assert.equal(await decide(bash(cwd, 'rm src/orders/a.js'), { env: engineEnv('run-1'), client }), undefined);
});

test('a path outside the worktree is no part of the project', async () => {
  const cwd = worktree();
  assert.equal(await decide(write(cwd, path.join(tempFolder('wh-art-'), 'plan.md')), { env: engineEnv('run-1'), client: helperWith(AREAS).client }), undefined);
});

test('a run with no areas is free as before', async () => {
  const cwd = worktree();
  assert.equal(await decide(write(cwd, 'anything.js'), { env: engineEnv('run-1'), client: helperWith(null).client }), undefined);
});

test('the hook does nothing outside an engine run', async () => {
  const cwd = worktree();
  const { client, asked } = helperWith(AREAS);
  assert.equal(await decide(write(cwd, 'src/users/b.js'), { env: {}, client }), undefined);
  assert.deepEqual(asked, []);
});

test('a tool that changes no file never asks the helper', async () => {
  const cwd = worktree();
  const { client, asked } = helperWith(AREAS);
  assert.equal(await decide(bash(cwd, 'npm test'), { env: engineEnv('run-1'), client }), undefined);
  assert.deepEqual(asked, []);
});

test('with no word from the helper a write is refused', async () => {
  const cwd = worktree();
  const refusing = { engine: { areas: async () => ({ ok: false, refused: 'the host helper could not be reached: is it running?' }) } };
  assert.ok(denied(await decide(write(cwd, 'src/orders/a.js'), { env: engineEnv('run-1'), client: refusing })));
  const failing = { engine: { areas: async () => { throw new Error('no helper'); } } };
  assert.ok(denied(await decide(write(cwd, 'src/orders/a.js'), { env: engineEnv('run-1'), client: failing })));
});
