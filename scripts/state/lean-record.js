// scripts/state/lean-record.js
// Lean's record, read and turned into state events. At Lean the chat writes one JSON line for each
// event into `.wheelhouse/record/YYYY-MM-DD.jsonl`, with git alone (adapters/copilot/skills/lean/SKILL.md, "The
// record"). Where Node.js runs, Wheelhouse reads those files and moves them up into its state.
//
// This module only reads and converts. It never runs git and never writes; `moveUp` (Part 6)
// writes the events. A Lean line is the chat's own account of a click, so no event made here is
// ever signed, and none is of a kind that a signed record is required for (PROTECTED_KINDS).
import fs from 'node:fs';
import path from 'node:path';
import { makeEvent, PROTECTED_KINDS } from './events.js';
import { LEAN_RECORD_DIR, PROOFS, REVIEW_KINDS } from '../lib/copilot-numbers.js';

// The kinds a Lean line can name, and the eight keys every line has, in the order they are written.
// Intake at Lean (ruling P5-37) adds `idea`, `ruling` and `design`, which carry a ninth key, `text`, after them:
// the director's words, verbatim, for an idea and a ruling; the design file's path and git blob hash for a design.
export const LEAN_KINDS = Object.freeze(['card', 'approval', 'review', 'merge', 'undo', 'stop', 'lift-stop', 'copy', 'idea', 'ruling', 'design']);
export const LEAN_KEYS = Object.freeze(['at', 'kind', 'card', 'choice', 'commit', 'proof', 'by', 'tier']);
export const LEAN_TEXT_KINDS = Object.freeze(['idea', 'ruling', 'design']);
export const LEAN_TEXT_CHARS = 4000;
// The record's folder and the proofs a line may name, for the modules that write lines back (scripts/lean/release.js).
export { LEAN_RECORD_DIR, PROOFS as LEAN_PROOFS };
// The folder in the record that holds Lean's designs, one Markdown file each (ruling P5-38). It is not a day's file.
export const LEAN_DESIGNS_DIR = 'designs';
// Only these kinds can have a click behind them, and only when the line names the option clicked.
const CLICK_KINDS = Object.freeze(['card', 'approval', 'undo', 'lift-stop', 'ruling', 'design']);

const FILE_NAME = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const COMMIT = /^[0-9a-f]{12}$/;
// A design line's text: its file in the designs folder, a space, and the file's git blob hash in full.
const DESIGN_TEXT = new RegExp(`^(${LEAN_RECORD_DIR.replaceAll('.', '\\.')}/${LEAN_DESIGNS_DIR}/[a-z0-9][a-z0-9-]{0,39}\\.md) ([0-9a-f]{40})$`);
// A real time: Date.parse lets 31 February roll into March, so the date must come back as it went in.
const isTime = (x) => typeof x === 'string' && TIME.test(x) && !Number.isNaN(Date.parse(x)) && new Date(x).toISOString().slice(0, 19) === x.slice(0, 19);
const isText = (x) => typeof x === 'string' && x !== '';
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The relative path of a record file as a problem names it, the same on every system.
const relative = (name) => `${LEAN_RECORD_DIR}/${name}`;

