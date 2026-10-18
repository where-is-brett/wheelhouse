// probes/07-telemetry/capture.js
// Check 7 for a computer where the command-line Claude can't sign in: starts
// the same capture server as run.js, and makes a scratch project whose own
// settings point a Desktop session's telemetry at it. Start a Desktop session
// in the printed folder, let it answer one prompt, then stop this script
// (it stops by itself after ten minutes). Prints only counts.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { probeLogDir } from '../lib/log.js';
import { makeScratchProject } from '../lib/scratch.js';

const logDir = probeLogDir('07-telemetry');
let saved = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    saved += 1;
    fs.writeFileSync(path.join(logDir, `desktop-request-${saved}${req.url.replaceAll('/', '_')}.json`), body);
    console.log(`request ${saved}: ${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const project = await makeScratchProject({
  name: 'telemetry-desktop',
  settings: {
    env: {
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
      OTEL_METRIC_EXPORT_INTERVAL: '1000',
    },
  },
});
console.log(`listening on ${port}; start a Desktop session in: ${project.dir}`);

const stop = async () => {
  server.close();
  await project.cleanup();
  console.log(`requests saved: ${saved}; folder: ${logDir}`);
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setTimeout(stop, 10 * 60 * 1000);
