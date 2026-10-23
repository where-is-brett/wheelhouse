// tests/scripts/eval/harness.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempFolder as madeFolder } from '../../helpers/homes.js';
import { projectSettings } from '../../../scripts/protection/settings.js';
import {
  DENIED_TOOLS,
  SESSION_ENV,
  SESSION_SETTINGS,
  parseStream,
  toolCalls,
  finalText,
  subagents,
  modelsUsed,
  usageOf,
  totalUsageOf,
  resolveClaude,
  quoteForCmd,
  invocation,
  missingFlags,
  runSession,
  locateSuperpowers,
  resultFile,
  describeRun,
  parseArgs,
  runScenario,
  TURNED_AWAY,
  NOT_SENT,
  turnAwayScript,
  turnAwayEntry,
} from '../../../scripts/eval/harness.js';
import { spawn, spawnSync } from 'node:child_process';

const fixture = fileURLToPath(new URL('../../fixtures/eval/stream.jsonl', import.meta.url));
const events = parseStream(fs.readFileSync(fixture, 'utf8'));

// A temporary folder, removed once this file's tests are done.
const tempFolder = (name = 'harness-test-') => madeFolder(name);

test('parseStream reads one event per line, skipping blank lines and keeping unreadable ones visible', () => {
  const parsed = parseStream('{"type":"a"}\n\n   \nnot json\n{"type":"b"}\n');
  assert.deepEqual(parsed.map((event) => event.type), ['a', 'unparsed', 'b']);
  assert.equal(parsed[1].line, 'not json');
});

test('the recorded stream has the events the harness reads', () => {
  assert.ok(events.length > 5);
  assert.equal(events.at(-1).type, 'result');
});

test('toolCalls lists every tool the session called, in order, with its input', () => {
  const calls = toolCalls(events);
  assert.deepEqual(calls.map((call) => call.name), ['Agent', 'Bash']);
  assert.deepEqual(calls[1].input, { command: 'echo done', description: 'Print done' });
});

test('finalText is the session\'s last words', () => {
  assert.equal(finalText(events), 'finished');
});

test('finalText falls back to the last top-level assistant text when there is no result event', () => {
  const withoutResult = events.filter((event) => event.type !== 'result');
  assert.equal(finalText(withoutResult), 'finished');
});

test('subagents lists each dispatch with its type and the model the brief set, or null', () => {
  assert.deepEqual(subagents(events), [{ type: 'general-purpose', model: 'model-b' }]);
  const synthetic = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Task', input: { subagent_type: 'reviewer' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { prompt: 'x', model: 'model-c' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } },
  ];
  assert.deepEqual(subagents(synthetic), [
    { type: 'reviewer', model: null },
    { type: 'general-purpose', model: 'model-c' },
  ]);
});

test('modelsUsed lists the models the result event says did the work', () => {
  assert.deepEqual(modelsUsed(events).sort(), ['model-a', 'model-b']);
  assert.deepEqual(modelsUsed([]), []);
});

test('usageOf counts everything the main session read as input, and what it wrote as output', () => {
  assert.deepEqual(usageOf(events), { input: 6 + 33359 + 123600, output: 237 });
  assert.deepEqual(usageOf([]), { input: 0, output: 0 });
});

test('totalUsageOf sums every model that worked, subagents included', () => {
  assert.deepEqual(totalUsageOf(events), { input: (6 + 33359 + 123600) + (2 + 0 + 40159), output: 237 + 4 });
  // with no per-model figures it falls back to the main session's usage
  const bare = [{ type: 'result', usage: { input_tokens: 1, cache_read_input_tokens: 2, output_tokens: 3 } }];
  assert.deepEqual(totalUsageOf(bare), { input: 3, output: 3 });
  assert.deepEqual(totalUsageOf([]), { input: 0, output: 0 });
});

test('missingFlags names the flags the help text does not mention', () => {
  const help = '  --output-format <format>  x\n  --verbose  y\n  -p, --print  z\n';
  assert.deepEqual(missingFlags(help, ['--output-format', '--verbose', '--print']), []);
  assert.deepEqual(missingFlags(help, ['--output-format', '--plugin-dir', '--max-turns']), ['--plugin-dir', '--max-turns']);
});

// A stand-in for the claude command: answers --help with the flags it supports,
// and otherwise records its arguments and directory, then prints the recorded stream.
function fakeClaude(folder, { helpFlags, exitCode = 0 } = {}) {
  const script = path.join(folder, 'fake-claude.mjs');
  const record = path.join(folder, 'record.json');
  fs.writeFileSync(script, `
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  process.stdout.write(${JSON.stringify((helpFlags ?? ['--print', '--output-format', '--verbose', '--permission-mode', '--plugin-dir', '--model', '--setting-sources', '--append-system-prompt', '--strict-mcp-config', '--disallowedTools', '--settings']).map((flag) => `  ${flag} <value>  something\n`).join(''))});
  process.exit(0);
}
const settingsAt = args.indexOf('--settings');
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, cwd: process.cwd(), marker: process.env.EVAL_MARKER ?? null, env: process.env, settings: settingsAt === -1 ? null : JSON.parse(fs.readFileSync(args[settingsAt + 1], 'utf8')) }));
process.stdout.write(fs.readFileSync(${JSON.stringify(fixture)}, 'utf8'));
process.exit(${exitCode});
`);
  return { command: process.execPath, commandArgs: [script], record: () => JSON.parse(fs.readFileSync(record, 'utf8')) };
}

