// scripts/setup/journal.js
// The journal of setup: every change it makes, with the value before it, and when each
// step's card was shown, clicked and finished. Uninstall reads it to put back exactly what
// setup changed, and only what nobody has changed since. The timed runs read it too.
//
//   Change = {
//     id: string,
//     step: number,
//     kind: 'json-key' | 'file' | 'folder' | 'process' | 'host' | 'locked' | 'env',
//     target: string,        a file or folder path, an environment variable, or a host object
//     key?: string[],        json-key: the path of the key inside the file
//     before: unknown | null,  what it held before setup (null: it was absent, or held null)
//     absent?: true,         json-key: the key was not there before setup (before is then null)
//     after: unknown,        what setup wrote
//     project?: string,
//   }
//
//   Journal = { v: 1, runs: Array<{
//     id, folder, project?, startedAt,
//     steps: Record<number, { shownAt?, clickedAt?, doneAt?, failed?: string }>,
//     changes: Change[],
//   }> }
//
// Every write is the whole file: a temporary file beside it, then a rename, so a crash leaves
// the earlier journal whole. A journal that cannot be read is refused, never replaced. The
// journal and its temporary file are for their owner only (mode 0o600), as the clicks are.
// Every writer reads, changes and writes under a lock file beside the journal
// (journal.json.lock, taken with an exclusive create), so the helper and a long step's
// child writing together lose nothing. A writer waits up to LOCK_WAIT_MS for it; a lock
// older than LOCK_STALE_MS belongs to a process that died and is taken over.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../lib/canonical.js';
import { journalFile, readJournal } from '../lib/setup-run.js';

// The journal's file and its reader are in scripts/lib/setup-run.js, which the hooks read without
// reaching these writers.
export { journalFile, readJournal };

const KINDS = ['json-key', 'file', 'folder', 'process', 'host', 'locked', 'env'];
const STEP_FIELDS = ['shownAt', 'clickedAt', 'doneAt', 'failed'];
const CHANGED = { put: false, why: 'changed since setup' };
const OWN_STEP = { put: false, why: 'put back by its own step' };

// ---- Writing whole files, atomically ----

