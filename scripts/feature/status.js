// scripts/feature/status.js
// Builds a feature's status from files alone, so the session spends no turns
// on it: the brief, the plan it names, the Superpowers ledger for that plan,
// the questions, the report, the kept pull request number, the project's views
// and the .git files. Also keeps the ledger's rulings in rulings.jsonl, so they
// outlive the ledger when Superpowers deletes its workspace. Nothing here runs
// git or any other command.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { featurePaths, openRegular, parseBrief, parseReport, readQuestions } from './files.js';
import { findRepoRoot } from '../hooks/kit.js';
import { projectForFolder } from '../lib/projects.js';
import { wheelhouseHome } from '../lib/paths.js';

// The most of each file that is read. A file over its limit reads as missing.
export const SMALL_BYTES = 4096; // HEAD, a loose ref, a .git file, commondir, pr.json, a ledger's first line
const BRIEF_BYTES = 1024 * 1024;
const REPORT_BYTES = 1024 * 1024;
const PLAN_BYTES = 4 * 1024 * 1024;
export const LEDGER_BYTES = 8 * 1024 * 1024;
const RULINGS_BYTES = 8 * 1024 * 1024;
const VIEW_BYTES = 8 * 1024 * 1024;
const PACKED_REFS_BYTES = 32 * 1024 * 1024;
// The most workspace folders looked at for a ledger, and links followed from HEAD.
const MAX_WORKSPACES = 500;
const MAX_LINKS = 5;

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RULING = 'Ruling:';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const lines = (text) => text.split(/\r?\n/);

function lstatOf(file) {
  try {
    return fs.lstatSync(file);
  } catch {
    return null;
  }
}

