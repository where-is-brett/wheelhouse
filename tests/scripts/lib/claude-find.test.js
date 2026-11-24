// tests/scripts/lib/claude-find.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { invocation, resolveClaude, resolveCommand, recordClaudePath, pathWithClaude, readRecordedClaude, readRecordedLaunch, recordedClaudeFault } from '../../../scripts/lib/claude.js';
import { featureStartCall } from '../../../adapters/claude-code/sessions.js';
import { tempFolder } from '../../helpers/homes.js';

const has = (...files) => (file) => files.includes(file);

test('a bare PATH finds claude in ~/.local/bin by its full path', () => {
  const env = { PATH: '/usr/bin:/bin', HOME: '/Users/x' };
  assert.deepEqual(resolveClaude({ platform: 'darwin', env, exists: has('/Users/x/.local/bin/claude') }), { kind: 'direct', file: '/Users/x/.local/bin/claude' });
});

test('it also looks in /opt/homebrew/bin, /usr/local/bin and ~/.claude/local, in that order of folders', () => {
  const env = { PATH: '/usr/bin', HOME: '/Users/x' };
  assert.equal(resolveClaude({ platform: 'linux', env, exists: has('/opt/homebrew/bin/claude') }).file, '/opt/homebrew/bin/claude');
  assert.equal(resolveClaude({ platform: 'linux', env, exists: has('/usr/local/bin/claude') }).file, '/usr/local/bin/claude');
  assert.equal(resolveClaude({ platform: 'linux', env, exists: has('/Users/x/.claude/local/claude') }).file, '/Users/x/.claude/local/claude');
});

test('claude on the PATH stays the bare name', () => {
  const env = { PATH: '/usr/bin:/opt/bin', HOME: '/Users/x' };
  assert.deepEqual(resolveClaude({ platform: 'darwin', env, exists: has('/opt/bin/claude', '/Users/x/.local/bin/claude') }), { kind: 'direct', file: 'claude' });
});

test('a path recorded by a session is used when it still exists, and ignored when it does not', () => {
  const env = { PATH: '/usr/bin', HOME: '/Users/x' };
  const recorded = () => '/Users/x/tools/claude';
  assert.equal(resolveClaude({ platform: 'darwin', env, exists: has('/Users/x/tools/claude'), recorded }).file, '/Users/x/tools/claude');
  assert.deepEqual(resolveClaude({ platform: 'darwin', env, exists: () => false, recorded }), { kind: 'direct', file: 'claude' });
});

test('a recorded path that is not absolute, or is inside the project folder, is not used', () => {
  const env = { PATH: '/usr/bin', HOME: '/Users/x' };
  assert.deepEqual(resolveClaude({ platform: 'darwin', env, exists: has('/opt/homebrew/bin/claude'), recorded: () => 'claude', inside: '/Users/x/proj' }).file, '/opt/homebrew/bin/claude');
  assert.equal(resolveClaude({ platform: 'darwin', env, exists: has('/Users/x/proj/bin/claude'), recorded: () => '/Users/x/proj/bin/claude', inside: '/Users/x/proj' }).file, 'claude');
});

test('nothing found anywhere leaves the bare name, and other programs are unchanged', () => {
  assert.deepEqual(resolveClaude({ platform: 'darwin', env: {}, exists: () => false }), { kind: 'direct', file: 'claude' });
  assert.deepEqual(resolveCommand({ name: 'copilot', platform: 'darwin', env: { PATH: '/usr/bin', HOME: '/Users/x' }, exists: () => true }), { kind: 'direct', file: 'copilot' });
});

