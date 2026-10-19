// scripts/briefing/model.js
// The arrival briefing as plain data (design section 5.2), from the board model, the usage figures
// and the sources report. Nothing here reads a file except through `wasRaised`, nothing is written,
// and nothing throws: a part that can't be built is empty.
//
// What changed for users and the merges in progress count only when they are after `since`, the
// last briefing (no since: all of them). What waits, what is building and the open pull requests
// are shown whenever they stand; a pull request whose work's latest report says blocked is in what
// to watch, in Wheelhouse's own words, rather than in progress. Unusual use is raised once: items
// already raised are left out, and `raise` lists the ids this briefing includes, in the order they
// follow the weekly lines in `watch`. The caller marks as raised (markRaised) only those its text
// showed, `raise.slice(0, shownWatch - weekly)` from briefingParts, once the briefing has really
// been given.
//
// The board's lines for Unattended build commands on Windows, and for Unattended off in a Locked
// project, stand while they hold; the briefing repeats them once a week, the week starting on
// Monday in the director's time (this computer's own time zone), until a briefing shows them.
// They are that week's news, so they open `watch`, ahead of unusual use, and are the last of it
// cut for length; `weekly` counts them, and the caller records them as shown (weeklyAt in
// seen.json) only when the text showed them, so a briefing cut short leaves them due.
import { oneLine, unusualLine, tokenWords, dollarWords, NOT_NOW_STEP } from '../board/model.js';
import { UNATTENDED_LINE, LOCKED_UNATTENDED_LINE } from '../lib/platform-lines.js';
import { wasRaised as realWasRaised } from '../usage/figures.js';

// Briefing = { first, waiting, changed, progress, watch, usage, raise, weekly }.
const EMPTY = () => ({ first: [], waiting: [], changed: [], progress: [], watch: [], usage: null, raise: [], weekly: 0 });

