// scripts/telemetry/env.js
// The settings that send Claude Code's usage counts to the local receiver.
// Nothing here turns on recording of prompts or tool details.

export function telemetryEnv(port) {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
  };
}