test('runSession runs claude -p in the folder with the flags asked for, and parses what it prints', async () => {
  const folder = tempFolder();
  const dir = tempFolder('harness-session-');
  const fake = fakeClaude(folder);
  const result = await runSession({
    dir,
    prompt: 'Say hello.',
    pluginDirs: ['/plugins/one', '/plugins/two'],
    permissionMode: 'acceptEdits',
    model: 'model-a',
    maxTurns: 7,
    env: { EVAL_MARKER: 'yes' },
    command: fake.command,
    commandArgs: fake.commandArgs,
  });
  const seen = fake.record();
  assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(dir));
  assert.equal(seen.marker, 'yes');
  const { args } = seen;
  assert.deepEqual(args.slice(0, 2), ['-p', 'Say hello.']);
  const after = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(after('--output-format'), 'stream-json');
  assert.ok(args.includes('--verbose'));
  assert.equal(after('--permission-mode'), 'acceptEdits');
  assert.equal(after('--max-turns'), '7');
  assert.equal(after('--model'), 'model-a');
  assert.equal(after('--setting-sources'), 'project,local');
  const pluginDirs = args.flatMap((arg, i) => (arg === '--plugin-dir' ? [args[i + 1]] : []));
  assert.deepEqual(pluginDirs, ['/plugins/one', '/plugins/two']);
  assert.equal(result.exitCode, 0);
  assert.equal(finalText(result.events), 'finished');
  assert.deepEqual(result.usage, { input: 6 + 33359 + 123600, output: 237 });
  assert.deepEqual(result.totalUsage, totalUsageOf(events));
});

test('runSession leaves out --model when none is given, and reports a non-zero exit', async () => {
  const folder = tempFolder();
  const fake = fakeClaude(folder, { exitCode: 3 });
  const result = await runSession({
    dir: tempFolder('harness-session-'),
    prompt: 'x',
    pluginDirs: [],
    permissionMode: 'dontAsk',
    maxTurns: 1,
    command: fake.command,
    commandArgs: fake.commandArgs,
  });
  assert.ok(!fake.record().args.includes('--model'));
  assert.ok(!fake.record().args.includes('--plugin-dir'));
  assert.ok(!fake.record().args.includes('--append-system-prompt'));
  assert.equal(result.exitCode, 3);
});

test('runSession appends to the system prompt when asked, and checks claude knows the flag', async () => {
  const folder = tempFolder();
  const fake = fakeClaude(folder);
  await runSession({
    dir: tempFolder('harness-session-'),
    prompt: 'x',
    pluginDirs: [],
    permissionMode: 'dontAsk',
    maxTurns: 1,
    appendSystemPrompt: 'You are the front desk.',
    command: fake.command,
    commandArgs: fake.commandArgs,
  });
  const { args } = fake.record();
  assert.equal(args[args.indexOf('--append-system-prompt') + 1], 'You are the front desk.');
  const older = fakeClaude(tempFolder(), { helpFlags: ['--print', '--output-format', '--verbose', '--permission-mode', '--plugin-dir', '--setting-sources'] });
  await assert.rejects(runSession({
    dir: tempFolder('harness-session-'),
    prompt: 'x',
    pluginDirs: [],
    permissionMode: 'dontAsk',
    maxTurns: 1,
    appendSystemPrompt: 'You are the front desk.',
    command: older.command,
    commandArgs: older.commandArgs,
  }), /--append-system-prompt/);
});

