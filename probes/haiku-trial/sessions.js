// probes/haiku-trial/sessions.js
// The feature sessions a trial has running, read from the records Wheelhouse keeps of them
// (<home>/projects/<project>/watcher/running/feature-<work>.json), not from where a session's worktree happens to be.
// The faults and the teardown both ask, so a session is found the same way wherever its worktree is.
import fs from 'node:fs';
import path from 'node:path';
import { watcherDir, pidAlive } from '../../scripts/watcher/waker.js';
import { projectsDir } from '../../scripts/lib/paths.js';

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

// [{ work, pid, at }] for a project (its NAME, owner__repo): the records that say running, with a process id that runs.
export function recordedFeatureSessions(name, { dir = watcherDir(name), alive = pidAlive } = {}) {
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'running')); } catch { return []; }
  const out = [];
  for (const file of files.sort()) {
    if (!file.startsWith('feature-') || !file.endsWith('.json')) continue;
    const r = readJson(path.join(dir, 'running', file));
    if (r === null || typeof r !== 'object' || r.state !== 'running' || !Number.isInteger(r.pid)) continue;
    if (!alive(r.pid)) continue;
    out.push({ work: file.slice('feature-'.length, -'.json'.length), pid: r.pid, at: r.at });
  }
  return out;
}

// [{ work, worktree, sessionId, at }] for a project: the session records the watcher keeps (watcher/sessions/<work>.json) whose
// worktree is still there, newest first. A feature session has a process only while a run lasts, so this is what says a work has one.
export function recordedFeatureWorktrees(name, { dir = watcherDir(name), exists = fs.existsSync } = {}) {
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'sessions')); } catch { return []; }
  const out = [];
  for (const file of files.sort()) {
    if (!file.endsWith('.json')) continue;
    const r = readJson(path.join(dir, 'sessions', file));
    if (r === null || typeof r !== 'object' || typeof r.worktree !== 'string' || r.worktree === '' || !exists(r.worktree)) continue;
    out.push({ work: file.slice(0, -'.json'.length), worktree: r.worktree, sessionId: r.sessionId, at: r.at });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// [{ project, work, pid, at }] across every project under the Wheelhouse home in force.
export function liveFeatureSessions({ projectsRoot = projectsDir(), alive = pidAlive } = {}) {
  let names = [];
  try { names = fs.readdirSync(projectsRoot); } catch { return []; }
  return names.flatMap((project) => recordedFeatureSessions(project, { dir: path.join(projectsRoot, project, 'watcher'), alive }).map((s) => ({ project, ...s })));
}
