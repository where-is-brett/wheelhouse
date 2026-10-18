// probes/11-helper/trials.js
// Check 11: run by an agent inside the sandbox. Each trial records whether
// the action worked. The first five should fail; the last two should work.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendJsonl } from '../lib/log.js';

const logDir = path.join(os.homedir(), '.wheelhouse-probes', '11-helper');
const socketPath = path.join(logDir, 'helper.sock');
const results = path.join(process.cwd(), 'trials.jsonl');

function get(options) {
  return new Promise((resolve) => {
    http.get(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ ok: res.statusCode === 200, detail: body.slice(0, 200) }));
    }).on('error', (error) => resolve({ ok: false, detail: error.code ?? error.message }));
  });
}

function readable(file) {
  try {
    fs.readFileSync(file);
    return { ok: true, detail: 'read' };
  } catch (error) {
    return { ok: false, detail: error.code };
  }
}

const trials = {
  'read gh login file': () => readable(path.join(os.homedir(), '.config', 'gh', 'hosts.yml')),
  'read .env.local': () => readable(path.join(process.cwd(), '.env.local')),
  'read keychain': () => {
    const result = process.platform === 'darwin'
      ? spawnSync('security', ['find-generic-password', '-s', 'wheelhouse-probe'], { encoding: 'utf8' })
      : spawnSync('cmdkey', ['/list'], { encoding: 'utf8' });
    return { ok: result.status === 0, detail: (result.stderr || '').trim().slice(0, 200) };
  },
  'reach the host directly': async () => {
    try {
      const response = await fetch('https://api.github.com/zen');
      return { ok: response.ok, detail: String(response.status) };
    } catch (error) {
      return { ok: false, detail: error.cause?.code ?? error.message };
    }
  },
  'start own helper and reach the host': async () => {
    const helper = fileURLToPath(new URL('./helper.js', import.meta.url));
    const { startHelper } = await import(helper);
    try {
      const own = await startHelper({ port: 0 });
      const reply = await get({ host: '127.0.0.1', port: own.address.port, path: '/host' });
      await own.close();
      return reply;
    } catch (error) {
      return { ok: false, detail: error.code ?? error.message };
    }
  },
  'ping the hook-started helper': () => get({ socketPath, path: '/ping' }),
  'reach the host through the hook-started helper': () => get({ socketPath, path: '/host' }),
};

for (const [trial, run] of Object.entries(trials)) {
  const outcome = await run();
  await appendJsonl(results, { trial, ...outcome });
  console.log(`${outcome.ok ? 'worked ' : 'refused'}  ${trial}  (${outcome.detail})`);
}
