// tests/scripts/eval/harness.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseStream,
  toolCalls,
  finalText,
  subagents,
  modelsUsed,
  usageOf,
  missingFlags,
  runSession,
  locateSuperpowers,
  resultFile,
  describeRun,
  parseArgs,
  runScenario,
} from '../../../scripts/eval/harness.js';

const fixture = fileURLToPath(new URL('../../fixtures/eval/stream.jsonl', import.meta.url));
const events = parseStream(fs.readFileSync(fixture, 'utf8'));

function tempFolder(name = 'harness-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

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
  process.stdout.write(${JSON.stringify((helpFlags ?? ['--print', '--output-format', '--verbose', '--permission-mode', '--plugin-dir', '--model', '--setting-sources']).map((flag) => `  ${flag} <value>  something\n`).join(''))});
  process.exit(0);
}
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, cwd: process.cwd(), marker: process.env.EVAL_MARKER ?? null }));
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
  assert.equal(result.exitCode, 3);
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
  assert.equal(locateSuperpowers({ home }), installed);
  assert.throws(() => locateSuperpowers({ home: tempFolder('harness-empty-') }), /installed_plugins\.json/);
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
});

test('runScenario sets the project up, runs the session, judges it and writes the result', async () => {
  const home = tempFolder('harness-home-');
  let setupSaw;
  let sessionSaw;
  const scenario = {
    id: 99,
    title: 'a stand-in',
    setup: async (dir, variant) => { setupSaw = { dir, variant }; fs.writeFileSync(path.join(dir, 'marker.txt'), variant); },
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
  assert.equal(outcome.pass, true);
  assert.equal(outcome.line, '99 without: pass (variant without) 163 in / 237 out'.replace('163', String(6 + 33359 + 123600)));
  const written = JSON.parse(fs.readFileSync(path.join(home, '.wheelhouse-evals', '2026-10-18', '99-without-1.json'), 'utf8'));
  assert.equal(written.id, 99);
  assert.equal(written.variant, 'without');
  assert.equal(written.pass, true);
  assert.equal(written.events.length, events.length);
  assert.deepEqual(written.usage, usageOf(events));
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
    runner: async () => ({ events: [], exitCode: 2, usage: { input: 0, output: 0 } }),
  });
  assert.equal(outcome.pass, false);
  assert.match(outcome.line, /^98 with: fail \(it asked; claude exited 2\)/);
});
