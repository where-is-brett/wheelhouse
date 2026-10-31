// scripts/jobs/weekly.js
// The weekly job: the check of the official sources. A session start runs `weekly-main.js`,
// detached, when `weeklyDue` says a week has passed; the process calls `runWeekly`. Each project's
// record and the settings are local repositories with no remote (design section 24), so there is
// no backup or sync to make.
//
// A project in git alone has no host to read protection from, so the week also looks at its home (spec 7.7): what is wrong goes on
// the project's Logbook.
//
// Under jobsDir():
//   weekly.json   { lastRun, result }  written once the week's sources check has run.
//                 lastRun     when this week's check ran: the week counts from it
//                 `result` keeps counts and reasons only; the whole sources report is in
//                 sources/report.json.
//                 A record v0.1.x kept counts its week from its sourcesRun when it has one, else
//                 from its lastRun; its retryAt is no longer read.
//   weekly.lock   held while the job runs, so two sessions starting together run it once
import fs from 'node:fs';
import path from 'node:path';
import { jobsDir, projectsDir } from '../lib/paths.js';
import { WEEK_MS } from '../lib/core-numbers.js';
import { registeredProjects } from '../lib/projects.js';
import { takeStartLock } from '../lib/start-lock.js';
import { DEFAULT_SOURCES } from '../sources/list.js';
import { runSourcesCheck } from '../sources/check.js';
import { effectiveSettings } from '../settings/effective.js';
import { readProfileViews } from '../profile/store.js';
import { readSmallText } from '../hooks/kit.js';
import { lookAtHome } from '../host/local/home.js';
import { seenMain } from '../host/local/merge.js';
import { makeEvent, writeEvent } from '../state/events.js';
import { openProjectRecord } from '../state/record.js';

// Longer than the job takes; a lock older than this belongs to a run that died.
const LOCK_STALE_MS = 30 * 60 * 1000;
const MAX_NESTING = 3;

const recordFile = () => path.join(jobsDir(), 'weekly.json');

// `now` as an ISO time: a Date, a time, or a function giving either. Throws for one that can't be read.
function isoOf(value) {
  const time = new Date(typeof value === 'function' ? value() : value ?? Date.now()).getTime();
  if (Number.isNaN(time)) throw new Error('The weekly jobs need a valid time');
  return new Date(time).toISOString();
}

const readRecord = () => {
  try { return JSON.parse(fs.readFileSync(recordFile(), 'utf8')); } catch { return undefined; }
};

// Whether the week is due for a record at `nowMs`: with no record, a damaged one, a week start a
// week old or more, or one in the future (a clock that was wrong).
function dueFor(record, nowMs) {
  const weekFrom = Date.parse(record?.sourcesRun ?? record?.lastRun);
  return Number.isNaN(weekFrom) || weekFrom > nowMs || nowMs - weekFrom >= WEEK_MS;
}

// Whether the job is due: a new week.
export function weeklyDue(now) {
  return dueFor(readRecord(), Date.parse(isoOf(now)));
}

function writeWhole(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, body);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A project's settings view, as the helper last wrote it (`views.old` between its two renames).
function settingsView(project) {
  const base = path.join(projectsDir(), project, 'views');
  for (const folder of [base, `${base}.old`]) {
    const view = readJson(path.join(folder, 'settings.json'));
    if (isObject(view)) return view;
  }
  return null;
}

// The default pages, then each other address a project's effective `sources` setting names.
function sourcesToCheck(projects, now) {
  const list = [...DEFAULT_SOURCES];
  const seen = new Set(list.map((s) => s.url));
  const profile = readProfileViews()?.settings;
  for (const { project } of projects) {
    const view = settingsView(project);
    if (!view) continue;
    let urls;
    try {
      urls = effectiveSettings({ project: view, profile: isObject(profile) ? profile : {}, now }).sources?.value;
    } catch {
      continue;
    }
    for (const url of Array.isArray(urls) ? urls : []) {
      if (typeof url === 'string' && !seen.has(url)) {
        seen.add(url);
        list.push(url);
      }
    }
  }
  return list;
}

