// scripts/protection/archon.js
// What the guards know of Archon (spec 6.4, 12.2): its program, the engine room's port, the private files under its
// home, and how a step's hook learns which run is its own. The tool guard and the project's settings read it here, so
// the guards hold one copy of Archon's layout; the adapter (scripts/engine/archon/) keeps the rest of Archon's words.
//
// Archon fixes the layout under its home: archon.db and its journal files, credential-key, .env, config.yaml and
// plugins/ at the top, and workspaces/<owner>/<repo>/ (or workspaces/_folder/<slug>/) holding artifacts/runs/<run>/,
// logs/, workflow-source/ and worktrees/. An agent may use its own run's artefacts and its own worktree, and nothing
// else there.
//
// The own run comes from the hook's environment, never from a file. Archon gives every AI step's Claude Code process
// the run's id (ARCHON_NODE_EXECUTION's runId, and WORKFLOW_ID), and hooks inherit that process's environment, which
// nothing an agent runs can change: an `export` in its shell reaches only that shell. A file an agent could write,
// such as the run's settings overlay, names nothing to the guard.
import path from 'node:path';

// Archon's program, refused as a command as the agents' own programs are, and the npm package of its command line.
export const ARCHON_PROGRAMS = Object.freeze({ programs: Object.freeze(['archon']), packages: Object.freeze(['@archon/cli']) });

// The port `archon serve` listens on, which the engine room uses (spec 5.6).
export const ENGINE_ROOM_PORT = 3090;

// The database and its journal files, the other private files, and the private folders, at the top of the home.
export const DATABASE = Object.freeze(['archon.db', 'archon.db-wal', 'archon.db-shm', 'archon.db-journal']);
export const PRIVATE_FILES = Object.freeze([...DATABASE, 'credential-key', '.env', 'config.yaml']);
export const PRIVATE_FOLDERS = Object.freeze(['plugins']);
// The folders in every workspace that hold its transcripts and the workflows' source.
export const WORKSPACE_FOLDERS = Object.freeze(['logs', 'workflow-source']);

// A run's id as a single folder name: letters, digits, dots, hyphens and underscores, and not dots alone.
const RUN_ID = /^[A-Za-z0-9._-]+$/;
const runIdOk = (id) => typeof id === 'string' && RUN_ID.test(id) && !/^\.+$/.test(id);

// The run the hook's step belongs to, or null: only in a step the adapter started (WHEELHOUSE_ENGINE_RUN, which
// archonEnv sets for every Archon command), from ARCHON_NODE_EXECUTION's runId and WORKFLOW_ID. Where both are given
// they must agree; one that can't be read, or names no plain folder, gives null.
export function ownRun(env = process.env) {
  if (env?.WHEELHOUSE_ENGINE_RUN !== '1') return null;
  let fromExecution;
  if (typeof env.ARCHON_NODE_EXECUTION === 'string' && env.ARCHON_NODE_EXECUTION !== '') {
    try {
      fromExecution = JSON.parse(env.ARCHON_NODE_EXECUTION)?.runId;
    } catch {
      return null;
    }
    if (!runIdOk(fromExecution)) return null;
  }
  const fromWorkflow = typeof env.WORKFLOW_ID === 'string' && env.WORKFLOW_ID !== '' ? env.WORKFLOW_ID : undefined;
  if (fromWorkflow !== undefined && !runIdOk(fromWorkflow)) return null;
  if (fromExecution !== undefined && fromWorkflow !== undefined && fromExecution !== fromWorkflow) return null;
  return fromExecution ?? fromWorkflow ?? null;
}

// The workspace a run's artefacts folder is in: `<workspace>/artifacts/runs/<runId>`. Throws for anything else.
export function workspaceOfRun(artifactsDir, runId) {
  if (!runIdOk(runId)) throw new Error('A run id is one folder name of letters, digits, dots, hyphens and underscores');
  if (typeof artifactsDir !== 'string' || !path.isAbsolute(artifactsDir)) throw new Error('The run\'s artefacts folder must be a full path');
  const dir = path.resolve(artifactsDir);
  if (path.basename(dir) !== runId || path.basename(path.dirname(dir)) !== 'runs' || path.basename(path.dirname(path.dirname(dir))) !== 'artifacts') {
    throw new Error('The run\'s artefacts folder must be <workspace>/artifacts/runs/<run id>');
  }
  return path.dirname(path.dirname(path.dirname(dir)));
}

// Where a path inside the home lies, from its parts below the home (already folded where the system ignores case):
// 'artefacts' in the run `run`'s artefacts folder, 'worktree' in a workspace's worktrees folder, 'private' elsewhere.
export function placeInHome(parts, run) {
  const [top, , , kind, runs, id] = parts;
  if (top === 'workspaces' && kind === 'artifacts' && runs === 'runs' && run !== null && id === run) return 'artefacts';
  if (top === 'workspaces' && kind === 'worktrees' && parts.length >= 5) return 'worktree';
  return 'private';
}
