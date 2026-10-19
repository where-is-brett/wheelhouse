// scripts/lib/role.js
// Which part a session plays: the foreman, a feature session or the front desk. It decides only
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
import { featureSlug } from '../hooks/session-start.js';
import { FOREMAN_PROMPT_LEAD } from '../foreman/start.js';
import { ROLE_VARIABLE } from '../watcher/waker.js';

export const ROLES = Object.freeze(['foreman', 'front-desk', 'feature']);

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

// 'foreman', 'feature' or 'front-desk'. `prompt` counts only while no role is recorded, that is,
// for the session's first prompt; `cwd` is the session's folder.
export function sessionRole({ sessionId, env = process.env, prompt, cwd } = {}) {
  if (env?.[ROLE_VARIABLE] === 'foreman') return 'foreman';
  const kept = recorded(sessionId);
  if (kept !== null) return kept;
  if (typeof prompt === 'string' && prompt.startsWith(FOREMAN_PROMPT_LEAD)) return 'foreman';
  if (featureSlug(cwd) !== null) return 'feature';
  return 'front-desk';
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
