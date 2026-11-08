// scripts/hooks/aside-overlap.js
// Warns the director, once, when a worktree aside's branch changes files a live crew piece is also changing (one First
// Mate design, section 6.6). It runs on Stop, in a session whose role is `aside` standing in a linked worktree, and nowhere
// else: never the front desk, a main-folder aside, the foreman, a feature (a helm session included) or a why copy.
//
// The aside's files are those its branch changed since it left the project's main branch, plus its uncommitted and untracked
// files. The crew's files are the dispatcher's own list (`crewRunning`), from the views the desk gives. `clashCheck` judges
// them with the project's `hotFiles`. A clash not yet warned of gives a `systemMessage` for the director and, once, a block
// that asks the session to say it in its reply; the (piece, file) pairs warned of are kept in the worktree, so only a new
// piece or a new file warns again, and a piece that ends drops out. The First Mate hears through one `aside-overlap` record.
// It informs and never holds an edit or a pull request: with the desk unread or git failing it says nothing.
import fs from 'node:fs';
import path from 'node:path';
import { runAndExit, worktreeRoot } from './kit.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { sessionRole, asideKind } from '../lib/role.js';
import { clashCheck } from '../foreman/queue.js';
import { crewRunning } from '../engine/dispatcher.js';
import { effectiveSettings } from '../settings/effective.js';
import { deskClient, unreached } from '../desk/client.js';
import { helperClient } from '../host/helper-client.js';
import { withinBudget } from './pending.js';
import { safeGit } from '../lib/safe-git.js';
import { readCapped, writeWhole } from '../feature/status.js';

// How many of the aside's files are read; more than this are left out.
export const FILES_CAP = 500;
// How long each call to the desk or the helper may take, so Stop is never held for long.
const CALL_BUDGET_MS = 3000;
const WARNED_BYTES = 256 * 1024;
const GIT_TIMEOUT_MS = 5000;
// The folder the worktree keeps its Wheelhouse files in, which is never one of the aside's own files.
const OWN_FOLDER = '.wheelhouse';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x !== '';

// git in `cwd` by the repository's git route (scripts/lib/safe-git.js): the fence alone, as these calls only read. Its output,
// or a throw when git fails. `run` is the route's runner or a stand-in.
async function git(run, cwd, args) {
  const got = await safeGit({ ...(run ? { run } : {}), cwd, list: 'project', look: 'never', timeoutMs: GIT_TIMEOUT_MS })(args);
  if (got?.code !== 0 || typeof got.stdout !== 'string') throw new Error(`git ${args[0]} failed`);
  return got.stdout;
}
const lines = (text) => String(text).split('\n').map((l) => l.trim()).filter((l) => l !== '');
const nulSplit = (text) => String(text).split('\0').filter((p) => p !== '');
const ownFile = (file) => file === OWN_FOLDER || file.startsWith(`${OWN_FOLDER}/`);

// asideFiles({ cwd, base, run }) -> the files the branch changed since its merge base with `base`, and its uncommitted and
// untracked files, each once and at most FILES_CAP; null when any git call fails.
export async function asideFiles({ cwd, base, run } = {}) {
  try {
    const mergeBase = (await git(run, cwd, ['merge-base', 'HEAD', base])).trim();
    if (mergeBase === '') return null;
    const files = new Set(nulSplit(await git(run, cwd, ['diff', '--name-only', '--no-renames', '-z', mergeBase])));
    // The diff names a renamed file by both paths (--no-renames): the old one is changed too. `-z` gives `XY path` entries,
    // a rename or copy followed by its old path, which the diff has already named.
    const entries = nulSplit(await git(run, cwd, ['status', '--porcelain', '-z', '--untracked-files=all']));
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (entry.length < 4) continue;
      files.add(entry.slice(3));
      if (/[RC]/.test(entry.slice(0, 2))) i += 1;
    }
    return [...files].filter((f) => !ownFile(f)).slice(0, FILES_CAP);
  } catch {
    return null;
  }
}

// The value of a setting as a settings view holds it (`{ value }`) or as a plain value.
const valueOf = (entry) => (isPlain(entry) && Object.hasOwn(entry, 'value') ? entry.value : entry);

// mainBranchOf({ cwd, views, run }) -> the project's main branch: the base branch its settings record, else the target of
// origin/HEAD (as `origin/<name>`), else null.
export async function mainBranchOf({ cwd, views, run } = {}) {
  const recorded = valueOf(isPlain(views?.settings) ? views.settings.baseBranch : undefined);
  if (isText(recorded)) return recorded;
  try {
    const target = (await git(run, cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
    return target === '' ? null : target;
  } catch {
    return null;
  }
}

const listed = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(''));

// overlapWords(clashes) -> one sentence per piece, in the order the pieces first appear, naming its files. `clashes` are
// clashCheck's: [{ work, file }].
export function overlapWords(clashes) {
  const byPiece = new Map();
  for (const { work, file } of clashes) {
    const files = byPiece.get(work) ?? [];
    if (!files.includes(file)) files.push(file);
    byPiece.set(work, files);
  }
  return [...byPiece].map(([piece, files]) => `Heads up: this branch changes ${listed(files.map((f) => `\`${f}\``))}, which the crew piece ${piece} is also changing. Merging both will conflict. You could wait for ${piece} to merge and then bring this branch up to date, or ask the First Mate to hold it.`).join(' ');
}

// The file in the worktree holding the (piece, file) pairs already warned of: [{ work, file }].
export function warnedFile(cwd) {
  return path.join(worktreeRoot(cwd) ?? cwd, OWN_FOLDER, 'aside-overlap.json');
}

function readWarned(file) {
  try {
    const list = JSON.parse(readCapped(file, WARNED_BYTES) ?? 'null');
    return Array.isArray(list) ? list.filter((p) => isPlain(p) && isText(p.work) && isText(p.file)).map(({ work, file: f }) => ({ work, file: f })) : [];
  } catch {
    return [];
  }
}

function writeWarned(file, pairs) {
  const dir = path.dirname(file);
  let stat = null;
  try { stat = fs.lstatSync(dir); } catch { /* made below */ }
  if (stat === null) fs.mkdirSync(dir, { recursive: true });
  else if (!stat.isDirectory()) throw new Error(`${OWN_FOLDER} isn't a real folder`);
  writeWhole(file, `${JSON.stringify(pairs)}\n`);
}

