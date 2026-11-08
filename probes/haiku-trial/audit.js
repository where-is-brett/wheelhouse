// probes/haiku-trial/audit.js
// Reads the trial's transcripts afterwards: which files belong to the trial, whether every assistant turn used a Haiku
// model, and whether any agent looked at the files held back from it. It reads files only and starts nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HAIKU = /haiku/i;
export const PEEK_PATTERNS = [/probes\/haiku-trial/, /held-back/, /reference-app/];

const ROLES = ['front-desk', 'foreman', 'feature', 'why'];
const ROLE_RECORD = /WHEELHOUSE_ROLE["'\s:=]+([A-Za-z-]+)/;
const TRANSCRIPT_FILE = /\.(jsonl|ndjson|log)$/;

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

const parseLine = (line) => {
  try {
    const value = JSON.parse(line);
    return value !== null && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
};

// Every line of a transcript that is a JSON object; lines that are not are skipped.
export function entriesOf(file) {
  return readText(file).split('\n').map(parseLine).filter((entry) => entry !== null);
}

const sessionOf = (file) => path.basename(file).replace(TRANSCRIPT_FILE, '');

function isWithin(folder, candidate) {
  const rel = path.relative(path.resolve(folder), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// The folder a transcript was run in: the `cwd` of its first line that has one.
function cwdOf(file) {
  return entriesOf(file).find((entry) => typeof entry.cwd === 'string' && entry.cwd !== '')?.cwd ?? null;
}

function jsonlFiles(dir) {
  return listDir(dir).filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => path.join(dir, e.name));
}

// The role a transcript's folder shows: the project's own folder is the front desk's, a worktree Wheelhouse made is a feature session's.
const WORKTREES = path.join('.wheelhouse', 'worktrees');
function roleByFolder(project, cwd) {
  return isWithin(path.join(project, WORKTREES), cwd) && path.resolve(cwd) !== path.resolve(project, WORKTREES) ? 'feature' : 'front-desk';
}

function projectFiles(claudeHome, project) {
  const found = [];
  for (const slug of listDir(path.join(claudeHome, 'projects'))) {
    if (!slug.isDirectory()) continue;
    const folder = path.join(claudeHome, 'projects', slug.name);
    const candidates = jsonlFiles(folder);
    for (const entry of listDir(folder)) {
      if (entry.isDirectory()) candidates.push(...jsonlFiles(path.join(folder, entry.name, 'subagents')));
    }
    for (const file of candidates) {
      const cwd = cwdOf(file);
      if (cwd !== null && isWithin(project, cwd)) found.push({ file, role: roleByFolder(project, cwd), session: sessionOf(file) });
    }
  }
  return found;
}

function walk(dir) {
  const found = [];
  for (const entry of listDir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.isFile() && TRANSCRIPT_FILE.test(entry.name)) found.push(full);
  }
  return found;
}

// The role a file's own WHEELHOUSE_ROLE record names, else the nearest folder above it that is a role's name.
function engineRole(file, engineDir) {
  const recorded = ROLE_RECORD.exec(readText(file))?.[1];
  if (recorded !== undefined) return recorded;
  const parts = path.relative(engineDir, path.dirname(file)).split(path.sep).reverse();
  return parts.find((part) => ROLES.includes(part)) ?? 'unknown';
}

export function findTranscripts({ project, claudeHome = path.join(os.homedir(), '.claude'), engineDir } = {}) {
  const found = new Map();
  for (const entry of projectFiles(claudeHome, project)) found.set(entry.session, entry);
  if (typeof engineDir === 'string') {
    // The same session can be found twice. The engine's own record of its role beats the folder's guess, which would call a
    // foreman started in the project's folder a front desk.
    for (const file of walk(engineDir)) {
      const role = engineRole(file, engineDir);
      const session = sessionOf(file);
      if (!found.has(session) || role !== 'unknown') found.set(session, { file: found.get(session)?.file ?? file, role, session });
    }
  }
  return [...found.values()];
}

const ADVISOR = 'advisor';

export function auditModels(transcripts) {
  const offenders = [];
  for (const { file, role, session } of transcripts) {
    const counts = new Map();
    for (const entry of entriesOf(file)) {
      if (entry.type !== 'assistant') continue;
      // A call to the advisor tool is answered by another model inside a Haiku turn, so it counts against the run.
      for (const block of Array.isArray(entry.message?.content) ? entry.message.content : []) {
        if (block?.type === 'server_tool_use' && block.name === ADVISOR) counts.set(ADVISOR, (counts.get(ADVISOR) ?? 0) + 1);
      }
      const model = entry.message?.model;
      if (typeof model !== 'string' || model === '<synthetic>' || HAIKU.test(model)) continue;
      counts.set(model, (counts.get(model) ?? 0) + 1);
    }
    for (const [model, count] of counts) offenders.push({ file, role, session, model, count });
  }
  return { clean: offenders.length === 0, offenders };
}

export function auditPeek(transcripts) {
  const hits = [];
  for (const { file, role } of transcripts) {
    for (const entry of entriesOf(file)) {
      if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue;
      for (const block of entry.message.content) {
        if (block?.type !== 'tool_use') continue;
        const text = JSON.stringify(block.input ?? null);
        if (PEEK_PATTERNS.some((pattern) => pattern.test(text))) hits.push({ file, role, tool: block.name, text });
      }
    }
  }
  return { clean: hits.length === 0, hits };
}
