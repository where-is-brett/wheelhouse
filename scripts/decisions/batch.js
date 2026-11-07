// scripts/decisions/batch.js
// The day's decision records that belong to no piece, as one change (design section 6.6 of the director's way of working). A
// decision about a piece is committed on that piece's branch and merges with the work. One with no piece, or whose piece was
// dropped, has no branch to ride on, so those answered the day before are gathered here into a single change that touches
// docs/decisions/ and nothing else, and so merges itself (scripts/gate/conditions.js, decisionsOnly).
//
//   batchChange(project, decisions, { date, dropped }) -> { branch: 'wheelhouse/decisions-<yyyy-mm-dd>', files: [{ path, text }], ids }
//     project:   { existing } the record files the project already has, as paths, so a new one never takes a used name
//     decisions: [{ id, decision, answer }] as recordFile takes them; `answer.private` keeps one out
//     ids:       the `id` of each decision a file was made from, in the order of `files`
//     date:      the day the change is for, a Date or yyyy-mm-dd
//     dropped:   the pieces that were dropped (ids), whose decisions have no branch left
// Only a decision with no piece, or with a dropped one, is taken; a private answer is never taken. Pure.
import { DECISIONS_DIR, dayOf, recordFile } from './record-file.js';

export const BATCH_BRANCH = /^wheelhouse\/decisions-[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const flat = (x) => (typeof x === 'string' ? x.trim() : '');

export function batchChange(project, decisions, { date, dropped = [] } = {}) {
  const day = typeof date === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) ? date : dayOf(date);
  const gone = new Set(dropped);
  const taken = new Set(Array.isArray(project?.existing) ? project.existing : []);
  const files = [];
  const ids = [];
  for (const { id, decision, answer } of Array.isArray(decisions) ? decisions : []) {
    if (answer?.private === true) continue;
    const piece = flat(decision?.work);
    if (piece !== '' && !gone.has(piece)) continue;
    const file = recordFile(decision, answer, { taken });
    if (!file.path.startsWith(`${DECISIONS_DIR}/`)) continue;
    taken.add(file.path);
    files.push(file);
    ids.push(id);
  }
  return { branch: `wheelhouse/decisions-${day}`, files, ids };
}
