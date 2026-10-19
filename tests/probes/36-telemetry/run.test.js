// tests/probes/36-telemetry/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addEnv, removeEnv, summarise, assertScratch, describe, probeEnv, assertIntendedAccount, THROWAWAY_ACCOUNT, since, isOwnSettings } from '../../../probes/36-telemetry/run.js';

const script = fileURLToPath(new URL('../../../probes/36-telemetry/run.js', import.meta.url));
const sample = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../fixtures/otlp-metrics.json', import.meta.url)), 'utf8'));

test('the summary keeps the service, metric names and token totals, and nothing about the account', () => {
  const summary = summarise(sample);
  assert.equal(summary.serviceName, 'claude-code');
  assert.ok(Object.keys(summary.metrics).length > 0);
  assert.ok(!JSON.stringify(summary).includes('user-placeholder'));
  assert.ok(!JSON.stringify(summary).includes('@'));
});

test('describe says plainly when nothing arrived', () => {
  assert.match(describe([]), /Points arrived: NO/);
  assert.match(describe([{ at: 'x', serviceName: 'claude-code-desktop', serviceVersion: '1', metrics: { m: 2 }, tokens: {} }]), /YES.*\n- service.name claude-code-desktop 1: 1 requests/);
});

test('the probe settings are the four from scripts/telemetry/env.js plus an export interval', async () => {
  const env = await probeEnv(1234);
  assert.equal(env.CLAUDE_CODE_ENABLE_TELEMETRY, '1');
  assert.equal(env.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://127.0.0.1:1234');
  assert.equal(Object.keys(env).length, 5);
});

test('addEnv then removeEnv returns the settings to how they were, key by key', () => {
  const values = { A: '1', B: '2' };
  const before = { model: 'x', env: { B: 'old', C: '3' } };
  const added = addEnv(before, values);
  assert.deepEqual(added.previous, { B: 'old' });
  assert.deepEqual(added.settings.env, { B: '2', C: '3', A: '1' });
  assert.deepEqual(removeEnv(added.settings, values, added.previous, true).settings, before);
});

test('removeEnv leaves a key someone changed since, and drops an env it created', () => {
  const values = { A: '1' };
  const added = addEnv({}, values);
  assert.deepEqual(removeEnv(added.settings, values, added.previous, false).settings, {});
  const changed = { env: { A: 'other' } };
  const result = removeEnv(changed, values, {}, true);
  assert.deepEqual(result.left, ['A']);
  assert.deepEqual(result.settings, changed);
});

test('only wheelhouse-check36 folders (or check36 inside a check35 one) may be touched', () => {
  assert.doesNotThrow(() => assertScratch(path.join(os.tmpdir(), 'wheelhouse-check36-abc')));
  assert.doesNotThrow(() => assertScratch('/Users/Shared/wheelhouse-check35/check36'));
  assert.throws(() => assertScratch(os.tmpdir()));
  assert.throws(() => assertScratch(path.join(os.tmpdir(), 'other')));
  assert.throws(() => assertScratch(path.join(os.homedir(), '.claude')));
});

test('settings set then unset on a named file restores it, and names no other file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-check36-test-'));
  try {
    const run = (...args) => execFileSync(process.execPath, [script, ...args, '--root', root], { encoding: 'utf8' });
    run('setup');
    const file = path.join(root, 'settings.json');
    const original = { permissions: { allow: ['Read'] }, env: { KEEP: '1' } };
    fs.writeFileSync(file, JSON.stringify(original));
    run('settings', 'set', '--file', file);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).env.CLAUDE_CODE_ENABLE_TELEMETRY, '1');
    assert.match(run('settings', 'unset'), /matches the copy taken before .*: YES/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), original);
    assert.throws(() => run('settings', 'set'), /Say which file/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--user and launch-env are allowed on macOS only in check 35\'s throwaway account', () => {
  assert.doesNotThrow(() => assertIntendedAccount({ platform: 'darwin', username: THROWAWAY_ACCOUNT }));
  assert.throws(() => assertIntendedAccount({ platform: 'darwin', username: 'someone' }), /throwaway account/);
});

test('on Windows they need --allow-own-account, and other systems are refused', () => {
  assert.throws(() => assertIntendedAccount({ platform: 'win32', username: 'someone', args: ['set', '--user'] }), /--allow-own-account/);
  assert.doesNotThrow(() => assertIntendedAccount({ platform: 'win32', username: 'someone', args: ['set', '--allow-own-account'] }));
  assert.throws(() => assertIntendedAccount({ platform: 'linux', username: 'someone' }), /macOS and Windows/);
});

