// scripts/update/board.js
// What the board and the session start say about updates (design 2026-11-04-update-command-design.md,
// sections 5 and 14): the weekly look for a newer release and its cache, the facts the board's lines
// are made from (read from the update's journal and the project's settings, writing nothing), and the
// one confirming line at the first session after an update. Nothing here asks the director for anything.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from '../lib/paths.js';
import { compareVersions } from '../lib/versions.js';
import { WHEELHOUSE_REPO } from '../lineage/manifest.js';
import { declined } from './declined.js';
import { openJournal, updateLockHeld } from './journal.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOK_EVERY_MS = 7 * DAY_MS;
// After a look that failed or ran out of time, the next waits this long.
const TRY_AGAIN_MS = 60 * 60 * 1000;
// How long a look may take before it is given up.
export const LOOK_WAIT_MS = 5000;
const PLAIN_TAG = /^v\d+\.\d+\.\d+$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const withV = (version) => (typeof version === 'string' && version !== '' ? (version.startsWith('v') ? version : `v${version}`) : null);

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

export function dayMonthYear(time) {
  const date = new Date(time);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// The release the project's committed settings name for Wheelhouse's marketplace, or null.
export function projectRef(folder) {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(folder, '.claude', 'settings.json'), 'utf8'));
    for (const entry of Object.values(settings?.extraKnownMarketplaces ?? {})) {
      const ref = entry?.source?.repo === WHEELHOUSE_REPO ? entry.source.ref : null;
      if (typeof ref === 'string' && PLAIN_TAG.test(ref)) return ref;
    }
  } catch { /* none */ }
  return null;
}

// This copy of Wheelhouse's version, v-prefixed, from the plugin.json beside these scripts; null when unreadable.
export function runningVersion() {
  try {
    return withV(JSON.parse(fs.readFileSync(new URL('../../.claude-plugin/plugin.json', import.meta.url), 'utf8'))?.version);
  } catch {
    return null;
  }
}

const latestFile = () => path.join(wheelhouseHome(), 'update', 'latest.json');

function readKept() {
  try {
    const kept = JSON.parse(fs.readFileSync(latestFile(), 'utf8'));
    return {
      tag: typeof kept?.tag === 'string' && PLAIN_TAG.test(kept.tag) ? kept.tag : null,
      at: Number.isFinite(Date.parse(kept?.at)) ? Date.parse(kept.at) : null,
      triedAt: Number.isFinite(Date.parse(kept?.triedAt)) ? Date.parse(kept.triedAt) : null,
    };
  } catch {
    return { tag: null, at: null, triedAt: null };
  }
}

// The newest release the last look found: { tag, due }, `due` when a new look is wanted (none yet,
// the last over a week old, and the last attempt not within the hour). Reads one small file.
export function readLatest({ now = () => new Date() } = {}) {
  const kept = readKept();
  const at = now().getTime();
  const old = kept.at === null || at - kept.at >= LOOK_EVERY_MS || kept.at > at;
  const tried = kept.triedAt !== null && kept.triedAt <= at && at - kept.triedAt < TRY_AGAIN_MS;
  return { tag: kept.tag, due: old && !tried };
}

// The weekly look: one `ls-remote`, raced against `waitMs` so it never holds anything up. It keeps
// the highest plain release in a small file; a look that fails or runs out of time keeps the last
// answer and waits an hour before the next. Resolves true when it kept a new answer, never throws.
export async function lookForLatest({ now = () => new Date(), list, waitMs = LOOK_WAIT_MS } = {}) {
  try {
    // release.js reaches the fenced tool; only the look loads it, so the session start's imports stay light.
    const { listReleases, latestRelease } = await import('./release.js');
    const lister = list ?? listReleases;
    if (!readLatest({ now }).due) return false;
    const kept = readKept();
    const stamp = now().toISOString();
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
    let found;
    try {
      found = await Promise.race([Promise.resolve().then(() => lister()).catch(() => null), late]);
    } finally {
      clearTimeout(timer);
    }
    if (!Array.isArray(found)) {
      writeAtomic(latestFile(), `${JSON.stringify({ tag: kept.tag, at: kept.at === null ? undefined : new Date(kept.at).toISOString(), triedAt: stamp })}\n`);
      return false;
    }
    writeAtomic(latestFile(), `${JSON.stringify({ tag: latestRelease(found)?.tag ?? null, at: stamp })}\n`);
    return true;
  } catch {
    return false;
  }
}

