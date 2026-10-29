// tests/scripts/engine/archon/cli.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { archonCli, parseJson } from '../../../../scripts/engine/archon/cli.js';

const engine = path.join(path.sep, 'e');
const home = path.join(path.sep, 'h');
const seen = [];
const fakeRun = (result) => async (file, args, options) => { seen.push({ file, args, options }); return result; };

test('archonCli always runs with archonEnv, and takes no environment from the caller', async () => {
  seen.length = 0;
  const run = fakeRun({ code: 0, stdout: '{"ok":true}', stderr: '' });
  await archonCli(['workflow', 'list'], { run, engine, home, nodeDir: '/n', cwd: '/w', env: { ARCHON_TELEMETRY_DISABLED: '0', GH_TOKEN: 't' } });
  const { file, args, options } = seen[0];
  assert.equal(file, path.join(engine, 'archon', 'bin', 'archon'));
  assert.deepEqual(args, ['workflow', 'list']);
  assert.equal(options.cwd, '/w');
  assert.deepEqual({ ...options.baseEnv }, {});
  assert.equal(options.env.ARCHON_TELEMETRY_DISABLED, '1');
  assert.equal(options.env.DO_NOT_TRACK, '1');
  assert.equal(options.env.POSTHOG_API_KEY, 'off');
  assert.equal(options.env.ARCHON_HOME, home);
  assert.equal(options.env.GH_TOKEN, undefined);
});

test('archonCli passes the timeout and adds --json only when asked', async () => {
  seen.length = 0;
  const run = fakeRun({ code: 0, stdout: '', stderr: '' });
  await archonCli(['workflow', 'get', 'r1'], { run, engine, home, nodeDir: '/n', timeout: 5000, json: true });
  await archonCli(['workflow', 'get', 'r1', '--json'], { run, engine, home, nodeDir: '/n', json: true });
  assert.equal(seen[0].options.timeoutMs, 5000);
  assert.deepEqual(seen[0].args, ['workflow', 'get', 'r1', '--json']);
  assert.deepEqual(seen[1].args, ['workflow', 'get', 'r1', '--json']);
});

test('archonCli parses JSON output and keeps stderr', async () => {
  const whole = await archonCli(['x'], { run: fakeRun({ code: 0, stdout: '{"a":1}\n', stderr: 'warn' }), engine, home, nodeDir: '/n' });
  assert.deepEqual(whole, { code: 0, json: { a: 1 }, stdout: '{"a":1}\n', stderr: 'warn' });
  const last = await archonCli(['x'], { run: fakeRun({ code: 0, stdout: 'starting\n{"a":1}\nnoise\n{"b":2}\n', stderr: '' }), engine, home, nodeDir: '/n' });
  assert.deepEqual(last.json, { b: 2 });
  const none = await archonCli(['x'], { run: fakeRun({ code: 1, stdout: 'plain text', stderr: 'boom' }), engine, home, nodeDir: '/n' });
  assert.equal(none.json, null);
  assert.equal(none.code, 1);
  assert.equal(none.stderr, 'boom');
});

test('parseJson reads a whole document, an array, or nothing', () => {
  assert.deepEqual(parseJson('[1,2]'), [1, 2]);
  assert.equal(parseJson(''), null);
  assert.equal(parseJson(undefined), null);
  assert.equal(parseJson('5\n6'), null);
});

test("archonCli hands on standard output alone as it comes, and keeps no more than `limit` of it", async () => {
  seen.length = 0;
  const run = fakeRun({ code: 0, stdout: '', stderr: '' });
  const onStdout = () => {};
  await archonCli(['workflow', 'attention', '--watch'], { run, engine, home, nodeDir: '/n', onStdout, limit: 4096 });
  assert.equal(seen[0].options.onStdout, onStdout);
  assert.equal(seen[0].options.onOutput, undefined);
  assert.equal(seen[0].options.limit, 4096);
});

test('archonCli given no folder runs in a git folder of the engine\'s own, as Archon v0.13.0 refuses any other', async () => {
  seen.length = 0;
  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-engine-'));
  const run = fakeRun({ code: 0, stdout: '{"ok":true}', stderr: '' });
  await archonCli(['workflow', 'get', 'r1'], { run, engine: own, home, nodeDir: '/n' });
  await archonCli(['workflow', 'get', 'r1'], { run, engine: own, home, nodeDir: '/n' });
  const place = seen[0].options.cwd;
  assert.equal(path.dirname(place), own);
  assert.equal(seen[1].options.cwd, place);
  assert.equal(execFileSync('git', ['rev-parse', '--git-dir'], { cwd: place, encoding: 'utf8' }).trim(), '.git');
  await archonCli(['workflow', 'get', 'r1'], { run, engine: own, home, nodeDir: '/n', cwd: '/w' });
  assert.equal(seen[2].options.cwd, '/w');
});
