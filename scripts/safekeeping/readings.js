// scripts/safekeeping/readings.js
// What the status reads (spec 8.2). Reading writes nothing and pushes nothing, in the folder or anywhere else: a project kept here
// reads its backup record and its home, and a hosted project compares its folder with the mirror of the host that the helper
// already keeps, whose fetch is the only way the host is read, at most once an hour. A running lane's branches and deleted
// branches aren't counted, and nor is the private record. `safekeepingTick` is the dispatcher's: it keeps the status beside the
// private record, for the desk's glance and the board to read without waiting on git.
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from '../gate/guardrails.js';
import { backupFile, backupPlace, readBackup, timeMachine } from '../host/local/backup.js';
import { gitRoute, homeGit } from '../host/local/home.js';
import { stateDir } from '../lib/paths.js';
import { notRead, safekeeping, staleStatus } from './status.js';

const HOUR_MS = 60 * 60 * 1000;
const NOTHING_HERE = Object.freeze({ commits: 0, uncommitted: 0, since: null, branches: [] });
const OWN_LINE = /^wheelhouse[-/]/;
const CONFIG_FILE = path.join('.claude', 'wheelhouse.json');

const lines = (got) => (got.code === 0 ? String(got.stdout).split('\n').filter(Boolean) : []);
const instantOf = (now) => (typeof now === 'function' ? now() : now);

// The merges on the main version within `range`: how many, and when the oldest was made.
async function mergesIn(home, range) {
  const made = lines(await home.call(['log', '--first-parent', '--format=%cI', ...range]));
  return { behind: made.length, oldest: made.at(-1) ?? null };
}

async function readLocal({ project, record, git, now, machine, ...how }) {
  const kept = readBackup(project);
  const home = homeGit(project, git);
  const known = kept.main !== null && await home.ok(['cat-file', '-e', `${kept.main}^{commit}`]);
  // A main version the home no longer holds says nothing of what came since, so it can't read as up to date.
  const lost = kept.main !== null && !known;
  const since = known ? await mergesIn(home, ['HEAD', `^${kept.main}`]) : { behind: lost ? 1 : 0, oldest: lost ? kept.at : null };
  const here = kept.folder !== null && fs.existsSync(kept.folder);
  const place = !here ? { ok: true } : backupPlace({ folder: kept.folder, project, root: record.folder, ...how });
  const gone = here && kept.at !== null && !fs.existsSync(backupFile(kept.folder, project));
  const machineSince = machine.on === true && typeof machine.last === 'string' ? await mergesIn(home, [`--since=${machine.last}`, 'HEAD']) : {};
  return {
    place: 'local',
    backup: { at: kept.at, ...since, failed: kept.failedAt !== null, refused: gone ? 'The backup file has gone from its folder' : place.ok ? kept.refused : place.why, pickRefused: kept.pickRefused },
    timeMachine: { ...machine, ...machineSince },
    readAt: instantOf(now).toISOString(),
  };
}

// When the oldest uncommitted file was changed, or null. A file gone from the folder says nothing.
function oldestChange(folder, status) {
  const times = status.flatMap((line) => {
    try {
      return [fs.statSync(path.join(folder, line.slice(3).replace(/^"|"$/g, ''))).mtimeMs];
    } catch {
      return [];
    }
  });
  return times.length === 0 ? null : new Date(Math.min(...times)).toISOString();
}

// What the folder holds that the host doesn't, and how far the host is ahead of it. The folder may lack the host's newest
// commits and the mirror its newest, so the walk starts in the folder, stopping at what it knows the host has (`tips`, every
// head there, pull requests' too, and the folder's own record of the remote), and the mirror then says which of the rest it has.
async function compare({ here, there, running }) {
  const main = await there.must(['symbolic-ref', '--short', 'HEAD'], 'unread');
  const tips = lines(await there.call(['for-each-ref', '--format=%(objectname)']));
  const known = new Set(tips);
  const seen = lines(await here.call(['for-each-ref', '--format=%(objectname)', 'refs/remotes']));
  const stops = [...known, ...seen].map((tip) => `^${tip}`).join('\n');
  const walk = async (from, ...flags) => lines(await here.call(['rev-list', '--ignore-missing', ...flags, '--stdin'], { input: `${from}\n${stops}\n` }));
  const notThere = async (commits) => {
    if (commits.length === 0) return new Set();
    const answers = lines(await there.call(['cat-file', '--batch-check'], { input: `${commits.join('\n')}\n` }));
    return new Set(answers.filter((line) => line.endsWith(' missing')).map((line) => line.split(' ')[0]));
  };
  const branches = lines(await here.call(['for-each-ref', '--format=%(objectname) %(refname:strip=2)', 'refs/heads']))
    .map((line) => [line.slice(0, line.indexOf(' ')), line.slice(line.indexOf(' ') + 1)])
    .filter(([tip, name]) => !OWN_LINE.test(name) && !known.has(tip));
  const only = new Set();
  const named = [];
  for (const [, name] of branches) {
    if (await running(name)) continue;
    const absent = await notThere(await walk(`refs/heads/${name}`));
    if (absent.size > 0) named.push(name);
    for (const commit of absent) only.add(commit);
  }
  const made = only.size === 0 ? [] : lines(await here.call(['log', '--no-walk=unsorted', '--format=%cI', '--stdin'], { input: `${[...only].join('\n')}\n` }));
  // The newest of the folder's main line the host has is where the host counts from.
  const held = await here.call(['rev-parse', '--verify', '-q', `refs/heads/${main}^{commit}`]);
  let behind = 0;
  if (held.code === 0) {
    const tip = String(held.stdout).trim();
    const walked = known.has(tip) ? [] : await walk(tip, '--boundary');
    const commits = walked.map((line) => line.replace(/^-/, ''));
    const absent = await notThere(commits);
    const shared = known.has(tip) ? [tip] : commits.filter((commit) => !absent.has(commit));
    if (shared.length > 0) {
      const counted = await there.call(['rev-list', '--count', '--ignore-missing', '--stdin'], { input: `refs/heads/${main}\n${shared.map((sha) => `^${sha}`).join('\n')}\n` });
      behind = Number(String(counted.stdout).trim()) || 0;
    }
  }
  return { made, named, behind };
}

