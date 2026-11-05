// scripts/hooks/front-desk-writes.js
// Before each file-writing tool (Write, Edit, MultiEdit, NotebookEdit) in the front desk's chat: refuses a write to the
// product's own files. The front desk records a plan or a piece of work and asks a card; the builders make the change in
// their own folders. A weaker model may otherwise answer a yes by writing the product itself, with no plan and no review.
//
// The front desk is the session whose folder is the registered project's own checkout and whose role is the front desk.
// Everything else is left alone: a folder that is not a set-up project, a project still being set up (setup writes
// its own files), a build engine step, the foreman, a feature session, and any folder with a checkout of its own (an
// engine worktree, a job folder). So are files outside the project's folder, and `.wheelhouse/` inside it, where the
// front desk keeps its briefs and the JSON it hands to its command. When the hook can't tell, it allows.
import fs from 'node:fs';
import path from 'node:path';
import { answer, runAndExit, projectOf, beingSetUp, worktreeRoot, sameFolder } from './kit.js';
import { sessionRole } from '../lib/role.js';
import { ownRun } from '../protection/archon.js';
import { startedAsScript } from '../lib/started-as-script.js';

export const WRITING = Object.freeze({ Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' });
// The folder in the project the front desk may write to.
export const OWN_FOLDER = '.wheelhouse';

export const FRONT_DESK_NO_WRITES = (file) => `Wheelhouse does not let the front desk write the product's own files (${file}). `
  + 'Record the change through intake as a plan or work and ask its card; the builders make the change. '
  + `Your briefs and notes go in ${OWN_FOLDER}/work/<id>.md.`;

// The real path of `file`, which may not exist yet: its nearest folder that does, with the rest after it.
function realPath(file) {
  const resolved = path.resolve(file);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    const parent = path.dirname(resolved);
    return parent === resolved ? resolved : path.join(realPath(parent), path.basename(resolved));
  }
}
const caseBlind = process.platform === 'win32' || process.platform === 'darwin';
const keyOf = (p) => (caseBlind ? p.toLowerCase() : p);
const inside = (folder, file) => {
  const base = keyOf(realPath(folder));
  const target = keyOf(realPath(file));
  return target === base || target.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
};

// The hook's answer: undefined to let the tool run.
export function decide(input, { env = process.env, find = projectOf, setUp = beingSetUp, role = sessionRole } = {}) {
  const field = WRITING[input?.tool_name];
  const given = field === undefined ? undefined : input?.tool_input?.[field];
  if (typeof given !== 'string' || given === '' || typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd)) return undefined;
  if (ownRun(env) !== null) return undefined;
  const found = find(input.cwd);
  if (!found?.record?.folder) return undefined;
  if (setUp(input.cwd) !== null) return undefined;
  if (role({ sessionId: input.session_id, env, cwd: input.cwd }) !== 'front-desk') return undefined;
  // Only the project's own checkout: a folder with a checkout of its own is a worktree or a job folder.
  const root = worktreeRoot(input.cwd);
  if (root === null || !sameFolder(root, found.record.folder)) return undefined;
  const file = path.resolve(input.cwd, given);
  if (!inside(found.record.folder, file)) return undefined;
  if (inside(path.join(found.record.folder, OWN_FOLDER), file)) return undefined;
  return answer.deny(FRONT_DESK_NO_WRITES(path.relative(realPath(found.record.folder), realPath(file)).split(path.sep).join('/')));
}

if (startedAsScript(import.meta.url)) await runAndExit(decide, { failClosed: false, event: 'PreToolUse' });
