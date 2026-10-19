// scripts/hooks/pending.js
// What the hooks that sign share: records written down before they are sent,
// sent again later, and the time a hook may spend waiting on the helper.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';
import { CARRIES_BASELINE } from '../lib/measures-clicks.js';

// The hook has ten seconds; the helper gets seven of them.
export const BUDGET_MS = 7000;
const HELD = /already holds an event with that id/;

export const pendingDir = (project) => path.join(stateDir(project), '..', 'pending');

// Returns a function that resolves with a call's answer, or with nothing once
// the time `end` (milliseconds since the epoch) has passed.
export function withinBudget(end) {
  return (promise) => {
    const ms = end - Date.now();
    if (ms <= 0) return Promise.resolve(null);
    let timer;
    return Promise.race([
      Promise.resolve(promise).catch(() => null),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
    ]).finally(() => clearTimeout(timer));
  };
}

// Keeps a record the helper has not yet taken. Written whole to a temporary
// name, then linked to its own name, which fails rather than overwrite.
export function keep(project, route, body, now) {
  const folder = pendingDir(project);
  fs.mkdirSync(folder, { recursive: true });
  const stem = `${now().toISOString().replaceAll(':', '-')}-${crypto.randomUUID().slice(0, 12)}`;
  const temp = path.join(folder, `${stem}.tmp`);
  const file = path.join(folder, `${stem}.json`);
  fs.writeFileSync(temp, `${JSON.stringify({ route, body })}\n`, { flag: 'wx' });
  try {
    fs.linkSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return file;
}

// Whether the helper is done with a record: it took it, it already holds it, or the state refused
// it for carrying the private note's figures. That last is dropped, never kept to send again,
// since once the figures lapse a later try would be taken.
export const taken = (result) => result?.ok === true
  || (typeof result?.refused === 'string' && (HELD.test(result.refused) || result.refused.includes(CARRIES_BASELINE)));

// Sends the kept records, oldest first, removing each the helper takes. A file
// that will not parse is moved to pending/bad/. Once `until` (milliseconds since
// the epoch) has passed it stops between records; the rest stay pending.
export async function sendPending(project, client, { until = Infinity } = {}) {
  const folder = pendingDir(project);
  let names;
  try {
    names = fs.readdirSync(folder).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return { sent: 0, kept: 0 };
  }
  let sent = 0;
  let kept = 0;
  for (const [i, name] of names.entries()) {
    if (Date.now() >= until) {
      kept += names.length - i;
      break;
    }
    const file = path.join(folder, name);
    let route;
    let body;
    try {
      ({ route, body } = JSON.parse(fs.readFileSync(file, 'utf8')));
      if (route !== 'write' && route !== 'record' && route !== 'profile-record') throw new Error('unknown route');
    } catch {
      try {
        fs.mkdirSync(path.join(folder, 'bad'), { recursive: true });
        fs.renameSync(file, path.join(folder, 'bad', name));
      } catch { /* left where it is */ }
      continue;
    }
    try {
      const send = { write: () => client.state.write(body), record: () => client.state.record(body), 'profile-record': () => client.profile.record(body) };
      const result = await send[route]();
      if (taken(result)) {
        fs.rmSync(file, { force: true });
        sent += 1;
        continue;
      }
    } catch {
      // Kept for the next try.
    }
    kept += 1;
  }
  return { sent, kept };
}
