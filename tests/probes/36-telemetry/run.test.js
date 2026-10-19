// tests/probes/36-telemetry/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addEnv, removeEnv, summarise, assertScratch, describe, probeEnv, assertIntendedAccount, THROWAWAY_ACCOUNT } from '../../../probes/36-telemetry/run.js';

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
