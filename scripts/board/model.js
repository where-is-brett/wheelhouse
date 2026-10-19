// scripts/board/model.js
// The board's two tabs, Director and Build, as plain data: built from the state views (and the
// profile views' unconfirmed settings), the raw events, the usage figures, the health lines, the
// settings in force and the sources report. Nothing here reads a file or the host, and nothing
// throws: a missing or damaged input becomes a line in `missing`. Every text an agent wrote
// reaches the board through oneLine, as one capped line with no Markdown of its own.
import { LINE_CHARS, WEEK_MS } from '../lib/core-numbers.js';
import { latestFor } from '../state/views.js';
import { BUILD_QUESTION_LABELS, isBuildQuestion, settingKey } from '../protection/windows-builds.js';

const LANES = ['quick', 'small', 'feature', 'bug'];
const WHEN = ['now', 'next', 'later'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const NO_STATE = 'There is no state for this project on this computer yet';
const NO_BUILD_LOOP = 'The build loop isn\'t running yet';
const NO_USAGE = 'Usage counts aren\'t on yet';
const NO_HEALTH = 'How the project stands couldn\'t be read';
const NO_SETTINGS = 'The settings couldn\'t be read';
const NO_SOURCES = 'The weekly check of official sources hasn\'t run yet';
const NO_CLOCK = 'The board\'s clock couldn\'t be read';
// The step a feature reads as while the director's Not now to its build commands holds it.
export const NOT_NOW_STEP = 'waiting on you to allow its build commands';
// The Windows build-commands settings, one per computer: confirmed only through their own card.
const BUILDS_KEY = settingKey('');
// A card's answer line, as the prompt record reads it.
const ANSWER_LINE = /Answer question (q-[a-z0-9-]+-[0-9]+)(?![a-z0-9-])/g;
// A time as the state and usage scripts write it, in UTC. Any other text is no time.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
// The most of a text oneLine reads.
const INPUT_CHARS = 20 * LINE_CHARS;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const values = (view) => (isRecord(view) ? Object.values(view).filter(isRecord) : []);
const list = (value) => (Array.isArray(value) ? value.filter(isRecord) : []);
// The time if it is one, else null. The time it reads back as must be the one written, so a
// date that rolls over (30 February, hour 24) is no time.
function timeOf(value) {
  const parts = typeof value === 'string' ? ISO_UTC.exec(value) : null;
  const ms = parts ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) return null;
  const fraction = (parts[1] ?? '.').slice(1).padEnd(3, '0');
  return new Date(ms).toISOString() === `${value.slice(0, 19)}.${fraction}Z` ? value : null;
}
const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
// Oldest first by strict time; a time that can't be read counts as the oldest.
const oldestFirst = (a, b) => (timeOf(a?.at) ?? '').localeCompare(timeOf(b?.at) ?? '');
const newestFirst = (a, b) => oldestFirst(b, a);
const isPr = (value) => Number.isInteger(value) && value > 0;

