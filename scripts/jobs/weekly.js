// scripts/jobs/weekly.js
// The weekly jobs: the check of the official sources, a backup of every registered project's
// state, and a sync of the director's profile. A session start runs `weekly-main.js`, detached,
// when `weeklyDue` says a week has passed; the process calls `runWeekly`.
//
// Under jobsDir():
//   weekly.json   { lastRun, result }  written once all three have been tried. `result` keeps
//                 counts and reasons only; the whole sources report is in sources/report.json.
//                 When the helper couldn't be reached for any of its calls there is no lastRun.
//   weekly.lock   held while the jobs run, so two sessions starting together run them once
//
// Git and the host are reached only through the helper (`client`).
import fs from 'node:fs';
import path from 'node:path';
import { jobsDir, wheelhouseHome } from '../lib/paths.js';
import { WEEK_MS } from '../lib/core-numbers.js';
import { readProject } from '../lib/projects.js';
import { takeStartLock } from '../lib/start-lock.js';
import { DEFAULT_SOURCES } from '../sources/list.js';
import { runSourcesCheck } from '../sources/check.js';
import { effectiveSettings } from '../settings/effective.js';
import { readProfileViews } from '../profile/store.js';
import { readSmallText } from '../hooks/kit.js';

// Longer than the jobs take; a lock older than this belongs to a run that died.
const LOCK_STALE_MS = 30 * 60 * 1000;
const MAX_NESTING = 3;

const recordFile = () => path.join(jobsDir(), 'weekly.json');

// `now` as an ISO time: a Date, a time, or a function giving either. Throws for one that can't be read.
function isoOf(value) {
  const time = new Date(typeof value === 'function' ? value() : value ?? Date.now()).getTime();
  if (Number.isNaN(time)) throw new Error('The weekly jobs need a valid time');
  return new Date(time).toISOString();
}

// Whether the jobs are due: no record, a damaged one, a last run a week old or more, or a last
// run in the future (a clock that was wrong).
export function weeklyDue(now) {
  let lastRun;
  try {
    lastRun = Date.parse(JSON.parse(fs.readFileSync(recordFile(), 'utf8'))?.lastRun);
  } catch {
    return true;
  }
  if (Number.isNaN(lastRun)) return true;
  const nowMs = Date.parse(isoOf(now));
  return lastRun > nowMs || nowMs - lastRun >= WEEK_MS;
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

// The registered projects: every folder under projects/ with a readable record.
function registeredProjects() {
  let names;
  try {
    names = fs.readdirSync(path.join(wheelhouseHome(), 'projects'));
  } catch {
    return [];
  }
  const found = [];
  for (const name of names.sort()) {
    const record = readProject(name);
    if (record) found.push({ project: name, record });
  }
  return found;
}

// A project's settings view, as the helper last wrote it (`views.old` between its two renames).
function settingsView(project) {
  const base = path.join(wheelhouseHome(), 'projects', project, 'views');
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

// The reason in an answer that was not ok, in the helper's own words.
const reasonOf = (answer) => answer?.why ?? answer?.refused ?? 'The host helper gave no reason';
// Whether an answer is the helper client's own for a helper that gave none, or a call that threw.
const NO_ANSWER = /^the host helper (?:could not be reached|did not answer in time)/;
const THREW = Symbol('threw');
const notReached = (answer) => answer === THREW || (answer?.ok !== true && NO_ANSWER.test(answer?.refused ?? ''));

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

// `answers` collects each raw answer (THREW for a call that threw), so the run can tell a
// helper that was down from one that answered.
async function backUp(client, projects, answers) {
  const backups = [];
  for (const { project } of projects) {
    try {
      const answer = await client.state.backup({ project });
      answers.push(answer);
      if (answer?.ok === true) backups.push({ project, ok: true, ...(typeof answer.why === 'string' ? { why: answer.why } : {}) });
      else backups.push({ project, ok: false, why: reasonOf(answer) });
    } catch (error) {
      answers.push(THREW);
      backups.push({ project, ok: false, why: whyOf(error) });
    }
  }
  return backups;
}

async function syncProfile(client, answers) {
  try {
    const answer = await client.profile.sync({});
    answers.push(answer);
    if (answer?.ok === true) return { ok: true, ...(Number.isInteger(answer.unpushed) ? { unpushed: answer.unpushed } : {}) };
    return { ok: false, why: reasonOf(answer) };
  } catch (error) {
    answers.push(THREW);
    return { ok: false, why: whyOf(error) };
  }
}

// Runs the three jobs once a week. One failure never stops the rest. Resolves with
// `{ sources: SourcesReport | null, backups: [{ project, ok, why? }], profile: { ok, why? } }`,
// or, when another run holds the lock or has already done this week's jobs,
// `{ skipped: true, why }` and nothing runs. `root` and `sourcesCheck` are for tests.
export async function runWeekly({ now, fetch = globalThis.fetch, client, root, sourcesCheck = runSourcesCheck } = {}) {
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
    if (!weeklyDue(at)) return { skipped: true, why: 'The weekly jobs have already run this week' };
    const projects = registeredProjects();

    let sources = null;
    let sourcesResult;
    try {
      sources = await sourcesCheck({
        fetch, now: at, sources: sourcesToCheck(projects, at), routedModels: routedModels(projects), ...(root === undefined ? {} : { root }),
      });
      sourcesResult = sourcesCounts(sources);
    } catch (error) {
      sourcesResult = { ok: false, why: whyOf(error) };
    }
    const answers = [];
    const backups = await backUp(client, projects, answers);
    const profile = await syncProfile(client, answers);

    // With the helper down for every call, the run is kept without a last run, so the next
    // session start tries again.
    const lastRun = answers.every(notReached) ? undefined : at;
    writeWhole(recordFile(), `${JSON.stringify({ lastRun, result: { sources: sourcesResult, backups, profile } }, null, 2)}\n`);
    return { sources, backups, profile };
  } finally {
    release();
  }
}
