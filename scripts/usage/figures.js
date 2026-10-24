// scripts/usage/figures.js
// The week's usage, per part and per feature, and unusual use, worked out from the usage store:
// the daily summaries, the session files and the allowance reading. The board, the briefing and
// the build loop's appetite check read these figures.
//
// This reads only. Today's counts are summed from the raw files without writing a summary
// (the store's computeDay), and the one file written here is usage/raised.json, through markRaised.
// A missing or damaged file becomes a missing figure and a line in `missing`, never an error.
//
// A background session that reports its own use (ruling P8-21, check 64) adds credits: when any session
// in the window has such runs, every figure carries `credits` too, summed from the runs that gave them and null
// (shown as not available) where none did; unusual use is then worked out on credits where there are no tokens; and
// the agent's own words (scripts/agents/usage-words.js) take the place of the allowance line, with `words` for the
// board's note. Without such runs nothing here differs from before.
import fs from 'node:fs';
import path from 'node:path';
import { usageDir } from '../lib/paths.js';
import { UNUSUAL, WEEK_MS, KEEP_DAYS } from '../lib/core-numbers.js';
import { readDay, computeDay } from './store.js';
import { usageWords } from '../agents/usage-words.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ROLES = ['front-desk', 'foreman', 'feature'];
// Matches the store's rule for a session ID, since the ID names a file.
const SESSION = /^(?!\.+$)[A-Za-z0-9._-]{1,128}$/;
const NO_TOKENS = 'Token counts start once setup switches on usage counting on this computer';
const NO_ALLOWANCE = 'The weekly allowance shows once the mod or the terminal has read it';
// The agent whose allowance the mod and the terminal read.
const CLAUDE_CODE = 'claude-code';
const PART_WORDS = { 'front-desk': 'front desk work', foreman: 'foreman work', feature: 'feature work' };

