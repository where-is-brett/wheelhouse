// tests/probes/lib/archon.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { archonEnv, archonRun, readEvents, cleanScratch, checksumFor, ARCHON_VERSION } from '../../../probes/lib/archon.js';

const base = { home: '/tmp/x/home', bunDir: '/tmp/x/bun', claudeBin: '/opt/claude' };

test('the pinned Archon version is 0.13.0', () => {
  assert.equal(ARCHON_VERSION, '0.13.0');
});

test('archonEnv sets the three telemetry switches and ARCHON_HOME', () => {
  const env = archonEnv(base);
  assert.equal(env.ARCHON_HOME, '/tmp/x/home');
  assert.equal(env.ARCHON_TELEMETRY_DISABLED, '1');
  assert.equal(env.DO_NOT_TRACK, '1');
  assert.equal(env.POSTHOG_API_KEY, 'off');
  assert.equal(env.CLAUDE_BIN_PATH, '/opt/claude');
  assert.equal(env.COPILOT_BIN_PATH, undefined);
});

test('archonEnv puts bun on PATH and no gh', () => {
  const env = archonEnv({ ...base, baseEnv: { PATH: '/opt/homebrew/bin:/usr/bin', GH_TOKEN: 'secret', GITHUB_TOKEN: 'x', HOME: '/Users/a' } });
  const dirs = env.PATH.split(path.delimiter);
  assert.equal(dirs[0], '/tmp/x/bun');
  assert.ok(!dirs.includes('/opt/homebrew/bin'), 'the inherited PATH, where gh lives, is not kept');
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.HOME, '/Users/a');
});

test('archonEnv adds a gh folder only when one is passed', () => {
  const env = archonEnv({ ...base, ghDir: '/tmp/x/broker' });
  assert.equal(env.PATH.split(path.delimiter)[1], '/tmp/x/broker');
});

test('archonEnv names the Copilot CLI and the node it needs', () => {
  const env = archonEnv({ ...base, copilotBin: '/p/node_modules/.bin/copilot', nodeDir: '/n/bin' });
  assert.equal(env.COPILOT_BIN_PATH, '/p/node_modules/.bin/copilot');
  assert.ok(env.PATH.split(path.delimiter).includes('/n/bin'));
});

test('archonRun refuses an environment without the telemetry switches', async () => {
  for (const missing of ['ARCHON_TELEMETRY_DISABLED', 'DO_NOT_TRACK', 'POSTHOG_API_KEY', 'ARCHON_HOME']) {
    const env = archonEnv(base);
    delete env[missing];
    let ran = false;
    const run = async () => { ran = true; return { code: 0, stdout: '', stderr: '' }; };
    await assert.rejects(archonRun(['doctor'], { env, run, bin: '/x/archon' }), new RegExp(missing));
    assert.equal(ran, false, `nothing runs without ${missing}`);
  }
});

test('archonRun refuses a switch set to the wrong value', async () => {
  const env = { ...archonEnv(base), POSTHOG_API_KEY: 'phc_real' };
  const run = async () => { throw new Error('ran'); };
  await assert.rejects(archonRun(['doctor'], { env, run, bin: '/x/archon' }), /POSTHOG_API_KEY/);
});

test('archonRun runs with only the given environment and reads JSON output', async () => {
  let seen;
  const run = async (file, args, options) => { seen = { file, args, options }; return { code: 0, stdout: 'note\n{"runId":"r1"}\n', stderr: '' }; };
  const result = await archonRun(['workflow', 'run', 'x', '--detach'], { env: archonEnv(base), run, bin: '/x/archon', cwd: '/tmp' });
  assert.equal(seen.file, '/x/archon');
  assert.deepEqual(seen.options.baseEnv, {});
  assert.equal(result.json.runId, 'r1');
});

test('readEvents keeps attention, resolved, terminal and bookmark lines and skips blank ones', () => {
  const lines = ['{"type":"attention","runId":"a"}', '', '  ', '{"type":"resolved","runId":"a"}', 'not json', '{"type":"terminal"}', '{"type":"bookmark","cursor":"c9"}'];
  const events = readEvents(lines);
  assert.deepEqual(events.map((e) => e.type), ['attention', 'resolved', 'terminal', 'bookmark']);
});

test('readEvents takes a block of text as well as lines', () => {
  assert.equal(readEvents('{"type":"ready"}\n{"type":"bookmark"}\n').length, 2);
});

test('checksumFor finds a file in a checksums list', () => {
  const list = 'aaa  archon-darwin-x64\nbbb  archon-darwin-arm64\n';
  assert.equal(checksumFor(list, 'archon-darwin-arm64'), 'bbb');
  assert.throws(() => checksumFor(list, 'archon-linux-x64'), /no checksum/);
});

test('cleanScratch removes the scratch root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-archon-test-'));
  fs.mkdirSync(path.join(root, 'home', 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'home', 'logs', 'run.jsonl'), '{}\n');
  await cleanScratch(root);
  assert.equal(fs.existsSync(root), false);
});

test('cleanScratch refuses a folder outside the temporary folder', async () => {
  await assert.rejects(cleanScratch(os.homedir()), /outside the temporary folder/);
});
