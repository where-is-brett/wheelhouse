// scripts/usage/store.js
// The usage store: counts of use, a day at a time, under usageDir().
//
// What the captured telemetry showed (check 7: three requests from one short headless session,
// each saved from the local receiver's port, read again for this store):
//   - `query_source` appeared on the cost and token data points, with one value only: `main`.
//     No subagent or other value was captured, because the session ran a single prompt, so the
//     other words Claude Code may send are not known from the capture. The receiver keeps any
//     one short word (a-z, "_" and "-", up to 32 letters) and drops anything else.
//   - The token series, and the cost and session-count series with them, were DELTA
//     (aggregationTemporality 1): each export held the counts since the last export, with a new
//     start time each time. Nothing captured was cumulative (aggregationTemporality 2), but the
//     store handles both, since the temporality is a setting of the exporter. A delta point is
//     added as it is, and a cumulative one by its increase since the last point of its series.
//
// Layout:
//   series.json            for a cumulative series its last value, and for a delta one its
//                          recent export times, so a repeat adds nothing
//   records/<date>.jsonl   increases: { at, session, model, type?, source?, tokens? | usd? }
//   mod/<date>.jsonl       the mod's readings of a session's running cost: { at, session, usd }
//   allowance.json         the latest rate-limit windows: { at, windows }
//   sessions/<id>.json     what a session is for, written once
//   days/<date>.json       a day's summary, from the two raw folders
//
// A file is always written whole, as a temporary file and then a rename, except the day files
// that lines are appended to. Only counts are kept: never prompt or tool text, never the
// account's email or IDs.
import fs from 'node:fs';
import path from 'node:path';
import { usageDir } from '../lib/paths.js';
import { KEEP_DAYS } from '../lib/core-numbers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Matches the receiver's rule for a session ID, since the ID names a file.
const SESSION = /^(?!\.+$)[A-Za-z0-9._-]{1,128}$/;
const MODEL = /^[A-Za-z0-9._:/[\]-]{1,100}$/;
const KIND = /^[A-Za-z]{1,32}$/;
const SOURCE = /^[a-z_-]{1,32}$/;
const LABEL = /^[\w .:-]{1,40}$/;
const PROJECT = /^(?!\.+$)[A-Za-z0-9._-]{1,200}$/;
const ROLES = ['front-desk', 'foreman', 'feature'];

const isoOf = (value) => {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};
// `now` may be a function, a Date or text.
const instant = (now) => {
  const iso = isoOf(typeof now === 'function' ? now() : now ?? new Date());
  if (!iso) throw new Error('The usage store needs a valid time');
  return iso;
};
const round = (number) => Math.round(number * 1e9) / 1e9;
const dateOf = (iso) => iso.slice(0, 10);

function checkDate(date) {
  if (typeof date !== 'string' || !DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    || dateOf(new Date(`${date}T00:00:00Z`).toISOString()) !== date) {
    throw new Error('A usage date must be written YYYY-MM-DD');
  }
  return date;
}

function checkSession(session) {
  if (typeof session !== 'string' || !SESSION.test(session)) throw new Error('A usage session ID may use only letters, digits, dots, hyphens and underscores');
  return session;
}

const usagePath = (...parts) => path.join(usageDir(), ...parts);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Writes the file whole: a temporary file in the same folder, then a rename.
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function readLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const lines = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') lines.push(parsed);
    } catch {
      // A torn or damaged line is skipped.
    }
  }
  return lines;
}

