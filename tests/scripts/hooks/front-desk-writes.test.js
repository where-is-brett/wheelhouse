// tests/scripts/hooks/front-desk-writes.test.js
// The front desk's write guard: in the chat of a set-up project's own checkout it refuses a write to the product's files;
// in an engine worktree, a job folder, a feature or foreman session, an engine step, a project being set up, a folder
// that isn't set up, or a path outside the project (and `.wheelhouse/` inside it) it does nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decide, FRONT_DESK_NO_WRITES } from '../../../scripts/hooks/front-desk-writes.js';
import { tempFolder } from '../../helpers/homes.js';

const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';

function project() {
  const folder = fs.realpathSync(tempFolder('wh-fdw-'));
  fs.mkdirSync(path.join(folder, '.git'));
  fs.mkdirSync(path.join(folder, 'src'));
  const worktree = path.join(folder, 'jobs', 'piece');
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: /elsewhere\n');
  return { folder, worktree };
}
const options = (folder, over = {}) => ({
  env: {}, find: () => ({ project: 'p', record: { folder } }), setUp: () => null, role: () => 'front-desk', ...over,
});
const write = (cwd, file, tool = 'Write') => ({
  tool_name: tool, cwd, session_id: 's1', tool_input: tool === 'NotebookEdit' ? { notebook_path: file } : { file_path: file, content: 'x' },
});

test('a write to a product file in the project\'s own checkout is refused, with what to do instead', () => {
  const { folder } = project();
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
    const out = decide(write(folder, path.join(folder, 'notes.js'), tool), options(folder));
    assert.ok(denied(out), tool);
  }
  const out = decide(write(path.join(folder, 'src'), 'a.js'), options(folder));
  assert.ok(denied(out), 'from a subfolder, by a relative path');
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, FRONT_DESK_NO_WRITES('src/a.js'));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /plan or work/);
});

test('the front desk\'s own folder, and files outside the project, are allowed', () => {
  const { folder } = project();
  assert.equal(decide(write(folder, path.join(folder, '.wheelhouse', 'work', 'x.md')), options(folder)), undefined);
  assert.equal(decide(write(folder, path.join(folder, '.wheelhouse', 'front-desk.json')), options(folder)), undefined);
  assert.equal(decide(write(folder, path.join(tempFolder('wh-fdw-out-'), 'front-desk.json')), options(folder)), undefined);
  assert.ok(denied(decide(write(folder, path.join(folder, '.wheelhouse', '..', 'notes.js')), options(folder))), 'a path that climbs out of it');
});

test('an engine worktree or job folder inside the project is allowed', () => {
  const { folder, worktree } = project();
  assert.equal(decide(write(worktree, path.join(worktree, 'notes.js')), options(folder)), undefined);
});

test('a feature or foreman session, an engine step, and a project being set up are allowed', () => {
  const { folder } = project();
  const target = path.join(folder, 'notes.js');
  assert.equal(decide(write(folder, target), options(folder, { role: () => 'feature' })), undefined);
  assert.equal(decide(write(folder, target), options(folder, { role: () => 'foreman' })), undefined);
  assert.equal(decide(write(folder, target), options(folder, { setUp: () => ({ folder }) })), undefined);
  const engine = { WHEELHOUSE_ENGINE_RUN: '1', ARCHON_NODE_EXECUTION: JSON.stringify({ runId: 'r1' }), WORKFLOW_ID: 'r1' };
  assert.equal(decide(write(folder, target), options(folder, { env: engine })), undefined);
});

test('a folder that is not a set-up project, and other tools, are untouched', () => {
  const { folder } = project();
  const target = path.join(folder, 'notes.js');
  assert.equal(decide(write(folder, target), options(folder, { find: () => null })), undefined);
  assert.equal(decide({ tool_name: 'Read', cwd: folder, tool_input: { file_path: target } }, options(folder)), undefined);
  assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: target } }, options(folder)), undefined);
});
