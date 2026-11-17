// scripts/setup/plan-sketch.js
// What the helper hands a long step's process (scripts/setup/run-step.js), kept for one click of one
// step: the list the click named, with its hash, and a sketch of it. The process applies that list
// when it has the hash the click named, so facts the plan reads from the network or the clock, which
// can answer differently a few seconds later in another process, never change what the director
// clicked on. When there is no such file the process works the list out again, and if that list
// differs the sketch lets it say what changed: each entry's kind, action and target, and for each
// other field its name and a salted digest of its value. What is said names fields, never values.
// The file is for its owner only and is removed when the step ends.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../lib/canonical.js';
import { hide } from '../lib/clean.js';
import { wheelhouseHome } from '../lib/paths.js';
import { STEP_TIMEOUT_MS } from '../lib/setup-numbers.js';

const IDENTITY = ['kind', 'action', 'target'];
const MOST_NAMED = 3;
const MOST_DETAIL_CHARS = 1000;
const MOST_TARGET_CHARS = 120;
const SOMETHING = 'a setup item';

// What the director is told an item is, by its kind and action. A path or an address is never told.
const PLAIN = {
  'host:sign-in': '{host} sign-in',
  'host:certificate': '{host} certificate',
  'host:connection': '{host} link',
  'host:key-card': 'sign-in key',
  'host:repository': 'project on {host}',
  'host:join': 'project to join on {host}',
  'host:own-app': 'your own GitHub app',
  'host:own-app-again': 'your own GitHub app',
  'folder:connect': 'link from this folder to your project',
  'folder:checkout': 'copy of your project in this folder',
  'folder:state': 'project record',
  'file:project': 'project record',
  'file:gitlab-hosts': 'settings file',
  'json-key': 'settings file',
};

// The folder of these files, which uninstall removes.
export const stepPlansDir = () => path.join(wheelhouseHome(), 'step-plans');
const sketchFile = (runId, step, clickedAt) => path.join(stepPlansDir(), `${runId}-${step}-${Date.parse(clickedAt)}.json`);
const nameOf = (entry) => IDENTITY.map((k) => (typeof entry?.[k] === 'string' ? entry[k] : '')).join('\u0000');

// The sketch of a list of changes: a salt, and each entry's name and its fields' digests.
export function sketchOf(changes, salt = crypto.randomBytes(16).toString('hex')) {
  const digest = (value) => crypto.createHash('sha256').update(salt + canonicalJson(value ?? null)).digest('hex').slice(0, 12);
  return {
    salt,
    entries: changes.map((c) => {
      const fields = {};
      for (const [name, value] of Object.entries(c ?? {})) if (!IDENTITY.includes(name)) fields[name] = digest(value);
      return { kind: c?.kind, action: c?.action, target: c?.target, fields };
    }),
  };
}

// Keeps the list `hash` names, and its sketch, for this click of the run's step, after removing
// files left by clicks older than a step may take. Whether it was kept does not matter to the step:
// without it the process works the list out again. Gives '' when it was kept, else a short plain
// reason, which the helper tells the process.
export function writeSketch(runId, step, clickedAt, hash, changes) {
  let temp = null;
  let failure = '';
  try {
    const file = sketchFile(runId, step, clickedAt);
    const dir = path.dirname(file);
    // The folder is the user's own, a real folder and not a link to one.
    if (fs.existsSync(dir)) {
      const found = fs.lstatSync(dir);
      if (!found.isDirectory() || (process.platform !== 'win32' && found.uid !== process.getuid())) throw new Error('the folder is not the user\'s own');
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    sweep(dir);
    temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ hash, changes, ...sketchOf(changes) }), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
    temp = null;
  } catch (error) {
    failure = safe(error?.code ?? error?.message ?? 'unknown').slice(0, 60);
  }
  if (temp !== null) {
    try {
      fs.rmSync(temp, { force: true });
    } catch { /* a leftover temporary file is removed with the folder */ }
  }
  return failure;
}

// Removes what clicks older than a step may take left behind: a process that was ended before it
// could remove its own file.
function sweep(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch { /* nothing to sweep */ }
  for (const name of names) {
    try {
      const file = path.join(dir, name);
      if (Date.now() - fs.statSync(file).mtimeMs > STEP_TIMEOUT_MS) fs.rmSync(file, { force: true });
    } catch { /* it goes at the next click or at uninstall */ }
  }
}

// What was kept for this click, when it is of the list `hash` names; otherwise null.
export function readSketch(runId, step, clickedAt, hash) {
  try {
    const got = JSON.parse(fs.readFileSync(sketchFile(runId, step, clickedAt), 'utf8'));
    return got?.hash === hash && typeof got.salt === 'string' && Array.isArray(got.entries) && Array.isArray(got.changes) ? got : null;
  } catch {
    return null;
  }
}

// This click's file is not wanted any more. A later click has a file of its own, so this never
// removes it.
export function removeSketch(runId, step, clickedAt) {
  try {
    fs.rmSync(sketchFile(runId, step, clickedAt), { force: true });
  } catch { /* a leftover is removed with the folder at uninstall */ }
}

