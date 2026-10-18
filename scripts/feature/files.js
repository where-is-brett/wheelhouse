// scripts/feature/files.js
// The four files between the foreman and a feature session, in the git-ignored
// folder `.wheelhouse/feature/` at the root of the session's worktree: the brief,
// the status, the questions and the report (plus the rulings the session keeps).
// Each reader is strict: a wrong shape reads as null, throws the one message
// named here, or is skipped and counted. Nothing in this file runs git.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from '../hooks/kit.js';
import { LANES, SLUG } from '../lib/build-loop.js';

export const FEATURE_DIR = '.wheelhouse/feature';

export const PHASES = Object.freeze(['planning', 'ready-to-build', 'building', 'pr-open', 'waiting', 'done']);
export const WAITING_ON = Object.freeze(['question', 'clash', 'pace', 'dependency', 'ci', 'review', 'merge']);
export const QUESTION_KINDS = Object.freeze(['question', 'extra-plan']);
export const REPORT_STATUSES = Object.freeze(['done', 'blocked', 'partial']);

// The most of a question file that is read.
const QUESTION_BYTES = 65536;

export function featurePaths(worktree) {
  const dir = path.join(worktree, ...FEATURE_DIR.split('/'));
  return {
    dir,
    brief: path.join(dir, 'brief.md'),
    status: path.join(dir, 'status.json'),
    questions: path.join(dir, 'questions.jsonl'),
    report: path.join(dir, 'report.md'),
    rulings: path.join(dir, 'rulings.jsonl'),
  };
}

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x !== '';
const isCount = (x) => Number.isInteger(x) && x >= 0;
const isNumber = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const isTexts = (x) => Array.isArray(x) && x.every((y) => typeof y === 'string');
const hasOnly = (o, keys) => Object.keys(o).every((k) => keys.includes(k));
const isNofM = (x) => isPlain(x) && hasOnly(x, ['n', 'm']) && Number.isInteger(x.n) && Number.isInteger(x.m) && x.n >= 1 && x.n <= x.m;
const isTime = (x) => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(x) && !Number.isNaN(Date.parse(x));