// A temporary file in the same folder, then a rename. A file that is there keeps its mode,
// unless `mode` is given.
function writeAtomic(file, text, { mode: given } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  let mode = given;
  if (mode === undefined) {
    try {
      mode = fs.statSync(file).mode & 0o777;
    } catch {
      mode = undefined;
    }
  }
  try {
    const fd = fs.openSync(temp, 'w', mode);
    try {
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (mode !== undefined) fs.chmodSync(temp, mode);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// Where a write to `file` should land: the file a link points to, so the link stays a link.
function writePath(file) {
  try {
    return fs.realpathSync.native(file);
  } catch {
    return file;
  }
}

// The time as UTC ISO 8601, from a `now` that is a function, a Date or a text.
function stamp(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('A time is needed to record this');
  return date.toISOString();
}

// ---- The journal ----

function writeJournal(journal) {
  writeAtomic(journalFile(), `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
}

const LOCK_STALE_MS = 5000;
const LOCK_WAIT_MS = 10000;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Holds the journal's lock while `work` runs. Synchronous: it waits by sleeping. A lock that
// is old is renamed to a name of its own and removed, so only one waiter takes it over, and a
// lock someone has just made in its place is put back.
function withLock(work) {
  const lock = `${journalFile()}.lock`;
  const token = `${process.pid}.${crypto.randomBytes(6).toString('hex')}\n`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.writeFileSync(lock, token, { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    }
    try {
      const seen = fs.readFileSync(lock, 'utf8');
      if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
        const taken = `${lock}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.stale`;
        fs.renameSync(lock, taken);
        if (fs.readFileSync(taken, 'utf8') !== seen) {
          try { fs.linkSync(taken, lock); } catch { /* another lock stands */ }
        }
        fs.rmSync(taken, { force: true });
        continue;
      }
    } catch { /* it went away, or another waiter took it over: try again */ }
    if (Date.now() > until) throw new Error(`The setup journal is in use: ${lock} has been held for over ${LOCK_WAIT_MS / 1000} seconds`);
    pause(10);
  }
  try {
    return work();
  } finally {
    // Not removed when it has been taken over meanwhile as stale.
    try {
      if (fs.readFileSync(lock, 'utf8') === token) fs.rmSync(lock, { force: true });
    } catch { /* already gone */ }
  }
}

// Under the lock, reads the journal, lets `change` alter it, writes it whole, and gives back what `change` returned.
function update(change) {
  return withLock(() => {
    const journal = readJournal();
    const result = change(journal);
    writeJournal(journal);
    return result;
  });
}

function runIn(journal, runId) {
  const run = journal.runs.find((r) => r.id === runId);
  if (!run) throw new Error(`There is no setup run ${runId}`);
  return run;
}

export function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(5).toString('hex')}`;
}

// Starts a run for a folder and gives it back. It always starts a new one: use findRun to resume.
export function startRun({ folder, project, now = () => new Date() }) {
  if (typeof folder !== 'string' || folder === '') throw new Error('A setup run needs the folder being set up');
  const run = { id: newId('run'), folder, ...(project === undefined ? {} : { project }), startedAt: stamp(now), steps: {}, changes: [] };
  update((journal) => { journal.runs.push(run); });
  return structuredClone(run);
}

// The latest run for a folder, or null.
export function findRun(folder) {
  const runs = readJournal().runs.filter((r) => r.folder === folder);
  return runs.length ? runs[runs.length - 1] : null;
}

// Records a step's time (field shownAt, clickedAt or doneAt), or that it failed (field
// failed, with `reason`). Recording again replaces the time. A later click or finish
// clears an earlier failure. With `when`, a test of the step's entry as it stands, read under the
// lock, nothing is recorded unless it passes: a long step's process records only for its own
// attempt. True when it was recorded.
export function markStep(runId, step, field, { now = () => new Date(), reason, when } = {}) {
  if (!Number.isInteger(step) || step < 1) throw new Error('A step is a number from 1');
  if (!STEP_FIELDS.includes(field)) throw new Error(`The field to record is one of ${STEP_FIELDS.join(', ')}`);
  if (field === 'failed' && (typeof reason !== 'string' || reason === '')) throw new Error('A failed step needs a reason');
  const at = stamp(now);
  return update((journal) => {
    const run = runIn(journal, runId);
    const entry = run.steps[step] ?? {};
    if (typeof when === 'function' && !when(structuredClone(entry))) return false;
    if (field === 'failed') entry.failed = reason;
    else {
      entry[field] = at;
      if (field !== 'shownAt') delete entry.failed;
    }
    run.steps[step] = entry;
    return true;
  });
}

function checkChange(change, { needStep = true } = {}) {
  if (!change || typeof change !== 'object') throw new Error('A change must be an object');
  if (typeof change.id !== 'string' || change.id === '') throw new Error('A change needs an id');
  if (needStep && (!Number.isInteger(change.step) || change.step < 1)) throw new Error(`Change ${change.id} needs the step that made it`);
  if (!KINDS.includes(change.kind)) throw new Error(`Change ${change.id} has a kind that is not one of ${KINDS.join(', ')}`);
  if (typeof change.target !== 'string' || change.target === '') throw new Error(`Change ${change.id} needs a target`);
  if (!('before' in change) || !('after' in change)) throw new Error(`Change ${change.id} needs its value before and after`);
  if (change.key !== undefined && !(Array.isArray(change.key) && change.key.every((k) => typeof k === 'string'))) {
    throw new Error(`Change ${change.id} has a key that is not a list of names`);
  }
  if (change.absent !== undefined && !(change.absent === true && change.before === null)) {
    throw new Error(`Change ${change.id} says absent only as true, with its value before null`);
  }
}

// Appends changes to a run. A change whose id is already there is refused, so a retry cannot double one.
export function addChanges(runId, changes) {
  if (!Array.isArray(changes)) throw new Error('The changes must be a list');
  changes.forEach((change) => checkChange(change));
  update((journal) => {
    const run = runIn(journal, runId);
    const seen = new Set(run.changes.map((c) => c.id));
    for (const change of changes) {
      if (seen.has(change.id)) throw new Error(`Change ${change.id} is already in the journal`);
      seen.add(change.id);
    }
    run.changes.push(...structuredClone(changes));
  });
}

// ---- Keys inside a JSON file ----

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// An error for a file that is there but is not what setup wrote: reversal reads it as a change since setup.
function notJson(message) {
  return Object.assign(new Error(message), { notJson: true });
}

// The file's content as an object, with what is needed to write it back the way it was.
// A missing file is {}. Anything that is not a JSON object is refused, naming the file.
function readObjectFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { data: {}, indent: 2, eol: '\n', bom: '', newline: true };
    throw error;
  }
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = text.slice(bom.length);
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw notJson(`${file} is not JSON, so setup has left it as it was`);
  }
  if (!isObject(data)) throw notJson(`${file} does not hold a JSON object, so setup has left it as it was`);
  const lead = /^[ \t]+(?=\S)/m.exec(body.slice(body.indexOf('\n') + 1));
  const multiline = body.trim().includes('\n');
  return {
    data,
    indent: lead && multiline ? lead[0] : (multiline ? 2 : 0),
    eol: body.includes('\r\n') ? '\r\n' : '\n',
    bom,
    newline: /\n$/.test(body),
  };
}

function writeObjectFile(file, { data, indent, eol, bom, newline }) {
  let text = JSON.stringify(data, null, indent === 0 ? undefined : indent);
  if (eol === '\r\n') text = text.replaceAll('\n', '\r\n');
  writeAtomic(writePath(file), `${bom}${text}${newline ? eol : ''}`);
}

function checkKey(key) {
  if (!Array.isArray(key) || key.length === 0 || !key.every((k) => typeof k === 'string' && k !== '')) {
    throw new Error('A key is a list of names, at least one');
  }
  if (key.includes('__proto__')) throw new Error('A key may not be named __proto__');
}

// The value at the key path: { found, value }. A path through something that is not an object is not found.
function getAt(data, key) {
  let node = data;
  for (const name of key) {
    if (!isObject(node) || !Object.hasOwn(node, name)) return { found: false };
    node = node[name];
  }
  return { found: true, value: node };
}

// Sets the value at the key path, making the objects on the way. Returns false, changing
// nothing, when something on the way is not an object.
function setAt(data, key, value) {
  let node = data;
  for (const name of key.slice(0, -1)) {
    if (!Object.hasOwn(node, name)) node[name] = {};
    else if (!isObject(node[name])) return false;
    node = node[name];
  }
  node[key[key.length - 1]] = value;
  return true;
}

function deleteAt(data, key) {
  const parent = getAt(data, key.slice(0, -1));
  if (parent.found && isObject(parent.value)) delete parent.value[key[key.length - 1]];
}

// Sets one key in a JSON file, leaving every other key and the file's layout as they were.
// The change it returns has the value before (null, with `absent: true`, when the key was not
// there). A file that is not a JSON object is refused, naming it, never replaced. `record`, when
// given, is called with the change before the file is written, so the journal holds it first;
// if it throws, the file is left as it was. A change recorded whose write then never happened is
// safe to reverse: the file does not hold `after`, so it is left alone.
export function applyJsonKey({ file, key, value, step, project, record }) {
  checkKey(key);
  if (typeof file !== 'string' || file === '') throw new Error('A file is needed');
  if (value === undefined) throw new Error('A value is needed');
  const read = readObjectFile(file);
  const was = getAt(read.data, key);
  const before = was.found ? was.value : null;
  if (!setAt(read.data, key, structuredClone(value))) {
    throw new Error(`${file} holds something that is not an object at ${key.join('.')}, so setup has left it as it was`);
  }
  const change = {
    id: newId('chg'),
    ...(step === undefined ? {} : { step }),
    kind: 'json-key',
    target: file,
    key: [...key],
    before: structuredClone(before),
    ...(was.found ? {} : { absent: true }),
    after: structuredClone(value),
    ...(project === undefined ? {} : { project }),
  };
  if (typeof record === 'function') record(structuredClone(change));
  writeObjectFile(file, read);
  return change;
}

// ---- Putting changes back ----

// A file that could not be read for a reason other than being gone is left alone and the
// reason is given as it is, not passed off as the director's own edit.
function unreadable(target, error) {
  return { put: false, why: `could not read ${target}: ${error.code ?? error.message}` };
}

function reverseJsonKey(change) {
  checkKey(change.key);
  let read;
  try {
    read = readObjectFile(change.target);
  } catch (error) {
    if (error.notJson) return CHANGED; // no longer a JSON object
    return unreadable(change.target, error);
  }
  const now = getAt(read.data, change.key);
  if (!now.found || canonicalJson(now.value) !== canonicalJson(change.after)) return CHANGED;
  if (change.absent === true) deleteAt(read.data, change.key);
  else setAt(read.data, change.key, structuredClone(change.before));
  writeObjectFile(change.target, read);
  return { put: true };
}

function reverseFile(change) {
  let text;
  try {
    text = fs.readFileSync(change.target, 'utf8');
  } catch (error) {
    return error.code === 'ENOENT' ? CHANGED : unreadable(change.target, error);
  }
  if (text !== change.after) return CHANGED;
  if (change.before === null) fs.rmSync(change.target);
  else writeAtomic(writePath(change.target), change.before);
  return { put: true };
}

// A folder setup made is removed only while it is empty.
function reverseFolder(change) {
  if (change.before !== null) return { put: false, why: 'not made by setup' };
  try {
    fs.rmdirSync(change.target);
  } catch {
    return CHANGED; // not empty, or already gone
  }
  return { put: true };
}

// Puts a change back, but only while the thing still holds what setup wrote. Otherwise it is
// left as it is and the reason is given. Kinds whose own step puts them back are not touched here.
export function reverseChange(change) {
  checkChange(change, { needStep: false });
  switch (change.kind) {
    case 'json-key': return reverseJsonKey(change);
    case 'file': return reverseFile(change);
    case 'folder': return reverseFolder(change);
    default: return OWN_STEP;
  }
}

// ---- Times ----

// For each step with its card shown, clicked and finished: the director's time from shown to
// clicked, and the wait from clicked to finished, in milliseconds, in step order.
export function stepTimes(run) {
  const times = [];
  for (const key of Object.keys(run.steps ?? {}).map(Number).sort((a, b) => a - b)) {
    const { shownAt, clickedAt, doneAt } = run.steps[key];
    if (!shownAt || !clickedAt || !doneAt) continue;
    const directorMs = Date.parse(clickedAt) - Date.parse(shownAt);
    const waitMs = Date.parse(doneAt) - Date.parse(clickedAt);
    if (Number.isNaN(directorMs) || Number.isNaN(waitMs)) continue;
    times.push({ step: key, directorMs, waitMs });
  }
  return times;
}