const usagePath = (...parts) => path.join(usageDir(), ...parts);
const dateOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const number = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
const round = (value) => Math.round(value * 1e9) / 1e9;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// `now` may be a function, a Date or text; anything unreadable is the current time.
function instant(now) {
  const ms = new Date(typeof now === 'function' ? now() : now ?? new Date()).getTime();
  return Number.isNaN(ms) ? Date.now() : ms;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function readAllowance() {
  const reading = readJson(usagePath('allowance.json'));
  if (!isRecord(reading) || !Array.isArray(reading.windows) || reading.windows.length === 0) return null;
  const at = Date.parse(reading.at);
  return Number.isNaN(at) ? null : { at: new Date(at).toISOString(), windows: reading.windows.filter(isRecord) };
}

// A day's summary. Today's comes from the raw files, which are newer than any summary; an
// earlier day's comes from its summary, or from its raw files when it has none yet.
function loadDay(date, today) {
  try {
    if (date === today) return computeDay(date) ?? readDay(date);
    return readDay(date) ?? computeDay(date);
  } catch {
    return null;
  }
}

function loadSession(id, cache) {
  if (cache.has(id)) return cache.get(id);
  let meta = null;
  if (SESSION.test(id)) {
    const file = readJson(usagePath('sessions', `${id}.json`));
    if (isRecord(file) && ROLES.includes(file.role) && typeof file.project === 'string') {
      meta = { project: file.project, role: file.role, work: typeof file.work === 'string' && file.work ? file.work : null };
    }
  }
  cache.set(id, meta);
  return meta;
}

// Sums of tokens, dollars and credits, with whether any figure was seen at all.
function sums() {
  return { tokens: 0, usd: 0, credits: 0, tokensSeen: false, usdSeen: false, creditsSeen: false };
}
function addTo(total, entry) {
  total.tokens += entry.tokens;
  total.usd += entry.usd;
  total.credits += entry.credits;
  if (entry.tokensSeen) total.tokensSeen = true;
  if (entry.usdSeen) total.usdSeen = true;
  if (entry.creditsSeen) total.creditsSeen = true;
}
// `credits` only when some session reported its own use: null when none of these runs gave a credit figure.
const figure = (total, credits = false) => ({
  tokens: total.tokensSeen ? total.tokens : null,
  usd: total.usdSeen ? round(total.usd) : null,
  ...(credits ? { credits: total.creditsSeen ? round(total.credits) : null } : {}),
});

// One session's share of one day. Dollars are telemetry's where the session has any, else the mod's reading.
function entryOf(date, id, raw, meta) {
  const tokens = number(raw.tokens);
  const telemetryUsd = number(raw.usd);
  const modUsd = typeof raw.modUsd === 'number' && Number.isFinite(raw.modUsd) && raw.modUsd >= 0 ? raw.modUsd : null;
  const models = new Map();
  for (const [model, sum] of Object.entries(isRecord(raw.byModel) ? raw.byModel : {})) {
    if (isRecord(sum)) models.set(model, { tokens: number(sum.tokens), usd: number(sum.usd) });
  }
  const sources = isRecord(raw.bySource) ? raw.bySource : {};
  // The tokens whose source is present and isn't `main` belong to a subagent. The capture
  // (check 7) showed only `main`, so which words mark a subagent is unconfirmed; `unknown` is
  // the store's word for no source at all.
  let subagentTokens = 0;
  for (const [source, count] of Object.entries(sources)) {
    if (source !== 'main' && source !== 'unknown') subagentTokens += number(count);
  }
  const runs = Number.isInteger(raw.runs) && raw.runs > 0;
  const credits = runs && typeof raw.credits === 'number' && Number.isFinite(raw.credits) && raw.credits >= 0 ? raw.credits : null;
  return {
    date,
    id,
    meta,
    tokens,
    usd: telemetryUsd > 0 ? telemetryUsd : modUsd ?? 0,
    credits: credits ?? 0,
    tokensSeen: tokens > 0,
    usdSeen: telemetryUsd > 0 || modUsd !== null,
    creditsSeen: credits !== null,
    telemetry: tokens > 0 || telemetryUsd > 0,
    runs,
    agent: runs && typeof raw.agent === 'string' ? raw.agent : null,
    models,
    subagentTokens,
  };
}

function bump(map, key, entry) {
  if (!map.has(key)) map.set(key, sums());
  addTo(map.get(key), entry);
}

// An item of one kind (a session, a feature or a day) over the comparison window.
function newItem(id) {
  return { id, ...sums(), inWeek: false, parts: new Map(), features: new Map(), models: new Map() };
}
function addToItem(item, entry, inWeek) {
  addTo(item, entry);
  if (inWeek) item.inWeek = true;
  bump(item.parts, entry.meta?.role ?? 'none', entry);
  if (entry.meta?.role === 'feature' && entry.meta.work) bump(item.features, entry.meta.work, entry);
  for (const [model, sum] of entry.models) {
    if (!item.models.has(model)) item.models.set(model, sums());
    item.models.get(model).tokens += sum.tokens;
    item.models.get(model).usd += sum.usd;
  }
}

// The key with the most use by `metric`, falling back to tokens when the metric is all zero.
function biggest(map, metric) {
  let best = null;
  for (const by of [metric, 'tokens']) {
    for (const [key, sum] of map) {
      if (sum[by] > 0 && (best === null || sum[by] > map.get(best)[by])) best = key;
    }
    if (best !== null) return best;
  }
  return null;
}

function causeOf(item, metric) {
  const part = biggest(item.parts, metric);
  const feature = biggest(item.features, metric);
  const model = biggest(item.models, metric);
  let cause = `Mostly ${PART_WORDS[part] ?? 'work with no recorded purpose'}`;
  if (feature) cause += ` on ${feature}`;
  if (model && model !== 'unknown') cause += `, on ${model}`;
  return cause;
}

// Items of one kind against the others of the same kind: those with use in the week whose
// value is over `factor` times the median of the rest, once there are enough of the kind.
function unusualOf(kind, items, factor) {
  const metric = items.some((item) => item.tokens > 0) ? 'tokens' : items.some((item) => item.credits > 0) ? 'credits' : 'usd';
  const valued = items.filter((item) => item[metric] > 0);
  if (valued.length < UNUSUAL.minSamples) return [];
  const found = [];
  for (const item of valued) {
    if (!item.inWeek) continue;
    const usual = median(valued.filter((other) => other !== item).map((other) => other[metric]));
    if (usual > 0 && item[metric] > factor * usual) {
      found.push({
        kind, id: `${kind}:${item.id}`, tokens: round(item[metric]), median: round(usual), cause: causeOf(item, metric), unit: metric,
        ratio: item[metric] / usual,
      });
    }
  }
  return found.sort((a, b) => b.ratio - a.ratio);
}

// The weekly allowance's share used, while its window is the current one: { share, shareAt },
// each null when there is none.
function shareOf(allowance, nowMs) {
  const weekly = allowance?.windows.find((window) => window.kind === 'seven_day') ?? null;
  const resetMs = weekly && typeof weekly.resetsAt === 'string' ? Date.parse(weekly.resetsAt) : NaN;
  if (weekly && Number.isFinite(weekly.percentUsed) && Number.isFinite(resetMs) && resetMs > nowMs
    && Date.parse(allowance.at) > resetMs - WEEK_MS) {
    return { share: weekly.percentUsed, shareAt: allowance.at };
  }
  return { share: null, shareAt: null };
}

// weeklyShare({ now }): the share alone, from the allowance file and nothing else, for a reader
// that can't wait for the days to be read (the status line).
export function weeklyShare({ now } = {}) {
  return shareOf(readAllowance(), instant(now));
}

// usageFigures({ project, now, factor, agent }): the figures described at the top of this file.
// `project` limits the week, the parts, the features and unusual use to sessions whose session file
// names that project (all sessions when null); the share is the account's whatever the project.
// `agent` is the agent the project runs on this computer: for any agent but Claude Code (ruling P8-32), and for
// figures whose sessions an agent other than Claude Code recorded, the allowance is Claude's, not the project's, so
// the figures carry no share, and the week is the last seven days rather than the allowance's window.
export function usageFigures({ project = null, now, factor, agent = null } = {}) {
  const nowMs = instant(now);
  const today = dateOf(nowMs);
  const limit = typeof factor === 'number' && Number.isFinite(factor) && factor > 0 ? factor : UNUSUAL.factor;

  const dates = [];
  for (let back = UNUSUAL.windowDays - 1; back >= 0; back -= 1) dates.push(dateOf(nowMs - back * DAY_MS));
  const sessionCache = new Map();
  const entries = [];
  let telemetry = false;
  for (const date of dates) {
    const summary = loadDay(date, today);
    if (!summary) continue;
    for (const [id, raw] of Object.entries(summary.sessions)) {
      if (!isRecord(raw)) continue;
      const meta = loadSession(id, sessionCache);
      const entry = entryOf(date, id, raw, meta);
      if (entry.telemetry) telemetry = true;
      if (project === null || meta?.project === project) entries.push(entry);
    }
  }

  // Whether any session here reported its own use, and the agent whose use it is: the one named, else the runs'.
  const runs = entries.some((entry) => entry.runs);
  const runAgent = entries.find((entry) => entry.agent !== null)?.agent ?? null;
  const usedBy = typeof agent === 'string' && agent !== '' ? agent : runAgent;
  const otherAgent = usedBy !== null && usedBy !== CLAUDE_CODE;
  const words = otherAgent ? usageWords(usedBy) : null;

  const allowance = otherAgent ? null : readAllowance();
  const weekly = allowance?.windows.find((window) => window.kind === 'seven_day') ?? null;
  const resetMs = weekly && typeof weekly.resetsAt === 'string' ? Date.parse(weekly.resetsAt) : NaN;
  // The week is the allowance's own window when its reset is ahead (within a week), else the last seven days.
  const ownWeek = Number.isFinite(resetMs) && resetMs > nowMs && resetMs <= nowMs + WEEK_MS;
  const fromMs = ownWeek ? resetMs - WEEK_MS : nowMs - WEEK_MS;
  const toMs = ownWeek ? resetMs : nowMs;
  // Counts are kept a day at a time, so a day counts whole: the last seven dates ending today, or
  // from the date the allowance's window began (that day's earlier use is counted with it).
  const firstWeekDate = ownWeek ? dateOf(fromMs) : dateOf(nowMs - 6 * DAY_MS);

  const { share, shareAt } = shareOf(allowance, nowMs);

  const inWeek = (entry) => entry.date >= firstWeekDate;
  const weekTotal = sums();
  const parts = new Map();
  const features = new Map();
  let subagents = 0;
  for (const entry of entries.filter(inWeek)) {
    addTo(weekTotal, entry);
    subagents += entry.subagentTokens;
    if (entry.meta) bump(parts, entry.meta.role, entry);
    if (entry.meta?.role === 'feature' && entry.meta.work) bump(features, entry.meta.work, entry);
  }

  const byPart = {};
  for (const role of ROLES) byPart[role] = figure(parts.get(role) ?? sums(), runs);
  const byFeature = Object.fromEntries([...features].map(([work, total]) => [work, figure(total, runs)]));

  const kinds = { session: new Map(), feature: new Map(), day: new Map() };
  for (const entry of entries) {
    const keys = { session: entry.id, day: entry.date };
    if (entry.meta?.role === 'feature' && entry.meta.work) keys.feature = entry.meta.work;
    for (const [kind, key] of Object.entries(keys)) {
      if (!kinds[kind].has(key)) kinds[kind].set(key, newItem(key));
      addToItem(kinds[kind].get(key), entry, inWeek(entry));
    }
  }
  const unusual = ['session', 'feature', 'day']
    .flatMap((kind) => unusualOf(kind, [...kinds[kind].values()], limit))
    .map(({ ratio, ...item }) => item);

  const missing = [];
  if (words !== null) missing.push(words.allowance);
  else if (!otherAgent) {
    if (!telemetry) missing.push(NO_TOKENS);
    if (!allowance) missing.push(NO_ALLOWANCE);
  }

  return {
    week: {
      from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), ...figure(weekTotal, runs), share, shareAt,
    },
    ...(words !== null ? { words: { note: words.note } } : {}),
    byPart,
    bySubagents: { tokens: subagents },
    byFeature,
    unusual,
    missing,
  };
}

// usage/raised.json: { raised: { <id>: <time raised> } }.
function readRaised() {
  const kept = readJson(usagePath('raised.json'));
  return isRecord(kept) && isRecord(kept.raised) ? kept.raised : {};
}

// Whether an unusual item's id has been raised already.
export function wasRaised(id) {
  return typeof id === 'string' && Object.hasOwn(readRaised(), id);
}

// Records the ids as raised, so the briefing raises each once. Entries older than the summaries are dropped.
export function markRaised(ids, { now } = {}) {
  const nowMs = instant(now);
  const floor = nowMs - KEEP_DAYS.summaries * DAY_MS;
  const kept = new Map(Object.entries(readRaised()).filter(([, at]) => Date.parse(at) >= floor));
  for (const id of ids ?? []) {
    if (typeof id === 'string' && id) kept.set(id, new Date(nowMs).toISOString());
  }
  // Object.fromEntries defines own keys, so an ID such as "__proto__" stays an ordinary key.
  const raised = Object.fromEntries(kept);
  const file = usagePath('raised.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify({ raised }, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}