// Why a parsed line is not a good Lean line, or null when it is one. Ruling P4-13: all eight keys,
// the five that are never null, and the proof each kind carries; ruling P5-37: `text` on the three intake
// kinds, and on no other; ruling P5-58: those three may carry any proof Wheelhouse knows, as written back by release.
function whyBad(line, file) {
  if (!isPlain(line)) return 'the line is not a JSON object';
  const keys = Object.keys(line);
  const missing = LEAN_KEYS.filter((k) => !Object.hasOwn(line, k));
  if (missing.length > 0) return `the line lacks ${missing.join(', ')}`;
  const extra = keys.filter((k) => !LEAN_KEYS.includes(k) && k !== 'text');
  if (extra.length > 0) return `the line has ${extra.join(', ')}, which a Lean line does not`;
  if (!isTime(line.at)) return 'the time is not UTC in ISO 8601';
  // A line belongs in the file for its own UTC day (the playbook writes it there).
  const day = FILE_NAME.exec(String(file ?? '').split('/').pop());
  if (day && line.at.slice(0, 10) !== `${day[1]}-${day[2]}-${day[3]}`) return 'the time is not on the day of the file';
  if (!LEAN_KINDS.includes(line.kind)) return `the kind ${typeof line.kind === 'string' ? `"${line.kind}" ` : ''}is not one Lean writes`;
  if (LEAN_TEXT_KINDS.includes(line.kind)) {
    if (!Object.hasOwn(line, 'text')) return 'the line lacks text, which an idea, a ruling and a design carry';
    if (typeof line.text !== 'string' || line.text.trim() === '') return 'the text is not the director\'s words';
    if (line.text.length > LEAN_TEXT_CHARS) return `the text is over ${LEAN_TEXT_CHARS} characters`;
  } else if (Object.hasOwn(line, 'text')) {
    return 'only an idea, a ruling or a design carries text';
  }
  for (const k of ['card', 'choice']) if (line[k] !== null && !isText(line[k])) return `${k} is neither text nor null`;
  if (line.commit !== null && !(typeof line.commit === 'string' && COMMIT.test(line.commit))) return 'the commit is not 12 lower-case hex characters';
  const proof = line.kind === 'review' ? 'chat-review' : 'chat-click';
  // An idea, a ruling or a design that the helper recorded and its release wrote back (ruling P5-58) keeps the proof
  // the helper's record named, such as the window's for a design approved there.
  if (LEAN_TEXT_KINDS.includes(line.kind)) {
    if (!PROOFS.includes(line.proof)) return `the proof of ${line.kind} must be ${proof}, or the one the helper recorded`;
  } else if (line.proof !== proof) return `the proof of ${line.kind} must be ${proof}`;
  // Both are named in the numbers, so a proof that drifts from them is caught here as well.
  if (!(PROOFS.includes(line.proof) || REVIEW_KINDS.includes(line.proof))) return 'the proof is not one Wheelhouse knows';
  if (line.by !== 'chat') return 'by must be chat';
  if (line.tier !== 'lean') return 'tier must be lean';
  // What each kind carries, from the line shown for it in the playbook.
  const need = (cond, what) => (cond ? null : what);
  switch (line.kind) {
    case 'card': return need(line.card !== null && line.choice !== null, 'a card line names the card and the option clicked');
    case 'approval':
      return need(line.card !== null && line.choice === 'Approve' && line.commit !== null, 'an approval names the card, Approve and the 12-character commit approved');
    case 'review': return need(['clean', 'findings'].includes(line.choice) && line.commit !== null, 'a review names clean or findings and the 12-character commit reviewed');
    case 'merge': return need(line.commit !== null, 'a merge names the 12-character merge commit');
    case 'undo': return need(line.commit !== null && (line.choice === null || line.choice === 'Undo'), 'an undo names the 12-character revert commit, and Undo or nothing');
    case 'copy': return need(['pushed', 'failed'].includes(line.choice) && line.commit !== null, 'a copy line names pushed or failed and the 12-character commit');
    // "Nothing else is in the line" for stop; the click on Lift STOP, or no click at all.
    case 'stop': return need(line.choice === null, 'a stop line has no choice');
    case 'lift-stop': return need(line.choice === null || line.choice === 'Lift STOP', 'a lift-stop line names Lift STOP, or nothing');
    // An idea is written at once, with no card; a ruling only after the click on Confirm; a design after Build it.
    case 'idea': return need(line.card !== null && line.choice === null && line.commit === null, 'an idea names its short name, and no choice or commit');
    case 'ruling': return need(line.card !== null && line.choice === 'Confirm' && line.commit === null, 'a ruling names its short name and Confirm, and no commit');
    case 'design':
      return need(line.card !== null && line.choice === 'Build it' && line.commit === null && DESIGN_TEXT.test(line.text), 'a design names its card, Build it, and as text its file in the designs folder and its full git blob hash');
    default: return null;
  }
}

