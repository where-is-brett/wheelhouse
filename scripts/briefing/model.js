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
//
// What the survey found when setup finished (design section 15) is mentioned once: `found` holds its
// lines when the latest survey is not the one `surveyAt` names, and `foundId` is that survey's id,
// which the caller records (surveyAt in seen.json) only when the text showed every line. Lines the
// caller says itself (`leaveOut`, the carry-on card's) count as said, so a survey whose every line
// is left out still has its id, with no lines. A survey with nothing to say, or none, leaves both
// empty. At Autonomy Trusting (`carrying`), its line about work in flight says Wheelhouse is
// carrying it on (ruling A9). `earlier` is the survey a second look follows, when it was mentioned:
// only what is new since it is said (briefingLines' `since`).
import { oneLine, unusualLine, tokenWords, dollarWords, creditWords, NOT_NOW_STEP } from '../board/model.js';
import { UNATTENDED_LINE, LOCKED_UNATTENDED_LINE, LOCKED_WOULD_LINE } from '../lib/platform-lines.js';
import { wasRaised as realWasRaised } from '../usage/figures.js';
import { brokenCount, SAFEKEEPING_LEAD } from '../board/health.js';
import { FRONT_DESK_MODEL_LEAD } from '../lib/front-desk-model.js';
import { verdict, sinceAbout } from '../lib/calm-words.js';
import { briefingLines } from '../survey/words.js';

// Briefing = { verdict, since, first, found, foundId, waiting, heldBack, changed, progress, watch, usage, onTrack, plus, raise, weekly }.
// `verdict` is the pane's sentence; `since` says when the last briefing was and how long ago ('' when
// there was none); each `waiting` entry is { title, line, recommendation, optional } (a card's own
// words, each only when it has them); `heldBack` counts the cards past the day's budget, which `waiting` leaves out; `onTrack` says usage is as it usually is; `plus` counts what
// is new since the last briefing, in waiting and changed ({ waiting, changed }, none when there was
// no last briefing).
const EMPTY = () => ({
  verdict: '', since: '', first: [], found: [], foundId: null, waiting: [], heldBack: 0, changed: [], progress: [], watch: [], usage: null, onTrack: false, plus: { waiting: 0, changed: 0 }, raise: [], weekly: 0, safekeeping: null,
});

// What the board model says when a merge carried no words for users. It belongs to progress, not
// to what changed for users.
const BARE_MERGE = /^(Pull request #\d+|A pull request) merged$/;
// The end of the board model's line for a change not yet confirmed.
const UNCONFIRMED = /, not yet confirmed by you$/;
// The board model's line for event records it couldn't read.
const DAMAGED = /^\d+ records? couldn't be read$/;
// The health lines given once a week: the Unattended lines, Locked's for a project with real users,
// and the front desk on another model than its pin, which the board shows all the while.
const WEEKLY = [UNATTENDED_LINE, LOCKED_UNATTENDED_LINE, LOCKED_WOULD_LINE];
// An unchanged safekeeping watch comes back this seldom, not every briefing (spec 8.2).
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const isWeekly = (text) => WEEKLY.includes(text) || text.startsWith(FRONT_DESK_MODEL_LEAD);
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
const BLOCKED = 'is blocked: its build stopped and couldn\'t go on; the Logbook has its report';
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

// The one sentence on safekeeping, or null: when the level turns, and for an unchanged watch once a month. `said` is what a
// briefing last said ({ level, at }). The caller records `level` only when the text showed the sentence.
function safekeepingNews(health, said, nowMs) {
  const line = records(health).find((l) => l.safekeeping === true);
  if (line === undefined) return null;
  const words = oneLine(line.text).replace(SAFEKEEPING_LEAD, '');
  const level = line.level === 'watch' ? 'watch' : 'safe';
  if (level === 'safe') return said?.level === 'watch' ? { level, line: `Safekeeping has cleared: ${words}` } : null;
  if (said?.level !== 'watch') return { level, line: `Safekeeping has turned to watch: ${words}` };
  const since = msOf(said.at);
  return Number.isNaN(since) || !Number.isFinite(nowMs) || nowMs - since >= MONTH_MS ? { level, line: `Safekeeping is still to watch: ${words}` } : null;
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
    // Sessions that report their own use count in credits (ruling P8-21), over the sessions Wheelhouse started.
    isNumber(week.credits) && week.credits >= 0 ? `${creditWords(week.credits)} over the sessions Wheelhouse started` : null,
    isNumber(week.tokens) && week.tokens >= 0 ? tokenWords(week.tokens) : null,
    isNumber(week.usd) && week.usd >= 0 ? `about ${dollarWords(week.usd)} at API prices` : null,
    isNumber(week.share) && week.share >= 0 ? `${Math.round(week.share)}% of your weekly allowance` : null,
  ].filter(Boolean);
  return said.length > 0 ? `Usage this week: ${said.join(', ')}.` : null;
}

// The hour and minute of a time as "09:10", in `timeZone` (this computer's own when it is undefined).
function clockOf(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  return `${parts.find((p) => p.type === 'hour').value}:${parts.find((p) => p.type === 'minute').value}`;
}

// A waiting card as the briefing gives it: its title, and its line, recommendation and optional
// minutes when it has them.
function waitingEntry(w) {
  const entry = { title: oneLine(w.what) || 'A question' };
  for (const key of ['line', 'recommendation']) if (oneLine(w[key])) entry[key] = oneLine(w[key]);
  if (Number.isInteger(w.optional) && w.optional > 0) entry.optional = w.optional;
  return entry;
}