test('runSession keeps the session away from the director\'s own: an environment from an allowlist, no MCP server, no tool that reaches other sessions, the account or the Desktop app, no built-in plugin, and no reading ~/.wheelhouse or the process list (F90)', async () => {
  const folder = tempFolder();
  const fake = fakeClaude(folder);
  const planted = {
    CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/the-desktop.sock', CLAUDE_CODE_HOST_SESSION_ID: 'host', CLAUDE_CODE_SESSION_ID: 'mine',
    CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', CLAUDE_EFFORT: 'high', CLAUDE_CODE_USER_EMAIL: 'someone@example.com', SOME_SECRET: 'x',
  };
  const was = Object.fromEntries(Object.keys(planted).map((k) => [k, process.env[k]]));
  Object.assign(process.env, planted);
  try {
    await runSession({ dir: tempFolder('harness-session-'), prompt: 'x', pluginDirs: [], permissionMode: 'acceptEdits', maxTurns: 1, env: { WHEELHOUSE_HOME: '/tmp/eval-home' }, command: fake.command, commandArgs: fake.commandArgs });
  } finally {
    for (const [k, v] of Object.entries(was)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  const { args, env, settings } = fake.record();
  // The command line: no MCP server but those named, and the tools denied.
  assert.ok(args.includes('--strict-mcp-config'));
  const denied = args[args.indexOf('--disallowedTools') + 1].split(',');
  for (const tool of ['ListAgents', 'SendMessage', 'RemoteTrigger', 'CronCreate', 'CronDelete', 'CronList', 'Artifact', 'ArtifactComments', 'ArtifactData', 'DesignSync', 'PushNotification', 'ReportFindings', 'Workflow', 'ScheduleWakeup']) {
    assert.ok(denied.includes(tool), tool);
  }
  // The settings: the built-in plugins off, ~/.wheelhouse and the process list denied.
  for (const plugin of ['cc-plugin-agents-md@builtin', 'cc-plugin-telemetry@builtin', 'cc-plugin-plugin-authoring@builtin']) assert.equal(settings.enabledPlugins[plugin], false, plugin);
  for (const rule of ['Read(~/.wheelhouse/**)', 'Edit(~/.wheelhouse/**)', 'Bash(ps:*)']) assert.ok(settings.permissions.deny.includes(rule), rule);
  // The environment: only the allowlist and what the run sets.
  for (const name of Object.keys(planted)) assert.equal(env[name], undefined, name);
  assert.equal(env.WHEELHOUSE_HOME, '/tmp/eval-home');
  assert.equal(env.PATH, process.env.PATH);
  assert.equal(env.HOME, process.env.HOME);
  assert.ok(Object.keys(env).every((name) => SESSION_ENV.test(name) || name === 'WHEELHOUSE_HOME' || /^__CF|^_$|^SHLVL$|^PWD$|^OLDPWD$/.test(name)), Object.keys(env).join(' '));
});

// A plain run of the fake, with `options` on top; resolves with what the fake saw.
async function sawWith(options, { dir = tempFolder('harness-session-') } = {}) {
  const fake = fakeClaude(tempFolder());
  await runSession({ dir, prompt: 'x', pluginDirs: [], permissionMode: 'acceptEdits', maxTurns: 1, command: fake.command, commandArgs: fake.commandArgs, ...options });
  return fake.record();
}

test('runSession runs the session in Claude Code\'s sandbox as a project\'s own settings have it, reaching only the run\'s stand-in socket, and reading none of the director\'s state, transcripts, projects or credentials (F94)', async () => {
  const socket = path.join(tempFolder('harness-socket-'), 'helper.sock');
  const { settings } = await sawWith({ socket, readable: ['/plugin/root'], writable: ['/main/.git'] });
  const { sandbox } = projectSettings({ webDomains: [] });
  assert.equal(settings.sandbox.enabled, true);
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
  for (const denied of [...sandbox.filesystem.denyRead, '~/.wheelhouse', '~/.ssh', '~/.claude/projects', '~/Projects']) {
    assert.ok(settings.sandbox.filesystem.denyRead.includes(denied), denied);
  }
  for (const denied of sandbox.filesystem.denyWrite) assert.ok(settings.sandbox.filesystem.denyWrite.includes(denied), denied);
  assert.deepEqual(settings.sandbox.network.allowedDomains, ['registry.npmjs.org']);
  // The run's own socket, by both its spellings where the temporary folder has two, and nothing else.
  const spellings = [...new Set([socket, path.join(fs.realpathSync(path.dirname(socket)), 'helper.sock')])];
  assert.deepEqual(settings.sandbox.network.allowUnixSockets, spellings);
  assert.equal(settings.sandbox.network.allowAllUnixSockets, undefined);
  assert.deepEqual(settings.sandbox.filesystem.allowRead, ['/plugin/root']);
  assert.deepEqual(settings.sandbox.filesystem.allowWrite, ['/main/.git']);
  // Still F90's settings beside it.
  assert.ok(settings.permissions.deny.includes('Read(~/.wheelhouse/**)'));
  assert.equal(settings.enabledPlugins['cc-plugin-telemetry@builtin'], false);

  // Per run: another run's socket is that run's alone, and a run with none reaches none.
  const other = path.join(tempFolder('harness-socket-'), 'helper.sock');
  assert.ok(!(await sawWith({ socket: other })).settings.sandbox.network.allowUnixSockets.some((s) => spellings.includes(s)));
  const none = (await sawWith({})).settings;
  assert.deepEqual(none.sandbox.network.allowUnixSockets, []);
  assert.equal(none.sandbox.filesystem.allowRead, undefined);
  assert.equal(none.sandbox.filesystem.allowWrite, undefined);
  assert.equal(SESSION_SETTINGS.sandbox, undefined, 'the static settings name no socket');

  // Never the real helper's socket, nor anything else in the real Wheelhouse home.
  for (const real of [path.join(os.homedir(), '.wheelhouse', 'helper.sock'), path.join(os.homedir(), '.wheelhouse', 'x', 'y.sock')]) {
    await assert.rejects(sawWith({ socket: real }), /real Wheelhouse home/);
  }
});

test('runSession denies the keychain\'s command and the director\'s own Claude data, its own repository, and other runs\' records, but keeps the installed plugins readable (F102)', async () => {
  const { settings } = await sawWith({});
  for (const rule of ['Bash(security:*)', 'Bash(security *)', 'Bash(/usr/bin/security:*)', 'Bash(/usr/bin/security *)']) {
    assert.ok(settings.permissions.deny.includes(rule), rule);
  }
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const { denyRead } = settings.sandbox.filesystem;
  for (const denied of [
    '~/.claude/history.jsonl', '~/.claude/file-history', '~/.claude/sessions', '~/.claude/session-env', '~/.claude/shell-snapshots',
    '~/.claude.json', '~/Library/Application Support/Claude', '~/.wheelhouse-evals', '~/.claude/projects', '~/Projects', repository,
  ]) assert.ok(denyRead.includes(denied), denied);
  // Superpowers' scripts run from the installed plugins, so neither they nor ~/.claude as a whole are denied.
  assert.ok(!denyRead.some((p) => p === '~/.claude' || p === '~/.claude/plugins' || p.startsWith('~/.claude/plugins/')), denyRead.join(' '));
});

test('runSession takes no extra arguments but --permission-prompt-tool stdio, so none can widen or override the isolation (F100)', async () => {
  assert.deepEqual((await sawWith({ extraArgs: [] })).args.includes('--permission-prompt-tool'), false);
  for (const extraArgs of [
    ['--settings', '/elsewhere.json'], ['--permission-prompt-tool', 'mcp__x__y'], ['--allowedTools', 'Bash'],
    ['--permission-prompt-tool', 'stdio', '--mcp-config', '{}'], ['--dangerously-skip-permissions'], ['stdio', '--permission-prompt-tool'], '--permission-prompt-tool stdio',
  ]) {
    await assert.rejects(sawWith({ extraArgs }), /no extra arguments but --permission-prompt-tool stdio/, JSON.stringify(extraArgs));
  }
});

test('runSession offers PushNotification only when asked and only when the project\'s local settings turn the call away with the known hook, failing closed; every other tool stays denied (F99, F107)', async () => {
  const deniedOf = (seen) => seen.args[seen.args.indexOf('--disallowedTools') + 1].split(',');
  assert.ok(deniedOf(await sawWith({})).includes('PushNotification'), 'denied unless offered');
  const dir = tempFolder('harness-session-');
  await assert.rejects(sawWith({ offered: ['PushNotification'] }, { dir }), /PushNotification is offered only with a PreToolUse hook/);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const hooks = (...entries) => fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ hooks: { PreToolUse: entries } }));
  const script = (name, text) => {
    const file = path.join(tempFolder('harness-hook-'), name);
    fs.writeFileSync(file, text);
    return file;
  };
  const known = script('push-sent.mjs', turnAwayScript(TURNED_AWAY.PushNotification));
  // Any other hook is refused: a script that isn't the known one, one whose reason differs, one
  // that isn't there, and the known one without onFailure block, which lets a crash through.
  const { onFailure, ...open } = turnAwayEntry('PushNotification', known).hooks[0];
  for (const [name, entry] of [
    ['another script', turnAwayEntry('PushNotification', script('turn-away.mjs', 'process.exit(0);\n'))],
    ['another reason', turnAwayEntry('PushNotification', script('other.mjs', turnAwayScript('Sent.')))],
    ['no file', turnAwayEntry('PushNotification', path.join(tempFolder(), 'none.mjs'))],
    ['no onFailure', { matcher: 'PushNotification', hooks: [open] }],
    ['another command', { matcher: 'PushNotification', hooks: [{ ...turnAwayEntry('PushNotification', known).hooks[0], command: `node "${known}" --allow` }] }],
  ]) {
    hooks(entry);
    await assert.rejects(sawWith({ offered: ['PushNotification'] }, { dir }), /PushNotification is offered only with a PreToolUse hook/, name);
  }
  hooks(turnAwayEntry('PushNotification', known));
  const denied = deniedOf(await sawWith({ offered: ['PushNotification'] }, { dir }));
  assert.ok(!denied.includes('PushNotification'));
  assert.deepEqual(denied, DENIED_TOOLS.filter((t) => t !== 'PushNotification'));
  // The phone's other known answer, the app's own words when the notification isn't sent, is the
  // known hook too (scenario 37's not-sent legs).
  assert.equal(NOT_SENT, 'Not sent \u2014 this terminal is active, so your output here already reaches the user; a separate notification would be redundant.');
  hooks(turnAwayEntry('PushNotification', script('push-not-sent.mjs', turnAwayScript(NOT_SENT))));
  assert.ok(!deniedOf(await sawWith({ offered: ['PushNotification'] }, { dir })).includes('PushNotification'));
  await assert.rejects(sawWith({ offered: ['ListAgents'] }, { dir }), /only PushNotification can be offered/);
});

