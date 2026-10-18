// scripts/telemetry/receiver.js
// A local receiver for Claude Code's usage telemetry (OTLP over HTTP, JSON).
// It listens only on the computer itself and keeps counts, not content.
import http from 'node:http';

const METRICS = { 'claude_code.token.usage': 'tokens', 'claude_code.cost.usage': 'usd' };
const LOOPBACK = '127.0.0.1';
const MAX_BODY = 1024 * 1024;
const CUMULATIVE = 2; // aggregationTemporality: 1 is delta, 2 is cumulative
// What may be kept from the data point's text attributes. Anything else is dropped.
const SESSION = /^(?!\.+$)[A-Za-z0-9._-]{1,128}$/;
const MODEL = /^[A-Za-z0-9._:/[\]-]{1,100}$/;
const KIND = /^[A-Za-z]{1,32}$/;
const SOURCE = /^[a-z_-]{1,32}$/;

function attribute(attributes, key) {
  const found = attributes?.find((item) => item.key === key);
  if (!found) return undefined;
  const value = found.value;
  return value.stringValue ?? value.intValue ?? value.doubleValue ?? value.boolValue;
}

function textOf(attributes, key, pattern) {
  const value = attribute(attributes, key);
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function isoOf(nanos) {
  try {
    const date = new Date(Number(BigInt(nanos) / 1000000n));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

// The counts in a telemetry export, as UsagePoint:
//   { metric: 'tokens' | 'usd', session, model, type?, source?, value, at, start, cumulative }
// Only the session, the model, the kind of tokens and `query_source` are read from a data
// point's attributes; the account's email and IDs and everything else are never looked at.
export function parseOtlpMetrics(body) {
  const points = [];
  for (const resourceMetric of body?.resourceMetrics ?? []) {
    for (const scopeMetric of resourceMetric.scopeMetrics ?? []) {
      for (const metric of scopeMetric.metrics ?? []) {
        const kind = METRICS[metric.name];
        if (!kind) continue;
        const series = metric.sum ?? metric.gauge;
        const cumulative = series?.aggregationTemporality === CUMULATIVE;
        for (const point of series?.dataPoints ?? []) {
          const session = textOf(point.attributes, 'session.id', SESSION);
          const value = Number(point.asDouble ?? point.asInt);
          const at = isoOf(point.timeUnixNano);
          if (!session || !Number.isFinite(value) || !at) continue;
          const parsed = { metric: kind, session, model: textOf(point.attributes, 'model', MODEL) ?? 'unknown' };
          const type = kind === 'tokens' ? textOf(point.attributes, 'type', KIND) : undefined;
          if (type) parsed.type = type;
          const source = textOf(point.attributes, 'query_source', SOURCE);
          if (source) parsed.source = source;
          Object.assign(parsed, { value, at, start: isoOf(point.startTimeUnixNano) ?? at, cumulative });
          points.push(parsed);
        }
      }
    }
  }
  return points;
}

export async function startReceiver({ port = 0, host = LOOPBACK, onRecords }) {
  if (host !== LOOPBACK) throw new Error('The receiver listens only on 127.0.0.1');
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }
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
