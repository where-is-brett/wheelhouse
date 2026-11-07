// scripts/watcher/keep-alive.js
// The watcher's keep-alive: whether the project's watcher is running, and a start when it isn't.
// The session start and the helper's own tick each call it, so a watcher that stopped mid-session
// starts again without waiting for the next session. Every project is Shape 1: a `watcherShape` of
// 2 in an older record is read as 1 (scripts/gate/guardrails.js).
//
// keepWatcherAlive never throws. It answers 'running', 'started', 'failed' (the start threw or
// started nothing) or 'unread' (the project's configuration can't be read, so nothing is started).
import { startWatcher, watcherRunning } from '../foreman/start.js';
import { projectConfig } from './main.js';

export async function keepWatcherAlive(project, {
  client, spawn, pluginRoot, env = process.env, running = watcherRunning, start = startWatcher,
} = {}) {
  try {
    if (running(project)) return 'running';
    if (typeof client?.config !== 'function') return 'unread';
    const read = await projectConfig(project, client);
    if (read.config === null) return 'unread';
    start(project, { spawn, pluginRoot, env });
    return 'started';
  } catch {
    return 'failed';
  }
}

// The helper's tick: one keepWatcherAlive for each project in `projects`, one at a time.
// `clientFor(project)` gives the client that answers that project's configuration; a project
// `skip(project)` names (an uninstall under way) is left alone. Answers { [project]: answer }.
export async function keepAllAlive({ projects, clientFor, skip = () => false, ...options }) {
  const answers = {};
  for (const project of projects) {
    if (skip(project)) continue;
    answers[project] = await keepWatcherAlive(project, { ...options, client: clientFor(project) });
  }
  return answers;
}