function appendLines(folder, byDate) {
  for (const [date, lines] of byDate) {
    fs.mkdirSync(usagePath(folder), { recursive: true });
    fs.appendFileSync(usagePath(folder, `${date}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
  }
}

// The dates of the files in a folder (`<date><extension>`), oldest first.
function datesIn(folder, extension) {
  let names;
  try {
    names = fs.readdirSync(usagePath(folder));
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(extension) && DATE.test(name.slice(0, -extension.length)))
    .map((name) => name.slice(0, -extension.length))
    .sort();
}

function usablePoint(point, nowIso) {
  if (!point || (point.metric !== 'tokens' && point.metric !== 'usd')) return null;
  if (typeof point.session !== 'string' || !SESSION.test(point.session)) return null;
  if (typeof point.value !== 'number' || !Number.isFinite(point.value) || point.value < 0) return null;
  const at = isoOf(point.at) ?? nowIso;
  const usable = {
    metric: point.metric,
    session: point.session,
    model: typeof point.model === 'string' && MODEL.test(point.model) ? point.model : 'unknown',
    value: point.value,
    at,
    // A point with no start time belongs to one series with the empty start, never to a new one each export.
    start: typeof point.start === 'string' ? isoOf(point.start) ?? '' : '',
    cumulative: point.cumulative === true,
  };
  if (point.metric === 'tokens' && typeof point.type === 'string' && KIND.test(point.type)) usable.type = point.type;
  if (typeof point.source === 'string' && SOURCE.test(point.source)) usable.source = point.source;
  return usable;
}

// How many of a delta series' recent export times are kept to recognise a repeated export.
const RECENT_EXPORTS = 32;

// Turns each series' points into increases and appends them to the day's records.
// A cumulative series (key includes its start time) adds only its rise since the last value
// seen; a new start time is a new series that counts from zero; a repeat, or a lower value
// with the same start time (out of order), adds nothing. A delta export is identified by its
// time: points of one series sharing a time are summed (attributes that are not kept can split
// one series into several points), and a time already counted for the series adds nothing,
// whether it comes again straight away or after later exports.
export function addPoints(points, { now } = {}) {
  const nowIso = instant(now);
  const file = usagePath('series.json');
  const kept = readJson(file);
  const series = kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {};
  const items = [];
  const deltas = new Map();
  for (const raw of points ?? []) {
    const point = usablePoint(raw, nowIso);
    if (!point) continue;
    point.key = JSON.stringify([
      point.metric, point.session, point.model, point.type ?? null, point.source ?? null, point.cumulative ? point.start : null,
    ]);
    if (!point.cumulative) {
      const same = `${point.key}@${point.at}`;
      if (deltas.has(same)) {
        deltas.get(same).value += point.value;
        continue;
      }
      deltas.set(same, point);
    }
    items.push(point);
  }
  const byDate = new Map();
  for (const point of items) {
    const { key } = point;
    const last = series[key];
    let increase;
    if (point.cumulative) {
      increase = !last ? point.value : Math.max(0, point.value - last.value);
      if (!last || point.value > last.value) series[key] = { value: point.value, start: point.start, seen: nowIso };
      else last.seen = nowIso;
    } else {
      const ats = Array.isArray(last?.ats) ? last.ats : [];
      const repeated = ats.includes(point.at);
      increase = repeated ? 0 : point.value;
      series[key] = { ats: repeated ? ats : [...ats, point.at].slice(-RECENT_EXPORTS), seen: nowIso };
    }
    increase = round(increase);
    if (!(increase > 0)) continue;
    const line = { at: point.at, session: point.session, model: point.model };
    if (point.type) line.type = point.type;
    if (point.source) line.source = point.source;
    line[point.metric] = increase;
    const date = dateOf(point.at);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(line);
  }
  // The series first: a failure here loses a batch, where the other order would count it again.
  writeJson(file, series);
  appendLines('records', byDate);
}

function windowsOf(windows) {
  const kept = [];
  for (const window of Array.isArray(windows) ? windows : []) {
    if (!window || typeof window.kind !== 'string' || !LABEL.test(window.kind)) continue;
    if (typeof window.percentUsed !== 'number' || !Number.isFinite(window.percentUsed)) continue;
    const entry = { kind: window.kind, percentUsed: window.percentUsed };
    const resets = typeof window.resetsAt === 'number'
      ? isoOf(window.resetsAt < 1e11 ? window.resetsAt * 1000 : window.resetsAt) // seconds or milliseconds
      : typeof window.resetsAt === 'string' ? isoOf(window.resetsAt) : null;
    if (resets) entry.resetsAt = resets;
    kept.push(entry);
  }
  return kept;
}

function timeOf(at) {
  const iso = isoOf(at);
  if (!iso) throw new Error('A usage reading needs a time');
  return iso;
}

// The latest windows win; a reading older than the one kept changes nothing, unless the kept
// one is stamped ahead of now (the clock was put back), when it would block every later reading.
function writeAllowance(windows, at, now = new Date()) {
  const kept = windowsOf(windows);
  if (kept.length === 0) return;
  const file = usagePath('allowance.json');
  const current = readJson(file);
  const keptAt = current && typeof current.at === 'string' ? Date.parse(current.at) : NaN;
  if (keptAt > Date.parse(at) && !(keptAt > new Date(now).getTime())) return;
  writeJson(file, { at, windows: kept });
}

// The mod's reading of a session's running cost (`usd`), and of the allowance (`windows`).
export function recordModReading({ session, usd, windows, at, now }) {
  checkSession(session);
  const time = timeOf(at);
  if (typeof usd === 'number' && Number.isFinite(usd) && usd >= 0) {
    appendLines('mod', new Map([[dateOf(time), [{ at: time, session, usd }]]]));
  }
  writeAllowance(windows, time, now);
}

// The allowance as the terminal's status line reports it: the same file.
export function recordAllowance({ windows, at, now }) {
  writeAllowance(windows, timeOf(at), now);
}

// What a session is for, written once; a second call changes nothing. The mod's bridge can't
// tell a foreman from the front desk, so a file it wrote (`by: 'mod'`) is replaced once by the
// session start's record, which knows; a file the session start wrote stays as it is.
export function recordSession({ session, project, role, work, at, by }) {
  checkSession(session);
  if (typeof project !== 'string' || !PROJECT.test(project)) throw new Error('A usage project name may use only letters, digits, dots, hyphens and underscores');
  if (!ROLES.includes(role)) throw new Error(`A session's role is one of ${ROLES.join(', ')}`);
  const file = usagePath('sessions', `${session}.json`);
  if (fs.existsSync(file) && (by === 'mod' || readJson(file)?.by !== 'mod')) return;
  const record = { session, project, role };
  if (typeof work === 'string' && PROJECT.test(work)) record.work = work;
  record.at = timeOf(at);
  if (by === 'mod') record.by = 'mod';
  writeJson(file, record);
}

function bump(map, key, field, amount) {
  if (!map.has(key)) map.set(key, { tokens: 0, usd: 0 });
  map.get(key)[field] += amount;
}

// The mod's last reading of each session on days before `date`, newest first, for the sessions asked for.
function readingsBefore(date, wanted) {
  const found = new Map();
  for (const earlier of datesIn('mod', '.jsonl').filter((day) => day < date).reverse()) {
    const lines = readLines(usagePath('mod', `${earlier}.jsonl`)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    for (const line of lines.reverse()) {
      if (wanted.has(line.session) && !found.has(line.session) && Number.isFinite(line.usd)) found.set(line.session, line.usd);
    }
    if (found.size === wanted.size) break;
  }
  return found;
}

// Adds up a day's raw counts, without writing anything.
function buildDay(date) {
  const rawFile = usagePath('records', `${date}.jsonl`);
  const modFile = usagePath('mod', `${date}.jsonl`);
  const sessions = new Map();
  const sessionOf = (id) => {
    if (!sessions.has(id)) sessions.set(id, { tokens: 0, usd: 0, byModel: new Map(), bySource: new Map(), modUsd: null });
    return sessions.get(id);
  };
  for (const line of readLines(rawFile)) {
    if (typeof line.session !== 'string' || !SESSION.test(line.session)) continue;
    const entry = sessionOf(line.session);
    const model = typeof line.model === 'string' ? line.model : 'unknown';
    if (Number.isFinite(line.tokens)) {
      entry.tokens += line.tokens;
      bump(entry.byModel, model, 'tokens', line.tokens);
      const source = typeof line.source === 'string' ? line.source : 'unknown';
      entry.bySource.set(source, (entry.bySource.get(source) ?? 0) + line.tokens);
    }
    if (Number.isFinite(line.usd)) {
      entry.usd += line.usd;
      bump(entry.byModel, model, 'usd', line.usd);
    }
  }
  const readings = new Map();
  const todays = readLines(modFile).filter((line) => typeof line.session === 'string' && SESSION.test(line.session) && Number.isFinite(line.usd));
  todays.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); // stable: ties stay in file order
  for (const line of todays) {
    if (!readings.has(line.session)) readings.set(line.session, []);
    readings.get(line.session).push(line.usd);
  }
  const before = readingsBefore(date, new Set(readings.keys()));
  for (const [id, values] of readings) {
    const baseline = before.has(id) ? before.get(id) : values[0];
    sessionOf(id).modUsd = round(Math.max(0, values[values.length - 1] - baseline));
  }
  // Object.fromEntries defines own keys, so an ID such as "__proto__" stays an ordinary key.
  const summary = {
    date,
    sessions: Object.fromEntries([...sessions].map(([id, entry]) => [id, {
      tokens: entry.tokens,
      usd: round(entry.usd),
      byModel: Object.fromEntries([...entry.byModel].map(([model, sums]) => [model, { tokens: sums.tokens, usd: round(sums.usd) }])),
      bySource: Object.fromEntries(entry.bySource),
      modUsd: entry.modUsd,
    }])),
  };
  return summary;
}

const hasRaw = (date) => fs.existsSync(usagePath('records', `${date}.jsonl`)) || fs.existsSync(usagePath('mod', `${date}.jsonl`));

// A day's summary worked out from its raw files and not written, or null when it has none.
export function computeDay(date) {
  checkDate(date);
  return hasRaw(date) ? buildDay(date) : null;
}

// Adds up a day's raw counts and writes days/<date>.json. A day whose raw files are gone
// keeps the summary it has.
export function summariseDay(date) {
  checkDate(date);
  if (!hasRaw(date)) {
    const kept = readDay(date);
    if (kept) return kept;
  }
  const summary = buildDay(date);
  writeJson(usagePath('days', `${date}.json`), summary);
  return summary;
}

// A day's summary, or null when there is none or it can't be read.
export function readDay(date) {
  try {
    checkDate(date);
  } catch {
    return null;
  }
  const summary = readJson(usagePath('days', `${date}.json`));
  return summary && summary.date === date && summary.sessions && typeof summary.sessions === 'object' ? summary : null;
}

// Removes raw files older than KEEP_DAYS.raw days, summaries older than KEEP_DAYS.summaries,
// the series not seen for as long as the raw files are kept, and session files that no
// remaining file mentions (a session recorded within the raw window is kept).
export function pruneUsage({ now } = {}) {
  const nowIso = instant(now);
  const cutoff = (days) => dateOf(new Date(Date.parse(nowIso) - days * DAY_MS).toISOString());
  const rawCutoff = cutoff(KEEP_DAYS.raw);
  const summaryCutoff = cutoff(KEEP_DAYS.summaries);
  const remove = (file) => fs.rmSync(file, { force: true });
  const mentioned = new Set();
  for (const [folder, extension, limit] of [['records', '.jsonl', rawCutoff], ['mod', '.jsonl', rawCutoff], ['days', '.json', summaryCutoff]]) {
    for (const date of datesIn(folder, extension)) {
      const file = usagePath(folder, `${date}${extension}`);
      if (date < limit) {
        remove(file);
      } else if (folder === 'days') {
        const summary = readJson(file);
        for (const id of Object.keys(summary?.sessions ?? {})) mentioned.add(id);
      } else {
        for (const line of readLines(file)) mentioned.add(line.session);
      }
    }
  }
  let sessionFiles = [];
  try {
    sessionFiles = fs.readdirSync(usagePath('sessions')).filter((name) => name.endsWith('.json'));
  } catch {
    // No sessions folder yet.
  }
  for (const name of sessionFiles) {
    const file = usagePath('sessions', name);
    const at = readJson(file)?.at;
    const recent = typeof at === 'string' && !Number.isNaN(Date.parse(at)) && dateOf(new Date(at).toISOString()) >= rawCutoff;
    if (!recent && !mentioned.has(name.slice(0, -'.json'.length))) remove(file);
  }
  const seriesFile = usagePath('series.json');
  const series = readJson(seriesFile);
  if (series && typeof series === 'object' && !Array.isArray(series)) {
    const floor = `${rawCutoff}T00:00:00.000Z`;
    const fresh = Object.fromEntries(Object.entries(series).filter(([, entry]) => typeof entry?.seen === 'string' && entry.seen >= floor));
    if (Object.keys(fresh).length !== Object.keys(series).length) writeJson(seriesFile, fresh);
  }
}