test('settings set --user from another account is refused and writes nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-check36-test-'));
  const config = path.join(root, 'config');
  try {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: config, HOME: root, USERPROFILE: root };
    execFileSync(process.execPath, [script, 'setup', '--root', root], { env });
    const result = spawnSync(process.execPath, [script, 'settings', 'set', '--user', '--root', root], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing/);
    assert.ok(!fs.existsSync(path.join(config, 'settings.json')));
    const launch = spawnSync(process.execPath, [script, 'launch-env', 'set', '--root', root], { env, encoding: 'utf8' });
    assert.equal(launch.status, 1);
    assert.match(launch.stderr, /Refusing/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('show-env prints the five variables as NAME=value', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-check36-test-'));
  try {
    execFileSync(process.execPath, [script, 'setup', '--root', root]);
    const lines = execFileSync(process.execPath, [script, 'show-env', '--root', root], { encoding: 'utf8' }).trim().split('\n');
    assert.equal(lines.length, 5);
    assert.ok(lines.includes('CLAUDE_CODE_ENABLE_TELEMETRY=1'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('read counts only the requests since the latest mark, and says how many earlier ones it left out', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-check36-test-'));
  try {
    const run = (...args) => execFileSync(process.execPath, [script, ...args, '--root', root], { encoding: 'utf8' });
    run('setup');
    const file = path.join(root, 'log', 'requests.jsonl');
    const entry = (at, serviceName) => JSON.stringify({ at, method: 'POST', url: '/v1/metrics', serviceName, serviceVersion: '1', metrics: { 'claude_code.session.count': 1 }, tokens: {} }) + '\n';
    fs.writeFileSync(file, entry('2026-10-19T01:00:00.000Z', 'trial-one'));
    assert.match(run('mark', 'trial 2'), /Mark "trial 2"/);
    assert.match(run('read'), /Points arrived: NO/);
    assert.match(run('read'), /since mark "trial 2".*1 earlier request not counted/s);
    fs.appendFileSync(file, entry(new Date(Date.now() + 1000).toISOString(), 'trial-two'));
    const out = run('read');
    assert.match(out, /Points arrived: YES \(1 request\)/);
    assert.match(out, /trial-two/);
    assert.ok(!out.includes('trial-one'));
    assert.match(run('read', '--all'), /Points arrived: YES \(2 requests\)/);
    assert.match(run('read', '--since', '2026-10-19T00:00:00.000Z'), /YES \(2 requests\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('since keeps the entries at or after the time given, and all of them with no time', () => {
  const entries = [{ at: '2026-10-19T01:00:00.000Z' }, { at: '2026-10-19T02:00:00.000Z' }];
  assert.equal(since(entries, '2026-10-19T01:30:00.000Z').length, 1);
  assert.equal(since(entries, '2026-10-19T01:00:00.000Z').length, 2);
  assert.equal(since(entries, undefined).length, 2);
  assert.throws(() => since(entries, 'not a time'), /not a time/);
});

test('settings set --file on the account\'s own user settings is refused like --user, and writes nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-check36-test-'));
  const config = path.join(root, 'config');
  try {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: config, HOME: root, USERPROFILE: root };
    execFileSync(process.execPath, [script, 'setup', '--root', root], { env });
    for (const file of [path.join(config, 'settings.json'), path.join(root, '.claude', 'settings.json'), path.join(root, '.claude', '..', '.claude', 'settings.json')]) {
      const result = spawnSync(process.execPath, [script, 'settings', 'set', '--file', file, '--root', root], { env, encoding: 'utf8' });
      assert.equal(result.status, 1, file);
      assert.match(result.stderr, /Refusing/);
      assert.ok(!fs.existsSync(file), file);
    }
    assert.ok(isOwnSettings(path.join(config, 'settings.json'), { env, home: root }));
    assert.ok(!isOwnSettings(path.join(root, 'settings.json'), { env, home: root }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('setup starts notes.md in a folder of its own, and not inside check 35\'s folder, which has its own', () => {
  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-check36-test-'));
  const check35 = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-check35-test-'));
  try {
    execFileSync(process.execPath, [script, 'setup', '--root', own]);
    assert.match(fs.readFileSync(path.join(own, 'notes.md'), 'utf8'), /^# Check 36 notes/);
    const inner = path.join(check35, 'check36');
    execFileSync(process.execPath, [script, 'setup', '--root', inner]);
    assert.ok(!fs.existsSync(path.join(inner, 'notes.md')));
  } finally {
    fs.rmSync(own, { recursive: true, force: true });
    fs.rmSync(check35, { recursive: true, force: true });
  }
});