// The text of a regular file, or null when it is missing, not a regular file
// (a symlink, a folder or a FIFO is refused, even one swapped in after the check, so it can't
// block), or over `max` bytes. With `head`, only the first `max` bytes are read
// and a longer file is not refused.
export function readCapped(file, max, { head = false } = {}) {
  const fd = openRegular(file);
  if (fd === null) return null;
  try {
    const stat = fs.fstatSync(fd);
    if (!head && stat.size > max) return null;
    const size = Math.min(stat.size, max);
    const buffer = Buffer.alloc(size);
    return buffer.toString('utf8', 0, fs.readSync(fd, buffer, 0, size, 0));
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// Writes `text` whole to a temporary file opened with `wx` beside `file`, then
// renames it over `file`, so a reader sees the old text or the new and never
// half of either. Refuses a `file` that is there but is not a regular file (a
// symlink above all) and a folder that is not a real folder.
export function writeWhole(file, text) {
  const dir = path.dirname(file);
  if (!lstatOf(dir)?.isDirectory()) throw new Error("The feature's folder isn't a real folder");
  const stat = lstatOf(file);
  if (stat !== null && !stat.isFile()) throw new Error(`${path.basename(file)} isn't a regular file`);
  const temp = `${file}.${crypto.randomUUID().slice(0, 12)}.tmp`;
  try {
    fs.writeFileSync(temp, text, { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// Whether the worktree's `.wheelhouse` and `.wheelhouse/feature` are real
// folders (not symlinks) and the feature folder's real path is the one under
// the worktree's own, so nothing written there can land anywhere else.
export function safeFeatureFolder(worktree) {
  const dot = path.join(worktree, '.wheelhouse');
  const dir = featurePaths(worktree).dir;
  if (!lstatOf(dot)?.isDirectory() || !lstatOf(dir)?.isDirectory()) return false;
  try {
    return fs.realpathSync.native(dir) === path.join(fs.realpathSync.native(worktree), '.wheelhouse', 'feature');
  } catch {
    return false;
  }
}

// --- The head commit, from the .git files ---
//
// A repository that keeps its refs in reftable, or a branch whose name has
// characters outside [A-Za-z0-9._/-], reads as head null.

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

// --- The brief, the plan and its ledger ---

// The brief's fields. Throws when it can't be read.
export function readBrief(worktree) {
  const text = readCapped(featurePaths(worktree).brief, BRIEF_BYTES);
  if (text === null) throw new Error("The brief can't be read");
  return parseBrief(text).fields;
}

const planOf = (brief) => (typeof brief.plan === 'string' && brief.plan.trim() !== '' ? brief.plan.trim() : null);
const slashes = (p) => p.replaceAll('\\', '/');
const planName = (plan) => slashes(plan).replace(/^(\.\/)+/, '');

// Whether a ledger's first line names `plan` exactly: the text after `plan:`
// (backticks aside) is the plan's path as the brief gives it, or that path in
// full under the worktree. `other/plans/a.md` and `plans/a.md.bak` are not `plans/a.md`.
function namesPlan(firstLine, worktree, plan) {
  const m = /plan:\s*`?(.+?)`?\s*$/.exec(firstLine);
  if (!m) return false;
  const named = planName(m[1]);
  const wanted = planName(plan);
  if (named === wanted) return true;
  const roots = new Set([worktree]);
  try {
    roots.add(fs.realpathSync.native(worktree));
  } catch { /* the path as given */ }
  return [...roots].some((root) => named === slashes(path.join(root, wanted)));
}

// The newest `.superpowers/sdd/*/progress.md` (by modification time) whose
// first line names `plan`, as `{ file, size, mtimeMs }`; null when none does.
// Only each candidate's first 4 KB is read.
export function findLedger(worktree, plan) {
  if (typeof plan !== 'string' || plan.trim() === '') return null;
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
    const stat = lstatOf(file);
    if (stat?.isFile()) found.push({ file, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const candidate of found) {
    const start = readCapped(candidate.file, SMALL_BYTES, { head: true });
    if (start !== null && namesPlan(lines(start)[0], worktree, plan.trim())) return candidate;
  }
  return null;
}

// What both functions below read: the brief, its plan, and the ledger with its
// text (null when there is none, or it is over its limit). Read once per run.
export function loadFeature(worktree, { brief = readBrief(worktree), ledger } = {}) {
  const plan = planOf(brief);
  const found = ledger === undefined ? (plan === null ? null : findLedger(worktree, plan)) : ledger;
  const text = found ? (found.text ?? readCapped(found.file, LEDGER_BYTES)) : null;
  return { brief, plan, ledger: found && text !== null ? { ...found, text } : null };
}

// The plan's text, from a path inside the worktree only.
export function readPlan(worktree, plan) {
  const file = path.resolve(worktree, plan);
  const rel = path.relative(worktree, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return readCapped(file, PLAN_BYTES);
}

// The task numbers of the plan's `### Task N` headings, leaving out any inside
// a fenced code block.
function planTasks(text) {
  const seen = new Set();
  let fence = null;
  for (const line of lines(text ?? '')) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = /^###\s+Task\s+(\d+)\b/.exec(line);
    if (m) seen.add(Number(m[1]));
  }
  return seen;
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

// The pull request number open-pr kept in pr.json as `{ pr }`, or null.
export function readPr(worktree) {
  try {
    const kept = JSON.parse(readCapped(featurePaths(worktree).pr, SMALL_BYTES) ?? 'null');
    return isPlain(kept) && Number.isSafeInteger(kept.pr) && kept.pr >= 1 ? kept.pr : null;
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

// --- The project's views ---

// One of the project's views as the helper last wrote it (`views/<name>.json`,
// or `views.old` while the views are being replaced); null when the project or
// the view can't be found, or the view is not an object.
function readView(worktree, name) {
  try {
    const root = findRepoRoot(worktree);
    const found = root === null ? null : projectForFolder(fs.realpathSync.native(root));
    if (!found) return null;
    const base = path.join(wheelhouseHome(), 'projects', found.project, 'views');
    const text = readCapped(path.join(base, `${name}.json`), VIEW_BYTES) ?? readCapped(path.join(`${base}.old`, `${name}.json`), VIEW_BYTES);
    const view = JSON.parse(text ?? 'null');
    return isPlain(view) ? view : null;
  } catch {
    return null;
  }
}

// The ids of the questions the director has answered, from the questions view:
// those whose `answer` is not null.
export function answeredInViews(worktree) {
  const answered = new Set();
  for (const [id, entry] of Object.entries(readView(worktree, 'questions') ?? {})) {
    if (isPlain(entry?.answer)) answered.add(id);
  }
  return answered;
}

// The slice the latest `feature` event for `work` names, from the features
// view; null when it is absent or not n of m.
export function sliceInViews(worktree, work) {
  const slice = readView(worktree, 'features')?.[work]?.data?.slice;
  const ok = isPlain(slice) && Object.keys(slice).length === 2
    && Number.isInteger(slice.n) && Number.isInteger(slice.m) && slice.n >= 1 && slice.n <= slice.m;
  return ok ? { n: slice.n, m: slice.m } : null;
}

// --- The status ---

// The feature's Status, from files alone. `answered(worktree)` gives the ids of
// answered questions and `slice(worktree, work)` the current slice; both read
// the project's views unless a caller passes its own. `feature` is what
// loadFeature read, when the caller has it already. Throws when the brief
// can't be read, since the status names its work and lane.
export function buildStatus({ worktree, now = () => new Date(), tokens = null, answered = answeredInViews, slice = sliceInViews, feature }) {
  const { brief, plan, ledger } = feature ?? loadFeature(worktree);
  const p = featurePaths(worktree);

  let task = null;
  let fixRound = null;
  let building = false;
  if (ledger !== null) {
    const headings = planTasks(readPlan(worktree, plan));
    const read = readTasks(ledger.text);
    const n = [...read.complete].filter((k) => headings.has(k)).length;
    task = headings.size > 0 ? { n, m: headings.size } : null;
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
    slice: slice(worktree, brief.work),
    tokens,
    updatedAt: now().toISOString(),
  };
}

// --- The rulings ---

// The rulings kept so far, one JSON string per line, and the file's text. Null
// when the file is there but is not a regular file, or is too big to read
// whole, so nothing is written that might clobber or repeat what is there.
function keptRulings(file) {
  const stat = lstatOf(file);
  if (stat === null) return { list: [], text: '' };
  const text = readCapped(file, RULINGS_BYTES);
  if (text === null) return null;
  const list = [];
  for (const line of lines(text)) {
    try {
      const value = JSON.parse(line);
      if (typeof value === 'string') list.push(value);
    } catch { /* not a ruling line */ }
  }
  return { list, text };
}

// Keeps in rulings.jsonl, one JSON string per line and in ledger order, each
// ledger line holding `Ruling:` (trimmed) that is not kept already. The file is
// rewritten whole (what was kept, then what is added) and renamed into place,
// never appended to, so runs at the same moment can't repeat a line.
// Returns the lines it added. Nothing is written without a ledger.
export function captureRulings({ worktree, feature }) {
  const { ledger } = feature ?? loadFeature(worktree);
  if (ledger === null || !safeFeatureFolder(worktree)) return [];
  const file = featurePaths(worktree).rulings;
  const kept = keptRulings(file);
  if (kept === null) return [];
  const seen = new Set(kept.list);
  const added = [];
  for (const line of lines(ledger.text)) {
    const text = line.trim();
    if (!text.includes(RULING) || seen.has(text)) continue;
    seen.add(text);
    added.push(text);
  }
  if (added.length === 0) return [];
  const lead = kept.text === '' || kept.text.endsWith('\n') ? '' : '\n';
  writeWhole(file, `${kept.text}${lead}${added.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return added;
}
