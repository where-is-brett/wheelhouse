// scripts/survey/ready-record.js
// The ready record (ruling P4): what the helper made ready for a piece of work to start from, a
// commit it fetched or built and the ref it put it at. It is kept in Wheelhouse's own folder on
// this computer, out of every agent's reach, so the foreman's start can tell a change the helper
// made ready from a ref an agent made with `git update-ref`. Only the helper's carry-on and
// archive routes write it; the foreman only reads it.
import fs from 'node:fs';
import path from 'node:path';
import { SLUG } from '../lib/build-loop.js';
import { stateDir } from '../lib/paths.js';
import { writeWhole } from '../lib/setup-clicks.js';

const RECORD_BYTES = 4096;
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// What a ready record holds for `work`: the commit, the work's own ref, the request it carries
// on (a whole number, or null) and that request's own head branch (text, or null).
function validRecord(r, work) {
  return isPlain(r) && Object.keys(r).length === 4 && Object.keys(r).every((k) => ['sha', 'ref', 'request', 'branch'].includes(k))
    && typeof r.sha === 'string' && /^[0-9a-f]{40}$/.test(r.sha)
    && r.ref === `refs/wheelhouse/from/${work}`
    && (r.request === null || (Number.isInteger(r.request) && r.request >= 1))
    && (r.branch === null || (typeof r.branch === 'string' && r.branch !== '' && !/[\0-\x1f]/.test(r.branch)));
}

// The record's file: <home>/projects/<project>/ready/<work>.json. Throws on a project or work
// name that could lead out of that folder.
export function readyRecordFile(project, work) {
  const projectDir = path.dirname(stateDir(project));
  if (typeof work !== 'string' || !SLUG.test(work)) throw new Error('A ready record needs a work id that is a short slug');
  return path.join(projectDir, 'ready', `${work}.json`);
}

// Writes the record whole, by a temporary file and a rename. Throws on a record of another shape.
export function writeReadyRecord(project, work, record) {
  if (!validRecord(record, work)) throw new Error('A ready record needs a full commit, the work\'s own ref, a request number or null and a branch or null');
  const { sha, ref, request, branch } = record;
  writeWhole(readyRecordFile(project, work), `${JSON.stringify({ v: 1, work, sha, ref, request, branch }, null, 2)}\n`);
}

// The record for `work` as `{ sha, ref, request, branch }`, or null when there is none, it is
// not a regular file (a link is never followed), or it is anything other than a whole record.
export function readReadyRecord(project, work) {
  const file = readyRecordFile(project, work);
  let text;
  let fd = null;
  try {
    if (!fs.lstatSync(file).isFile()) return null;
    // Opened without following a link where the system allows it, and checked again once open.
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > RECORD_BYTES) return null;
    text = fs.readFileSync(fd, 'utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  let kept;
  try {
    kept = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlain(kept) || kept.v !== 1 || kept.work !== work) return null;
  const { v: _v, work: _work, ...record } = kept;
  return validRecord(record, work) ? record : null;
}