// The update's journal for the project as plain facts: the release it is for, its steps, and whether
// a process holds the lock. Null when there is no journal or it is from a newer Wheelhouse.
function journalFacts(project) {
  try {
    const journal = openJournal(project);
    const read = journal.read();
    if (read.newer) return null;
    const tag = withV(read.steps.checks?.data?.tag);
    return { steps: read.steps, tag: tag !== null && PLAIN_TAG.test(tag) ? tag : null, held: updateLockHeld() };
  } catch {
    return null;
  }
}

const started = (steps) => Object.values(steps).some((s) => s.state !== 'todo');

// What the board needs to say about updates for one project. `version` is the running copy's
// (v-prefixed or not), `latest` the weekly look's tag, `helperVersion` what the helper answers.
// Each part is null when there is nothing to say. Reads files only.
export function updateFacts({ project, folder, version, latest = null, helperVersion = null, now = () => new Date() } = {}) {
  const has = withV(version);
  const facts = { version: has, updatedAt: null, newer: null, partway: null, refresh: null, mismatch: null, oldHelper: null };
  const at = now().getTime();
  const journal = journalFacts(project);
  if (journal !== null && journal.tag !== null) {
    const { steps, tag, held } = journal;
    const done = steps.done?.state === 'done';
    if (done && tag === has) {
      const when = Date.parse(steps.done.at);
      if (Number.isFinite(when) && at >= when && at - when < 7 * DAY_MS) facts.updatedAt = steps.done.at;
    }
    if (!done && started(steps)) {
      const failed = Object.entries(steps).find(([, s]) => s.state === 'failed');
      if (failed && failed[0] === 'finish' && steps.installs?.state === 'done') {
        const data = steps.finish.data;
        facts.refresh = { tag, left: typeof data?.left === 'string' ? data.left : (typeof data?.line === 'string' ? data.line : null) };
      } else if (failed) {
        facts.partway = { kind: 'stopped', tag };
      } else if (!held) {
        facts.partway = { kind: 'stopped', tag };
      } else if (steps.merged?.state === 'running') {
        facts.partway = { kind: 'merge', tag };
      } else if (steps.idle?.state === 'running') {
        facts.partway = { kind: 'idle', tag };
      }
    }
  }
  if (typeof latest === 'string' && PLAIN_TAG.test(latest) && has !== null && compareVersions(latest, has) === 1 && declined(project)?.tag !== latest) {
    facts.newer = latest;
  }
  const names = typeof folder === 'string' ? projectRef(folder) : null;
  if (names !== null && has !== null && compareVersions(names, has) === 1 && !(journal?.held ?? false)) facts.mismatch = { names, has };
  const helper = withV(helperVersion);
  if (helper !== null && has !== null && compareVersions(helper, has) === -1) facts.oldHelper = helper;
  return facts;
}

const confirmedFile = (project) => path.join(openJournal(project).folder, 'confirmed.json');

// The one line at the first session after an update has finished, naming this session's version and the
// helper's, or null (and nothing kept) when there is nothing to say yet or it has been said. A session
// still on the old release neither says it nor uses it up. Writes a small marker when it speaks.
export function confirmingLine({ project, sessionVersion, helperVersion, now = () => new Date() } = {}) {
  try {
    const journal = journalFacts(project);
    if (journal === null || journal.tag === null || journal.steps.done?.state !== 'done') return null;
    const mine = withV(sessionVersion);
    if (mine !== journal.tag) return null;
    try {
      if (JSON.parse(fs.readFileSync(confirmedFile(project), 'utf8'))?.tag === journal.tag) return null;
    } catch { /* not said yet */ }
    const when = Date.parse(journal.steps.done.at);
    const today = Number.isFinite(when) && dayMonthYear(when) === dayMonthYear(now().getTime());
    const approved = journal.steps.merged?.data?.approved;
    const parts = [`updated ${Number.isFinite(when) ? (today ? 'today' : dayMonthYear(when)) : 'recently'}`];
    if (approved === true) parts.push('approved by you');
    else if (approved === false) parts.push('reviewed without your approval');
    const helper = withV(helperVersion);
    const tail = helper === null ? '' : (helper === mine ? `; the helper is ${helper}` : `; the helper is still ${helper}`);
    writeAtomic(confirmedFile(project), `${JSON.stringify({ tag: journal.tag })}\n`);
    return `Wheelhouse ${mine} is running (${parts.join(', ')})${tail}.`;
  } catch {
    return null;
  }
}
