// probes/07-telemetry/run.js
// Check 7: starts a capture server on 127.0.0.1, runs one short headless
// Claude Code session with telemetry pointed at it, and saves every request
// body to the probe's log folder. Prints only counts. Claude is started
// without blocking, so the server can answer while the session runs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
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
    fs.writeFileSync(path.join(logDir, `request-${saved}${req.url.replaceAll('/', '_')}.json`), body);
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const project = await makeScratchProject({ name: 'telemetry' });
const status = await new Promise((resolve) => {
  // On Windows `claude` may be a .cmd shim, so it runs through the shell,
  // which joins arguments unquoted: the prompt needs its own quotes there.
  const prompt = 'Write the numbers one to forty in words, one per line.';
  const child = spawn('claude', ['-p', process.platform === 'win32' ? `"${prompt}"` : prompt, '--max-turns', '1', ...(process.env.PROBE_DEBUG_FILE ? ['--debug-file', process.env.PROBE_DEBUG_FILE] : [])], {
  cwd: project.dir,
  shell: process.platform === 'win32',
  stdio: 'ignore',
  env: {
    ...process.env,
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
    OTEL_METRIC_EXPORT_INTERVAL: '1000',
  },
  });
  child.on('close', resolve);
});
await new Promise((resolve) => setTimeout(resolve, 3000));
server.close();
await project.cleanup();
console.log(`claude exit ${status}; requests saved: ${saved}; folder: ${logDir}`);
