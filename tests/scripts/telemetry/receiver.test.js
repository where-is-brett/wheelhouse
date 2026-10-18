// tests/scripts/telemetry/receiver.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOtlpMetrics, startReceiver } from '../../../scripts/telemetry/receiver.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../../fixtures/otlp-metrics.json', import.meta.url), 'utf8'));

test('parseOtlpMetrics returns token usage by session, model and type', () => {
  const records = parseOtlpMetrics(fixture);
  assert.equal(records.length, 4);
  for (const record of records) {
    assert.equal(record.sessionId, 'session-1');
    assert.equal(record.model, 'model-a');
    assert.ok(['input', 'output', 'cacheRead', 'cacheCreation'].includes(record.type));
    assert.ok(record.tokens > 0);
    assert.ok(!Number.isNaN(Date.parse(record.at)));
  }
  assert.equal(records.find((record) => record.type === 'cacheRead').tokens, 4800);
});

test('parseOtlpMetrics ignores other metrics', () => {
  const onlySessions = structuredClone(fixture);
  const scope = onlySessions.resourceMetrics[0].scopeMetrics[0];
  scope.metrics = scope.metrics.filter((metric) => metric.name === 'claude_code.session.count');
  assert.deepEqual(parseOtlpMetrics(onlySessions), []);
});

test('startReceiver delivers posted records', async () => {
  const delivered = [];
  const receiver = await startReceiver({ port: 0, onRecords: (records) => delivered.push(...records) });
  try {
    const response = await fetch(`http://127.0.0.1:${receiver.port}/v1/metrics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fixture),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(delivered, parseOtlpMetrics(fixture));
  } finally {
    await receiver.close();
  }
});

test('startReceiver answers other paths with 404', async () => {
  const receiver = await startReceiver({ port: 0, onRecords: () => {} });
  try {
    const response = await fetch(`http://127.0.0.1:${receiver.port}/v1/logs`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 404);
  } finally {
    await receiver.close();
  }
});

test('startReceiver refuses any host but 127.0.0.1', async () => {
  await assert.rejects(startReceiver({ host: '0.0.0.0', onRecords: () => {} }), /only on 127\.0\.0\.1/);
});
