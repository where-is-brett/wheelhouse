// scripts/update/journal.js
// The update's journal: one file per project under the Wheelhouse home, one entry per step with
// its state, so a job stopped part-way carries on from the first step not done. Also the one lock
// per computer, and the backup of the files an install may change.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from '../lib/paths.js';

export const JOURNAL_SCHEMA = 1;
export const STEPS = ['checks', 'change', 'merged', 'idle', 'backup', 'catalogue', 'installs', 'verify', 'finish', 'done'];
export const STATES = ['todo', 'running', 'done', 'failed'];

const SAFE_PART = /^[A-Za-z0-9._-]+$/;

function updateDir() {
  return path.join(wheelhouseHome(), 'update');
}

function blank() {
  const steps = {};
  for (const name of STEPS) steps[name] = { state: 'todo' };
  return { schema: JOURNAL_SCHEMA, steps };
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH'; // EPERM: the process exists
  }
}

// The lock is one file for the whole computer. A file that can't be read as a lock is taken as
// held, so it is never taken over by mistake; a lock whose process has gone is taken over.
function takeLock(project) {
  const file = path.join(updateDir(), 'lock');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const mine = JSON.stringify({
    pid: process.pid,
    startTime: Math.round(Date.now() - process.uptime() * 1000),
    project,
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.writeFileSync(file, mine, { flag: 'wx' });
      return () => {
        try {
          if (fs.readFileSync(file, 'utf8') === mine) fs.rmSync(file, { force: true });
        } catch { /* already gone */ }
      };
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    }
    let seen;
    try { seen = fs.readFileSync(file, 'utf8'); } catch { continue; } // gone: try again
    let held;
    try { held = JSON.parse(seen); } catch { return null; }
    if (alive(held?.pid)) return null;
    // Rename to a name of its own, so only one waiter takes it over and nobody removes a fresh lock.
    const taken = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.stale`;
    try {
      fs.renameSync(file, taken);
    } catch { continue; }
    if (fs.readFileSync(taken, 'utf8') !== seen) {
      try { fs.linkSync(taken, file); } catch { /* another lock stands */ }
    }
    fs.rmSync(taken, { force: true });
  }
  return null;
}

// Whether a live process holds the update's lock. A lock file that can't be read counts as held.
export function lockHeld() {
  let seen;
  try { seen = fs.readFileSync(path.join(updateDir(), 'lock'), 'utf8'); } catch { return false; }
  try { return alive(JSON.parse(seen)?.pid); } catch { return true; }
}

export function openJournal(project) {
  if (typeof project !== 'string' || !SAFE_PART.test(project) || /^\.+$/.test(project)) {
    throw new Error('A project folder name may use only letters, digits, dots, hyphens and underscores');
  }
  const folder = path.join(updateDir(), project);
  const file = path.join(folder, 'journal.json');

  function read() {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return blank(); }
    let parsed;
    try { parsed = JSON.parse(text); } catch { return blank(); }
    if (parsed?.schema > JOURNAL_SCHEMA) return { newer: true, schema: parsed.schema, steps: parsed.steps ?? {} };
    const state = blank();
    for (const name of STEPS) if (parsed?.steps?.[name]) state.steps[name] = parsed.steps[name];
    for (const key of Object.keys(parsed ?? {})) if (key !== 'steps' && key !== 'schema') state[key] = parsed[key];
    return state;
  }

  function mark(step, state, data) {
    if (!STEPS.includes(step)) throw new Error(`No update step called ${step}`);
    if (!STATES.includes(state)) throw new Error(`No step state called ${state}`);
    const current = read();
    if (current.newer) throw new Error('This journal was written by a newer Wheelhouse; carry on with the newer Wheelhouse');
    const entry = { state, at: new Date().toISOString() };
    if (data !== undefined) entry.data = data;
    current.steps[step] = entry;
    writeAtomic(file, `${JSON.stringify(current, null, 2)}\n`);
    return entry;
  }

  return { read, mark, lock: () => takeLock(project), held: lockHeld, folder };
}

// Copies the files into <journal folder>/backup/, and notes which were not there. A path already
// in the backup keeps its first copy, so running a backup again never overwrites what the update
// has not yet touched with what it has.
export function backup(journal, files) {
  const dir = path.join(journal.folder, 'backup');
  const manifestFile = path.join(dir, 'manifest.json');
  let manifest = { entries: [] };
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { /* none yet */ }
  for (const original of files) {
    const full = path.resolve(original);
    if (manifest.entries.some((e) => e.path === full)) continue;
    const entry = { path: full, saved: null };
    if (fs.existsSync(full)) {
      entry.saved = `${manifest.entries.length}-${path.basename(full)}`;
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(full, path.join(dir, entry.saved));
    }
    manifest.entries.push(entry);
  }
  writeAtomic(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest.entries.length;
}

// Puts back each file byte for byte, and removes one that was not there before.
export function restore(journal) {
  const dir = path.join(journal.folder, 'backup');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { return 0; }
  for (const entry of manifest.entries) {
    if (entry.saved) {
      fs.mkdirSync(path.dirname(entry.path), { recursive: true });
      fs.copyFileSync(path.join(dir, entry.saved), entry.path);
    } else {
      fs.rmSync(entry.path, { force: true });
    }
  }
  return manifest.entries.length;
}