// Reads the text of one record file. A line that is not JSON, lacks a field or names an unknown kind
// is a problem with its file and line number, and the line is kept in it: nothing is dropped silently.
// `file` is the project-relative path the problems (and each entry) name.
export function parseLeanRecord(text, { file = LEAN_RECORD_DIR } = {}) {
  const entries = [];
  const problems = [];
  // PowerShell on Windows can write a byte order mark at the start of a file.
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    if (raw.trim() === '') return;
    const line = i + 1;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      problems.push({ file, line, text: raw, why: 'the line is not JSON' });
      return;
    }
    const why = whyBad(parsed, file);
    if (why) problems.push({ file, line, text: raw, why });
    else entries.push({ ...parsed, file, line });
  });
  return { entries, problems };
}

// Every file in the project's record folder, oldest first by name, as { entries, problems }. A name
// that is not a day's file, or a file that cannot be read, is a problem; it is never skipped silently.
export function readLeanRecord(folder) {
  const dir = path.join(folder, ...LEAN_RECORD_DIR.split('/'));
  const entries = [];
  const problems = [];
  let names;
  try {
    names = fs.readdirSync(dir).sort();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { entries, problems };
    return { entries, problems: [{ file: LEAN_RECORD_DIR, line: null, text: '', why: 'the record folder could not be read' }] };
  }
  for (const name of names) {
    const file = relative(name);
    // Lean's designs folder (ruling P5-38) holds designs, not record lines; a file of that name is not it.
    if (name === LEAN_DESIGNS_DIR && isFolder(path.join(dir, name))) continue;
    const m = FILE_NAME.exec(name);
    if (!m || !isTime(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)) {
      problems.push({ file, line: null, text: '', why: 'the file is not named for a day (YYYY-MM-DD.jsonl)' });
      continue;
    }
    let text;
    try {
      // A link or a folder is not a day's file; a link could lead out of the project.
      if (!fs.lstatSync(path.join(dir, name)).isFile()) throw new Error('not a file');
      text = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
      problems.push({ file, line: null, text: '', why: 'the file could not be read' });
      continue;
    }
    const got = parseLeanRecord(text, { file });
    entries.push(...got.entries);
    problems.push(...got.problems);
  }
  return { entries, problems };
}