test('recordClaudePath keeps the full path a session sees, and nothing when the project holds it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-find-'));
  try {
    const env = { PATH: '/a:/b', HOME: '/Users/x', WHEELHOUSE_HOME: home };
    assert.equal(recordClaudePath({ platform: 'darwin', env, exists: has('/b/claude') }), '/b/claude');
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'claude-path.json'), 'utf8')).path, '/b/claude');
    // The default reader finds it again.
    assert.equal(resolveClaude({ platform: 'darwin', env: { PATH: '/usr/bin', WHEELHOUSE_HOME: home }, exists: has('/b/claude') }).file, '/b/claude');
    fs.rmSync(path.join(home, 'claude-path.json'));
    assert.equal(recordClaudePath({ platform: 'darwin', env, exists: has('/b/claude'), inside: '/b' }), null);
    assert.equal(fs.existsSync(path.join(home, 'claude-path.json')), false);
    assert.equal(recordClaudePath({ platform: 'win32', env, exists: () => true }), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('pathWithClaude puts the folder of a found claude on the PATH, and leaves the environment alone otherwise', () => {
  const env = { PATH: '/usr/bin', HOME: '/Users/x', KEEP: '1' };
  const got = pathWithClaude(env, { platform: 'darwin', exists: has('/Users/x/.local/bin/claude') });
  assert.equal(got.PATH, '/Users/x/.local/bin:/usr/bin');
  assert.equal(got.KEEP, '1');
  assert.deepEqual(pathWithClaude(env, { platform: 'darwin', exists: () => false }), env);
  const onPath = { PATH: '/opt/bin:/usr/bin', HOME: '/Users/x' };
  assert.deepEqual(pathWithClaude(onPath, { platform: 'darwin', exists: has('/opt/bin/claude') }), onPath);
  assert.deepEqual(pathWithClaude(env, { platform: 'win32', exists: () => true }), env);
});

test('a damaged claude-path.json reads as unknown and is named, never as a path (review focus 2)', () => {
  const home = tempFolder('wh-claude-path-');
  fs.writeFileSync(path.join(home, 'claude-path.json'), '{\n "path": "C:\\Users\\x\\claude"\n}');
  assert.equal(readRecordedClaude({ WHEELHOUSE_HOME: home }), null);
  const fault = recordedClaudeFault();
  assert.deepEqual([fault.line, fault.column], [2, 13]);
  fs.writeFileSync(path.join(home, 'claude-path.json'), '{"path":"/a/claude"}');
  assert.equal(readRecordedClaude({ WHEELHOUSE_HOME: home }), '/a/claude');
  assert.equal(recordedClaudeFault(), null);
});

// A fake wrapper: a small Node script in a temp folder that prints its arguments and "ready".
function fakeWrapper() {
  const dir = tempFolder('wh-wrapper-');
  const file = path.join(dir, 'wrap');
  fs.writeFileSync(file, `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));\nconsole.log('ready');\n`);
  fs.chmodSync(file, 0o755);
  return { dir, file };
}

test('with a launch, resolveClaude runs the wrapper with shell false and Wheelhouse\'s arguments after its words', () => {
  const { dir, file } = fakeWrapper();
  const resolved = resolveClaude({ platform: process.platform, env: { PATH: `${dir}:/usr/bin`, HOME: '/Users/x' }, launch: ['wrap', 'claude', '--model', 'x'], recordedLaunch: () => null });
  assert.deepEqual(resolved, { kind: 'direct', file, command: file, args: ['claude', '--model', 'x'] });
  const call = invocation(resolved, ['--session-id', 'abc'], ['--permission-mode', 'auto'], 'do the work');
  assert.equal(call.file, file);
  assert.deepEqual(call.args, ['claude', '--model', 'x', '--session-id', 'abc', '-p', 'do the work', '--permission-mode', 'auto']);
  assert.equal(call.verbatim, false);
  const ran = spawnSync(call.file, call.args, { shell: false, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  const [printed, ready] = ran.stdout.trim().split('\n');
  assert.deepEqual(JSON.parse(printed), call.args);
  assert.equal(ready, 'ready');
});

test('a full path as the first word needs no PATH, and a first word that is not there is named', () => {
  const { file } = fakeWrapper();
  assert.equal(resolveClaude({ platform: 'darwin', env: { PATH: '/usr/bin' }, launch: [file, 'claude'], recordedLaunch: () => null }).file, file);
  assert.throws(() => resolveClaude({ platform: 'darwin', env: { PATH: '/usr/bin' }, launch: ['nowrap', 'claude'], recordedLaunch: () => null }), /launch command can't be used.*isn't on this computer's PATH/);
  assert.throws(() => resolveClaude({ platform: 'darwin', env: { PATH: '/usr/bin' }, launch: ['wrap;rm', 'claude'], recordedLaunch: () => null }), /launch command can't be used/);
});

test('a .cmd wrapper on Windows goes through cmd.exe /d /s /c with every word quoted by quoteForCmd', () => {
  const exists = has('C:\\bin\\wrap.cmd');
  const resolved = resolveClaude({ platform: 'win32', env: { Path: 'C:\\bin' }, exists, launch: ['wrap', 'claude', 'my words'], recordedLaunch: () => null });
  assert.deepEqual(resolved, { kind: 'cmd', file: 'C:\\bin\\wrap.cmd', command: 'C:\\bin\\wrap.cmd', args: ['claude', 'my words'] });
  const call = invocation(resolved, [], ['--permission-mode', 'auto'], 'the prompt');
  assert.equal(call.file, 'cmd.exe');
  assert.deepEqual(call.args, ['/d', '/s', '/c', '"C:\\bin\\wrap.cmd claude "my words" -p --permission-mode auto"']);
  assert.equal(call.input, 'the prompt');
  assert.equal(call.verbatim, true);
  // A word cmd.exe can't be given safely is named, never swallowed, even when it got past the split.
  const refused = { ...resolved, args: ['claude', 'a%PATH%'] };
  assert.throws(() => invocation(refused, [], [], 'p'), /launch command can't be passed to cmd\.exe safely/);
  assert.throws(() => invocation({ ...resolved, args: ['C:\\dir\\ '.trimEnd() + ' x\\'] }, [], [], 'p'), /launch command can't be passed to cmd\.exe safely/);
});

test('a .exe wrapper on Windows is started directly, and a .ps1 one is refused', () => {
  const exists = has('C:\\Program Files\\wrap\\wrap.exe');
  const resolved = resolveClaude({ platform: 'win32', env: { Path: 'C:\\x' }, exists, launch: ['C:\\Program Files\\wrap\\wrap.exe', 'claude'], recordedLaunch: () => null });
  assert.equal(resolved.kind, 'direct');
  assert.deepEqual(invocation(resolved, [], [], 'p').args, ['claude', '-p', 'p']);
  assert.throws(() => resolveClaude({ platform: 'win32', env: { Path: 'C:\\x' }, exists: () => true, launch: ['C:\\w\\wrap.ps1'], recordedLaunch: () => null }), /`\.cmd` or `\.exe`/);
});

test('without a launch the arguments are as they were, and recorded launch words stand in only for the same words', () => {
  assert.deepEqual(invocation({ kind: 'direct', file: 'claude' }, ['--a'], ['--b'], 'p').args, ['--a', '-p', 'p', '--b']);
  const env = { PATH: '/usr/bin', HOME: '/Users/x' };
  const kept = { words: ['wrap', 'claude'], file: '/opt/w/wrap' };
  assert.equal(resolveClaude({ platform: 'darwin', env, exists: has('/opt/w/wrap'), launch: ['wrap', 'claude'], recordedLaunch: () => kept }).file, '/opt/w/wrap');
  assert.throws(() => resolveClaude({ platform: 'darwin', env, exists: has('/opt/w/wrap'), launch: ['wrap', 'other'], recordedLaunch: () => kept }), /isn't on this computer's PATH/);
});

test('a recorded launch stands in only for a program of the first word\'s own name, outside the project\'s folder', () => {
  const env = { PATH: '/usr/bin', HOME: '/Users/x' };
  const other = { words: ['wrap', 'claude'], file: '/opt/w/evil' };
  assert.throws(() => resolveClaude({ platform: 'darwin', env, exists: has('/opt/w/evil'), launch: ['wrap', 'claude'], recordedLaunch: () => other }), /isn't on this computer's PATH/);
  const relative = { words: ['wrap', 'claude'], file: 'w/wrap' };
  assert.throws(() => resolveClaude({ platform: 'darwin', env, exists: has('w/wrap'), launch: ['wrap', 'claude'], recordedLaunch: () => relative }), /isn't on this computer's PATH/);
  const inProject = { words: ['wrap', 'claude'], file: '/work/p/bin/wrap' };
  assert.throws(() => resolveClaude({ platform: 'darwin', env, exists: has('/work/p/bin/wrap'), inside: '/work/p', launch: ['wrap', 'claude'], recordedLaunch: () => inProject }), /isn't on this computer's PATH/);
  // A first word found on the PATH inside the project's folder is not used either.
  assert.throws(() => resolveClaude({ platform: 'darwin', env: { PATH: '/work/p/bin' }, exists: has('/work/p/bin/wrap'), inside: '/work/p', launch: ['wrap', 'claude'], recordedLaunch: () => null }), /isn't on this computer's PATH/);
});

test('recordClaudePath records the resolved launch with the path, and readRecordedLaunch reads it back', () => {
  const { dir, file } = fakeWrapper();
  const home = tempFolder('wh-launch-home-');
  const env = { PATH: `${dir}:/usr/bin`, HOME: home, WHEELHOUSE_HOME: home };
  assert.equal(recordClaudePath({ platform: 'darwin', env, exists: (f) => f === file || f === '/usr/bin/claude', launch: ['wrap', 'claude'] }), '/usr/bin/claude');
  assert.deepEqual(readRecordedLaunch(env), { words: ['wrap', 'claude'], file });
  assert.equal(readRecordedClaude(env), '/usr/bin/claude');
  // A launch that fails a check is not recorded.
  recordClaudePath({ platform: 'darwin', env, exists: (f) => f === file || f === '/usr/bin/claude', launch: ['wrap;x'] });
  assert.equal(readRecordedLaunch(env), null);
  // With no claude on the PATH, the wrapper alone is recorded.
  assert.equal(recordClaudePath({ platform: 'darwin', env, exists: (f) => f === file, launch: ['wrap', 'claude'] }), null);
  assert.deepEqual(readRecordedLaunch(env), { words: ['wrap', 'claude'], file });
});

test('sessionEnv still drops ANTHROPIC_BASE_URL with a launch command (review focus 1)', () => {
  const env = { PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'https://gateway.example', CLAUDE_CODE_ENTRYPOINT: 'cli', ANTHROPIC_API_KEY: 'k' };
  const { dir } = fakeWrapper();
  const call = featureStartCall({
    sessionId: 'abc', config: null, prompt: 'p', platform: 'darwin', env: { ...env, PATH: `${dir}:/usr/bin` },
    claude: resolveClaude({ platform: 'darwin', env: { PATH: `${dir}:/usr/bin` }, launch: ['wrap', 'claude'], recordedLaunch: () => null }),
  });
  assert.equal(call.env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(call.env.CLAUDE_CODE_ENTRYPOINT, undefined);
  assert.equal(call.env.ANTHROPIC_API_KEY, 'k');
  assert.equal(call.args[0], 'claude');
  assert.deepEqual(call.args.slice(1, 5), ['-p', 'p', '--session-id', 'abc']);
});
