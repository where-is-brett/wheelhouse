// scripts/hooks/helm-end.js
// On SessionEnd, hands a feature piece back, unless its helm process is still running, when the session that ends is the one the director holds at its helm (crew
// visibility design, 9.1): the hold goes and the piece is woken to read what the director did. Any other session, any other
// role and any failure do nothing. It says nothing on stdout and always exits 0.
import { Readable } from 'node:stream';
import { runAndExit, projectOf, isWhy } from './kit.js';
import { sessionRole } from '../lib/role.js';
import { holdBySession } from '../crew/hold.js';
import { handBack } from '../crew/helm.js';
import { pidAlive } from '../watcher/waker.js';
import { startedAsScript } from '../lib/started-as-script.js';

// How long the project's configuration may take to come: the hook's own limit is ten seconds.
const CONFIG_MS = 5000;

// The project's configuration, or null when it can't be had in time. Without it the piece is still handed back; its wake
// is written but not delivered, and the waker's prune takes it away.
async function readConfig(project) {
  let timer;
  try {
    const { projectConfig } = await import('../watcher/main.js');
    const { helperClient } = await import('../host/helper-client.js');
    const read = await Promise.race([
      projectConfig(project, helperClient()),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ config: null }), CONFIG_MS); }),
    ]);
    return read.config ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// `deps`: `find`, `roleOf`, `configOf`, `wakerFor` and `now` are for tests.
export async function decide(input, deps = {}) {
  const { find = projectOf, roleOf = sessionRole, configOf = readConfig, wakerFor = null, now = () => new Date(), env = process.env, alive = pidAlive } = deps;
  try {
    // On an agent whose hooks only read (`writeVia: 'helper'`) the hold is handed back by the helm process and the routine, not here.
    if (deps.writeVia !== undefined && deps.writeVia !== 'self') return undefined;
    if (input?.hook_event_name !== 'SessionEnd' || isWhy(env)) return undefined;
    if (typeof input.cwd !== 'string' || typeof input.session_id !== 'string') return undefined;
    const found = find(input.cwd);
    if (!found) return undefined;
    if (roleOf({ sessionId: input.session_id, cwd: input.cwd, env }) !== 'feature') return undefined;
    const hold = holdBySession(found.project, input.session_id);
    if (hold === null || typeof hold.work !== 'string') return undefined;
    // The helm process hands back itself once the session has exited; only a hold whose holder is gone is handed back here.
    if (Number.isInteger(hold.holder) && alive(hold.holder)) return undefined;
    const config = wakerFor === null ? await configOf(found.project) : null;
    await handBack(found.project, hold.work, { why: 'ended', now, config, wakerFor, print: () => {} });
  } catch {
    // A hook at the end of a session has nothing to refuse and nowhere to say it.
  }
  return undefined;
}

if (startedAsScript(import.meta.url)) {
  let text = '';
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    text = Buffer.concat(chunks).toString('utf8');
  } catch {
    // Unreadable input is passed on as it is, and does nothing.
  }
  await runAndExit(decide, { failClosed: false, event: 'SessionEnd' }, { stdin: Readable.from([text]) });
}
