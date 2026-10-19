// scripts/briefing/seen.js
// When the director was last seen in a project: `promptAt`, their last message, `briefedAt`,
// the last briefing they were given, and `weeklyAt`, the last briefing that showed them the lines
// it repeats once a week (Unattended build commands on Windows). Kept in
// projects/<project>/seen.json, beside the state clone, and written whole (a temporary file in the
// same folder, then a rename).
//
// Reading never throws. A damaged file reads as no times, and so does a field that isn't a time
// as toISOString writes it, or a time after now, which this computer's clock can't have written.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';

const FIELDS = ['promptAt', 'briefedAt', 'weeklyAt'];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const none = () => Object.fromEntries(FIELDS.map((field) => [field, null]));

// The file for a project; throws for a name that can't be a project's.
export function seenFile(project) {
  return path.join(path.dirname(stateDir(project)), 'seen.json');
}

// The time as toISOString writes it, or null. A Date counts too.
function timeText(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return null;
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === value ? value : null;
}

function nowMs(now) {
  try {
    const value = typeof now === 'function' ? now() : now;
    const ms = value === undefined ? Date.now() : new Date(value).getTime();
    return Number.isFinite(ms) ? ms : NaN;
  } catch {
    return NaN;
  }
}

// The times as written, each null when it isn't one; all null when the file can't be read.
function readKept(project) {
  try {
    const kept = JSON.parse(fs.readFileSync(seenFile(project), 'utf8'));
    if (!isRecord(kept)) return none();
    return Object.fromEntries(FIELDS.map((field) => [field, timeText(kept[field])]));
  } catch {
    return none();
  }
}

// readSeen(project, { now }) -> { promptAt, briefedAt, weeklyAt }, each a time or null. With a
// clock that can't be read, no time counts as after it.
export function readSeen(project, { now } = {}) {
  const kept = readKept(project);
  const limit = nowMs(now);
  return Object.fromEntries(FIELDS.map((field) => {
    const value = kept[field];
    return [field, value !== null && Number.isFinite(limit) && Date.parse(value) > limit ? null : value];
  }));
}

// markSeen(project, { promptAt, briefedAt, weeklyAt }): writes the times given, keeping the others as they were.
// A value that isn't a time is not written.
export function markSeen(project, times = {}) {
  const file = seenFile(project);
  const next = readKept(project);
  for (const field of FIELDS) {
    const value = timeText(isRecord(times) ? times[field] : undefined);
    if (value !== null) next[field] = value;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}
