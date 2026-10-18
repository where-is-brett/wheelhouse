// tests/scripts/telemetry/receiver.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOtlpMetrics, startReceiver } from '../../../scripts/telemetry/receiver.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../../fixtures/otlp-metrics.json', import.meta.url), 'utf8'));

test('parseOtlpMetrics returns tokens and dollars by session, model, type and source', () => {
  const points = parseOtlpMetrics(fixture);
  assert.equal(points.length, 7);
  const delta = points.filter((point) => point.session === 'session-1');
  assert.equal(delta.length, 5);
  for (const point of delta) {
    assert.equal(point.model, 'model-a');
    assert.equal(point.source, 'main');
    assert.equal(point.cumulative, false);
    assert.ok(!Number.isNaN(Date.parse(point.at)));
    assert.ok(!Number.isNaN(Date.parse(point.start)));
  }
  const tokens = delta.filter((point) => point.metric === 'tokens');
  assert.deepEqual(tokens.map((point) => point.type), ['input', 'output', 'cacheRead', 'cacheCreation']);
  assert.equal(tokens.find((point) => point.type === 'cacheRead').value, 4800);
  const [cost] = delta.filter((point) => point.metric === 'usd');
  assert.equal(cost.value, 0.25);
  assert.equal(cost.type, undefined);
  const cumulative = points.filter((point) => point.session === 'session-2');
  assert.equal(cumulative.length, 2);
  assert.ok(cumulative.every((point) => point.cumulative === true && point.metric === 'tokens'));
  assert.equal(cumulative[0].at, '2026-10-17T09:41:37.978Z');
  assert.equal(cumulative[0].start, '2026-10-17T09:40:36.978Z');
});

test('only session, model, type, source, the value and the times are kept', () => {
  const first = parseOtlpMetrics(fixture).find((point) => point.metric === 'tokens');
  assert.deepEqual(Object.keys(first).sort(), ['at', 'cumulative', 'metric', 'model', 'session', 'source', 'start', 'type', 'value']);
  const text = JSON.stringify(parseOtlpMetrics(fixture));
  for (const private_ of ['director@example.invalid', 'user-placeholder', 'org-placeholder', 'account-placeholder']) {
    assert.ok(!text.includes(private_));
  }
});

test('a query_source that is not one short word is dropped', () => {
  const sourceOf = (value) => {
    const changed = structuredClone(fixture);
    const point = changed.resourceMetrics[0].scopeMetrics[0].metrics[1].sum.dataPoints[0];
    point.attributes.find((item) => item.key === 'query_source').value.stringValue = value;
    return parseOtlpMetrics(changed)[0].source;
  };
  assert.equal(sourceOf('subagent'), 'subagent');
  assert.equal(sourceOf('auto-mode'), 'auto-mode');
  assert.equal(sourceOf('Fix the login bug in /etc/passwd'), undefined);
  assert.equal(sourceOf('a'.repeat(33)), undefined);
  assert.equal(sourceOf(''), undefined);
});

test('parseOtlpMetrics ignores other metrics', () => {
  const onlySessions = structuredClone(fixture);
  const scope = onlySessions.resourceMetrics[0].scopeMetrics[0];
  scope.metrics = scope.metrics.filter((metric) => metric.name === 'claude_code.session.count');
  onlySessions.resourceMetrics.length = 1;
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

test('the receiver answers /health and still refuses anything but 127.0.0.1', async () => {
  const receiver = await startReceiver({ port: 0, onRecords: () => {} });
  try {
    const response = await fetch(`http://127.0.0.1:${receiver.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    const posted = await fetch(`http://127.0.0.1:${receiver.port}/health`, { method: 'POST', body: '{}' });
    assert.equal(posted.status, 404);
  } finally {
    await receiver.close();
  }
  await assert.rejects(startReceiver({ host: '0.0.0.0', onRecords: () => {} }), /only on 127\.0\.0\.1/);
});

test('startReceiver refuses any host but 127.0.0.1', async () => {
  await assert.rejects(startReceiver({ host: '0.0.0.0', onRecords: () => {} }), /only on 127\.0\.0\.1/);
});