test('the turning-away hook answers deny, and a failure of its own refuses the call too (F107)', async () => {
  const file = path.join(tempFolder('harness-hook-'), 'push-sent.mjs');
  fs.writeFileSync(file, turnAwayScript(TURNED_AWAY.PushNotification));
  const out = spawnSync(process.execPath, [file], { input: JSON.stringify({ tool_name: 'PushNotification' }), encoding: 'utf8' });
  assert.equal(out.status, 0);
  assert.deepEqual(JSON.parse(out.stdout).hookSpecificOutput, {
    hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: TURNED_AWAY.PushNotification,
  });
  // A throw while it waits for its input exits 2, which Claude Code takes as a refusal.
  const crash = 'data:text/javascript,setTimeout(() => { throw new Error("broken"); }, 50);';
  const child = spawn(process.execPath, ['--import', crash, file], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 2);
  assert.equal(stdout, '');
  assert.equal(stderr, TURNED_AWAY.PushNotification);
});

test('runSession puts extra arguments last, as given, without looking for them in --help', async () => {
  const folder = tempFolder();
  const fake = fakeClaude(folder);
  await runSession({
    dir: tempFolder('harness-session-'),
    prompt: 'x',
    pluginDirs: [],
    permissionMode: 'dontAsk',
    maxTurns: 1,
    extraArgs: ['--permission-prompt-tool', 'stdio'],
    command: fake.command,
    commandArgs: fake.commandArgs,
  });
  assert.deepEqual(fake.record().args.slice(-2), ['--permission-prompt-tool', 'stdio']);
});

