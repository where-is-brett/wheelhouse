// scripts/crew/runs.js
// Finding a run's transcript and its subagents' transcripts. Read-only: every file found is
// checked with lstat, and a link or anything that is not a plain file is left out.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function configDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function plainFile(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

function safeId(id) {
  return typeof id === 'string' && id !== '' && id !== '.' && id !== '..' && !/[\\/\0]/.test(id);
}

export function findTranscript({ sessionId, env = process.env } = {}) {
  if (!safeId(sessionId)) return null;
  const projects = path.join(configDir(env), 'projects');
  let folders;
  try {
    folders = fs.readdirSync(projects, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const file = path.join(projects, folder.name, `${sessionId}.jsonl`);
    if (plainFile(file)) return file;
  }
  return null;
}

export function findSubagents(file) {
  if (typeof file !== 'string' || !file.endsWith('.jsonl')) return [];
  const dir = path.join(path.dirname(file), path.basename(file, '.jsonl'), 'subagents');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found = [];
  for (const name of names) {
    const m = /^agent-(.+)\.jsonl$/.exec(name);
    if (!m) continue;
    const sub = path.join(dir, name);
    try {
      const st = fs.lstatSync(sub);
      if (st.isFile()) found.push({ agentId: m[1], file: sub, mtime: st.mtimeMs });
    } catch {
      // vanished between listing and checking
    }
  }
  found.sort((a, b) => a.mtime - b.mtime || (a.agentId < b.agentId ? -1 : 1));
  return found.map(({ agentId, file: f }) => ({ agentId, file: f }));
}
