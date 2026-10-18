// scripts/feature/status.js
// Builds a feature's status from files alone, so the session spends no turns
// on it: the brief, the plan it names, the Superpowers ledger for that plan,
// the questions, the report, the kept pull request number and the .git files.
// Also keeps the ledger's rulings in rulings.jsonl, so they outlive the ledger
// when Superpowers deletes its workspace. Nothing here runs git or any command.
import fs from 'node:fs';
import path from 'node:path';
import { featurePaths, parseBrief, parseReport, readQuestions } from './files.js';
import { findRepoRoot } from '../hooks/kit.js';
import { projectForFolder } from '../lib/projects.js';
import { wheelhouseHome } from '../lib/paths.js';

// The most of each file that is read. A file over its limit reads as missing.
const SMALL_BYTES = 4096; // HEAD, a loose ref, a .git file, commondir, pr.json
const BRIEF_BYTES = 1024 * 1024;
const REPORT_BYTES = 1024 * 1024;
const PLAN_BYTES = 4 * 1024 * 1024;
const LEDGER_BYTES = 8 * 1024 * 1024;
const RULINGS_BYTES = 8 * 1024 * 1024;
const VIEW_BYTES = 8 * 1024 * 1024;
const PACKED_REFS_BYTES = 32 * 1024 * 1024;
// The most workspace folders looked at for a ledger, and links followed from HEAD.
const MAX_WORKSPACES = 500;
const MAX_LINKS = 5;

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RULING = 'Ruling:';

// The text of a regular file, or null when it is missing, not a file, or over `max` bytes.
function readCapped(file, max) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) return null;
    const buffer = Buffer.alloc(stat.size);
    return buffer.toString('utf8', 0, fs.readSync(fd, buffer, 0, stat.size, 0));
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

const lines = (text) => text.split(/\r?\n/);

// --- The head commit, from the .git files ---

// The worktree's own git folder and the repository's common one. A `.git`
// folder is both; a `.git` file names the worktree's folder, whose `commondir`
// names the common one.
function gitFolders(worktree) {
  const dot = path.join(worktree, '.git');
  let stat;
  try {
    stat = fs.statSync(dot);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return { own: dot, common: dot };
  if (!stat.isFile()) return null;
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readCapped(dot, SMALL_BYTES) ?? '');
  if (!pointer) return null;
  const own = path.resolve(worktree, pointer[1]);
  const named = readCapped(path.join(own, 'commondir'), SMALL_BYTES)?.trim();
  return { own, common: named ? path.resolve(own, named) : own };
}

