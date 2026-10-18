// scripts/telemetry/receiver.js
// A local receiver for Claude Code's usage telemetry (OTLP over HTTP, JSON).
// It listens only on the computer itself and keeps token counts, not content.
import http from 'node:http';

const TOKEN_METRIC = 'claude_code.token.usage';
const LOOPBACK = '127.0.0.1';
const MAX_BODY = 1024 * 1024;

function attribute(attributes, key) {
  const found = attributes?.find((item) => item.key === key);
  if (!found) return undefined;
  const value = found.value;
  return value.stringValue ?? value.intValue ?? value.doubleValue ?? value.boolValue;
}

export function parseOtlpMetrics(body) {
  const records = [];
  for (const resourceMetric of body?.resourceMetrics ?? []) {
    for (const scopeMetric of resourceMetric.scopeMetrics ?? []) {
      for (const metric of scopeMetric.metrics ?? []) {
        if (metric.name !== TOKEN_METRIC) continue;
        const points = (metric.sum ?? metric.gauge)?.dataPoints ?? [];
        for (const point of points) {
          records.push({
            sessionId: attribute(point.attributes, 'session.id'),
            model: attribute(point.attributes, 'model'),
            type: attribute(point.attributes, 'type'),
            tokens: Number(point.asDouble ?? point.asInt ?? 0),
            at: new Date(Number(BigInt(point.timeUnixNano) / 1000000n)).toISOString(),
          });
        }
      }
    }
  }
  return records;
}

export async function startReceiver({ port = 0, host = LOOPBACK, onRecords }) {
  if (host !== LOOPBACK) throw new Error('The receiver listens only on 127.0.0.1');
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/metrics') {
      res.writeHead(404).end();
      req.resume();
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      try {
        onRecords(parseOtlpMetrics(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      } catch {
        res.writeHead(400).end();
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK, resolve);
  });
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