function stringsIn(value, depth, into) {
  if (typeof value === 'string') into.add(value.trim());
  else if (depth < MAX_NESTING && value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) stringsIn(inner, depth + 1, into);
  }
}

const CONFIG_MAX_BYTES = 256 * 1024;

// The project's configuration, read only when it is a regular file (not a link, not a pipe)
// of reasonable size, inside a `.claude` that is a real folder: the project's folder is one an
// agent controls. readSmallText opens without waiting and reads only a regular file within the
// limit, so a pipe put there between the check and the read is never waited on.
function readConfig(folder) {
  try {
    const dir = path.join(folder, '.claude');
    const file = path.join(dir, 'wheelhouse.json');
    if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(file).isSymbolicLink()) return undefined;
    const text = readSmallText(file, CONFIG_MAX_BYTES);
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Every model named in a project's `.claude/wheelhouse.json` routing. A missing or damaged file adds none.
function routedModels(projects) {
  const models = new Set();
  for (const { record } of projects) {
    const config = readConfig(record.folder);
    if (isObject(config) && isObject(config.routing)) stringsIn(config.routing, 0, models);
  }
  models.delete('');
  return [...models];
}

const whyOf = (error) => (error instanceof Error ? error.message : String(error));

function sourcesCounts(report) {
  const list = Array.isArray(report?.sources) ? report.sources : [];
  const retiring = Array.isArray(report?.retiring) ? report.retiring : [];
  return {
    ok: true,
    checked: list.length,
    unread: list.filter((s) => !s.ok).length,
    changed: list.filter((s) => s.changed).length,
    newModels: (report?.newModels ?? []).length,
    newLinks: (report?.newLinks ?? []).length,
    retiring: retiring.length,
    retiringRouted: retiring.filter((r) => r.routed).length,
  };
}

// Looks at each local project's home, and writes what is wrong to its Logbook. A project that can't be read holds up no other.
export async function lookAtHomes(projects, { look = lookAtHome, note = homeNote } = {}) {
  const found = [];
  for (const { project } of projects.filter((p) => p.record?.host === 'local')) {
    const got = await look({ project, seen: seenMain(project) }).catch(() => ({ ok: false, why: 'it couldn\'t be read' }));
    found.push({ project, ...got });
    if (got.ok !== true) await note(project, `This project's home needs looking at: ${got.why}. Your folder holds a full copy of the history.`).catch(() => {});
  }
  return found;
}
async function homeNote(project, words) {
  await openProjectRecord(project, {});
  await writeEvent({ project, event: makeEvent({ kind: 'note', data: { about: 'engine', words } }) });
}

// Runs the sources check once a week. Resolves with `{ sources: SourcesReport | null }` (null for a
// check that threw), or, when another run holds the lock or the week isn't due, `{ skipped: true,
// why }` and nothing runs. `root` and `sourcesCheck` are for tests.
export async function runWeekly({ now, fetch = globalThis.fetch, root, sourcesCheck = runSourcesCheck, homes = lookAtHomes } = {}) {
  const at = isoOf(now);
  let release;
  try {
    release = await takeStartLock(path.join(jobsDir(), 'weekly.lock'), {
      message: 'Another session is running the weekly jobs', waitMs: 0, staleMs: LOCK_STALE_MS,
    });
  } catch (error) {
    return { skipped: true, why: whyOf(error) };
  }
  try {
    if (!dueFor(readRecord(), Date.parse(at))) return { skipped: true, why: 'The weekly jobs have already run this week' };
    const projects = registeredProjects();
    let sources = null;
    let result;
    try {
      sources = await sourcesCheck({
        fetch, now: at, sources: sourcesToCheck(projects, at), routedModels: routedModels(projects), ...(root === undefined ? {} : { root }),
      });
      result = sourcesCounts(sources);
    } catch (error) {
      result = { ok: false, why: whyOf(error) };
    }
    await homes(projects).catch(() => {});
    writeWhole(recordFile(), `${JSON.stringify({ lastRun: at, result: { sources: result } }, null, 2)}\n`);
    return { sources };
  } finally {
    release();
  }
}
