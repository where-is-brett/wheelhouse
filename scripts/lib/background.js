// scripts/lib/background.js
// What a session start does besides the host helper: records what the session is for, makes
// sure the usage receiver is running, and starts the weekly job when it is due. All of it
// fits in one second of the session start's budget, and none of it throws.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { featureSlug } from '../hooks/session-start.js';
import { receiverPort } from '../telemetry/main.js';
import { recordSession } from '../usage/store.js';
import { weeklyDue } from '../jobs/weekly.js';
import { takeStartLock } from './start-lock.js';
import { sessionRole } from './role.js';
import { jobFolder, usageDir, wheelhouseHome } from './paths.js';

export const BACKGROUND_MS = 1000;
const HEALTH_MS = 300;
const POLL_MS = 50;

// Whether the weekly job is due is answered by the job's own module.
export { weeklyDue };

// Whether something answers /health on the port as the receiver does.
export function askHealth(port, timeoutMs = HEALTH_MS) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(res.statusCode === 200 && JSON.parse(body)?.ok === true); } catch { resolve(false); }
      });
      res.on('error', () => resolve(false));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The promise's value, or `fallback` after `ms`, or `fallback` if it rejects.
function within(ms, promise, fallback) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), Math.max(0, ms)); }),
  ]).finally(() => clearTimeout(timer));
}

function recordPart({ session, project, cwd, env, now }) {
  try {
    const role = sessionRole({ sessionId: session, env, cwd });
    // A session in a feature worktree is feature work, whatever role was recorded, unless it is the foreman.
    const feature = role === 'foreman' ? null : featureSlug(cwd);
    recordSession({ session, project, role: feature ? 'feature' : role, ...(feature ? { work: feature } : {}), at: now() });
  } catch { /* a session that can't be recorded is still a session */ }
}

// Starts `node <script> [args]` detached in Wheelhouse's home, with no window and no output kept; true
// when it started.
export function startDetached(spawn, script, args = []) {
  try {
    const home = wheelhouseHome();
    fs.mkdirSync(home, { recursive: true });
    const child = spawn(process.execPath, [script, ...args], { cwd: jobFolder(), detached: true, windowsHide: true, stdio: 'ignore' });
    child?.unref?.();
    child?.on?.('error', () => {});
    return true;
  } catch {
    return false;
  }
}

async function ensureReceiver({ spawn, pluginRoot, health, end }) {
  const port = receiverPort();
  const answers = async (ms) => (await within(Math.min(ms, end - Date.now()), health(port), false)) === true;
  if (await answers(HEALTH_MS)) return 'running';
  let release;
  try {
    release = await takeStartLock(path.join(usageDir(), 'receiver.lock'), {
      message: 'Another session is starting the usage receiver', waitMs: Math.max(0, end - Date.now()), staleMs: 5000,
    });
  } catch {
    return 'failed';
  }
  try {
    // The one that held the lock may have started it.
    if (await answers(HEALTH_MS)) return 'running';
    if (!startDetached(spawn, path.join(pluginRoot, 'scripts', 'telemetry', 'main.js'))) return 'failed';
    while (Date.now() < end) {
      await sleep(POLL_MS);
      if (await answers(POLL_MS * 2)) return 'started';
    }
    return 'failed';
  } finally {
    release();
  }
}

export async function startBackground({
  pluginRoot, session, cwd, project, env = process.env, spawn = nodeSpawn, now = () => new Date(),
  health = askHealth, weeklyDue: due = weeklyDue,
}) {
  const end = Date.now() + BACKGROUND_MS;
  const result = { receiver: 'failed', weekly: 'not-due' };
  const work = (async () => {
    recordPart({ session, project, cwd, env, now });
    result.receiver = await ensureReceiver({ spawn, pluginRoot, health, end });
    if (due(now())) result.weekly = startDetached(spawn, path.join(pluginRoot, 'scripts', 'jobs', 'weekly-main.js')) ? 'started' : 'not-due';
  })();
  await within(end - Date.now(), work, null);
  return { ...result };
}
