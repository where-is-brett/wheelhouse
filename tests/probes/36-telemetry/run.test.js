// tests/probes/36-telemetry/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addEnv, removeEnv, summarise, assertScratch, describe, probeEnv } from '../../../probes/36-telemetry/run.js';

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