// The pieces on the director's card list, from the views: those with a question or a card open on them, the way the
// dispatcher's runner knows them.
function waitingPieces(views) {
  const out = new Set();
  for (const entry of Object.values(isPlain(views?.questions) ? views.questions : {})) {
    if (isPlain(entry) && !entry.answer && isText(entry.question?.data?.work)) out.add(entry.question.data.work);
  }
  for (const card of Array.isArray(views?.waiting) ? views.waiting : []) if (isText(card?.data?.work)) out.add(card.data.work);
  return [...out];
}

// The settings in force as the dispatcher reads them: each key's value. A key the catalogue doesn't hold (`hotFiles`) is
// taken as the project's view gives it.
function flatSettings(views, now) {
  const given = isPlain(views?.settings) ? views.settings : {};
  const raw = Object.fromEntries(Object.entries(given).map(([key, entry]) => [key, valueOf(entry)]));
  const effective = Object.fromEntries(Object.entries(effectiveSettings({ project: given, now })).map(([key, entry]) => [key, entry.value]));
  return { ...raw, ...effective };
}

// The desk as the hook uses it: `read(view)` through the desk client and `write(kind, data)` to the project's record.
function deskOf(cwd) {
  const client = deskClient({ cwd, timeout: CALL_BUDGET_MS });
  return {
    read: (view, args) => client.read(view, args),
    write: (kind, data) => helperClient({ timeout: CALL_BUDGET_MS }).state.write({ cwd, kind, data }),
  };
}

// decide(input, { env, cwd, desk, run, now, role, kind }) -> { systemMessage, decision: 'block', reason } for a clash not yet
// warned of, else undefined.
export async function decide(input, {
  env = process.env, cwd = input?.cwd, desk, run, now = () => new Date(), role = sessionRole, kind = asideKind,
} = {}) {
  try {
    if (input?.stop_hook_active === true || typeof cwd !== 'string') return undefined;
    if (role({ sessionId: input?.session_id, env, cwd }) !== 'aside' || kind({ cwd }) !== 'worktree') return undefined;
    const where = desk ?? deskOf(cwd);
    const got = await where.read('waiting');
    if (unreached(got) || got?.ok !== true || !isPlain(got.data?.views)) return undefined;
    const { views } = got.data;
    const clock = typeof now === 'function' ? now() : now;
    const base = await mainBranchOf({ cwd, views, run });
    if (base === null) return undefined;
    const files = await asideFiles({ cwd, base, run });
    if (files === null) return undefined;
    const branch = (await git(run, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (branch === '') return undefined;

    const settings = flatSettings(views, clock);
    // Reservations, pieces on their way back and admitted ones live in the dispatcher's own process, so they are empty here.
    const running = crewRunning({
      work: views.work, runs: views.runs, reports: views.reports, features: views.features, settings,
      waiting: waitingPieces(views), reserved: {}, returning: [], admitted: [], stoppedFeatures: [],
    });
    const { clashes } = clashCheck({ files, running, hotFiles: Array.isArray(settings.hotFiles) ? settings.hotFiles : [] });

    const file = warnedFile(cwd);
    const before = readWarned(file);
    const kept = before.filter((w) => running.some((r) => r.work === w.work));
    const fresh = clashes.filter((c) => !kept.some((w) => w.work === c.work && w.file === c.file));
    const same = (a, b) => a.length === b.length && a.every((w, i) => w.work === b[i].work && w.file === b[i].file);
    if (fresh.length === 0) {
      if (!same(before, kept)) writeWarned(file, kept);
      return undefined;
    }

    const pairs = fresh.filter((c, i) => fresh.findIndex((o) => o.work === c.work && o.file === c.file) === i).map(({ work, file: f }) => ({ work, file: f }));
    const data = { branch, pieces: [...new Set(pairs.map((p) => p.work))], files: [...new Set(pairs.map((p) => p.file))], at: clock.toISOString() };
    // The First Mate hears of it through the record; the director has been told in this window either way.
    await withinBudget(Date.now() + CALL_BUDGET_MS)(where.write('aside-overlap', data));
    writeWarned(file, [...kept, ...pairs]);
    const words = overlapWords(pairs);
    return { systemMessage: words, decision: 'block', reason: words };
  } catch {
    return undefined;
  }
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: false, event: 'Stop' });
}
