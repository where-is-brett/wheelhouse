// scripts/lib/role.js
// Which part a session plays: the foreman, a feature session, the front desk or an aside. It decides only
// what a session is shown, never what it may do.
//
// The foreman has WHEELHOUSE_ROLE=foreman, or a first prompt that begins with the foreman's wake
// line (a foreman started without an environment of its own gets only that). The board-context
// hook sees each session's first prompt and records the role it gives in
// sessions/<sessionId>/role.json under the Wheelhouse home, once, so a later prompt with the same
// words changes nothing, and the session start, the usage records and the mod read it back.
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from './paths.js';
import { madeFeatureSlug } from '../hooks/session-start.js';
import { projectOf, worktreeRoot } from '../hooks/kit.js';
import { readSeat } from './first-mate-seat.js';
import { FOREMAN_PROMPT_LEAD } from '../foreman/start.js';
import { ROLE_VARIABLE } from '../watcher/waker.js';

export const ROLES = Object.freeze(['foreman', 'front-desk', 'feature', 'why', 'aside']);
// The command that makes a window an ordinary session, never the First Mate.
export const ASIDE_COMMAND = '/wheelhouse:aside';

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

// The session's record, or null when its id can't name a folder safely.
export function roleFile(sessionId) {
  if (typeof sessionId !== 'string' || !SAFE_ID.test(sessionId) || /^\.+$/.test(sessionId)) return null;
  return path.join(wheelhouseHome(), 'sessions', sessionId, 'role.json');
}

// The role recorded for the session, or null when none is, or the record can't be read.
function recorded(sessionId) {
  const file = roleFile(sessionId);
  if (file === null) return null;
  try {
    const role = JSON.parse(fs.readFileSync(file, 'utf8'))?.role;
    return ROLES.includes(role) ? role : null;
  } catch {
    return null;
  }
}

// Whether `cwd` is in a linked worktree: the nearest `.git` is a file, not a folder.
function inLinkedWorktree(cwd) {
  try {
    const root = worktreeRoot(cwd);
    return root !== null && fs.lstatSync(path.join(root, '.git')).isFile();
  } catch {
    return false;
  }
}

// 'worktree' or 'main': which aside line a session gets, by where it stands.
export function asideKind({ cwd } = {}) {
  return inLinkedWorktree(cwd) ? 'worktree' : 'main';
}

// Whether the session chose, or stands where it is, an aside: the aside command as the prompt, or a
// linked worktree that isn't a made feature. A seat held by another session is not a choice, so it is
// not recorded.
export function asideByChoice({ prompt, cwd } = {}) {
  if (typeof prompt === 'string' && prompt.startsWith(ASIDE_COMMAND)) return true;
  return inLinkedWorktree(cwd);
}

// What the seat says of a session that is nothing else: the front desk when it holds the seat or the
// seat is free, an aside when another session holds it. Only reads. With no session id or no project
// there is no seat to judge by, so the front desk.
function seatRole({ sessionId, cwd, seat }) {
  if (typeof sessionId !== 'string' || sessionId === '') return 'front-desk';
  let held = seat;
  if (held === undefined) {
    try {
      const found = projectOf(cwd);
      held = found ? readSeat(found.project) : null;
    } catch {
      held = null;
    }
  }
  if (held === null || typeof held?.session !== 'string' || held.session === '') return 'front-desk';
  return held.session === sessionId ? 'front-desk' : 'aside';
}

// 'foreman', 'feature', 'why', 'aside' or 'front-desk'. `prompt` counts only while no role is recorded, that is,
// for the session's first prompt; `cwd` is the session's folder; `seat` is the First Mate's seat (read from the
// cwd's project when not given). A why session (a read-only copy that explains a decision) is known by its
// environment alone, before anything recorded or any folder is looked at. A recorded front desk does not
// outrank the seat, since a take-over moves the seat without rewriting the old window's record.
export function sessionRole({ sessionId, env = process.env, prompt, cwd, seat } = {}) {
  if (env?.[ROLE_VARIABLE] === 'why') return 'why';
  if (env?.[ROLE_VARIABLE] === 'foreman') return 'foreman';
  const kept = recorded(sessionId);
  if (kept !== null && kept !== 'front-desk') return kept;
  // The wake line counts only while no role is recorded, so a recorded front desk is not turned foreman by later words.
  if (kept === null && typeof prompt === 'string' && prompt.startsWith(FOREMAN_PROMPT_LEAD)) return 'foreman';
  if (madeFeatureSlug(cwd) !== null) return 'feature';
  if (asideByChoice({ prompt, cwd })) return 'aside';
  return seatRole({ sessionId, cwd, seat });
}

// Records the session's role unless one is recorded already: true when it wrote it.
export function recordRole(sessionId, role) {
  const file = roleFile(sessionId);
  if (file === null || !ROLES.includes(role)) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ role })}\n`, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}