// A ref name git could have written: under refs/, no empty, `.` or `..` part.
function safeRef(name) {
  return /^refs\/[A-Za-z0-9._\/-]+$/.test(name) && name.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function packedRef(common, name) {
  const text = readCapped(path.join(common, 'packed-refs'), PACKED_REFS_BYTES);
  if (text === null) return null;
  for (const line of lines(text)) {
    const m = /^([0-9a-f]{40}|[0-9a-f]{64}) (\S+)$/.exec(line);
    if (m && m[2] === name) return m[1];
  }
  return null;
}

// The commit `name` points at: a loose ref in the worktree's folder or the
// common one, then packed-refs. A loose ref may itself name another ref.
function resolveRef(folders, name, links) {
  if (links > MAX_LINKS || !safeRef(name)) return null;
  for (const dir of new Set([folders.own, folders.common])) {
    const text = readCapped(path.join(dir, ...name.split('/')), SMALL_BYTES);
    if (text === null) continue;
    const value = text.trim();
    if (SHA.test(value)) return value;
    const next = /^ref:\s*(\S+)$/.exec(value);
    return next ? resolveRef(folders, next[1], links + 1) : null;
  }
  return packedRef(folders.common, name);
}

// The commit checked out in `worktree`, read from its .git files: a detached
// HEAD names it; otherwise HEAD names a branch, found loose or packed. Null
// when there is no repository or the branch has no commit yet.
export function gitHead(worktree) {
  const folders = gitFolders(worktree);
  if (folders === null) return null;
  const head = readCapped(path.join(folders.own, 'HEAD'), SMALL_BYTES)?.trim();
  if (!head) return null;
  if (SHA.test(head)) return head;
  const ref = /^ref:\s*(\S+)$/.exec(head);
  return ref ? resolveRef(folders, ref[1], 0) : null;
}

// --- The plan and its ledger ---

// A plan path as a ledger's first line would name it: forward slashes, no leading `./`.
const planName = (plan) => plan.replaceAll('\\', '/').replace(/^(\.\/)+/, '');

// The plan's text, from a path inside the worktree only.
function readPlan(worktree, plan) {
  const file = path.resolve(worktree, plan);
  const rel = path.relative(worktree, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return readCapped(file, PLAN_BYTES);
}

// The number of distinct `### Task N` headings in the plan.
function countTasks(text) {
  const seen = new Set();
  for (const line of lines(text ?? '')) {
    const m = /^###\s+Task\s+(\d+)\b/.exec(line);
    if (m) seen.add(Number(m[1]));
  }
  return seen.size;
}

// The text of the newest `.superpowers/sdd/*/progress.md` (by modification
// time) whose first line names `plan`; null when none does.
function readLedger(worktree, plan) {
  if (typeof plan !== 'string' || plan.trim() === '') return null;
  const wanted = planName(plan.trim());
  const sdd = path.join(worktree, '.superpowers', 'sdd');
  let entries;
  try {
    entries = fs.readdirSync(sdd, { withFileTypes: true }).filter((e) => e.isDirectory()).slice(0, MAX_WORKSPACES);
  } catch {
    return null;
  }
  const found = [];
  for (const entry of entries) {
    const file = path.join(sdd, entry.name, 'progress.md');
    try {
      const stat = fs.lstatSync(file);
      if (stat.isFile()) found.push({ file, mtime: stat.mtimeMs });
    } catch { /* no ledger in this workspace */ }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  for (const { file } of found) {
    const text = readCapped(file, LEDGER_BYTES);
    if (text !== null && lines(text)[0].includes(wanted)) return text;
  }
  return null;
}

const TASK_LINE = /^\s*(?:[-*]\s+)?Task (\d+): (.*)$/;

// What the ledger says of its tasks: those complete, the last fix round of a
// task not yet complete, and whether it has any task line at all.
function readTasks(ledger) {
  const complete = new Set();
  const rounds = [];
  let any = false;
  for (const line of lines(ledger)) {
    const m = TASK_LINE.exec(line);
    if (!m) continue;
    any = true;
    const n = Number(m[1]);
    if (/^complete\b/.test(m[2])) complete.add(n);
    const round = /^fix round (\d+)\//.exec(m[2]);
    if (round) rounds.push({ n, round: Number(round[1]) });
  }
  const open = rounds.filter((r) => !complete.has(r.n));
  return { complete, fixRound: open.length > 0 ? open.at(-1).round : null, any };
}

// --- The other feature files ---

function readBrief(worktree) {
  const text = readCapped(featurePaths(worktree).brief, BRIEF_BYTES);
  if (text === null) throw new Error("The brief can't be read");
  return parseBrief(text).fields;
}

// The pull request number open-pr kept in pr.json as `{ pr }`, or null.
function readPr(worktree) {
  try {
    const kept = JSON.parse(readCapped(featurePaths(worktree).pr, SMALL_BYTES) ?? 'null');
    return kept !== null && typeof kept === 'object' && !Array.isArray(kept) && Number.isSafeInteger(kept.pr) && kept.pr >= 1 ? kept.pr : null;
  } catch {
    return null;
  }
}

function hasReport(worktree) {
  const text = readCapped(featurePaths(worktree).report, REPORT_BYTES);
  if (text === null) return false;
  try {
    parseReport(text);
    return true;
  } catch {
    return false;
  }
}

// The ids of the questions the director has answered, from the project's
// questions view on disk (`views/questions.json`, or `views.old` while the
// views are being replaced). None when the project or the view can't be found.
export function answeredInViews(worktree) {
  const answered = new Set();
  try {
    const root = findRepoRoot(worktree);
    const found = root === null ? null : projectForFolder(fs.realpathSync.native(root));
    if (!found) return answered;
    const base = path.join(wheelhouseHome(), 'projects', found.project, 'views');
    const text = readCapped(path.join(base, 'questions.json'), VIEW_BYTES) ?? readCapped(path.join(`${base}.old`, 'questions.json'), VIEW_BYTES);
    const view = JSON.parse(text ?? 'null');
    if (view === null || typeof view !== 'object' || Array.isArray(view)) return answered;
    for (const [id, entry] of Object.entries(view)) {
      if (entry?.answer !== null && typeof entry?.answer === 'object') answered.add(id);
    }
  } catch { /* none known */ }
  return answered;
}

// --- The status ---

// The feature's Status, from files alone. `answered(worktree)` gives the ids of
// answered questions; it reads the questions view unless a caller passes its own.
// Throws when the brief can't be read, since the status names its work and lane.
export function buildStatus({ worktree, now = () => new Date(), tokens = null, answered = answeredInViews }) {
  const brief = readBrief(worktree);
  const p = featurePaths(worktree);
  const plan = typeof brief.plan === 'string' && brief.plan.trim() !== '' ? brief.plan : null;
  const ledger = plan === null ? null : readLedger(worktree, plan);

  let task = null;
  let fixRound = null;
  let building = false;
  if (ledger !== null) {
    const m = countTasks(readPlan(worktree, plan));
    const read = readTasks(ledger);
    const n = [...read.complete].filter((k) => k >= 1 && k <= m).length;
    // Status's n of m starts at 1: before any task is complete there is none to give.
    task = m > 0 && n > 0 ? { n, m } : null;
    fixRound = read.fixRound;
    building = read.any;
  }

  const asked = readQuestions(p.questions).questions.filter((q) => q.kind === 'question');
  const done = asked.length > 0 ? answered(worktree) : new Set();
  const waiting = asked.some((q) => !done.has(q.id));
  const pr = readPr(worktree);

  let phase;
  if (waiting) phase = 'waiting';
  else if (hasReport(worktree)) phase = 'done';
  else if (pr !== null) phase = 'pr-open';
  else if (building) phase = 'building';
  else if (plan !== null) phase = 'ready-to-build';
  else phase = 'planning';

  return {
    v: 1,
    work: brief.work,
    lane: brief.lane,
    phase,
    task,
    fixRound,
    waitingOn: waiting ? 'question' : null,
    head: gitHead(worktree),
    pr,
    slice: null,
    tokens,
    updatedAt: now().toISOString(),
  };
}

// --- The rulings ---

// The rulings kept so far, one JSON string per line; null when the file is too
// big to read whole, so nothing is appended that might already be there.
function keptRulings(file) {
  let text;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > RULINGS_BYTES) return null;
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return error?.code === 'ENOENT' ? { list: [], text: '' } : null;
  }
  const list = [];
  for (const line of lines(text)) {
    try {
      const value = JSON.parse(line);
      if (typeof value === 'string') list.push(value);
    } catch { /* not a ruling line */ }
  }
  return { list, text };
}

// Appends to rulings.jsonl, as one JSON string per line and in ledger order,
// each ledger line holding `Ruling:` (trimmed) that is not kept already.
// Returns the lines it appended. Nothing is written without a ledger.
export function captureRulings({ worktree }) {
  const brief = readBrief(worktree);
  const ledger = typeof brief.plan === 'string' ? readLedger(worktree, brief.plan) : null;
  if (ledger === null) return [];
  const file = featurePaths(worktree).rulings;
  const kept = keptRulings(file);
  if (kept === null) return [];
  const seen = new Set(kept.list);
  const added = [];
  for (const line of lines(ledger)) {
    const text = line.trim();
    if (!text.includes(RULING) || seen.has(text)) continue;
    seen.add(text);
    added.push(text);
  }
  if (added.length === 0) return [];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lead = kept.text === '' || kept.text.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${lead}${added.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return added;
}
