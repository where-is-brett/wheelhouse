// probes/haiku-trial/product.js
// Starts the product under test and talks to it. Nothing here throws on a bad answer from the product.
import { spawn } from 'node:child_process';
import net from 'node:net';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST')) delete env[key];
  return env;
}

// One request. Resolves {status, headers, text}; status 0 means no answer, with the reason in text.
export async function request(url, { method, body, form, file, follow = false, timeoutMs = 10000 } = {}) {
  let payload = body;
  const headers = {};
  if (form) {
    payload = new URLSearchParams(form).toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  } else if (file) {
    const data = new FormData();
    data.append(file.field, new Blob([file.content], { type: 'text/csv' }), file.name);
    payload = data;
  }
  let verb = method ?? (payload === undefined ? 'GET' : 'POST');
  let target = url;
  const deadline = Date.now() + timeoutMs;
  try {
    for (let hops = 0; ; hops += 1) {
      const res = await fetch(target, {
        method: verb,
        headers,
        body: verb === 'GET' ? undefined : payload,
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      const text = await res.text();
      const result = { status: res.status, headers: Object.fromEntries(res.headers), text };
      if (!follow || res.status < 300 || res.status > 399 || !result.headers.location || hops >= 5) return result;
      target = new URL(result.headers.location, target).href;
      verb = 'GET';
      payload = undefined;
    }
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return { status: 0, headers: {}, text: timedOut ? 'timed out' : `no answer: ${error?.cause?.code ?? error?.message}` };
  }
}

// Runs `npm start` in dir on a free port with an empty in-memory database, and waits until it answers.
export async function startProduct({ dir, env = {}, timeoutMs = 20000 }) {
  const port = await freePort();
  const child = spawn('npm', ['start'], {
    cwd: dir,
    detached: true,
    stdio: 'ignore',
    env: cleanEnv({ LEDGER_DB: ':memory:', ...env, PORT: String(port) }),
  });
  let exited = false;
  const done = new Promise((resolve) => {
    child.once('exit', () => { exited = true; resolve(); });
    child.once('error', () => { exited = true; resolve(); });
  });
  const kill = async () => {
    if (exited) return;
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      try { process.kill(-child.pid, signal); } catch { /* already gone */ }
      await Promise.race([done, pause(2000)]);
      if (exited) return;
    }
  };
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  let last = 'no answer yet';
  while (Date.now() < deadline) {
    if (exited) { await kill(); throw new Error('product did not start: npm start exited'); }
    const res = await request(`${url}/`, { timeoutMs: 1000 });
    if (res.status > 0) return { url, pid: child.pid, stop: kill };
    last = res.text;
    await pause(100);
  }
  await kill();
  throw new Error(`product did not start: nothing answered within ${timeoutMs} ms (${last})`);
}
