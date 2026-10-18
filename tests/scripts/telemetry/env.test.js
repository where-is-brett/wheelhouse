// tests/scripts/telemetry/env.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telemetryEnv } from '../../../scripts/telemetry/env.js';

test('telemetryEnv points at the receiver and records no content', () => {
  const env = telemetryEnv(4318);
  assert.deepEqual(env, {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
  });
  assert.ok(!Object.keys(env).some((key) => /LOG_USER_PROMPTS|LOG_TOOL_DETAILS|LOGS_EXPORTER/.test(key)));
});
