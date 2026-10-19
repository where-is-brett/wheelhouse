// tests/probes/53-windows-grants/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { judgeAllowed, judgeRefused, main, parseOptions, PROMPTS, summariseSession } from '../../../probes/53-windows-grants/run.js';

const events = (...list) => list.map((event) => JSON.stringify(event)).join('\n');
const bashCall = (command) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });

test('parseOptions needs a model, and takes it from the environment', () => {
  assert.throws(() => parseOptions([], {}), /Name the model/);
  assert.equal(parseOptions(['--model', 'some-model'], {}).model, 'some-model');
  assert.equal(parseOptions([], { WHEELHOUSE_PROBE_MODEL: 'env-model' }).model, 'env-model');
  assert.throws(() => parseOptions(['--model', '--bad'], {}), /does not look like a model/);
  assert.throws(() => parseOptions(['--model', 'm', '--nope'], {}), /Unknown option/);
});

test('summariseSession finds the Bash commands and the denials', () => {
  const summary = summariseSession(events(
    { type: 'system', subtype: 'init', session_id: 's1' },
    bashCall('npm test'),
    { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'Claude requested permissions to use Bash, but you haven\'t granted it yet.' }] } },
    { type: 'result', is_error: false, session_id: 's1', result: 'DONE', permission_denials: [{ tool_name: 'Bash' }] },
  ));
  assert.deepEqual(summary, { sessionId: 's1', bashCommands: ['npm test'], denials: 1, blocked: 1, isError: false, result: 'DONE', hasResult: true });
});

test('a refusal is judged on the denial and on the command not running', () => {
  const denied = summariseSession(events(bashCall('npm test'), { type: 'result', permission_denials: [{}] }));
  const silent = summariseSession(events(bashCall('npm test'), { type: 'result', permission_denials: [] }));
  const none = summariseSession(events({ type: 'result', permission_denials: [] }));
  assert.equal(judgeRefused({ summary: denied, timedOut: false, ran: false }).status, 'PASS');
  assert.equal(judgeRefused({ summary: denied, timedOut: true, ran: false }).status, 'FAIL');
  assert.match(judgeRefused({ summary: denied, timedOut: true, ran: false }).why, /did not come at once/);
  assert.equal(judgeRefused({ summary: denied, timedOut: false, ran: true }).status, 'FAIL');
  assert.equal(judgeRefused({ summary: silent, timedOut: false, ran: false }).status, 'FAIL');
  assert.equal(judgeRefused({ summary: none, timedOut: false, ran: false }).status, 'SEEN');
});

test('an allowed command is judged on running with nothing refused', () => {
  const clean = summariseSession(events(bashCall('npm test'), { type: 'result', permission_denials: [] }));
  const denied = summariseSession(events(bashCall('npm test'), { type: 'result', permission_denials: [{}] }));
  assert.equal(judgeAllowed({ summary: clean, timedOut: false, ran: true }).status, 'PASS');
  assert.equal(judgeAllowed({ summary: denied, timedOut: false, ran: false }).status, 'FAIL');
  assert.equal(judgeAllowed({ summary: clean, timedOut: true, ran: false }).status, 'FAIL');
  assert.equal(judgeAllowed({ summary: clean, timedOut: false, ran: false }).status, 'FAIL');
  assert.equal(judgeAllowed({ summary: summariseSession(''), timedOut: false, ran: false }).status, 'SEEN');
});

test('the runner prompt carries the command unchanged', () => {
  const command = "'C:/x/node.exe' 'C:/x/runner.js' npm test";
  assert.ok(PROMPTS.runner(command).includes(`: ${command}\n`));
});

test('the probe refuses to run off Windows without being told to', async () => {
  if (process.platform === 'win32') return;
  const original = console.error;
  const errors = [];
  console.error = (line) => errors.push(line);
  try {
    assert.equal(await main(['--model', 'm']), 2);
  } finally {
    console.error = original;
  }
  assert.match(errors.join('\n'), /Windows only/);
});

test('the stand-in runner notes its integrity and runs the command in its folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-test-standin-'));
  try {
    const runner = fileURLToPath(new URL('../../../probes/53-windows-grants/standin-runner.js', import.meta.url));
    const result = spawnSync(process.execPath, [runner, `"${process.execPath}"`, '-e', '"require(\'fs\').writeFileSync(\'made.txt\',process.env.TEMP)"'], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(path.join(dir, 'runner-ran.txt'), 'utf8'), /^integrity=\w+\nargs=/);
    assert.equal(fs.realpathSync(fs.readFileSync(path.join(dir, 'made.txt'), 'utf8')), fs.realpathSync(path.join(dir, '.tmp')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
