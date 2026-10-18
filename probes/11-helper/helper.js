// probes/11-helper/helper.js
// Check 11: a stand-in for the host helper. It answers /ping, and /host by
// reaching GitHub itself, to show whether agents can reach it while the
// sandbox keeps them from reaching the host directly.
// Run as: node helper.js <socket path>   or   node helper.js --port <n>
import http from 'node:http';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function startHelper({ socketPath, port }) {
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (req.url === '/ping') return reply(200, { ok: true, pid: process.pid });
    if (req.url === '/host') {
      try {
        const response = await fetch('https://api.github.com/zen');
        return reply(200, { ok: true, status: response.status });
      } catch (error) {
        return reply(502, { ok: false, error: error.message });
      }
    }
    return reply(404, { ok: false });
  });
  if (socketPath) {
    fs.rmSync(socketPath, { force: true });
    await new Promise((resolve, reject) => server.once('error', reject).listen(socketPath, resolve));
  } else {
    await new Promise((resolve, reject) => server.once('error', reject).listen(port ?? 0, '127.0.0.1', resolve));
  }
  const address = socketPath ? { socketPath } : { host: '127.0.0.1', port: server.address().port };
  return { address, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [first, second] = process.argv.slice(2);
  const helper = await startHelper(first === '--port' ? { port: Number(second) } : { socketPath: first });
  process.stdout.write(JSON.stringify(helper.address) + '\n');
}