// Cuts a line to LINE_CHARS, ending it with an ellipsis, never between the halves of a surrogate pair.
function cap(text) {
  if (text.length <= LINE_CHARS) return text;
  let cut = text.slice(0, LINE_CHARS - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

// One line of plain text, at most LINE_CHARS: links and images become their words, and heading,
// list, quote and code marks are taken out. Anything that isn't text or a number is no text.
export function oneLine(text) {
  if (typeof text === 'number' && Number.isFinite(text)) return String(text);
  if (typeof text !== 'string') return '';
  // Cut first, so deeply nested marks can't make the passes below slow.
  if (text.length > INPUT_CHARS) text = text.slice(0, INPUT_CHARS).replace(/[\uD800-\uDBFF]$/, '');
  const lines = text.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/g, ' ').split(/\r?\n|\r/)
    .map(withoutLeadingMarks);
  const linked = untilStable(lines.join(' '), (s) => s
    .replace(/!\[([^\][]*)\]\([^()]*\)/g, '$1')
    .replace(/\[([^\][]*)\]\([^()]*\)/g, '$1')
    .replace(/\[([^\][]*)\]\[[^\][]*\]/g, '$1'))
    .replaceAll('](', ' (')
    .replace(/[[\]]/g, '')
    .replace(/<((?:https?:\/\/|mailto:)[^<>\s]*|[^<>\s@]+@[^<>\s@]+)>/g, ' $1 ');
  // Tags come out until none is left, since taking one out can join the text around it into
  // another; then any < or > left over goes too. The board's lines need neither.
  const words = untilStable(linked, (s) => s.replace(/<\/?[A-Za-z!?][^<>]*>/g, ' '))
    .replace(/[<>]/g, ' ')
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cap(withoutLeadingMarks(words).trim());
}

// Applies `step` until the text stops changing.
function untilStable(text, step) {
  let before;
  let after = text;
  do {
    before = after;
    after = step(before);
  } while (after !== before);
  return after;
}

// Takes quote, heading, list and code-fence marks off the start of a line, however they are
// nested or indented. A fence's language word goes with it.
function withoutLeadingMarks(line) {
  return untilStable(line, (s) => s
    .replace(/^\s*(`{3,}|~{3,})\S*/, '')
    .replace(/^\s*>+/, '')
    .replace(/^\s*#+(\s+|$)/, '')
    .replace(/^\s*([-*+]|\d{1,9}[.)])(\s+|$)/, ''));
}

// A value as words: text and numbers as they are, anything else as JSON.
function valueWords(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return oneLine(String(value));
  try {
    return oneLine(JSON.stringify(value) ?? '');
  } catch {
    return '';
  }
}

function dayMonthYear(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function tokenWords(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M tokens`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}K tokens`;
  return `${Math.round(value)} tokens`;
}
export const dollarWords = (value) => `$${value < 1 ? value.toFixed(2) : Math.round(value)}`;

// Section 9: what was written for the director to confirm and isn't confirmed yet. The views keep
// these without effect, so nothing has been applied without confirmation; they are listed instead.
// `profile` is the profile views' unconfirmed list: a setting there is the director's own, for
// every project. A Windows build-commands setting is left out: it is confirmed only through its own
// card, and a Keep asking click leaves one unconfirmed each day it is offered.
function firstLines(views, profile) {
  const kinds = { ruling: 'A ruling', level: 'A level', setting: 'A setting' };
  const builds = (u) => u.kind === 'setting' && [u.key, u.data?.key].some((key) => typeof key === 'string' && key.startsWith(BUILDS_KEY));
  const project = list(views?.unconfirmed).filter((u) => Object.hasOwn(kinds, u.kind) && !builds(u)).map((u) => ({ u, label: kinds[u.kind] }));
  const own = list(profile).filter((u) => u.kind === 'setting').map((u) => ({ u, label: 'Your setting' }));
  return [...project, ...own].sort((a, b) => oldestFirst(a.u, b.u)).map(({ u, label }) => {
    const data = isRecord(u.data) ? u.data : {};
    const what = u.kind === 'ruling' ? oneLine(data.words) : `${oneLine(u.key ?? data.key)} ${valueWords(data.value)}`.trim();
    return cap(`${label}: ${what || 'with no words'}, not yet confirmed by you`);
  });
}

// Whether a card's text names a build-loop question by its answer line.
function namesQuestion(card, id) {
  const pattern = new RegExp(`Answer question ${id.replace(/[^a-z0-9-]/g, '')}(?![a-z0-9-])`);
  return [card.data?.question, card.data?.title].some((text) => typeof text === 'string' && pattern.test(text));
}

// The cards waiting are the waiting view's, so one rule, in views.js, says what waits. (Whether a
// card put off with Not now stays waiting is the front desk plan's change to that rule.) Then the
// build loop's questions that nobody has answered and no card asked, waiting or not, names.
// A build-command question is named by its commands, since a session writes its `what`.
// Oldest first, numbered from 1.
function waitingList(views, events, questions) {
  const cards = list(views?.waiting);
  const named = [...cards, ...events.filter((e) => e.kind === 'card')];
  const items = cards.map((card) => ({ what: oneLine(card.data?.title ?? card.data?.question) || 'A question', since: timeOf(card.at) }));
  for (const [id, entry] of Object.entries(questions)) {
    if (!isRecord(entry) || entry.answer || named.some((card) => namesQuestion(card, id))) continue;
    items.push({ what: questionWords(entry.question?.data) || 'A question from the build', since: timeOf(entry.question?.at) });
  }
  return items.sort((a, b) => (a.since ?? '').localeCompare(b.since ?? '')).map((item, i) => ({ n: i + 1, ...item }));
}

// A build-loop question in words: a build-command question by its commands, with its `what` beside them.
function questionWords(data) {
  const what = oneLine(data?.what);
  if (!isBuildQuestion(data)) return what;
  return cap(`Run ${data.commands.map(oneLine).join(', ')}${what ? `: ${what}` : ''}`);
}

// Whether the director's Not now holds the feature for `work`: its newest build-command question
// (isBuildQuestion) isn't answered, and a plain card-answer labelled Not now, after the question,
// names that question alone by its answer line; and no report for the work came at or after it.
// A Not now click is never a signed answer, so this is for the board's words only: a forged
// card-answer makes the feature read as waiting, nothing more.
function heldByNotNow(work, questions, events, reports) {
  const asked = Object.entries(questions)
    .filter(([, entry]) => isRecord(entry) && isBuildQuestion(entry.question?.data) && entry.question.data.work === work && timeOf(entry.question.at))
    .sort(([, a], [, b]) => oldestFirst(a.question, b.question));
  if (asked.length === 0) return false;
  const [id, newest] = asked.at(-1);
  if (newest.answer) return false;
  const ms = (value) => Date.parse(timeOf(value));
  const since = ms(newest.question.at);
  const said = events.filter((e) => e.kind === 'card-answer' && e.data?.label === BUILD_QUESTION_LABELS.notNow && ms(e.at) >= since
    && typeof e.data.question === 'string' && namesOnly(e.data.question, id));
  if (said.length === 0) return false;
  const first = Math.min(...said.map((e) => ms(e.at)));
  return !reports.some((r) => r.data.work === work && ms(r.at) >= first);
}

// Whether `text` names exactly one question by its answer line, and that one is `id`.
function namesOnly(text, id) {
  const found = [...text.matchAll(ANSWER_LINE)];
  return found.length === 1 && found[0][1] === id;
}

function workInfo(work, id) {
  const data = isRecord(work[id]) && isRecord(work[id].work?.data) ? work[id].work.data : {};
  return { title: oneLine(data.title) || oneLine(id), lane: LANES.includes(data.lane) ? data.lane : null };
}

// pull request -> commit -> record, keeping only records with data and a time.
function readable(view) {
  const out = {};
  for (const [pr, commits] of Object.entries(isRecord(view) ? view : {})) {
    out[pr] = Object.fromEntries(Object.entries(isRecord(commits) ? commits : {})
      .filter(([, r]) => isRecord(r) && isRecord(r.data) && typeof r.at === 'string' && typeof r.id === 'string'));
  }
  return out;
}

// The review of a pull request's head: the newest commit the reviews or approvals name for it.
// A review of an older commit says nothing about the head, so a head with none reads as none.
function headReview(reviews, approvals, pr) {
  const review = latestFor(reviews, pr);
  const approval = latestFor(approvals, pr);
  if (!approval || (review && oldestFirst(approval, review) <= 0)) return review;
  return reviews[String(pr)]?.[String(approval.data.commit)] ?? null;
}
function reviewState(record) {
  const verdict = typeof record?.data?.verdict === 'string' ? record.data.verdict.toUpperCase() : null;
  if (verdict === 'CLEAN') return 'clean';
  return verdict === 'FINDINGS' ? 'findings' : 'none';
}
const findingsOf = (record) => (Number.isInteger(record?.data?.findings) && record.data.findings >= 0 ? record.data.findings : null);

// One unusual item from the usage figures in words, or null when it has no figures to say.
// The board and the briefing both say it this way.
export function unusualLine(u) {
  if (!isRecord(u) || typeof u.tokens !== 'number' || typeof u.median !== 'number') return null;
  const amount = u.unit === 'usd' ? dollarWords : tokenWords;
  const name = typeof u.id === 'string' ? u.id.slice(u.id.indexOf(':') + 1) : '';
  const who = u.kind === 'feature' ? `Work on ${oneLine(name)}` : u.kind === 'day' ? dayMonthYear(name) ?? 'One day' : 'One session';
  const usual = u.unit === 'usd' ? dollarWords(u.median) : tokenWords(u.median).replace(' tokens', '');
  return cap(`${who} used ${amount(u.tokens)}, against a usual ${usual}: ${oneLine(u.cause)}`);
}

function unusualLines(unusual) {
  return list(unusual).map(unusualLine).filter((line) => line !== null);
}

// What the build loop and the sources add to health: open incidents, a model the director's
// projects use retiring soon, and security advisories for the repositories it builds on.
function extraHealth(incidents, sources) {
  const lines = [];
  for (const i of list(incidents?.open)) lines.push({ level: 'stop', text: cap(`Incident ${oneLine(i.id)} is open, so nothing merges: ${oneLine(i.what)}`) });
  for (const r of list(sources?.retiring)) {
    if (r.routed === true && r.soon === true) lines.push({ level: 'watch', text: cap(`${oneLine(r.model)}, a model your projects use, retires on ${dayMonthYear(r.date) ?? oneLine(r.date)}`) });
  }
  for (const a of list(sources?.advisories)) lines.push({ level: 'watch', text: cap(`A security advisory for ${oneLine(a.repo)}: ${oneLine(a.summary)}`) });
  return lines;
}

// Builds one part, or names it in `missing` when its inputs are too damaged to build it.
function part(missing, name, build, fallback) {
  try {
    return build();
  } catch {
    missing.push(`The board's ${name} couldn't be built`);
    return fallback;
  }
}

export function boardModel({ project, views, profileUnconfirmed, events, usage, health, settings, sources, now } = {}) {
  const missing = [];
  // A clock that can't be read is named, never replaced by this computer's.
  // Only a Date, a finite number, or a function giving one of those, is a clock.
  const reading = (value) => (value instanceof Date ? value.getTime() : typeof value === 'number' && Number.isFinite(value) ? value : NaN);
  let nowMs = NaN;
  try {
    nowMs = reading(typeof now === 'function' ? now() : now);
  } catch {
    // stays unread
  }
  if (!Number.isFinite(nowMs) || Number.isNaN(new Date(nowMs).getTime())) nowMs = NaN;
  const builtAt = Number.isNaN(nowMs) ? null : new Date(nowMs).toISOString();
  if (builtAt === null) missing.push(NO_CLOCK);
  const state = isRecord(views) ? views : null;
  if (!state) missing.push(NO_STATE);
  const loop = state && isRecord(state.work) && isRecord(state.features) ? state : null;
  if (!loop) missing.push(NO_BUILD_LOOP);
  const work = loop ? loop.work : {};
  const features = loop ? loop.features : {};
  const questions = loop && isRecord(loop.questions) ? loop.questions : {};
  const all = list(events);
  const reports = all.filter((e) => e.kind === 'report' && isRecord(e.data));
  const merges = all.filter((e) => e.kind === 'merge' && isRecord(e.data));
  const figures = isRecord(usage) ? usage : null;
  if (!figures) missing.push(NO_USAGE);
  for (const line of Array.isArray(figures?.missing) ? figures.missing : []) if (typeof line === 'string') missing.push(oneLine(line));
  const lines = Array.isArray(health) ? health.filter((l) => isRecord(l) && typeof l.text === 'string') : null;
  if (!lines) missing.push(NO_HEALTH);
  const effective = isRecord(settings) ? settings : null;
  if (!effective) missing.push(NO_SETTINGS);
  const report = isRecord(sources) ? sources : null;
  if (!report) missing.push(NO_SOURCES);
  const damaged = Array.isArray(state?.damaged) ? state.damaged.length : 0;
  if (damaged > 0) missing.push(`${damaged} ${damaged === 1 ? 'record' : 'records'} couldn't be read`);

  const active = values(features).filter((f) => isRecord(f.data) && typeof f.data.work === 'string' && f.data.step !== 'closed').sort(oldestFirst);
  // The step each active feature reads as: the director's Not now to its build commands holds it.
  const held = new Set(part(missing, 'build-command answers', () => active.map((f) => f.data.work).filter((w) => heldByNotNow(w, questions, all, reports)), []));
  const stepOf = (f) => (held.has(f.data.work) ? NOT_NOW_STEP : oneLine(f.data.step));
  const prOfWork = (id) => reports.filter((r) => r.data.work === id && isPr(r.data.pr)).sort(oldestFirst).at(-1)?.data.pr ?? null;

  const inProgress = part(missing, 'work in progress', () => {
    const out = Object.fromEntries(LANES.map((lane) => [lane, []]));
    for (const f of active) {
      const info = workInfo(work, f.data.work);
      if (info.lane) out[info.lane].push({ title: info.title, step: stepOf(f) });
    }
    return out;
  }, Object.fromEntries(LANES.map((lane) => [lane, []])));

  const ideas = part(missing, 'ideas', () => {
    const out = { now: [], next: [], later: [] };
    for (const idea of values(state?.ideas).filter((i) => isRecord(i.data)).sort(oldestFirst)) {
      const text = oneLine(idea.data.text ?? idea.data.title ?? idea.data.what ?? idea.key);
      if (text) out[WHEN.includes(idea.data.when) ? idea.data.when : 'later'].push(text);
    }
    return out;
  }, { now: [], next: [], later: [] });

  const launch = part(missing, 'progress to launch', () => {
    const blockers = values(state?.blockers).filter((b) => isRecord(b.data)).sort(oldestFirst);
    const started = new Set(values(features).map((f) => f.data?.work));
    const queued = values(work).filter((w) => w.approved === true && isRecord(w.work?.data) && !started.has(w.work.data.id))
      .sort((a, b) => (a.work.data.place ?? Infinity) - (b.work.data.place ?? Infinity) || oldestFirst(a.work, b.work))
      .map((w) => workInfo(work, w.work.data.id).title);
    return {
      phase: typeof effective?.phase?.value === 'string' ? effective.phase.value : null,
      resolved: blockers.filter((b) => b.data.resolved === true).length,
      total: blockers.length,
      blockers: blockers.filter((b) => b.data.resolved !== true).map((b) => oneLine(b.data.what)).filter(Boolean),
      next: [...ideas.now, ...queued],
    };
  }, { phase: null, resolved: 0, total: 0, blockers: [], next: [] });

  const decisions = list(state?.decisions).filter((d) => isRecord(d.data));
  const week = isRecord(figures?.week) ? figures.week : null;
  const fromMs = Date.parse(timeOf(week?.from));
  const toMs = Date.parse(timeOf(week?.to));
  const [weekFrom, weekTo] = Number.isNaN(fromMs) || Number.isNaN(toMs) ? [nowMs - WEEK_MS, nowMs] : [fromMs, toMs];

  const director = {
    first: part(missing, 'unconfirmed changes', () => firstLines(state, profileUnconfirmed), []),
    waiting: part(missing, 'waiting list', () => waitingList(state, all, questions), []),
    launch,
    inProgress,
    changed: part(missing, 'changes for users', () => merges.filter((m) => timeOf(m.at)).sort(newestFirst).slice(0, 20).map((m) => ({
      what: oneLine(m.data.forUsers) || (isPr(m.data.pr) ? `Pull request #${m.data.pr} merged` : 'A pull request merged'), at: timeOf(m.at),
    })), []),
    ideas,
    health: [...(lines ?? []).map((l) => ({ level: l.level, text: l.text })), ...part(missing, 'health', () => extraHealth(loop?.incidents, report), [])],
    budget: {
      week: week ? { from: timeOf(week.from), to: timeOf(week.to), tokens: numberOrNull(week.tokens), usd: numberOrNull(week.usd) } : null,
      share: numberOrNull(week?.share),
      setting: 'report',
      unusual: part(missing, 'unusual use', () => unusualLines(figures?.unusual), []),
    },
    rulings: part(missing, 'rulings', () => decisions.filter((d) => d.data.level === 2).sort(newestFirst).slice(0, 10)
      .map((d) => ({ what: oneLine(d.data.what), at: timeOf(d.at) })), []),
  };

  const build = {
    features: part(missing, 'features', () => active.map((f) => {
      const info = workInfo(work, f.data.work);
      const slice = f.data.slice;
      return {
        work: oneLine(f.data.work),
        title: info.title,
        lane: info.lane,
        step: stepOf(f),
        slice: isRecord(slice) && Number.isInteger(slice.n) && Number.isInteger(slice.m) ? { n: slice.n, m: slice.m } : null,
        pr: prOfWork(f.data.work),
      };
    }), []),
    pullRequests: part(missing, 'pull requests', () => {
      const done = new Set([
        ...merges.map((m) => m.data.pr),
        ...reports.filter((r) => r.data.outcome === 'merged' || r.data.outcome === 'closed').map((r) => r.data.pr),
      ].filter(isPr));
      const prs = new Set([
        ...Object.keys(isRecord(state?.reviews) ? state.reviews : {}),
        ...Object.keys(isRecord(state?.approvals) ? state.approvals : {}),
        ...reports.map((r) => String(r.data.pr)),
      ].map(Number).filter((pr) => isPr(pr) && !done.has(pr)));
      const reviews = readable(state?.reviews);
      const approvals = readable(state?.approvals);
      return [...prs].sort((a, b) => a - b).map((pr) => {
        const review = headReview(reviews, approvals, pr);
        const named = reports.filter((r) => r.data.pr === pr && typeof r.data.work === 'string').sort(oldestFirst).at(-1);
        return { pr, work: named ? oneLine(named.data.work) : null, review: reviewState(review), findings: review ? findingsOf(review) : null };
      });
    }, []),
    quality: part(missing, 'quality this week', () => {
      const reviews = values(readable(state?.reviews)).flatMap(values).filter((r) => {
        const time = Date.parse(timeOf(r.at));
        return time >= weekFrom && time <= weekTo;
      });
      const counts = reviews.map((r) => findingsOf(r) ?? 0);
      return {
        reviews: reviews.length,
        withFindings: reviews.filter((r, i) => reviewState(r) === 'findings' || counts[i] > 0).length,
        findings: counts.reduce((sum, n) => sum + n, 0),
      };
    }, { reviews: 0, withFindings: 0, findings: 0 }),
    decisions: part(missing, 'decisions', () => [
      ...decisions.map((d) => ({ what: oneLine(d.data.what), why: oneLine(d.data.why), at: timeOf(d.at) })),
      ...reports.flatMap((r) => (Array.isArray(r.data.rulings) ? r.data.rulings : []).map((what) => ({ what: oneLine(what), why: '', at: timeOf(r.at) }))),
    ].filter((d) => d.what).sort(newestFirst).slice(0, 20), []),
    risks: part(missing, 'risks', () => values(state?.risks).filter((r) => isRecord(r.data)).sort(newestFirst)
      .map((r) => ({ what: oneLine(r.data.what), costLater: oneLine(r.data.costLater) })), []),
    usage: {
      ...Object.fromEntries(['front-desk', 'foreman', 'feature'].map((role) => {
        const figure = figures?.byPart?.[role];
        return [role, { tokens: numberOrNull(figure?.tokens), usd: numberOrNull(figure?.usd) }];
      })),
      subagents: numberOrNull(figures?.bySubagents?.tokens),
    },
  };

  return { project, builtAt, director, build, missing: [...new Set(missing)] };
}
