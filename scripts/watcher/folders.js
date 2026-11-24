// scripts/watcher/folders.js
// Where the watcher keeps its files, projects/<p>/watcher. A reader of the run records (the crew's runs and holds) names a file
// from here without reading the waker, which imports most of the plugin.
import path from 'node:path';
import { stateDir } from '../lib/paths.js';

export function watcherDir(project) {
  return path.join(path.dirname(stateDir(project)), 'watcher');
}

export const runningFile = (project, target) => path.join(watcherDir(project), 'running', `${target}.json`);
export const sessionFile = (project, work) => path.join(watcherDir(project), 'sessions', `${work}.json`);