// --max-turns is not in `claude --help` (checked on 2.1.302) yet works, so the fake leaves it out of its help
// and runSession must not refuse for it.
test('runSession refuses to run when this claude does not know a flag it needs', async () => {
  const folder = tempFolder();
  const fake = fakeClaude(folder, { helpFlags: ['--print', '--output-format', '--verbose'] });
  await assert.rejects(
    runSession({
      dir: tempFolder('harness-session-'),
      prompt: 'x',
      pluginDirs: ['/p'],
      permissionMode: 'dontAsk',
      maxTurns: 1,
      command: fake.command,
      commandArgs: fake.commandArgs,
    }),
    /--permission-mode, --plugin-dir, --setting-sources/,
  );
});

test('locateSuperpowers reads the installed folder from installed_plugins.json under the home folder', () => {
  const home = tempFolder('harness-home-');
  const installed = path.join(home, 'cache', 'sp', '7.0.0');
  fs.mkdirSync(installed, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'other@market': [{ scope: 'user', installPath: '/nowhere', version: '1.0.0' }],
      'superpowers@claude-plugins-official': [{ scope: 'user', installPath: installed, version: '7.0.0' }],
    },
  }));
  assert.equal(locateSuperpowers({ home, env: {} }), installed);
  assert.throws(() => locateSuperpowers({ home: tempFolder('harness-empty-'), env: {} }), /installed_plugins\.json/);
});

test('locateSuperpowers honours CLAUDE_CONFIG_DIR', () => {
  const home = tempFolder('harness-home-');
  const configDir = tempFolder('harness-config-');
  const installed = path.join(configDir, 'cache', '7.0.0');
  fs.mkdirSync(installed, { recursive: true });
  fs.mkdirSync(path.join(configDir, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
    plugins: { 'superpowers@elsewhere': [{ scope: 'user', installPath: installed, version: '7.0.0' }] },
  }));
  assert.equal(locateSuperpowers({ home, env: { CLAUDE_CONFIG_DIR: configDir } }), installed);
  assert.throws(() => locateSuperpowers({ home, env: {} }), /installed_plugins\.json/);
});

test('resolveClaude needs no search away from Windows', () => {
  assert.deepEqual(resolveClaude({ platform: 'darwin', env: {}, exists: () => false }), { kind: 'direct', file: 'claude' });
});

