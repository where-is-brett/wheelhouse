// tests/helpers/http-host.js
// A stand-in for a private repository's host: a local HTTP server that runs
// `git http-backend` as a CGI program over a folder of bare repositories, and
// answers 401 to any request that does not carry the key. The key travels as
// git's http.extraHeader does: `Authorization: Basic base64("x-access-token:" + token)`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { run } from '../../scripts/lib/run.js';

async function backendProgram() {
  const said = await run('git', ['--exec-path']);
  const exec = said.code === 0 ? said.stdout.trim() : '';
  for (const name of ['git-http-backend', 'git-http-backend.exe']) {
    const file = path.join(exec, name);
    if (exec && fs.existsSync(file)) return { file, args: [] };
  }
  return { file: 'git', args: ['http-backend'] };
}

// Runs the CGI program on one request and resolves with { status, headers, body }.
function cgi(program, env, body) {
  return new Promise((resolve, reject) => {
    // No shell. The pack data is binary, so output is kept as Buffers.
    const child = spawn(program.file, program.args, { env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', () => {
      const all = Buffer.concat(out);
      const split = all.indexOf('\r\n\r\n') >= 0 ? all.indexOf('\r\n\r\n') : all.indexOf('\n\n');
      if (split < 0) return resolve({ status: 500, headers: {}, body: Buffer.alloc(0) });
      const gap = all.indexOf('\r\n\r\n') === split ? 4 : 2;
      const headers = {};
      let status = 200;
      for (const line of all.subarray(0, split).toString('utf8').split(/\r?\n/)) {
        const at = line.indexOf(':');
        if (at < 0) continue;
        const name = line.slice(0, at).trim().toLowerCase();
        const value = line.slice(at + 1).trim();
        if (name === 'status') status = Number.parseInt(value, 10) || 200;
        else headers[name] = value;
      }
      return resolve({ status, headers, body: all.subarray(split + gap) });
    });
    child.stdin.end(body);
  });
}

export async function startHttpHost({ root, token }) {
  const program = await backendProgram();
  const wanted = `Basic ${Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')}`;
  let refused = 0;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      // The scheme is case-insensitive: the connection writes "basic".
      if (String(req.headers.authorization ?? '').replace(/^basic /i, 'Basic ') !== wanted) {
        refused += 1;
        res.writeHead(401, { 'www-authenticate': 'Basic realm="host"', 'content-length': 0 });
        res.end();
        return;
      }
      try {
        const url = new URL(req.url ?? '/', 'http://host');
        const body = Buffer.concat(chunks);
        const env = {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          GIT_PROJECT_ROOT: root,
          GIT_HTTP_EXPORT_ALL: '1',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          REMOTE_USER: 'x-access-token', // a push is allowed only for a signed-in user
          REQUEST_METHOD: req.method,
          PATH_INFO: decodeURIComponent(url.pathname),
          QUERY_STRING: url.search.replace(/^\?/, ''),
          CONTENT_LENGTH: String(body.length),
          ...(req.headers['content-type'] ? { CONTENT_TYPE: req.headers['content-type'] } : {}),
          ...(req.headers['content-encoding'] ? { HTTP_CONTENT_ENCODING: req.headers['content-encoding'] } : {}),
          ...(req.headers['git-protocol'] ? { GIT_PROTOCOL: req.headers['git-protocol'] } : {}),
        };
        const answer = await cgi(program, Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)), body);
        res.writeHead(answer.status, { ...answer.headers, 'content-length': answer.body.length });
        res.end(answer.body);
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    refusedCount: () => refused,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}
