// probes/mac-sitting/layout.mjs
// Where everything for the Mac sitting (checks 33, 41 and 42) lives. The scratch folder is this file's own folder,
// under the system's temporary folder. Nothing here is in the Wheelhouse repository.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BASE = path.dirname(fileURLToPath(import.meta.url));
// The checkout the plugin copy is taken from: set by copy.mjs (source.json) when the kit is copied
// out of the repository, or by WHEELHOUSE_SITTING_SOURCE.
const sourceFile = path.join(BASE, 'source.json');
export const WORKTREE = process.env.WHEELHOUSE_SITTING_SOURCE
  ?? (fs.existsSync(sourceFile) ? JSON.parse(fs.readFileSync(sourceFile, 'utf8')).worktree : path.resolve(BASE, '..', '..'));
// The plugin as committed at the worktree's HEAD, extracted here, so the engine's laid types and
// any edit by the other implementer never touch the repository during the sitting.
export const PLUGIN = path.join(BASE, 'plugin');
export const SCRATCH_HOME = path.join(BASE, 'home');
export const REAL_HOME = path.join(os.homedir(), '.wheelhouse');
export const PROJECT_DIR = path.join(BASE, 'project');
export const REMOTES = path.join(BASE, 'remotes');
export const OBSERVER = path.join(BASE, 'observer');
export const OBSERVER_LOG = path.join(BASE, 'observer.jsonl');
// The observer's notes since the second sitting: one file per note (observer/hooks/register.ts).
export const OBSERVER_NOTES = path.join(BASE, 'observer.d');
// The courier's changes as check.mjs courier-watch and lock-watch.mjs see them (courier-log.mjs).
export const COURIER_WATCH_LOG = path.join(BASE, 'courier-watch.log');
export const LOGS = path.join(BASE, 'logs');
export const MADE = path.join(BASE, 'made.json');
export const REAL_BEFORE = path.join(BASE, 'real-home-before.json');
export const DEV_MODS = path.join(os.homedir(), '.claude', 'dev-mods');
export const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects');

export const REPO = 'check41/scratch';
export const PROJECT = 'check41__scratch';
export const PROFILE_REPO = 'check41/profile';
export const PR = 7;
// The project's configuration on its default branch: Shape 2, so a front desk's tick never
// starts a watcher process (as tests/e2e/mod.test.js).
export const CONFIG = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], watcherShape: 2 };

// The plugin's own modules, imported from the extracted copy.
export const fromPlugin = (rel) => import(pathToFileURL(path.join(PLUGIN, rel)).href);

// What prepare.mjs recorded, or null before it ran.
export function readMade() {
  try {
    return JSON.parse(fs.readFileSync(MADE, 'utf8'));
  } catch {
    return null;
  }
}

// The home the sitting uses, as prepare.mjs recorded it; set into this process's environment
// before any plugin module reads it.
export function useHome() {
  const made = readMade();
  if (made === null) throw new Error('Run prepare.mjs first: made.json is missing');
  process.env.WHEELHOUSE_HOME = made.home;
  delete process.env.WHEELHOUSE_ROLE;
  return made;
}

// Claude Code's folder name for a session's transcripts: the path with every character other
// than a letter, a digit or a hyphen turned into a hyphen.
export const transcriptFolder = (dir) => path.join(CLAUDE_PROJECTS, dir.replace(/[^A-Za-z0-9-]/g, '-'));
