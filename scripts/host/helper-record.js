// scripts/host/helper-record.js
// The helper's running record, ~/.wheelhouse/helper.json: { pid, startTime, version, root, address, home }. The helper writes it
// once it is listening and removes it when it closes; an update reads it to prove which process is the helper before it
// stops anything. It holds no secret.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { helperRecordFile, wheelhouseHome } from '../lib/paths.js';
import { readSmallText } from '../lib/small-file.js';
import { homeLabel } from '../lib/standard-env.js';

// Writes the record beside its final name, then renames it over, so a reader sees the old one or the new one whole.
// A name that is a link is replaced, never followed.
// `home` is the Wheelhouse home the helper serves, written from `~` when it is under the person's home folder (homeOf reads it).
export function writeHelperRecord({ pid, startTime, version, root, address, home = wheelhouseHome() }) {
  const file = helperRecordFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify({ pid, startTime: startTime ?? null, version: version ?? null, root, address, home: homeLabel(home) })}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch { /* left for the next write */ }
    throw error;
  }
}

// The record, or null when there is none or it is not one.
export function readHelperRecord() {
  try {
    const stat = fs.lstatSync(helperRecordFile());
    if (!stat.isFile()) return null;
    const record = JSON.parse(readSmallText(helperRecordFile()));
    if (!record || typeof record !== 'object' || !Number.isInteger(record.pid) || record.pid < 1) return null;
    return record;
  } catch {
    return null;
  }
}

// Removes the record only when it is this process's own: a newer helper's record is never taken away.
export function removeHelperRecord(pid = process.pid) {
  const record = readHelperRecord();
  if (record?.pid !== pid) return false;
  try { fs.rmSync(helperRecordFile(), { force: true }); return true; } catch { return false; }
}