// briefingModel({ model, usage, sources, since, now, wasRaised, timeZone, weeklySince, review, survey, surveyAt, host, leaveOut, carrying, earlier, holdLocked }) -> Briefing.
// `model` is boardModel's, `usage` usageFigures', `sources` the sources report, `since` the time of
// the last briefing, `weeklySince` the time of the last briefing that showed the weekly lines.
// `wasRaised(id)` says whether an unusual item was raised already (the usage store's by default).
// `timeZone` is the director's, this computer's own by default. `review` is { due, days }: whether
// the delegation review is due, and the days between reviews, as the caller worked it out from the state.
// `survey` is the latest survey as the views give it ({ id, data }), `surveyAt` the id of the one a
// briefing last mentioned, `host` the project's ('github', 'gitlab' or null) and `leaveOut` the
// survey's lines (see briefingLines) the caller says itself; `carrying` is briefingLines' own, and
// `earlier` its `since`. `holdLocked`, for setup's own briefing, leaves Locked's weekly line out.
// `safekeepingSaid` is readSafekeepingSaid's. `safekeeping` in the answer is the sentence's level and its place in `watch`, or null.
export function briefingModel(options) {
  try {
    return build(isRecord(options) ? options : {});
  } catch {
    return EMPTY();
  }
}

// The survey's lines, and its id, when it is one not mentioned yet and has something to say, said
// here or by the caller (the lines left out).
function foundLines(survey, surveyAt, host, leaveOut, carrying, earlier) {
  const none = { found: [], id: null };
  if (!isRecord(survey) || !isRecord(survey.data) || typeof survey.id !== 'string' || survey.id === surveyAt) return none;
  const since = isRecord(earlier) ? earlier : null;
  const said = (leave) => lines(briefingLines(survey.data, { host, leave, carrying: carrying === true, since }));
  if (said([]).length === 0) return none;
  return { found: said(list(leaveOut)), id: survey.id };
}

function build({ model, usage, sources, since, now, wasRaised = realWasRaised, timeZone, weeklySince, review, survey, surveyAt, host = null, leaveOut = [], carrying = false, earlier = null, holdLocked = false, safekeepingSaid = null }) {
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
  const said = part(() => foundLines(survey, surveyAt, host, leaveOut, carrying, earlier), { found: [], id: null });
  briefing.found = said.found;
  briefing.foundId = said.id;
  briefing.waiting = part(() => records(director.waiting).filter((w) => w.heldBack !== true).map(waitingEntry), []);
  briefing.heldBack = part(() => records(director.waiting).filter((w) => w.heldBack === true).length, 0);
  briefing.changed = part(() => lines(records(director.changed).filter((c) => isNew(c.at)).map((c) => c.what))
    .filter((what) => !BARE_MERGE.test(what)), []);
  briefing.verdict = part(() => verdict({ waiting: records(director.waiting).length, broken: brokenCount(director.health) }), '');
  const known = !Number.isNaN(sinceMs);
  briefing.since = part(() => (known && Number.isFinite(nowMs) ? sinceAbout(clockOf(sinceMs, timeZone), nowMs - sinceMs) : ''), '');
  // What is new since the last briefing is counted only when there was one.
  briefing.plus = part(() => ({
    waiting: known ? records(director.waiting).filter((w) => w.heldBack !== true && msOf(w.since) > sinceMs).length : 0,
    changed: known ? briefing.changed.length : 0,
  }), { waiting: 0, changed: 0 });
  briefing.progress = part(() => progressLines({ director, build: isRecord(board.build) ? board.build : {} }, isNew), []);

  const shown = msOf(weeklySince);
  const due = part(() => weeklyDue(Number.isFinite(nowMs) && shown > nowMs ? NaN : shown, nowMs, timeZone), true);
  const standing = part(() => lines(records(director.health).filter((l) => (l.level === 'watch' || l.level === 'stop') && l.safekeeping !== true).map((l) => l.text)), []);
  // Setup's own briefing holds Locked's line back: the director chose minutes before (holdLocked).
  const weekly = due ? standing.filter(isWeekly).filter((text) => !(holdLocked === true && text === LOCKED_WOULD_LINE)) : [];
  const health = standing.filter((text) => !isWeekly(text));
  const unusual = part(() => unusualItems(usage, typeof wasRaised === 'function' ? wasRaised : realWasRaised), []);
  const report = isRecord(sources) && (Number.isNaN(sinceMs) || msOf(sources.at) > sinceMs) ? sources : null;
  const fromSources = report ? part(() => sourceLines(report), []) : [];
  const damaged = part(() => list(board.missing).filter((line) => typeof line === 'string' && DAMAGED.test(line)), []);
  const dueReview = part(() => reviewLine(review), null);
  const blocked = part(() => blockedLines({ build: isRecord(board.build) ? board.build : {} }), []);
  // The weekly lines and unusual use are news and the other health lines stand from one briefing
  // to the next, so the news comes first and is the last of `watch` to be cut for length; a review
  // that is due follows it, then the pull requests that are blocked.
  const kept = part(() => safekeepingNews(director.health, safekeepingSaid, nowMs), null);
  briefing.watch = [...weekly, ...unusual.map((u) => u.line), ...(kept === null ? [] : [kept.line]), ...(dueReview === null ? [] : [dueReview]), ...blocked, ...health, ...fromSources, ...damaged];
  briefing.safekeeping = kept === null ? null : { level: kept.level, at: weekly.length + unusual.length };
  briefing.raise = unusual.map((u) => u.id);
  briefing.weekly = weekly.length;
  briefing.usage = part(() => usageLine(usage), null);
  // On track: the week's figures are known, nothing in them is unusual and the allowance isn't spent.
  briefing.onTrack = part(() => briefing.usage !== null && records(usage?.unusual).length === 0
    && !(isNumber(usage?.week?.share) && usage.week.share >= 100), false);
  return briefing;
}
