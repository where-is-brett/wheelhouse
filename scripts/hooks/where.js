// scripts/hooks/where.js
// The "where you were" digest: a short block, at most 1,500 characters, that session-start.js adds to
// its reload when a session starts from a compaction (design: docs/specs/2026-11-03-compaction-design.md,
// section 3.1). It is made from records that already exist, so no model writes it: the session's role,
// the feature's ledger, the branch, last commit and uncommitted files (git, one second in all), the
// open cards that carry this session's id (else the waiting list), the running goal, and the session
// note (part 4 writes it) with its age. A piece that can't be read is left out, and nothing here throws.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sessionRole } from '../lib/role.js';
import { goalInForce } from '../engine/goal.js';
import { sessionFile, readSession, updateSession } from './context-gauge.js';

export const WHERE_CHARS = 1500;
export const GIT_MS = 1000;
export const NOTE_CHARS = 1200;
const CARDS_SHOWN = 5;

const oneLine = (value, max = 160) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// One git question for `cwd`, without a shell and within `ms`; null when it fails or runs out of time.
function git(cwd, args, ms, run) {
  if (!(ms > 0)) return null;
  try {
    const got = run('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: ms, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    return got?.status === 0 && typeof got.stdout === 'string' ? got.stdout : null;
  } catch {
    return null;
  }
}

// The branch, the last commit's subject and the count of uncommitted files, in one second together.
export function gitLine(cwd, { run = spawnSync, now = Date.now } = {}) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  const end = now() + GIT_MS;
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], end - now(), run)?.trim();
  const subject = git(cwd, ['log', '-1', '--format=%s'], end - now(), run)?.trim();
  const status = git(cwd, ['status', '--porcelain'], end - now(), run);
  const parts = [];
  if (branch) parts.push(`branch ${oneLine(branch, 80)}`);
  if (subject) parts.push(`last commit "${oneLine(subject, 80)}"`);
  if (status !== null) {
    const n = status.split('\n').filter((l) => l.trim() !== '').length;
    parts.push(n === 0 ? 'nothing uncommitted' : `${n} uncommitted file${n === 1 ? '' : 's'}`);
  }
  return parts.length === 0 ? null : `Git: ${parts.join('; ')}`;
}

const ago = (ms) => {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.floor(hours / 24)} days ago`;
};

// <wheelhouse home>/projects/<project>/sessions/<id>.md, next to the gauge's <id>.json.
export function noteFile(project, sessionId) {
  const json = sessionFile(project, sessionId);
  return json === null ? null : `${json.slice(0, -'.json'.length)}.md`;
}

// The session note and its age, or null when there is none or it can't be read.
export function noteLines(project, sessionId, now) {
  try {
    const file = noteFile(project, sessionId);
    if (file === null) return null;
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    const body = fs.readFileSync(file, 'utf8').trim().slice(0, NOTE_CHARS);
    if (body === '') return null;
    return [`Your session note (${path.basename(file)}, written ${ago(now().getTime() - stat.mtimeMs)}):`, body];
  } catch {
    return null;
  }
}

const cardTitle = (data) => {
  const t = data?.title ?? data?.question ?? data?.words ?? data?.value ?? '';
  return typeof t === 'string' ? t : (JSON.stringify(t) ?? '');
};
const cardSession = (data) => [data?.session_id, data?.sessionId, data?.session].find((s) => typeof s === 'string' && s !== '');

function cardLine(views, sessionId) {
  const waiting = Array.isArray(views?.waiting) ? views.waiting : [];
  if (waiting.length === 0) return null;
  const mine = typeof sessionId === 'string' ? waiting.filter((w) => cardSession(w?.data) === sessionId) : [];
  const [heading, list] = mine.length > 0 ? ['Your open cards', mine] : ['Waiting on the director', waiting];
  const shown = list.slice(0, CARDS_SHOWN).map((w) => `${w.id}: ${oneLine(cardTitle(w.data), 60)}`);
  const more = list.length > CARDS_SHOWN ? `; and ${list.length - CARDS_SHOWN} more` : '';
  return `${heading}: ${shown.join('; ')}${more}`;
}

// The digest as text; '' when nothing could be read. `feature` is the feature's slug, `stateRoot` the
// project's record folder. Every piece is read apart, so one failing leaves only itself out.
export function whereDigest({ project, input = {}, views, feature = null, stateRoot, env = process.env, now = () => new Date(), run = spawnSync } = {}) {
  const lines = [];
  const piece = (fn) => {
    try {
      const got = fn();
      if (typeof got === 'string' && got !== '') lines.push(got);
      else if (Array.isArray(got)) lines.push(...got);
    } catch { /* left out */ }
  };
  piece(() => `Where you were, before the compaction (role: ${sessionRole({ sessionId: input.session_id, env, cwd: input.cwd })}):`);
  piece(() => gitLine(input.cwd, { run }));
  piece(() => (feature && stateRoot ? `Feature ledger: ${path.join(stateRoot, 'features', feature, 'ledger.md')}` : null));
  piece(() => {
    const goal = goalInForce(views);
    return goal === null ? null : `Goal running: ${oneLine(goal.id, 60)}${goal.sheet?.title ? ` (${oneLine(goal.sheet.title, 60)})` : ''}; its report is in the Logbook`;
  });
  piece(() => cardLine(views, input.session_id));
  piece(() => noteLines(project, input.session_id, now));
  if (lines.length <= 1) return '';
  const text = lines.join('\n');
  return text.length > WHERE_CHARS ? `${text.slice(0, WHERE_CHARS - 1)}…` : text;
}

// A new episode starts: the gauge's `preparedAt` is cleared when the session file holds one.
export function resetEpisode(project, sessionId) {
  try {
    const file = sessionFile(project, sessionId);
    if (file !== null && readSession(file).preparedAt !== undefined) updateSession(file, { preparedAt: undefined });
  } catch { /* the next warning is simply held back */ }
}
