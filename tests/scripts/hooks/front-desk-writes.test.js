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
  assert.equal(decide(write(folder, target), options(folder, { setUp: () => ({ folder, run: { startedAt: new Date().toISOString() } }) })), undefined);
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

test('a setup run that has been still for hours no longer turns the hook off', () => {
  const { folder } = project();
  const target = path.join(folder, 'notes.js');
  const old = { folder, run: { startedAt: '2026-11-01T00:00:00.000Z', steps: { 1: { doneAt: '2026-11-01T01:00:00.000Z' } } } };
  assert.ok(denied(decide(write(folder, target), options(folder, { setUp: () => old, now: () => Date.parse('2026-11-05T00:00:00.000Z') }))));
  assert.equal(decide(write(folder, target), options(folder, { setUp: () => old, now: () => Date.parse('2026-11-01T01:30:00.000Z') })), undefined);
});

test('a nested repository made inside the project does not turn the hook off, but a linked worktree is its own checkout', () => {
  const { folder } = project();
  const nested = path.join(folder, 'app');
  fs.mkdirSync(path.join(nested, '.git'), { recursive: true });
  assert.ok(denied(decide(write(nested, path.join(nested, 'index.js')), options(folder))));
  assert.ok(denied(decide(write(nested, path.join(folder, 'notes.js')), options(folder))));
});

const bash = (cwd, command) => ({ tool_name: 'Bash', cwd, session_id: 's1', tool_input: { command } });

test('a shell command that writes the product is refused', () => {
  const { folder } = project();
  for (const command of [
    'cat > notes.js <<EOF\nconsole.log(1)\nEOF', 'echo x >> README.md', 'echo x | tee src/a.js', 'sed -i s/a/b/ src/a.js', 'perl -pi -e s/a/b/ src/a.js',
    'cp /tmp/a.js src/a.js', 'mv /tmp/a.js notes.js', 'touch notes.js', 'npm create vite@latest', 'npx create-react-app app', 'git init',
    'cd app && git init', 'node -e "require(\'fs\').writeFileSync(\'a.js\', \'x\')"', 'python3 -c "open(\'a.py\', \'w\').write(\'x\')"',
  ]) {
    const out = decide(bash(folder, command), options(folder));
    assert.ok(denied(out), command);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /plan or work/);
  }
});

test('a shell command that reads, or writes outside the product, passes', () => {
  const { folder } = project();
  for (const command of [
    'ls -la', 'git status', 'npm test 2>&1', 'npm test >/dev/null 2>&1', 'node cli.js card < /tmp/front-desk.json', 'cat <<EOF | node cli.js card\ntouch a\ntee b\nEOF',
    'echo x > /tmp/front-desk.json', `echo x > ${path.join(folder, '.wheelhouse', 'work', 'a.md')}`, 'cat > .wheelhouse/front-desk.json <<EOF\n{}\nEOF',
    'sed -n 1,20p src/a.js', 'git init /tmp/other', 'node cli.js views waiting', 'echo "a > b"', 'grep -r "touch" src',
  ]) assert.equal(decide(bash(folder, command), options(folder)), undefined, command);
  assert.equal(decide(bash(folder, 'echo ${HOME} > "$X"'), options(folder)), undefined, 'a target it can\'t place');
  assert.equal(decide(bash(folder, 'echo (unclosed'), options(folder)), undefined, 'a command it can\'t read');
});

test('the shell check keeps to the same conditions', () => {
  const { folder, worktree } = project();
  assert.equal(decide(bash(worktree, 'touch notes.js'), options(folder)), undefined, 'a linked worktree');
  assert.equal(decide(bash(folder, 'touch notes.js'), options(folder, { role: () => 'feature' })), undefined);
  assert.equal(decide(bash(folder, 'touch notes.js'), options(folder, { find: () => null })), undefined);
});