// A document whose first block is a fenced json block: its parsed fields and the text after it.
// Anything else (no block first, text that is not JSON, JSON that is not an object) is null.
function splitJsonBlock(text) {
  if (typeof text !== 'string') return null;
  const match = /^(?:[ \t]*\r?\n)*```json[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n|$)/.exec(text.replace(/^\uFEFF/, ''));
  if (!match) return null;
  let fields;
  try {
    fields = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!isPlain(fields)) return null;
  return { fields, body: text.replace(/^\uFEFF/, '').slice(match[0].length) };
}

// --- The brief ---

const BRIEF_KEYS = ['v', 'work', 'lane', 'version', 'goal', 'done', 'appetite', 'rulings', 'routing', 'shownFirst', 'plan', 'slices'];
const BRIEF_REQUIRED = BRIEF_KEYS.filter((k) => k !== 'plan' && k !== 'slices');

function validBrief(f) {
  return hasOnly(f, BRIEF_KEYS)
    && BRIEF_REQUIRED.every((k) => k in f)
    && f.v === 1
    && typeof f.work === 'string' && SLUG.test(f.work)
    && LANES.includes(f.lane)
    && isNumber(f.version)
    && typeof f.goal === 'string'
    && isTexts(f.done)
    && isPlain(f.appetite) && hasOnly(f.appetite, ['sessions', 'tokens']) && isNumber(f.appetite.sessions) && isNumber(f.appetite.tokens)
    && Array.isArray(f.rulings) && f.rulings.every((r) => isPlain(r) && hasOnly(r, ['id', 'words']) && isText(r.id) && typeof r.words === 'string')
    && isPlain(f.routing) && Object.values(f.routing).every((x) => typeof x === 'string')
    && typeof f.shownFirst === 'boolean'
    && (f.plan === undefined || typeof f.plan === 'string')
    && (f.slices === undefined || (Number.isInteger(f.slices) && f.slices >= 1));
}

// The brief's fields and the text after its JSON block. Throws if it is anything else.
export function parseBrief(text) {
  const parsed = splitJsonBlock(text);
  if (!parsed || !validBrief(parsed.fields)) throw new Error("The brief can't be read");
  return parsed;
}

// The brief's identity: SHA-256 in hex of its text with line endings evened to LF.
export function briefHash(text) {
  return crypto.createHash('sha256').update(String(text).replace(/\r\n?/g, '\n')).digest('hex');
}

// --- The status ---

const STATUS_KEYS = ['v', 'work', 'lane', 'phase', 'task', 'fixRound', 'waitingOn', 'head', 'pr', 'slice', 'tokens', 'updatedAt'];

function validStatus(s) {
  return isPlain(s)
    && Object.keys(s).length === STATUS_KEYS.length && STATUS_KEYS.every((k) => k in s)
    && s.v === 1
    && typeof s.work === 'string' && SLUG.test(s.work)
    && LANES.includes(s.lane)
    && PHASES.includes(s.phase)
    && (s.task === null || isNofM(s.task))
    && (s.fixRound === null || isCount(s.fixRound))
    && (s.waitingOn === null || WAITING_ON.includes(s.waitingOn))
    && (s.head === null || isText(s.head))
    && (s.pr === null || (Number.isInteger(s.pr) && s.pr >= 1))
    && (s.slice === null || isNofM(s.slice))
    && (s.tokens === null || isNumber(s.tokens))
    && isTime(s.updatedAt);
}

// The status in `file`, or null when it is missing, not JSON or not the right shape.
export function readStatus(file) {
  try {
    const status = JSON.parse(fs.readFileSync(file, 'utf8'));
    return validStatus(status) ? status : null;
  } catch {
    return null;
  }
}

// Writes the status whole to a temporary name and renames it over `file`, so a
// reader sees the old status or the new one and never half of either.
export function writeStatus(file, status) {
  if (!validStatus(status)) throw new Error("The status can't be written");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID().slice(0, 12)}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(status)}\n`, { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// --- The questions ---

const QUESTION_KEYS = ['id', 'kind', 'what', 'why', 'options', 'recommendation', 'level', 'plan'];

// `q-<work>-<n>`, the same id the state's question record carries.
function isQuestionId(id) {
  const m = typeof id === 'string' ? /^q-([a-z0-9-]+)-[0-9]+$/.exec(id) : null;
  return m !== null && SLUG.test(m[1]);
}

function validQuestion(q) {
  return isPlain(q)
    && hasOnly(q, QUESTION_KEYS)
    && isQuestionId(q.id)
    && QUESTION_KINDS.includes(q.kind)
    && isText(q.what)
    && isText(q.why)
    && Array.isArray(q.options) && q.options.length > 0
    && q.options.every((o) => isPlain(o) && Object.keys(o).length === 2 && isText(o.label) && typeof o.says === 'string')
    && isText(q.recommendation)
    && [1, 2, 3, 4].includes(q.level)
    && (q.kind === 'extra-plan' ? isText(q.plan) : q.plan === undefined || typeof q.plan === 'string');
}

// The questions in `file`, one JSON object per line. Lines that are not a valid
// question are skipped and counted. No more than `maxBytes` of the file is read;
// a line the limit cuts short counts as skipped. A missing file holds none.
export function readQuestions(file, { maxBytes = QUESTION_BYTES } = {}) {
  let text;
  let cut = false;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const buffer = Buffer.alloc(Math.min(size, maxBytes));
      const got = fs.readSync(fd, buffer, 0, buffer.length, 0);
      text = buffer.toString('utf8', 0, got);
      cut = size > maxBytes;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { questions: [], skipped: 0 };
  }
  let skipped = 0;
  if (cut) {
    // The limit may fall inside a line, or inside a character: keep whole lines only.
    const end = text.lastIndexOf('\n');
    const rest = text.slice(end + 1);
    text = end === -1 ? '' : text.slice(0, end + 1);
    if (rest.trim() !== '') skipped += 1;
  }
  const questions = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const q = JSON.parse(line);
      if (validQuestion(q)) questions.push(q);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { questions, skipped };
}

// --- The report ---

const REPORT_KEYS = ['v', 'work', 'status', 'pr', 'head', 'tests', 'assumptions', 'concerns', 'rulings'];

function validReport(f) {
  return hasOnly(f, REPORT_KEYS)
    && ['v', 'work', 'status', 'tests', 'assumptions', 'concerns', 'rulings'].every((k) => k in f)
    && f.v === 1
    && typeof f.work === 'string' && SLUG.test(f.work)
    && REPORT_STATUSES.includes(f.status)
    && (f.pr === undefined || (Number.isInteger(f.pr) && f.pr >= 1))
    && (f.head === undefined || isText(f.head))
    && typeof f.tests === 'string'
    && isTexts(f.assumptions)
    && isTexts(f.concerns)
    && isTexts(f.rulings);
}

// The report's fields, the text after its JSON block and that text's word count.
// A body over REPORT_WORDS words is not an error here: the caller sees the count.
// Throws if the report is anything else.
export function parseReport(text) {
  const parsed = splitJsonBlock(text);
  if (!parsed || !validReport(parsed.fields)) throw new Error("The report can't be read");
  const words = parsed.body.split(/\s+/).filter(Boolean).length;
  return { ...parsed, words };
}

// --- Keeping the files out of git ---

// Adds `.wheelhouse/` once to `info/exclude` in the repository's common git
// folder, so no project's own .gitignore is touched. The folder is found with
// fs, following a worktree's .git file and its commondir, and git never runs.
export function ensureIgnored(worktree) {
  const root = findRepoRoot(path.resolve(worktree));
  const gitDir = root === null ? null : path.join(root, '.git');
  let isDir = false;
  try {
    isDir = gitDir !== null && fs.statSync(gitDir).isDirectory();
  } catch {
    // Not a folder.
  }
  if (!isDir) throw new Error("Can't find the repository's git folder");
  const file = path.join(gitDir, 'info', 'exclude');
  let current = '';
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    // No exclude file yet.
  }
  if (current.split(/\r?\n/).some((line) => ['.wheelhouse/', '/.wheelhouse/', '.wheelhouse', '/.wheelhouse'].includes(line.trim()))) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lead = current === '' || current.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${lead}.wheelhouse/\n`);
}