async function readHosted({ record, mirror, host, running, git, now }) {
  const none = { place: record.host, reachedAt: host.reachedAt ?? null, triedSince: host.triedSince ?? null, behind: 0, onlyHere: NOTHING_HERE, readAt: instantOf(now).toISOString() };
  if (typeof mirror !== 'string' || !fs.existsSync(path.join(mirror, 'HEAD'))) return none;
  const { folder } = record;
  const here = git(folder, { reach: 'local', what: 'the project\'s folder' });
  const there = git(mirror, { reach: 'local', what: 'the mirror' });
  const { made, named, behind } = await compare({ here, there, running });
  const dirty = lines(await here.call(['--no-optional-locks', 'status', '--porcelain']));
  const times = [...made, ...(dirty.length > 0 ? [oldestChange(folder, dirty)] : [])].filter((t) => typeof t === 'string').map((t) => Date.parse(t));
  const since = times.length === 0 ? null : new Date(Math.min(...times)).toISOString();
  return { ...none, behind, onlyHere: { commits: made.length, uncommitted: dirty.length, since, branches: named } };
}

// readSafekeeping({ project, record, git, now, mirror, running, host, machine }) -> readings, or null for a project with no
// status: a Lean project has no record here, and keeps its own copy step. `mirror` is the folder of the host's mirror, `running(branch)`
// says a lane is on a branch, `host` is { reachedAt, triedSince }, and `machine` timeMachine's reading.
export async function readSafekeeping({ project, record, git = gitRoute(), now = () => new Date(), mirror, running = () => false, host = {}, machine = { on: false, last: null }, ...how }) {
  if (record === null || record === undefined) return null;
  if (record.host === 'local') return readLocal({ project, record, git, now, machine, ...how });
  return readHosted({ record, mirror, host, running, git, now });
}

export const safekeepingFile = (project) => path.join(path.dirname(stateDir(project)), 'safekeeping.json');

function readKept(project) {
  try {
    const kept = JSON.parse(fs.readFileSync(safekeepingFile(project), 'utf8'));
    return kept !== null && typeof kept === 'object' ? kept : {};
  } catch {
    return {};
  }
}

// The status the last tick kept, or null. One no tick has renewed can't still say all is well.
export const readStatus = (project, { now = () => new Date() } = {}) => {
  const { status = null } = readKept(project);
  return status === null ? null : staleStatus(status, { now: instantOf(now) });
};
// What the last tick read, for an action to go by.
export const readReadings = (project) => readKept(project).readings ?? null;

function keep(project, kept) {
  const file = safekeepingFile(project);
  const part = `${file}.${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(part, `${JSON.stringify(kept, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(part, file);
}

function limitsOf(folder) {
  try {
    return readConfig(fs.readFileSync(path.join(folder, CONFIG_FILE), 'utf8')).safekeeping ?? {};
  } catch {
    return {};
  }
}

// One look at a project: the host once an hour, or now with `force`, Time Machine the same, then the readings, and the status
// kept beside the private record. `refresh()` is the helper's fetch of the mirror, { ok } or a refusal.
export async function safekeepingTick({ project, record, git = gitRoute(), now = () => new Date(), mirror, running, refresh = async () => ({ ok: false }), machine = timeMachine, force = false, ...how }) {
  if (record === null || record === undefined) return null;
  const at = instantOf(now);
  const kept = readKept(project);
  const due = force || Number.isNaN(Date.parse(kept.triedAt)) || at.getTime() - Date.parse(kept.triedAt) >= HOUR_MS || Date.parse(kept.triedAt) > at.getTime();
  const next = { triedAt: kept.triedAt ?? null, reachedAt: kept.reachedAt ?? null, triedSince: kept.triedSince ?? null, machine: kept.machine ?? { on: false, last: null } };
  if (due) {
    next.triedAt = at.toISOString();
    if (record.host === 'local') next.machine = await machine();
    else {
      const got = await refresh().catch(() => ({ ok: false }));
      if (got?.ok === true) Object.assign(next, { reachedAt: at.toISOString(), triedSince: null });
      else next.triedSince ??= at.toISOString();
    }
  }
  // A look that fails can't leave the last status standing as if it were still so.
  try {
    const readings = await readSafekeeping({ project, record, git, now: () => at, mirror, running, host: next, machine: next.machine, ...how });
    const status = safekeeping(readings, { ...limitsOf(record.folder), now: at });
    keep(project, { ...next, status, readings });
    return status;
  } catch {
    const status = notRead({ place: record.host, now: at });
    keep(project, { ...next, status, readings: null });
    return status;
  }
}
