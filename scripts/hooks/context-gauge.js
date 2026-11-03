// scripts/hooks/context-gauge.js
// Tells the model how full its context is, each turn, and keeps the reading for
// later turns. The transcript's format is Claude Code's own and may
// change, so anything unexpected gives no reading and the hook says nothing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { answer, runAndExit, projectOf, registeredByPath, readTailEntries } from './kit.js';
import { projectForFolder } from '../lib/projects.js';
import { wheelhouseHome } from '../lib/paths.js';
import { startedAsScript } from '../lib/started-as-script.js';

// The fallback; the point follows the project's `compactPrepare` setting when it has one.
export const SAVE_FROM = 200000;
export const SAVE_NOTE = 'Finish this step, save state, then carry on.';

// The point to prepare at: the project's `compactPrepare` setting in force (its settings view), else SAVE_FROM.
export function prepareAt(project) {
  try {
    const view = JSON.parse(fs.readFileSync(path.join(wheelhouseHome(), 'projects', project, 'views', 'settings.json'), 'utf8'));
    const value = view?.compactPrepare?.value;
    if (Number.isInteger(value) && value >= 100000 && value <= 290000) return value;
  } catch {
    // No settings view yet: the default.
  }
  return SAVE_FROM;
}

const count = (v) => (Number.isFinite(v) && v >= 0 ? v : null);

// The last assistant entry's input_tokens + cache_read_input_tokens +
// cache_creation_input_tokens, from the end of the file; null if unreadable.
export function contextSize(transcriptPath) {
  const entries = readTailEntries(transcriptPath);
  if (entries === null) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type === 'system' && entry.subtype === 'compact_boundary') return null;
    if (entry?.isSidechain === true) continue;
    if (entry?.type !== 'assistant' && entry?.message?.role !== 'assistant') continue;
    if (entry.message?.model === '<synthetic>') continue;
    const u = entry.message?.usage;
    const parts = [u?.input_tokens, u?.cache_read_input_tokens, u?.cache_creation_input_tokens].map(count);
    if (parts.some((p) => p === null)) continue;
    return parts[0] + parts[1] + parts[2];
  }
  return null;
}

// The project's name for a folder, by .git files first and then by path alone.
export function projectNameOf(cwd, dir) {
  const found = projectOf(cwd, { dir });
  if (found) return found.project;
  if (registeredByPath(cwd)) return projectForFolder(fs.realpathSync.native(cwd))?.project ?? null;
  return null;
}

// <wheelhouse home>/projects/<project>/sessions/<id>.json; null for an id outside
// [A-Za-z0-9_-] or longer than 128 characters, which gets no stored reading.
export function sessionFile(project, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  return path.join(wheelhouseHome(), 'projects', project, 'sessions', `${id}.json`);
}

export function readSession(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// Merges fields into the session file, written whole to a temporary name and renamed.
export function updateSession(file, fields) {
  const next = { ...readSession(file), ...fields };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID().slice(0, 12)}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(next)}\n`, { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export async function decide(input, { dir, now = () => new Date() } = {}) {
  if (typeof input.cwd !== 'string') return undefined;
  const project = projectNameOf(input.cwd, dir);
  if (project === null) return undefined;
  const tokens = contextSize(input.transcript_path);
  if (tokens === null) return undefined;
  const file = sessionFile(project, input.session_id);
  if (file !== null) {
    try {
      updateSession(file, { tokens, at: now().toISOString() });
    } catch {
      // The line is still worth saying.
    }
  }
  const text = `Context: about ${Math.floor(tokens / 1000)}k tokens.`;
  return answer.context('UserPromptSubmit', tokens >= prepareAt(project) ? `${text} ${SAVE_NOTE}` : text);
}

// Read at most once every five seconds per session on a tool call.
export const TOOL_READ_MS = 5000;

// PostToolUse: speaks once per episode, the first time the context is at or past the prepare point,
// and records `preparedAt` in the session file (a compaction resets it). Cheap when it has nothing to say:
// a session already prepared, or read within the last five seconds, costs one small file read.
export function prepareOnToolUse(input, { dir, now = () => new Date() } = {}) {
  try {
    if (typeof input?.cwd !== 'string') return undefined;
    const project = projectNameOf(input.cwd, dir);
    if (project === null) return undefined;
    const file = sessionFile(project, input.session_id);
    if (file === null) return undefined;
    const session = readSession(file);
    if (session.preparedAt !== undefined) return undefined;
    const nowMs = now().getTime();
    const last = Date.parse(session.at);
    if (Number.isFinite(last) && nowMs >= last && nowMs - last < TOOL_READ_MS) return undefined;
    const tokens = contextSize(input.transcript_path);
    if (tokens === null) return undefined;
    const due = tokens >= prepareAt(project);
    updateSession(file, { tokens, at: now().toISOString(), ...(due ? { preparedAt: now().toISOString() } : {}) });
    if (!due) return undefined;
    return answer.context('PostToolUse', `Context is about ${Math.floor(tokens / 1000)}k tokens. Finish this step, commit, write your session note, then carry on.`);
  } catch {
    return undefined;
  }
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: false, event: 'UserPromptSubmit' });
}
