// scripts/setup/plan-sketch.js
// What a long step's process needs to say what changed when its list differs from the one the click
// named (scripts/setup/run-step.js). The helper keeps, beside the step's hash, a sketch of the list
// the hash was made from: each entry's kind, action and target, and for each other field its name
// and a short digest of its value. A value may hold an address or a secret, so no value is kept, and
// what the process says names fields, never values.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../lib/canonical.js';
import { hide } from '../lib/clean.js';
import { wheelhouseHome } from '../lib/paths.js';

const IDENTITY = ['kind', 'action', 'target'];
const MOST_NAMED = 3;

const sketchFile = (runId, step) => path.join(wheelhouseHome(), 'step-plans', `${runId}-${step}.json`);
const digest = (value) => crypto.createHash('sha256').update(canonicalJson(value ?? null)).digest('hex').slice(0, 12);
const spelt = (entry) => IDENTITY.map((k) => (typeof entry?.[k] === 'string' ? entry[k] : '')).join('\u0000');

// The sketch of a list of changes.
export function sketchOf(changes) {
  return changes.map((c) => {
    const fields = {};
    for (const [name, value] of Object.entries(c ?? {})) if (!IDENTITY.includes(name)) fields[name] = digest(value);
    return { kind: c?.kind, action: c?.action, target: c?.target, fields };
  });
}

// Keeps the sketch of the list `hash` names for this run's step. Whether it was kept does not
// matter to the step: without it the failure just says less.
export function writeSketch(runId, step, hash, changes) {
  try {
    const file = sketchFile(runId, step);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ hash, entries: sketchOf(changes) }));
    fs.renameSync(temp, file);
  } catch { /* the failure line then says only that the list changed */ }
}

// The sketch kept for this run's step, when it is of the list `hash` names; otherwise null.
export function readSketch(runId, step, hash) {
  try {
    const got = JSON.parse(fs.readFileSync(sketchFile(runId, step), 'utf8'));
    return got?.hash === hash && Array.isArray(got.entries) ? got.entries : null;
  } catch {
    return null;
  }
}

const named = (entry) => {
  const action = typeof entry.action === 'string' ? ` ${entry.action}` : '';
  const target = typeof entry.target === 'string' ? ` ${hide(entry.target, [])}` : '';
  return `${entry.kind ?? 'entry'}${action}${target}`;
};

// The entries of `after` that are not in `before`, the entries of `before` that are not in `after`,
// and for entries in both (same kind, action and target, taken in order) the names of the fields
// whose values differ.
export function differences(before, after) {
  const left = new Map();
  for (const e of before) left.set(spelt(e), [...(left.get(spelt(e)) ?? []), e]);
  const added = [];
  const changed = [];
  for (const e of after) {
    const same = left.get(spelt(e))?.shift();
    if (same === undefined) {
      added.push(e);
      continue;
    }
    const names = [...new Set([...Object.keys(same.fields ?? {}), ...Object.keys(e.fields ?? {})])]
      .filter((k) => same.fields?.[k] !== e.fields?.[k]).sort();
    if (names.length > 0) changed.push({ entry: e, names });
  }
  return { added, removed: [...left.values()].flat(), changed };
}

// Plain words for a product owner about how the list now differs, from the sketches of the list
// the click named and of the list the process just worked out; '' when the sketches agree.
export function sayDifference(before, after) {
  const { added, removed, changed } = differences(before, after);
  const parts = [
    ...added.map((e) => `added ${named(e)}`),
    ...removed.map((e) => `removed ${named(e)}`),
    ...changed.map(({ entry, names }) => `changed ${named(entry)} (fields: ${names.join(', ')})`),
  ];
  if (parts.length === 0) return '';
  const more = parts.length > MOST_NAMED ? `, and ${parts.length - MOST_NAMED} more` : '';
  return `now it has ${parts.slice(0, MOST_NAMED).join('; ')}${more}`;
}

// What a step that no longer has a list says in its place.
export function sayNoList(got) {
  if (got?.ask !== undefined) return `the step asked a question again (id ${hide(String(got.ask.id), [])})`;
  if (got?.wait !== undefined) return 'the step asked to wait again';
  if (got?.settled !== undefined) return 'the step settled without a list';
  return 'the step gave no list';
}