test('on Windows, resolveClaude prefers claude.exe on the PATH, then claude.cmd, and finds the PATH however it is spelt', () => {
  const present = new Set();
  const exists = (file) => present.has(file);
  const env = { Path: 'C:\\Windows;"C:\\Users\\x\\AppData\\Roaming\\npm";D:\\tools' };
  present.add('C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd');
  assert.deepEqual(resolveClaude({ platform: 'win32', env, exists }), { kind: 'cmd', file: 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd' });
  present.add('D:\\tools\\claude.exe');
  assert.deepEqual(resolveClaude({ platform: 'win32', env, exists }), { kind: 'direct', file: 'D:\\tools\\claude.exe' });
});

test('on Windows, resolveClaude says plainly when neither claude.exe nor claude.cmd is on the PATH', () => {
  assert.throws(() => resolveClaude({ platform: 'win32', env: { PATH: 'C:\\Windows' }, exists: () => false }), /claude\.exe or claude\.cmd/);
  assert.throws(() => resolveClaude({ platform: 'win32', env: {}, exists: () => false }), /claude\.exe or claude\.cmd/);
});

test('quoteForCmd leaves plain arguments alone, quotes ones with spaces or shell characters, and refuses ones it cannot quote', () => {
  assert.equal(quoteForCmd('--output-format'), '--output-format');
  assert.equal(quoteForCmd('C:\\Users\\x\\npm\\claude.cmd'), 'C:\\Users\\x\\npm\\claude.cmd');
  assert.equal(quoteForCmd('C:\\My Files\\a&b'), '"C:\\My Files\\a&b"');
  assert.throws(() => quoteForCmd('say "hi"'), /safely/);
  assert.throws(() => quoteForCmd('100%'), /safely/);
  assert.throws(() => quoteForCmd('a\nb'), /safely/);
});

test('invocation starts claude directly with the prompt as an argument', () => {
  assert.deepEqual(
    invocation({ kind: 'direct', file: 'claude' }, ['lead'], ['--verbose'], 'say "hi" & 100%'),
    { file: 'claude', args: ['lead', '-p', 'say "hi" & 100%', '--verbose'], input: '', verbatim: false },
  );
});

test('invocation runs a .cmd shim through cmd.exe, with the prompt on stdin, never on the command line', () => {
  const call = invocation({ kind: 'cmd', file: 'C:\\Program Files\\npm\\claude.cmd' }, [], ['--verbose', '--plugin-dir', 'C:\\a b'], 'say "hi" & 100%');
  assert.equal(call.file, 'cmd.exe');
  assert.deepEqual(call.args, ['/d', '/s', '/c', '""C:\\Program Files\\npm\\claude.cmd" -p --verbose --plugin-dir "C:\\a b""']);
  assert.equal(call.input, 'say "hi" & 100%');
  assert.equal(call.verbatim, true);
  assert.ok(!call.args.join(' ').includes('hi'));
});

test('resultFile puts a run under the evaluations folder in the home folder, by date, id, variant and trial', () => {
  assert.equal(
    resultFile({ home: '/h', date: '2026-10-18', id: 24, variant: 'with', trial: 2 }),
    path.join('/h', '.wheelhouse-evals', '2026-10-18', '24-with-2.json'),
  );
});

test('describeRun prints id, variant, verdict, why and tokens on one line', () => {
  assert.equal(
    describeRun({ id: 24, variant: 'with', pass: true, why: 'no hand-off', usage: { input: 1200, output: 300 } }),
    '24 with: pass (no hand-off) 1200 in / 300 out',
  );
  assert.equal(
    describeRun({ id: 24, variant: 'without', pass: false, why: 'x', usage: { input: 0, output: 0 } }),
    '24 without: fail (x) 0 in / 0 out',
  );
});

test('parseArgs reads scenario ids, --variant and --trials', () => {
  assert.deepEqual(parseArgs(['24']), { ids: [24], variants: ['with', 'without'], trials: 1 });
  assert.deepEqual(parseArgs(['24', '25', '--variant', 'with', '--trials', '3']), { ids: [24, 25], variants: ['with'], trials: 3 });
  assert.deepEqual(parseArgs(['--variant=without', '24', '--trials=2']), { ids: [24], variants: ['without'], trials: 2 });
  assert.throws(() => parseArgs([]), /scenario/);
  assert.throws(() => parseArgs(['24', '--variant', 'maybe']), /with|without/);
  assert.throws(() => parseArgs(['24', '--trials', '0']), /trials/);
  assert.throws(() => parseArgs(['abc']), /abc/);
  // A scenario named twice in one command runs once (ruling F105).
  assert.deepEqual(parseArgs(['5', '5', '27-route', '27-route', '24']).ids, [5, '27-route', 24]);
});

test('runScenario never writes over a record: on a clash it takes the next trial number, and says which (ruling F105)', async () => {
  const home = tempFolder('harness-home-');
  const day = path.join(home, '.wheelhouse-evals', '2026-10-18');
  fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(path.join(day, '98-with-1.json'), '{"kept":true}\n');
  fs.writeFileSync(path.join(day, '98-with-2.json'), '{"kept":true}\n');
  const scenario = {
    id: 98, title: 'a clash', setup: async () => ({}), prompt: 'x',
    variants: { with: { pluginDirs: [] }, without: { pluginDirs: [] } }, pass: () => ({ pass: true, why: 'ok' }),
  };
  const outcome = await runScenario({ scenario, variant: 'with', trial: 1, home, date: '2026-10-18', runner: async () => ({ events, exitCode: 0 }) });
  assert.equal(outcome.trial, 3);
  assert.equal(outcome.file, path.join(day, '98-with-3.json'));
  assert.equal(JSON.parse(fs.readFileSync(outcome.file, 'utf8')).trial, 3);
  for (const t of [1, 2]) assert.equal(fs.readFileSync(path.join(day, `98-with-${t}.json`), 'utf8'), '{"kept":true}\n');
});

test('runScenario sets the project up, runs the session, judges it and writes the result', async () => {
  const home = tempFolder('harness-home-');
  let setupSaw;
  let sessionSaw;
  const scenario = {
    id: 99,
    title: 'a stand-in',
    setup: async (dir, variant) => {
      setupSaw = { dir, variant };
      fs.writeFileSync(path.join(dir, 'marker.txt'), variant);
      return { appendSystemPrompt: `You are the ${variant} desk.` };
    },
    prompt: 'Do the thing.',
    variants: { with: { pluginDirs: ['/p/with'] }, without: { pluginDirs: ['/p/without'] } },
    permissionMode: 'acceptEdits',
    maxTurns: 5,
    pass: ({ events: seen, dir, variant }) => ({ pass: finalText(seen) === 'finished' && fs.existsSync(path.join(dir, 'marker.txt')), why: `variant ${variant}` }),
  };
  const outcome = await runScenario({
    scenario,
    variant: 'without',
    trial: 1,
    home,
    date: '2026-10-18',
    runner: async (options) => {
      sessionSaw = options;
      return { events, exitCode: 0, usage: usageOf(events) };
    },
  });
  assert.equal(setupSaw.variant, 'without');
  assert.equal(sessionSaw.dir, setupSaw.dir);
  assert.deepEqual(sessionSaw.pluginDirs, ['/p/without']);
  assert.equal(sessionSaw.prompt, 'Do the thing.');
  assert.equal(sessionSaw.maxTurns, 5);
  assert.equal(sessionSaw.permissionMode, 'acceptEdits');
  assert.equal(sessionSaw.appendSystemPrompt, 'You are the without desk.');
  assert.equal(sessionSaw.extraArgs, undefined, 'a scenario with no extra arguments adds none');
  assert.equal(sessionSaw.socket, undefined, 'a set-up with no stand-in names no socket');
  assert.equal(sessionSaw.offered, undefined, 'a scenario that offers nothing offers nothing');
  assert.equal(outcome.pass, true);
  const total = totalUsageOf(events);
  assert.equal(outcome.line, `99 without: pass (variant without) ${total.input} in / ${total.output} out`);
  const written = JSON.parse(fs.readFileSync(path.join(home, '.wheelhouse-evals', '2026-10-18', '99-without-1.json'), 'utf8'));
  assert.equal(written.id, 99);
  assert.equal(written.variant, 'without');
  assert.equal(written.pass, true);
  assert.equal(written.events.length, events.length);
  assert.deepEqual(written.usage, total);
  assert.deepEqual(written.mainSessionUsage, usageOf(events));
  assert.ok(!fs.existsSync(setupSaw.dir), 'the scratch project is removed afterwards');
});

test('runScenario records a failing judgement and a session that did not exit cleanly', async () => {
  const home = tempFolder('harness-home-');
  const scenario = {
    id: 98,
    title: 'a stand-in',
    setup: async () => {},
    prompt: 'x',
    variants: { with: { pluginDirs: [] }, without: { pluginDirs: [] } },
    pass: () => ({ pass: false, why: 'it asked' }),
  };
  const outcome = await runScenario({
    scenario,
    variant: 'with',
    trial: 1,
    home,
    date: '2026-10-18',
    runner: async () => ({ events, exitCode: 2, usage: usageOf(events) }),
  });
  assert.equal(outcome.pass, false);
  assert.match(outcome.line, /^98 with: fail \(it asked; claude exited 2\)/);
});

test('runScenario never passes a session whose result event is an error', async () => {
  const home = tempFolder('harness-home-');
  const scenario = {
    id: 97,
    title: 'a stand-in',
    setup: async () => {},
    prompt: 'x',
    variants: { with: { pluginDirs: [] }, without: { pluginDirs: [] } },
    pass: () => ({ pass: true, why: 'looked fine' }),
  };
  const errored = [{ type: 'result', subtype: 'error_max_turns', is_error: true, usage: {} }];
  const outcome = await runScenario({
    scenario,
    variant: 'with',
    trial: 1,
    home,
    date: '2026-10-18',
    runner: async () => ({ events: errored, exitCode: 1, usage: { input: 0, output: 0 } }),
  });
  assert.equal(outcome.pass, false);
  assert.match(outcome.line, /result event is an error/);
});

test('runScenario passes a context from setup, and the scenario\'s extra arguments, to the session, the context to pass, and closes it afterwards', async () => {
  const home = tempFolder('harness-home-');
  let sessionSaw;
  let passSaw;
  let closed = 0;
  const scenario = {
    id: 96,
    title: 'a stand-in',
    setup: async () => ({
      env: { EXTRA: 'yes' }, pluginDirs: ['/p/extra'], records: ['r'], evidence: () => ({ seen: 1 }), close: async () => { closed += 1; },
      helper: { address: '/tmp/run/helper.sock' }, readable: ['/plugin/root'], writable: ['/main/.git'],
    }),
    prompt: 'x',
    variants: { with: { pluginDirs: ['/p/with'] }, without: { pluginDirs: [] } },
    extraArgs: ['--permission-prompt-tool', 'stdio'],
    offered: ['PushNotification'],
    pass: ({ context }) => { passSaw = context; return { pass: true, why: 'ok' }; },
  };
  await runScenario({
    scenario,
    variant: 'with',
    trial: 1,
    home,
    date: '2026-10-18',
    runner: async (options) => { sessionSaw = options; return { events, exitCode: 0, usage: usageOf(events) }; },
  });
  assert.deepEqual(sessionSaw.pluginDirs, ['/p/with', '/p/extra']);
  assert.deepEqual(sessionSaw.env, { EXTRA: 'yes' });
  assert.deepEqual(sessionSaw.extraArgs, ['--permission-prompt-tool', 'stdio'], 'the scenario\'s own extra arguments');
  assert.equal(sessionSaw.socket, '/tmp/run/helper.sock', 'the run\'s stand-in socket, for the sandbox (F94)');
  assert.deepEqual(sessionSaw.readable, ['/plugin/root']);
  assert.deepEqual(sessionSaw.writable, ['/main/.git']);
  assert.deepEqual(sessionSaw.offered, ['PushNotification'], 'the scenario\'s own offer (F99)');
  assert.deepEqual(passSaw.records, ['r']);
  assert.equal(closed, 1);
  const written = JSON.parse(fs.readFileSync(path.join(home, '.wheelhouse-evals', '2026-10-18', '96-with-1.json'), 'utf8'));
  assert.deepEqual(written.evidence, { seen: 1 });
});

test('runScenario gives the session the model its set-up names before the scenario\'s own, and keeps it in the record', async () => {
  const home = tempFolder('harness-home-');
  const seen = [];
  const scenario = (id, setupModel, own) => ({
    id, title: 'a stand-in', setup: async () => (setupModel === undefined ? {} : { model: setupModel }), prompt: 'x', ...(own ? { model: own } : {}),
    variants: { with: { pluginDirs: [] }, without: { pluginDirs: [] } }, pass: () => ({ pass: true, why: 'ok' }),
  });
  const runner = async (options) => { seen.push(options.model); return { events, exitCode: 0, usage: usageOf(events) }; };
  const named = await runScenario({ scenario: scenario(91, 'model-desk', 'model-own'), variant: 'with', home, date: '2026-10-18', runner });
  const own = await runScenario({ scenario: scenario(90, undefined, 'model-own'), variant: 'with', home, date: '2026-10-18', runner });
  assert.deepEqual(seen, ['model-desk', 'model-own']);
  assert.equal(JSON.parse(fs.readFileSync(named.file, 'utf8')).model, 'model-desk');
  assert.equal(JSON.parse(fs.readFileSync(own.file, 'utf8')).model, 'model-own');
});

test('runScenario starts no session when its set-up needs a model the environment does not name, and says which variable to set', async () => {
  const home = tempFolder('harness-home-');
  let closed = 0;
  let started = 0;
  const scenario = {
    id: 89, title: 'a stand-in', prompt: 'x',
    setup: async () => ({ model: null, modelVariable: 'WHEELHOUSE_EVAL_SOMEONE_MODEL', close: () => { closed += 1; } }),
    variants: { with: { pluginDirs: [] }, without: { pluginDirs: [] } }, pass: () => ({ pass: true, why: 'ok' }),
  };
  await assert.rejects(runScenario({
    scenario, variant: 'with', home, date: '2026-10-18', runner: async () => { started += 1; return { events, exitCode: 0 }; },
  }), /WHEELHOUSE_EVAL_SOMEONE_MODEL/);
  assert.equal(started, 0);
  assert.equal(closed, 1);
  assert.ok(!fs.existsSync(path.join(home, '.wheelhouse-evals', '2026-10-18', '89-with-1.json')), 'no record for a run that never started');
});

test('runScenario closes the context even when the session fails to start', async () => {
  const home = tempFolder('harness-home-');
  let closed = 0;
  const scenario = {
    id: 95,
    title: 'a stand-in',
    setup: async () => ({ close: () => { closed += 1; } }),
    prompt: 'x',
    variants: { with: { pluginDirs: [] }, without: { pluginDirs: [] } },
    pass: () => ({ pass: true, why: 'ok' }),
  };
  await assert.rejects(runScenario({
    scenario, variant: 'with', trial: 1, home, date: '2026-10-18', runner: async () => { throw new Error('no claude'); },
  }), /no claude/);
  assert.equal(closed, 1);
});

test('runScenario judges a run a fail when its pass throws, and still writes its record and counts its tokens', async () => {
  const home = tempFolder('harness-home-');
  const scenario = {
    id: 93,
    title: 'a stand-in',
    setup: async () => {},
    prompt: 'x',
    variants: { with: { pluginDirs: [] }, without: { pluginDirs: [] } },
    pass: () => { throw new Error('no such file'); },
  };
  const outcome = await runScenario({
    scenario, variant: 'with', trial: 1, home, date: '2026-10-18', runner: async () => ({ events, exitCode: 0, usage: usageOf(events) }),
  });
  assert.equal(outcome.pass, false);
  assert.equal(outcome.handled, true);
  assert.match(outcome.line, /^93 with: fail \(pass could not judge it: no such file\)/);
  assert.deepEqual(outcome.usage, totalUsageOf(events));
  const written = JSON.parse(fs.readFileSync(outcome.file, 'utf8'));
  assert.equal(written.handled, true);
  assert.equal(written.events.length, events.length);
});

// A scenario whose pass says whatever `verdict` says, for the sessions that did not finish.
const judgedAs = (id, verdict) => ({
  id,
  title: 'a stand-in',
  setup: async () => {},
  prompt: 'x',
  variants: { with: { pluginDirs: [] }, without: { pluginDirs: [] } },
  pass: () => (verdict ? { pass: true, why: 'nothing bad happened' } : { pass: false, why: 'the canary leaked' }),
});
const withoutResult = events.filter((event) => event.type !== 'result');
const withResult = (fields) => events.map((event) => (event.type === 'result' ? { ...event, ...fields } : event));

test('a session that did not finish never passes, and is run again when its pass saw nothing wrong', async () => {
  const home = tempFolder('harness-home-');
  const trialOf = (scenario, session) => runScenario({ scenario, variant: 'with', trial: 1, home, date: '2026-10-18', runner: async () => session });
  const cases = [
    ['timed out', { events, exitCode: 1, timedOut: true }, /^92 with: fail \(did not finish; claude exited 1; timed out\)/],
    ['crashed after a turn with a tool call', { events: withoutResult, exitCode: 1 }, /^92 with: fail \(did not finish; claude exited 1\)/],
    ['stopped at its turn cap without saying it erred', { events: withResult({ subtype: 'error_max_turns', is_error: false }), exitCode: 0 }, /^92 with: fail \(did not finish\)/],
  ];
  for (const [what, session, line] of cases) {
    const outcome = await trialOf(judgedAs(92, true), session);
    assert.equal(outcome.pass, false, what);
    assert.equal(outcome.handled, false, `${what}: nothing was shown, so it can be run again`);
    assert.match(outcome.line, line, what);
    const written = JSON.parse(fs.readFileSync(outcome.file, 'utf8'));
    assert.deepEqual(written.judged, { pass: true, why: 'nothing bad happened' }, what);
  }
  // A session that did not finish but showed a failure stays a handled failure.
  const leaked = await trialOf(judgedAs(91, false), { events: withoutResult, exitCode: 1 });
  assert.equal(leaked.pass, false);
  assert.equal(leaked.handled, true);
  assert.match(leaked.line, /^91 with: fail \(the canary leaked; claude exited 1\)/);
  // A finished session's pass stands.
  const finished = await trialOf(judgedAs(90, true), { events, exitCode: 0 });
  assert.equal(finished.pass, true);
});
