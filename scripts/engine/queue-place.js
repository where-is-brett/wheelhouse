// scripts/engine/queue-place.js
// Where a project's merge queue folder is (queue-folder.js), and which project a folder there is, kept apart from the
// folder's making so the hooks can place a step there without loading git or the settings.
import path from 'node:path';
import { engineDir } from '../lib/paths.js';
import { isInsideFolder } from '../lib/projects.js';

// The queue's folder for a project, under the engine folder.
export const queueFolderOf = (project, engine = engineDir()) => path.join(engine, 'queues', project);

// Which of `projects` owns the queue folder holding `cwd`, or null: the broker places the queue's gh calls by it, and the
// tool guard the queue's steps, as each places a run's by the project's own folder.
export function queueProjectOf(cwd, projects, engine = engineDir()) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  return projects.find((project) => isInsideFolder(queueFolderOf(project, engine), cwd)) ?? null;
}

