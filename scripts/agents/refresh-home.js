// scripts/agents/refresh-home.js
// The part of an update's second half that belongs to an agent: writing the agent's clean home in the build engine again
// from the new release. Gives null where the project's agent has none, or the computer has no engine; otherwise
// { ok: true, wrote: [files] }, every file written, for the update's own-files record.
import fs from 'node:fs';
import path from 'node:path';
import { engineDir, computerId } from '../lib/paths.js';
import { agentOfProject } from './names.js';

// Every regular file under a folder, links skipped.
export function filesUnder(dir) {
  const found = [];
  const walk = (at) => {
    let entries = [];
    try { entries = fs.readdirSync(at, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(at, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full); else if (entry.isFile()) found.push(full);
    }
  };
  if (typeof dir === 'string') walk(dir);
  return found.sort();
}

// `writeHome` is for tests; it stands in for the adapter's writer.
export async function refreshAgentHome({ folder, newRoot, writeHome }) {
  if (typeof folder !== 'string' || agentOfProject(folder, { computerId: computerId() }) !== 'copilot') return null;
  if (!fs.existsSync(engineDir())) return null;
  const { engineHomeProblem, writeEngineHome } = await import('./copilot/engine-home.js');
  if (engineHomeProblem({ engine: engineDir(), root: newRoot }) === null) return { ok: true, wrote: [] };
  // The sign-in is only read from the director's own folder, never written there.
  const home = (writeHome ?? writeEngineHome)({ engine: engineDir(), root: newRoot });
  return { ok: true, wrote: filesUnder(home) };
}