// How the entries of `after` differ from those of `before`: first the entries whose whole sketch is
// the same are paired, then the rest by name (kind, action and target), in order. What is left of
// `after` is added, what is left of `before` removed, and a pair by name whose fields differ is
// changed, with the names of those fields.
export function differences(before, after) {
  const whole = (e) => JSON.stringify([nameOf(e), Object.entries(e.fields ?? {}).sort()]);
  const left = new Map();
  before.forEach((e, i) => left.set(whole(e), [...(left.get(whole(e)) ?? []), i]));
  const used = new Set();
  const unpaired = [];
  after.forEach((e, i) => {
    const same = left.get(whole(e))?.shift();
    if (same === undefined) unpaired.push(i);
    else used.add(same);
  });
  const rest = before.map((e, i) => i).filter((i) => !used.has(i));
  const added = [];
  const changed = [];
  for (const i of unpaired) {
    const e = after[i];
    const at = rest.findIndex((j) => nameOf(before[j]) === nameOf(e));
    if (at === -1) {
      added.push(e);
      continue;
    }
    const [j] = rest.splice(at, 1);
    const names = [...new Set([...Object.keys(before[j].fields ?? {}), ...Object.keys(e.fields ?? {})])]
      .filter((k) => before[j].fields?.[k] !== e.fields?.[k]).sort();
    changed.push({ entry: e, names });
  }
  return { added, removed: rest.map((j) => before[j]), changed };
}

// A host's name is a service's (GitLab, GitHub), never an address.
const serviceOf = (target) => (target === 'gitlab' ? 'GitLab' : target === 'github' ? 'GitHub' : 'the host');
const plainOf = (entry) => (PLAIN[`${entry.kind}:${entry.action}`] ?? PLAIN[entry.kind] ?? SOMETHING).replace('{host}', serviceOf(entry.target));

// Only plain characters of a target go to a journal line: anything else is a question mark.
const safe = (text) => String(text).replace(/[^A-Za-z0-9 _.,/\\:~@+=-]/g, '?').slice(0, MOST_TARGET_CHARS);
const technical = (entry) => [safe(entry.kind ?? 'entry'), typeof entry.action === 'string' ? safe(entry.action) : undefined, typeof entry.target === 'string' ? safe(hide(entry.target, [])) : undefined]
  .filter((x) => typeof x === 'string').join(' ');

// For the director, in plain words: what is different, repeats grouped ("3 more items (GitLab
// certificate)"), the first MOST_NAMED groups and a count of the rest; '' when the sketches agree.
export function sayDifference(before, after) {
  const { added, removed, changed } = differences(before.entries, after.entries);
  const groups = new Map();
  const add = (kind, entry) => {
    const key = `${kind}|${plainOf(entry)}`;
    groups.set(key, { kind, plain: plainOf(entry), count: (groups.get(key)?.count ?? 0) + 1 });
  };
  added.forEach((e) => add('added', e));
  removed.forEach((e) => add('removed', e));
  changed.forEach(({ entry }) => add('changed', entry));
  const words = { added: ['one more item', 'more items'], removed: ['one item no longer needed', 'items no longer needed'], changed: ['one item with new details', 'items with new details'] };
  const listed = [...groups.values()].map(({ kind, plain, count }) => `${count === 1 ? words[kind][0] : `${count} ${words[kind][1]}`} (${plain})`);
  if (listed.length === 0) return '';
  const more = listed.length > MOST_NAMED ? `, and ${listed.length - MOST_NAMED} more` : '';
  return `${listed.slice(0, MOST_NAMED).join('; ')}${more}`;
}

// For agents: the exact kind, action and target of each entry, and for a changed one the names of
// its fields that differ. Never a value. When the sketches agree but the hashes do not, it says so.
export function detailOf(before, after) {
  const diff = differences(before.entries, after.entries);
  const listed = [
    ...diff.added.map((e) => `added ${technical(e)}`),
    ...diff.removed.map((e) => `removed ${technical(e)}`),
    ...diff.changed.map(({ entry, names }) => `changed ${technical(entry)} (fields: ${names.map(safe).join(', ')})`),
  ];
  if (listed.length === 0) return 'same items; order or a detail outside the sketch differs';
  return listed.join('; ').slice(0, MOST_DETAIL_CHARS);
}

// What a step that no longer has a list says in its place: in plain words for the director, whether
// opening setup again helps, and for agents the exact thing, with the question's id.
export function sayNoList(got) {
  if (got?.ask !== undefined) return { plain: 'the step now needs an answer from you first', again: true, detail: `the step asked a question again (id ${safe(hide(String(got.ask.id), []))})` };
  if (got?.wait !== undefined) return { plain: 'the step now has to wait for something else first', again: true, detail: 'the step asked to wait again' };
  if (got?.settled !== undefined) return { plain: 'the step has nothing left to do', again: false, detail: 'the step settled without a list' };
  return { plain: 'the step has nothing left to do', again: false, detail: 'the step gave no list' };
}