function isFolder(p) {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Whether the record leaves STOP on: its last stop or lift-stop line, in the order the files and lines read (as the
// playbook's `git grep` prints them), is a stop.
export function leanStopOpen(entries) {
  return entries.filter((e) => e?.kind === 'stop' || e?.kind === 'lift-stop').at(-1)?.kind === 'stop';
}

const words = (slug) => String(slug).replace(/-/g, ' ');

// One plain sentence for an event kept as a note. Each says the click was a chat click, not proven.
function sentence(e) {
  const card = e.card === null ? 'a card' : words(e.card);
  switch (e.kind) {
    case 'approval': return `Lean: the director approved ${card} at ${e.commit}, by a click in the chat, not proven.`;
    case 'review': return `Lean: a second look at ${e.commit} in the chat found it ${e.choice === 'clean' ? 'clean' : 'had things to fix'}, not an independent review.`;
    case 'undo': return e.choice === null
      ? `Lean: ${card} was undone at ${e.commit} with no click behind it.`
      : `Lean: the director chose to undo ${card}, undone at ${e.commit}, by a click in the chat, not proven.`;
    case 'stop': return 'Lean: the director said stop. Nothing at Lean enforces it.';
    case 'lift-stop': return e.choice === null
      ? 'Lean: STOP was lifted with no click behind it.'
      : 'Lean: the director lifted STOP, by a click in the chat, not proven.';
    case 'copy': return e.choice === 'pushed' ? `Lean: the copy was updated to ${e.commit}.` : `Lean: the copy was not updated at ${e.commit}.`;
    case 'ruling': return `Lean: the director confirmed the ruling ${card}, by a click in the chat, not proven.`;
    case 'design': return `Lean: the director chose to build the design ${card}, by a click in the chat, not proven.`;
    default: return '';
  }
}

// What each Lean kind becomes. `card`, `merge`, `idea` and `ruling` have an unsigned state event that
// means the same. An approval, a review and a click on an action are signed kinds, and a Lean line is
// never signed, so those, with the rest, are notes that say which Lean kind they are. A ruling's state
// event is the ruling itself, plain and so unconfirmed; its confirm click is a note beside it.
function stateKind(kind) {
  if (kind === 'card') return 'card-answer';
  if (['merge', 'idea', 'ruling'].includes(kind)) return kind;
  return 'note';
}

function dataOf(e) {
  const kept = {
    tier: e.tier,
    proof: e.proof,
    by: e.by,
    // A click is a chosen option on a card. A line with no choice has no click behind it, however
    // its proof reads, and a review's verdict, a merge or a copy is not a click at all.
    clicked: CLICK_KINDS.includes(e.kind) && e.choice !== null,
    ...(isText(e.file) && Number.isInteger(e.line) ? { source: { file: e.file, line: e.line } } : {}),
  };
  if (e.kind === 'card') return { question: e.card, label: e.choice, ...kept };
  // An idea is kept under its short name, so a later line with the same name replaces it (views' latestPerKey).
  if (e.kind === 'idea') return { key: e.card, text: e.text, ...kept };
  // The ruling is the director's words, never narrowed; the click on Confirm is the note that follows it.
  if (e.kind === 'ruling') return { words: e.text, card: e.card, ...kept, clicked: false };
  if (e.kind === 'design') {
    const [, file, hash] = DESIGN_TEXT.exec(e.text);
    return { text: sentence(e), lean: 'design', card: e.card, choice: e.choice, commit: e.commit, path: file, hash, ...kept };
  }
  if (e.kind === 'merge') {
    return {
      commit: e.commit,
      ...(e.card === null ? {} : { card: e.card }),
      forUsers: e.card === null ? 'A feature was merged' : `${words(e.card).replace(/^merge /, '')} was merged`,
      ...kept,
    };
  }
  return { text: sentence(e), lean: e.kind, card: e.card, choice: e.choice, commit: e.commit, ...kept };
}

// The state events for entries read from Lean's record, each through makeEvent at the time its line
// gives, with `data.tier` 'lean' and `data.proof` as recorded. Never signed: no event here is of a
// protected kind, so makeEvent does not reach for a key, and none carries `sig`. An entry that is
// not a good Lean line throws. `project` is the project the events go to; an event carries no
// project of its own, because it is kept in that project's state, so moveUp writes them there.
// A ruling line gives two events: the ruling, then a note of its confirm click (`data.lean` 'ruling-confirm',
// naming the ruling by its id).
export function leanToEvents(entries, { project } = {}) { // eslint-disable-line no-unused-vars
  const make = (kind, data, at) => {
    if (PROTECTED_KINDS.includes(kind)) throw new Error('A Lean entry is never a signed kind');
    const event = makeEvent({ kind, data, now: () => new Date(at) });
    if (event.sig !== undefined) throw new Error('A Lean entry is never signed');
    return event;
  };
  return entries.flatMap((entry) => {
    const keys = Object.hasOwn(entry ?? {}, 'text') ? [...LEAN_KEYS, 'text'] : LEAN_KEYS;
    const why = whyBad(Object.fromEntries(keys.map((k) => [k, entry?.[k]])), entry?.file);
    if (why) throw new Error(`A Lean entry cannot become an event: ${why}`);
    const event = make(stateKind(entry.kind), dataOf(entry), entry.at);
    if (entry.kind !== 'ruling') return [event];
    const { words: _words, ...kept } = event.data;
    const confirm = { ...kept, text: sentence(entry), lean: 'ruling-confirm', ruling: event.id, choice: entry.choice, commit: entry.commit, clicked: true };
    return [event, make('note', confirm, entry.at)];
  });
}
