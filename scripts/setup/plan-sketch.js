// scripts/setup/plan-sketch.js
// What a long step's process needs to say what changed when its list differs from the one the click
// named (scripts/setup/run-step.js). The helper keeps, beside the step's hash, a sketch of the list
// the hash was made from: each entry's kind, action and target, and for each other field its name
// and a salted digest of its value. A value may hold an address or a secret, so no value is kept,
// and what the process says names fields, never values. The sketch is removed when the step ends.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../lib/canonical.js';
import { hide } from '../lib/clean.js';
import { wheelhouseHome } from '../lib/paths.js';

const IDENTITY = ['kind', 'action', 'target'];
const MOST_NAMED = 3;
const MOST_DETAIL_CHARS = 1000;

// What the director is told an item is, by its kind and action; any other is told by its target.
const PLAIN = {
  'host:sign-in': 'GitLab sign-in',
  'host:certificate': 'GitLab certificate',
  'host:connection': 'connection',
  'host:key-card': 'sign-in key',
  'json-key': 'settings file',
  'file:gitlab-hosts': 'settings file',
};

const sketchFile = (runId, step) => path.join(wheelhouseHome(), 'step-plans', `${runId}-${step}.json`);
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

// Keeps the sketch of the list `hash` names for this run's step. Whether it was kept does not
// matter to the step: without it the failure just says less.
export function writeSketch(runId, step, hash, changes) {
  let temp = null;
  try {
    const file = sketchFile(runId, step);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ hash, ...sketchOf(changes) }), { mode: 0o600 });
    fs.renameSync(temp, file);
    temp = null;
  } catch { /* the failure line then says only that the list changed */ }
  if (temp !== null) fs.rmSync(temp, { force: true });
}

// The sketch kept for this run's step, when it is of the list `hash` names; otherwise null.
export function readSketch(runId, step, hash) {
  try {
    const got = JSON.parse(fs.readFileSync(sketchFile(runId, step), 'utf8'));
    return got?.hash === hash && typeof got.salt === 'string' && Array.isArray(got.entries) ? got : null;
  } catch {
    return null;
  }
}

// The step has ended, so its sketch is not wanted.
export function removeSketch(runId, step) {
  try {
    fs.rmSync(sketchFile(runId, step), { force: true });
  } catch { /* a leftover is written over by the next click */ }
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

const parts = (diff, say) => [
  ...diff.added.map((e) => say.added(e)),
  ...diff.removed.map((e) => say.removed(e)),
  ...diff.changed.map((c) => say.changed(c)),
];

const plainOf = (entry) => {
  const mapped = PLAIN[`${entry.kind}:${entry.action}`] ?? PLAIN[entry.kind];
  return mapped ?? (typeof entry.target === 'string' ? hide(entry.target, []) : 'an item');
};

const technical = (entry) => [entry.kind ?? 'entry', entry.action, typeof entry.target === 'string' ? hide(entry.target, []) : undefined]
  .filter((x) => typeof x === 'string').join(' ');

// For the director, in plain words: what is different, as up to MOST_NAMED parts and a count of the
// rest, or '' when the sketches agree.
export function sayDifference(before, after) {
  const listed = parts(differences(before.entries, after.entries), {
    added: (e) => `one more item (${plainOf(e)})`,
    removed: (e) => `one item no longer needed (${plainOf(e)})`,
    changed: ({ entry }) => `one item with new details (${plainOf(entry)})`,
  });
  if (listed.length === 0) return '';
  const more = listed.length > MOST_NAMED ? `, and ${listed.length - MOST_NAMED} more` : '';
  return `${listed.slice(0, MOST_NAMED).join('; ')}${more}`;
}

// For agents: the exact kind, action and target of each entry, and for a changed one the names of
// its fields that differ. Never a value.
export function detailOf(before, after) {
  const listed = parts(differences(before.entries, after.entries), {
    added: (e) => `added ${technical(e)}`,
    removed: (e) => `removed ${technical(e)}`,
    changed: ({ entry, names }) => `changed ${technical(entry)} (fields: ${names.join(', ')})`,
  });
  return listed.join('; ').slice(0, MOST_DETAIL_CHARS);
}

// What a step that no longer has a list says in its place: in plain words for the director, and for
// agents the exact thing, with the question's id.
export function sayNoList(got) {
  if (got?.ask !== undefined) return { plain: 'the step now needs an answer from you first', detail: `the step asked a question again (id ${hide(String(got.ask.id), [])})` };
  if (got?.wait !== undefined) return { plain: 'the step now has to wait for something else first', detail: 'the step asked to wait again' };
  if (got?.settled !== undefined) return { plain: 'the step has nothing left to do', detail: 'the step settled without a list' };
  return { plain: 'the step has nothing left to do', detail: 'the step gave no list' };
}
