// tests/scripts/foreman/tools.test.js
// The foreman's allowed tools (rulings R45, R63): Read, and exactly its two
// scripts, wake.js and act.js, from the plugin it sits in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { foremanTools, foremanCommands, PLUGIN_ROOT } from '../../../scripts/foreman/tools.js';
import { invocation } from '../../../scripts/lib/claude.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// What a `Bash(<prefix>:*)` rule lets run: the prefix alone, or the prefix and a space.
const allows = (rules, command) => rules.some((rule) => {
  const m = /^Bash\((.*):\*\)$/.exec(rule);
  return m !== null && (command === m[1] || command.startsWith(`${m[1]} `));
});

const OTHERS = (base) => [
  'node -e "process.exit(0)"',
  `node '${base}/scripts/foreman/wake.js.bak' read x`,
  `node '${base}/scripts/foreman/start.js' o__p`,
  "node '/elsewhere/scripts/foreman/act.js' start x",
  'node',
  'npm test',
  'git push',
];

test('the foreman may Read, and run its two scripts and nothing else', () => {
  const tools = foremanTools('/plugins/wheelhouse', { platform: 'darwin' });
  assert.deepEqual(tools, [
    'Read',
    "Bash(node '/plugins/wheelhouse/scripts/foreman/wake.js':*)",
    "Bash(node '/plugins/wheelhouse/scripts/foreman/act.js':*)",
  ]);
  assert.deepEqual(foremanCommands('/plugins/wheelhouse', { platform: 'darwin' }), {
    wake: "node '/plugins/wheelhouse/scripts/foreman/wake.js'",
    act: "node '/plugins/wheelhouse/scripts/foreman/act.js'",
  });

  const bash = tools.filter((t) => t.startsWith('Bash('));
  assert.ok(allows(bash, "node '/plugins/wheelhouse/scripts/foreman/wake.js' read .wheelhouse/foreman/wakes/a.json"));
  assert.ok(allows(bash, "node '/plugins/wheelhouse/scripts/foreman/act.js' start login-page"));
  for (const other of OTHERS('/plugins/wheelhouse')) assert.equal(allows(bash, other), false, other);
  // One wildcard per rule, at its end; one pair of parentheses; no Edit, Write or other tool.
  for (const rule of bash) {
    assert.equal(rule.split('*').length, 2, rule);
    assert.equal(rule.replace(/[^()]/g, ''), '()', rule);
    assert.doesNotMatch(rule, /[",]/, rule);
  }
  assert.deepEqual(tools.filter((t) => !t.startsWith('Bash(')), ['Read']);
});

test('the rules are given on Windows too, with the path in forward slashes, and pass through claude.cmd', () => {
  const winRoot = 'C:\\Users\\a b\\plugins\\wheelhouse';
  const tools = foremanTools(winRoot, { platform: 'win32' });
  assert.deepEqual(tools, [
    'Read',
    "Bash(node 'C:/Users/a b/plugins/wheelhouse/scripts/foreman/wake.js':*)",
    "Bash(node 'C:/Users/a b/plugins/wheelhouse/scripts/foreman/act.js':*)",
  ]);
  // Through the npm shim, as the waker starts a foreman: no argument is refused,
  // and the command line still names exactly the two scripts.
  const run = invocation({ kind: 'cmd', file: 'C:\\npm\\claude.cmd' }, [], ['--permission-mode', 'acceptEdits', '--allowedTools', ...tools], 'Wheelhouse foreman: handle x.json');
  const line = run.args.at(-1);
  for (const tool of tools) assert.ok(line.includes(tool), tool);
  assert.equal((line.match(/scripts\/foreman\/[a-z]+\.js/g) ?? []).join(' '), 'scripts/foreman/wake.js scripts/foreman/act.js');
  const bash = tools.filter((t) => t.startsWith('Bash('));
  assert.ok(allows(bash, "node 'C:/Users/a b/plugins/wheelhouse/scripts/foreman/act.js' start x"));
  for (const other of OTHERS('C:/Users/a b/plugins/wheelhouse')) assert.equal(allows(bash, other), false, other);
});

test('by default the plugin root is the one this file sits in', () => {
  assert.equal(PLUGIN_ROOT, root);
  const [, wake, act] = foremanTools();
  const slashed = process.platform === 'win32' ? root.replaceAll('\\', '/') : root;
  assert.equal(wake, `Bash(node '${slashed}/scripts/foreman/wake.js':*)`);
  assert.equal(act, `Bash(node '${slashed}/scripts/foreman/act.js':*)`);
});

test('a plugin root outside the allowed characters is refused', () => {
  for (const bad of [
    'relative/root', '/a/*', '/a/"b', "/a/'b", '/a/$HOME', '/a/`x`', '/a\nb', '/a\\b', '/a/%PATH%',
    '/p) Bash x(', '/a(b)', '/a,b', '/a  b', '/a/ b', '/a/b ', '/a:b', '/a;b', '/a&b', '/a|b', '/a^b', '/a!b', '', null,
  ]) {
    assert.throws(() => foremanTools(bad, { platform: 'darwin' }), /plugin/, String(bad));
  }
  for (const bad of ['\\\\server\\share\\wheelhouse', 'wheelhouse', 'C:\\a:b', 'C:\\a(b)', "C:\\a'b", 'C:\\a,b', 'C:\\a%b%']) {
    assert.throws(() => foremanTools(bad, { platform: 'win32' }), /plugin/, bad);
  }
  // Ordinary roots are taken.
  for (const good of ['/Users/a.b/.claude/plugins/cache/wheelhouse@1.2.0', '/home/a_b/x-y/z=1', '/a b/c']) {
    assert.doesNotThrow(() => foremanTools(good, { platform: 'darwin' }), good);
  }
  assert.doesNotThrow(() => foremanTools('D:/plugins/wheelhouse', { platform: 'win32' }));
});

test('a plugin root with accented or non-Latin letters, or a Windows short name, is taken', () => {
  const roots = [
    ['/Users/José/.claude/plugins/wheelhouse', 'darwin'],
    ['/Users/Jose\u0301/.claude/plugins/wheelhouse', 'darwin'], // the accent as a combining mark
    ['/home/Søren Ørsted/plugins/wheelhouse', 'linux'],
    ['/home/田中/plugins/wheelhouse', 'linux'],
    ['/home/Дмитрий/plugins/wheelhouse', 'linux'],
    ['C:\\Users\\JOSE~1\\.claude\\plugins\\wheelhouse', 'win32'],
    ['C:\\Users\\Zoë\\plugins\\wheelhouse', 'win32'],
  ];
  for (const [root, platform] of roots) {
    const [, wake, act] = foremanTools(root, { platform });
    const slashed = platform === 'win32' ? root.replaceAll('\\', '/') : root;
    assert.equal(wake, `Bash(node '${slashed}/scripts/foreman/wake.js':*)`, root);
    assert.equal(act, `Bash(node '${slashed}/scripts/foreman/act.js':*)`, root);
  }
  // The other refusals stand beside the letters now allowed.
  for (const bad of ['/Users/José/a"b', "/Users/José/a'b", '/Users/田中/$HOME', '/Users/田中/(x)', '/Users/José/a,b', '/Users/José/%x%', '/Users/José/a b ', '/Users/José/*']) {
    assert.throws(() => foremanTools(bad, { platform: 'darwin' }), /plugin/, bad);
  }
  for (const bad of ['C:\\Users\\JOSE~1\\a"b', 'C:\\Users\\Zoë\\a%b%', 'C:\\Users\\Zoë\\a(b)']) {
    assert.throws(() => foremanTools(bad, { platform: 'win32' }), /plugin/, bad);
  }
  // Through claude.cmd, a short-name root passes as an argument.
  const tools = foremanTools('C:\\Users\\JOSE~1\\plugins\\wheelhouse', { platform: 'win32' });
  assert.doesNotThrow(() => invocation({ kind: 'cmd', file: 'C:\\npm\\claude.cmd' }, [], ['--allowedTools', ...tools], 'Wheelhouse foreman: handle x.json'));
});
