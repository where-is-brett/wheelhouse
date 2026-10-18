// tests/scripts/foreman/tools.test.js
// The foreman's allowed tools (rulings R45, R63): Read, and exactly its two
// scripts, wake.js and act.js, from the plugin it sits in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { foremanTools, foremanCommands, PLUGIN_ROOT } from '../../../scripts/foreman/tools.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// What a `Bash(<prefix>:*)` rule lets run: the prefix alone, or the prefix and a space.
const allows = (rules, command) => rules.some((rule) => {
  const m = /^Bash\((.*):\*\)$/.exec(rule);
  return m !== null && (command === m[1] || command.startsWith(`${m[1]} `));
});

test('the foreman may Read, and run its two scripts and nothing else', () => {
  const tools = foremanTools('/plugins/wheelhouse', { platform: 'darwin' });
  assert.deepEqual(tools, [
    'Read',
    'Bash(node "/plugins/wheelhouse/scripts/foreman/wake.js":*)',
    'Bash(node "/plugins/wheelhouse/scripts/foreman/act.js":*)',
  ]);
  assert.deepEqual(foremanCommands('/plugins/wheelhouse', { platform: 'darwin' }), {
    wake: 'node "/plugins/wheelhouse/scripts/foreman/wake.js"',
    act: 'node "/plugins/wheelhouse/scripts/foreman/act.js"',
  });

  const bash = tools.filter((t) => t.startsWith('Bash('));
  assert.ok(allows(bash, 'node "/plugins/wheelhouse/scripts/foreman/wake.js" read .wheelhouse/foreman/wakes/a.json'));
  assert.ok(allows(bash, 'node "/plugins/wheelhouse/scripts/foreman/act.js" start login-page'));
  for (const other of [
    'node -e "process.exit(0)"',
    'node "/plugins/wheelhouse/scripts/foreman/wake.js.bak" read x',
    'node "/plugins/wheelhouse/scripts/foreman/start.js" o__p',
    'node "/elsewhere/scripts/foreman/act.js" start x',
    'node',
    'npm test',
    'git push',
  ]) assert.equal(allows(bash, other), false, other);
  // One wildcard per rule, at its end; no Edit, Write or other tool.
  for (const rule of bash) assert.equal(rule.split('*').length, 2, rule);
  assert.deepEqual(tools.filter((t) => !t.startsWith('Bash(')), ['Read']);
});

test('the rules are given on Windows too, with the path in forward slashes', () => {
  assert.deepEqual(foremanTools('C:\\Users\\a b\\plugins\\wheelhouse', { platform: 'win32' }), [
    'Read',
    'Bash(node "C:/Users/a b/plugins/wheelhouse/scripts/foreman/wake.js":*)',
    'Bash(node "C:/Users/a b/plugins/wheelhouse/scripts/foreman/act.js":*)',
  ]);
});

test('by default the plugin root is the one this file sits in', () => {
  assert.equal(PLUGIN_ROOT, root);
  const [, wake, act] = foremanTools();
  const slashed = process.platform === 'win32' ? root.replaceAll('\\', '/') : root;
  assert.equal(wake, `Bash(node "${slashed}/scripts/foreman/wake.js":*)`);
  assert.equal(act, `Bash(node "${slashed}/scripts/foreman/act.js":*)`);
});

test('a plugin root that would change what a rule allows is refused', () => {
  for (const bad of ['relative/root', '/a/*', '/a/"b', '/a/$HOME', '/a/`x`', '/a\nb', '/a\\b', '', null]) {
    assert.throws(() => foremanTools(bad, { platform: 'darwin' }), /plugin/, String(bad));
  }
  assert.throws(() => foremanTools('\\\\server\\share\\wheelhouse', { platform: 'win32' }), /plugin/);
  assert.throws(() => foremanTools('wheelhouse', { platform: 'win32' }), /plugin/);
});
