// scripts/feature/files.js
// The four files between the foreman and a feature session, in the git-ignored
// folder `.wheelhouse/feature/` at the root of the session's worktree: the brief,
// the status, the questions and the report (plus the rulings the session keeps,
// its session id and its pull request's number).
// Each reader is strict: a wrong shape reads as null, throws the one message
// named here, or is skipped and counted. Nothing in this file runs git.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LANES, SLUG } from '../lib/build-loop.js';

export const FEATURE_DIR = '.wheelhouse/feature';

export const PHASES = Object.freeze(['planning', 'ready-to-build', 'building', 'pr-open', 'waiting', 'done']);
export const WAITING_ON = Object.freeze(['question', 'clash', 'pace', 'dependency', 'ci', 'review', 'merge']);
export const QUESTION_KINDS = Object.freeze(['question', 'extra-plan']);
export const REPORT_STATUSES = Object.freeze(['done', 'blocked', 'partial']);

// The most of a question file, or of a status file, that is read.
const READ_BYTES = 65536;

export function featurePaths(worktree) {
  const dir = path.join(worktree, ...FEATURE_DIR.split('/'));
  return {
    dir,
    brief: path.join(dir, 'brief.md'),
    status: path.join(dir, 'status.json'),
    questions: path.join(dir, 'questions.jsonl'),
    report: path.join(dir, 'report.md'),
    rulings: path.join(dir, 'rulings.jsonl'),
    session: path.join(dir, 'session.json'),
    pr: path.join(dir, 'pr.json'),
  };
}

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x !== '';
const isCount = (x) => Number.isInteger(x) && x >= 0;
const isNumber = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const isTexts = (x) => Array.isArray(x) && x.every((y) => typeof y === 'string');
const hasOnly = (o, keys) => Object.keys(o).every((k) => keys.includes(k));
const isNofM = (x) => isPlain(x) && hasOnly(x, ['n', 'm']) && Number.isInteger(x.n) && Number.isInteger(x.m) && x.n >= 1 && x.n <= x.m;
// A task count: n of the plan's m tasks complete, where none complete yet is 0.
const isTaskCount = (x) => isPlain(x) && hasOnly(x, ['n', 'm']) && Number.isInteger(x.n) && Number.isInteger(x.m) && x.m >= 1 && x.n >= 0 && x.n <= x.m;
// Whether `file` is a regular file, checked without following a symlink or
// opening it, so a symlink, a folder or a FIFO is refused before it can block.
function isRegular(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}
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
    && (s.task === null || isTaskCount(s.task))
    && (s.fixRound === null || isCount(s.fixRound))
    && (s.waitingOn === null || WAITING_ON.includes(s.waitingOn))
    && (s.head === null || isText(s.head))
    && (s.pr === null || (Number.isInteger(s.pr) && s.pr >= 1))
    && (s.slice === null || isNofM(s.slice))
    && (s.tokens === null || isNumber(s.tokens))
    && isTime(s.updatedAt);
}

// The status in `file`, or null when it is missing, not a regular file, over
// 64 KB, not JSON or not the right shape.
export function readStatus(file) {
  if (!isRegular(file)) return null;
  try {
    const fd = fs.openSync(file, 'r');
    let text;
    try {
      const size = fs.fstatSync(fd).size;
      if (size > READ_BYTES) return null;
      const buffer = Buffer.alloc(size);
      text = buffer.toString('utf8', 0, fs.readSync(fd, buffer, 0, size, 0));
    } finally {
      fs.closeSync(fd);
    }
    const status = JSON.parse(text);
    return validStatus(status) ? status : null;
  } catch {
    return null;
  }
}

// Writes the status whole to a temporary name and renames it over `file`, so a
// reader sees the old status or the new one and never half of either. A `file`
// that is there but is not a regular file (a symlink, say) is refused.
export function writeStatus(file, status) {
  if (!validStatus(status)) throw new Error("The status can't be written");
  if (lstatOf(file) !== null && !isRegular(file)) throw new Error("The status can't be written");
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
// a line the limit cuts short counts as skipped, and `truncated` says the limit
// was reached. A missing file holds none.
export function readQuestions(file, { maxBytes = READ_BYTES } = {}) {
  let text;
  let cut = false;
  if (!isRegular(file)) return { questions: [], skipped: 0, truncated: false };
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
    return { questions: [], skipped: 0, truncated: false };
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
  return { questions, skipped, truncated: cut };
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

const NOT_THE_PROJECTS = "The worktree's git folder isn't the project's";

// The real path of `p`, or null when it does not exist.
function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function lstatOf(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// Adds `.wheelhouse/` once to `info/exclude` in the project's git folder, so no
// project's own .gitignore is touched. `mainCheckout` is the project's main
// checkout, named by the caller that made the worktree. The worktree's git
// folder is found with fs, following its .git file and that folder's commondir,
// and it is used only when it is the project's own: the common folder must be
// the real `<mainCheckout>/.git`, and a worktree's own folder must sit under
// its `worktrees/`. A `.git` that is a symlink, or a crafted `.git` file that
// points elsewhere, is refused and nothing is written. Git never runs.
// For the main checkout itself, `worktree` and `mainCheckout` are the same.
export function ensureIgnored(worktree, { mainCheckout } = {}) {
  if (typeof worktree !== 'string' || typeof mainCheckout !== 'string' || !path.isAbsolute(worktree) || !path.isAbsolute(mainCheckout)) {
    throw new Error(NOT_THE_PROJECTS);
  }
  const mainDot = path.join(mainCheckout, '.git');
  const common = lstatOf(mainDot)?.isDirectory() ? real(mainDot) : null;
  if (common === null) throw new Error(NOT_THE_PROJECTS);

  const dot = path.join(worktree, '.git');
  const stat = lstatOf(dot);
  if (stat === null || stat.isSymbolicLink()) throw new Error(NOT_THE_PROJECTS);
  if (stat.isDirectory()) {
    if (real(dot) !== common) throw new Error(NOT_THE_PROJECTS);
  } else if (stat.isFile()) {
    const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readText(dot) ?? '');
    const gitdir = pointer ? real(path.resolve(worktree, pointer[1])) : null;
    const named = gitdir === null ? null : readText(path.join(gitdir, 'commondir'))?.trim();
    const own = named ? real(path.resolve(gitdir, named)) : null;
    if (own !== common || !gitdir.startsWith(path.join(common, 'worktrees') + path.sep)) throw new Error(NOT_THE_PROJECTS);
  } else {
    throw new Error(NOT_THE_PROJECTS);
  }

  const info = path.join(common, 'info');
  const file = path.join(info, 'exclude');
  if (lstatOf(info)?.isSymbolicLink() || lstatOf(file)?.isSymbolicLink()) throw new Error(NOT_THE_PROJECTS);
  const current = readText(file) ?? '';
  if (current.split(/\r?\n/).some((line) => ['.wheelhouse/', '/.wheelhouse/', '.wheelhouse', '/.wheelhouse'].includes(line.trim()))) return;
  fs.mkdirSync(info, { recursive: true });
  const lead = current === '' || current.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${lead}.wheelhouse/\n`);
}