// What the board model says when a merge carried no words for users. It belongs to progress, not
// to what changed for users.
const BARE_MERGE = /^(Pull request #\d+|A pull request) merged$/;
// The end of the board model's line for a change not yet confirmed.
const UNCONFIRMED = /, not yet confirmed by you$/;
// The board model's line for event records it couldn't read.
const DAMAGED = /^\d+ records? couldn't be read$/;
// The health lines given once a week.
const WEEKLY = [UNATTENDED_LINE, LOCKED_UNATTENDED_LINE];
const DAY_MS = 24 * 60 * 60 * 1000;
// Anthropic's pages the sources check reads (sources/list.js), by id, as the director knows them.
const PAGE_NAMES = {
  models: 'models overview',
  deprecations: 'model deprecations',
  changelog: 'Claude Code changelog',
  prompting: 'prompting best practices',
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const records = (value) => list(value).filter(isRecord);
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const lines = (values) => values.map((value) => oneLine(value)).filter(Boolean);

// A time in milliseconds, or NaN. Only text that reads back as itself counts, so a rolled-over
// date (30 February) is no time.
function msOf(value) {
  if (typeof value !== 'string') return NaN;
  const ms = Date.parse(value);
  if (Number.isNaN(ms) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return NaN;
  const fraction = (/\.(\d+)Z$/.exec(value)?.[1] ?? '').padEnd(3, '0');
  return new Date(ms).toISOString() === `${value.slice(0, 19)}.${fraction}Z` ? ms : NaN;
}
function clockMs(now) {
  try {
    const value = typeof now === 'function' ? now() : now;
    const ms = value instanceof Date ? value.getTime() : isNumber(value) ? value : typeof value === 'string' ? Date.parse(value) : NaN;
    return isNumber(ms) ? ms : NaN;
  } catch {
    return NaN;
  }
}

// The Monday that starts the week holding `ms` in `timeZone` (this computer's own when it is
// undefined), as a count of days.
function weekOf(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(ms));
  const part = (type) => Number(parts.find((p) => p.type === type)?.value);
  const day = Date.UTC(part('year'), part('month') - 1, part('day')) / DAY_MS;
  return day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7);
}

// Whether the weekly lines are due: no briefing showed them before (or none that can be read),
// or the last that did was in an earlier week. A clock that can't be read can't tell, so they are.
function weeklyDue(shownMs, nowMs, timeZone) {
  if (Number.isNaN(shownMs) || !Number.isFinite(nowMs)) return true;
  return weekOf(shownMs, timeZone) < weekOf(nowMs, timeZone);
}

// Builds one part, or leaves it empty when its inputs are too damaged to build it.
function part(build, fallback) {
  try {
    return build();
  } catch {
    return fallback;
  }
}

const openPullRequests = (model) => records(model.build?.pullRequests).filter((x) => Number.isInteger(x.pr) && x.pr > 0);

// "Pull request #12 for Search": the work by its feature's title, or by its id.
function pullRequestName(p, features) {
  const feature = features.find((f) => typeof p.work === 'string' && f.work === p.work);
  const name = oneLine(feature?.title) || oneLine(p.work);
  return `Pull request #${p.pr}${name ? ` for ${name}` : ''}`;
}

// The pull requests whose work's latest report says blocked (the board model's `blocked`), in
// Wheelhouse's own words. The report's summary is text the build wrote, which may carry its own
// talk or an instruction (design section 12.5), so it stays on the board and never reaches here.
const BLOCKED = 'is blocked: its build stopped and couldn\'t go on; the board has its report';
function blockedLines(model) {
  const features = records(model.build?.features);
  return openPullRequests(model).filter((p) => typeof p.blocked === 'string').map((p) => `${pullRequestName(p, features)} ${BLOCKED}`);
}

function progressLines(model, isNew) {
  const out = [];
  const merged = records(model.director?.changed).filter((c) => isNew(c.at)).length;
  if (merged > 0) out.push(`${merged} pull ${merged === 1 ? 'request' : 'requests'} merged`);
  const features = records(model.build?.features);
  for (const f of features.filter((x) => x.step === 'building' || x.step === NOT_NOW_STEP)) {
    const title = oneLine(f.title) || oneLine(f.work) || 'Untitled work';
    // Held by the director's Not now to its build commands: it waits on them, it isn't building.
    if (f.step === NOT_NOW_STEP) {
      out.push(`${title} is ${NOT_NOW_STEP}`);
      continue;
    }
    const slice = isRecord(f.slice) && Number.isInteger(f.slice.n) && Number.isInteger(f.slice.m) ? `, slice ${f.slice.n} of ${f.slice.m}` : '';
    out.push(`Building ${title}${slice}`);
  }
  // A blocked pull request is in what to watch instead.
  for (const p of openPullRequests(model).filter((x) => typeof x.blocked !== 'string')) {
    const which = pullRequestName(p, features);
    if (p.review === 'none') out.push(`${which} is waiting on CI or review`);
    else if (p.review === 'findings') {
      const found = Number.isInteger(p.findings) && p.findings > 0 ? `${p.findings} ${p.findings === 1 ? 'problem' : 'problems'}` : 'problems';
      out.push(`${which} is waiting on fixes: its review found ${found}`);
    }
  }
  return out;
}

// Unusual use not raised before, in words, with the ids raised.
function unusualItems(usage, raised) {
  const items = [];
  for (const u of records(usage?.unusual)) {
    if (typeof u.id !== 'string' || !u.id) continue;
    let already = false;
    try {
      already = raised(u.id) === true;
    } catch {
      // A check that can't be made leaves the item in.
    }
    const line = already ? null : unusualLine(u);
    if (line) items.push({ id: u.id, line });
  }
  return items;
}

// What the sources report adds: new models to test and changed pages. Retirements and advisories
// are in the health lines already.
function sourceLines(sources) {
  const out = lines(list(sources.newModels)).map((name) => `A new model to test: ${name}`);
  for (const s of records(sources.sources).filter((x) => x.ok === true && x.changed === true && typeof x.id === 'string')) {
    if (s.id.startsWith('releases:')) out.push(`${oneLine(s.id.slice('releases:'.length))} has new releases`);
    else if (!s.id.includes(':')) out.push(`Anthropic's ${Object.hasOwn(PAGE_NAMES, s.id) ? PAGE_NAMES[s.id] : oneLine(s.id)} page changed`);
  }
  return out;
}

// The watch line for a delegation review that is due (ruling F43), or null. `review` is
// { due, days }, worked out by the caller from the state: `days` between reviews.
function reviewLine(review) {
  if (!isRecord(review) || review.due !== true) return null;
  const { days } = review;
  if (!Number.isInteger(days) || days <= 0 || days === 14) return 'The fortnightly look at what I can decide alone is due';
  return `The look at what I can decide alone is due (every ${days} days)`;
}

// "Usage this week: 1.2M tokens, about $84 at API prices, 34% of your weekly allowance.", each
// part left out when it isn't known; null when none is.
function usageLine(usage) {
  const week = isRecord(usage?.week) ? usage.week : {};
  const said = [
    isNumber(week.tokens) && week.tokens >= 0 ? tokenWords(week.tokens) : null,
    isNumber(week.usd) && week.usd >= 0 ? `about ${dollarWords(week.usd)} at API prices` : null,
    isNumber(week.share) && week.share >= 0 ? `${Math.round(week.share)}% of your weekly allowance` : null,
  ].filter(Boolean);
  return said.length > 0 ? `Usage this week: ${said.join(', ')}.` : null;
}

// briefingModel({ model, usage, sources, since, now, wasRaised, timeZone, weeklySince, review }) -> Briefing.
// `model` is boardModel's, `usage` usageFigures', `sources` the sources report, `since` the time of
// the last briefing, `weeklySince` the time of the last briefing that showed the weekly lines.
// `wasRaised(id)` says whether an unusual item was raised already (the usage store's by default).
// `timeZone` is the director's, this computer's own by default. `review` is { due, days }: whether
// the delegation review is due, and the days between reviews, as the caller worked it out from the state.
export function briefingModel(options) {
  try {
    return build(isRecord(options) ? options : {});
  } catch {
    return EMPTY();
  }
}

function build({ model, usage, sources, since, now, wasRaised = realWasRaised, timeZone, weeklySince, review }) {
  const briefing = EMPTY();
  const board = isRecord(model) ? model : {};
  const director = isRecord(board.director) ? board.director : {};
  const nowMs = clockMs(now);
  // A since that can't be read, or that is after now, counts as none.
  let sinceMs = msOf(since);
  if (Number.isFinite(nowMs) && sinceMs > nowMs) sinceMs = NaN;
  const isNew = (at) => Number.isNaN(sinceMs) || msOf(at) > sinceMs;

  // The heading says these aren't confirmed, so each line's own saying of it goes.
  briefing.first = part(() => lines(list(director.first)).map((line) => line.replace(UNCONFIRMED, '')), []);
  briefing.waiting = part(() => records(director.waiting).map((w) => oneLine(w.what) || 'A question'), []);
  briefing.changed = part(() => lines(records(director.changed).filter((c) => isNew(c.at)).map((c) => c.what))
    .filter((what) => !BARE_MERGE.test(what)), []);
  briefing.progress = part(() => progressLines({ director, build: isRecord(board.build) ? board.build : {} }, isNew), []);

  const shown = msOf(weeklySince);
  const due = part(() => weeklyDue(Number.isFinite(nowMs) && shown > nowMs ? NaN : shown, nowMs, timeZone), true);
  const standing = part(() => lines(records(director.health).filter((l) => l.level === 'watch' || l.level === 'stop').map((l) => l.text)), []);
  const weekly = due ? standing.filter((text) => WEEKLY.includes(text)) : [];
  const health = standing.filter((text) => !WEEKLY.includes(text));
  const unusual = part(() => unusualItems(usage, typeof wasRaised === 'function' ? wasRaised : realWasRaised), []);
  const report = isRecord(sources) && (Number.isNaN(sinceMs) || msOf(sources.at) > sinceMs) ? sources : null;
  const fromSources = report ? part(() => sourceLines(report), []) : [];
  const damaged = part(() => list(board.missing).filter((line) => typeof line === 'string' && DAMAGED.test(line)), []);
  const dueReview = part(() => reviewLine(review), null);
  const blocked = part(() => blockedLines({ build: isRecord(board.build) ? board.build : {} }), []);
  // The weekly lines and unusual use are news and the other health lines stand from one briefing
  // to the next, so the news comes first and is the last of `watch` to be cut for length; a review
  // that is due follows it, then the pull requests that are blocked.
  briefing.watch = [...weekly, ...unusual.map((u) => u.line), ...(dueReview === null ? [] : [dueReview]), ...blocked, ...health, ...fromSources, ...damaged];
  briefing.raise = unusual.map((u) => u.id);
  briefing.weekly = weekly.length;
  briefing.usage = part(() => usageLine(usage), null);
  return briefing;
}
