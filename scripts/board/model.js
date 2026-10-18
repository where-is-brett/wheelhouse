// scripts/board/model.js
// The board's two tabs, Director and Build, as plain data: built from the state views, the
// raw events, the usage figures, the health lines, the settings in force and the sources
// report. Nothing here reads a file or the host, and nothing throws: a missing or damaged
// input becomes a line in `missing`. Every text an agent wrote reaches the board through
// oneLine, as one capped line with no Markdown of its own.
import { LINE_CHARS, WEEK_MS } from '../lib/core-numbers.js';

const LANES = ['quick', 'small', 'feature', 'bug'];
const WHEN = ['now', 'next', 'later'];
// Answers that leave a card waiting: the director put it off, or asked to hear more.
const NOT_ANSWERS = ['Not now', 'Explain more'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const NO_STATE = 'There is no state for this project on this computer yet';
const NO_BUILD_LOOP = 'The build loop isn\'t running yet';
const NO_USAGE = 'Usage counts aren\'t on yet';
const NO_HEALTH = 'How the project stands couldn\'t be read';
const NO_SETTINGS = 'The settings couldn\'t be read';
const NO_SOURCES = 'The weekly check of official sources hasn\'t run yet';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const values = (view) => (isRecord(view) ? Object.values(view).filter(isRecord) : []);
const list = (value) => (Array.isArray(value) ? value.filter(isRecord) : []);
const timeOf = (value) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);
const oldestFirst = (a, b) => String(a.at ?? '').localeCompare(String(b.at ?? ''));
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
  const lines = text.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/g, ' ').split(/\r?\n|\r/)
    .filter((line) => !/^\s*(`{3,}|~{3,})/.test(line))
    .map((line) => line
      .replace(/^\s*(>\s*)+/, '')
      .replace(/^\s{0,3}#{1,6}(\s+|$)/, '')
      .replace(/^\s*([-*+]|\d{1,9}[.)])\s+/, ''));
  const flat = lines.join(' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<(https?:\/\/[^>\s]*)>/g, '$1')
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cap(flat);
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

function tokenWords(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M tokens`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}K tokens`;
  return `${Math.round(value)} tokens`;
}
const dollarWords = (value) => `$${value < 1 ? value.toFixed(2) : Math.round(value)}`;

// Section 9: what was written for the director to confirm and isn't confirmed yet. The views keep
// these without effect, so nothing has been applied without confirmation; they are listed instead.
function firstLines(views) {
  const kinds = { ruling: 'A ruling', level: 'A level', setting: 'A setting' };
  return list(views?.unconfirmed).filter((u) => Object.hasOwn(kinds, u.kind)).sort(oldestFirst).map((u) => {
    const data = isRecord(u.data) ? u.data : {};
    const what = u.kind === 'ruling' ? oneLine(data.words) : `${oneLine(u.key ?? data.key)} ${valueWords(data.value)}`.trim();
    return cap(`${kinds[u.kind]}: ${what || 'with no words'}, not yet confirmed by you`);
  });
}

// Whether a card's text names a build-loop question by its answer line.
function namesQuestion(card, id) {
  const pattern = new RegExp(`Answer question ${id.replace(/[^a-z0-9-]/g, '')}(?![a-z0-9-])`);
  return [card.data?.question, card.data?.title].some((text) => typeof text === 'string' && pattern.test(text));
}

// The cards still waiting, and every card asked (which may name a question). From the events when
// there are any, since the waiting view closes a card on any answer, a put-off one included.
function cardsOf(views, events) {
  if (events.length === 0 && Array.isArray(views?.waiting)) {
    const waiting = list(views.waiting);
    return { waiting, asked: waiting };
  }
  const asked = events.filter((e) => e.kind === 'card' && typeof e.id === 'string');
  const answers = events.filter((e) => e.kind === 'card-answer' && isRecord(e.data) && !NOT_ANSWERS.includes(e.data.label));
  const ids = new Set(answers.map((e) => e.data.card).filter((c) => typeof c === 'string'));
  const quoted = new Set(answers.filter((e) => e.data.card === undefined || e.data.card === null)
    .map((e) => e.data.question).filter((q) => typeof q === 'string'));
  const questionOf = (card) => (typeof card.data?.question === 'string' ? card.data.question : card.data?.title);
  return { waiting: asked.filter((card) => !ids.has(card.id) && !quoted.has(questionOf(card))), asked };
}

// Cards asked and not yet answered, other than put off; then questions from the build loop that
// no card names yet and nobody has answered. Oldest first, numbered from 1.
function waitingList(views, events, questions) {
  const { waiting: cards, asked: named } = cardsOf(views, events);
  const items = cards.map((card) => ({ what: oneLine(card.data?.title ?? card.data?.question) || 'A question', since: timeOf(card.at) }));
  for (const [id, entry] of Object.entries(questions)) {
    if (!isRecord(entry) || entry.answer || named.some((card) => namesQuestion(card, id))) continue;
    items.push({ what: oneLine(entry.question?.data?.what) || 'A question from the build', since: timeOf(entry.question?.at) });
  }
  return items.sort((a, b) => String(a.since ?? '').localeCompare(String(b.since ?? ''))).map((item, i) => ({ n: i + 1, ...item }));
}

function workInfo(work, id) {
  const data = isRecord(work[id]) && isRecord(work[id].work?.data) ? work[id].work.data : {};
  return { title: oneLine(data.title) || oneLine(id), lane: LANES.includes(data.lane) ? data.lane : null };
}

// The latest review across a pull request's commits, or null.
function latestReview(commits) {
  return values(commits).filter((r) => isRecord(r.data)).sort(oldestFirst).at(-1) ?? null;
}
function reviewState(record) {
  const verdict = typeof record?.data?.verdict === 'string' ? record.data.verdict.toUpperCase() : null;
  if (verdict === 'CLEAN') return 'clean';
  return verdict === 'FINDINGS' ? 'findings' : 'none';
}
const findingsOf = (record) => (Number.isInteger(record?.data?.findings) && record.data.findings >= 0 ? record.data.findings : null);

function unusualLines(unusual) {
  return list(unusual).filter((u) => typeof u.tokens === 'number' && typeof u.median === 'number').map((u) => {
    const amount = u.unit === 'usd' ? dollarWords : tokenWords;
    const name = typeof u.id === 'string' ? u.id.slice(u.id.indexOf(':') + 1) : '';
    const who = u.kind === 'feature' ? `Work on ${oneLine(name)}` : u.kind === 'day' ? dayMonthYear(name) ?? 'One day' : 'One session';
    const usual = u.unit === 'usd' ? dollarWords(u.median) : tokenWords(u.median).replace(' tokens', '');
    return cap(`${who} used ${amount(u.tokens)}, against a usual ${usual}: ${oneLine(u.cause)}`);
  });
}

// What the build loop and the sources add to health: open incidents, a model this project uses
// retiring soon, and security advisories for the repositories it builds on.
function extraHealth(incidents, sources) {
  const lines = [];
  for (const i of list(incidents?.open)) lines.push({ level: 'stop', text: cap(`Incident ${oneLine(i.id)} is open, so nothing merges: ${oneLine(i.what)}`) });
  for (const r of list(sources?.retiring)) {
    if (r.routed === true && r.soon === true) lines.push({ level: 'watch', text: cap(`${oneLine(r.model)}, which this project uses, retires on ${dayMonthYear(r.date) ?? oneLine(r.date)}`) });
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

export function boardModel({ project, views, events, usage, health, settings, sources, now } = {}) {
  const nowMs = new Date(typeof now === 'function' ? now() : now ?? Date.now()).getTime();
  const builtAt = new Date(Number.isNaN(nowMs) ? Date.now() : nowMs).toISOString();
  const missing = [];
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
  const prOfWork = (id) => reports.filter((r) => r.data.work === id && isPr(r.data.pr)).sort(oldestFirst).at(-1)?.data.pr ?? null;

  const inProgress = part(missing, 'work in progress', () => {
    const out = Object.fromEntries(LANES.map((lane) => [lane, []]));
    for (const f of active) {
      const info = workInfo(work, f.data.work);
      if (info.lane) out[info.lane].push({ title: info.title, step: oneLine(f.data.step) });
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
  const fromMs = Date.parse(week?.from);
  const toMs = Date.parse(week?.to);
  const [weekFrom, weekTo] = Number.isNaN(fromMs) || Number.isNaN(toMs) ? [nowMs - WEEK_MS, nowMs] : [fromMs, toMs];

  const director = {
    first: part(missing, 'unconfirmed changes', () => firstLines(state), []),
    waiting: part(missing, 'waiting list', () => waitingList(state, all, questions), []),
    launch,
    inProgress,
    changed: part(missing, 'changes for users', () => merges.filter((m) => timeOf(m.at)).sort(newestFirst).slice(0, 20).map((m) => ({
      what: oneLine(m.data.forUsers) || (isPr(m.data.pr) ? `Pull request #${m.data.pr} merged` : 'A pull request merged'), at: m.at,
    })), []),
    ideas,
    health: [...(lines ?? []).map((l) => ({ level: l.level, text: l.text })), ...part(missing, 'health', () => extraHealth(loop?.incidents, report), [])],
    budget: {
      week: week ? { from: week.from ?? null, to: week.to ?? null, tokens: week.tokens ?? null, usd: week.usd ?? null } : null,
      share: typeof week?.share === 'number' ? week.share : null,
      setting: 'report',
      unusual: part(missing, 'unusual use', () => unusualLines(figures?.unusual), []),
    },
    rulings: part(missing, 'rulings', () => decisions.filter((d) => d.data.level === 2).sort(newestFirst).slice(0, 10)
      .map((d) => ({ what: oneLine(d.data.what), at: d.at })), []),
  };

  const build = {
    features: part(missing, 'features', () => active.map((f) => {
      const info = workInfo(work, f.data.work);
      const slice = f.data.slice;
      return {
        work: oneLine(f.data.work),
        title: info.title,
        lane: info.lane,
        step: oneLine(f.data.step),
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
      return [...prs].sort((a, b) => a - b).map((pr) => {
        const review = latestReview(state?.reviews?.[String(pr)]);
        const named = reports.filter((r) => r.data.pr === pr && typeof r.data.work === 'string').sort(oldestFirst).at(-1);
        return { pr, work: named ? oneLine(named.data.work) : null, review: reviewState(review), findings: review ? findingsOf(review) : null };
      });
    }, []),
    quality: part(missing, 'quality this week', () => {
      const reviews = values(state?.reviews).flatMap(values).filter((r) => {
        const time = Date.parse(r.at);
        return isRecord(r.data) && time >= weekFrom && time <= weekTo;
      });
      const counts = reviews.map((r) => findingsOf(r) ?? 0);
      return {
        reviews: reviews.length,
        withFindings: reviews.filter((r, i) => reviewState(r) === 'findings' || counts[i] > 0).length,
        findings: counts.reduce((sum, n) => sum + n, 0),
      };
    }, { reviews: 0, withFindings: 0, findings: 0 }),
    decisions: part(missing, 'decisions', () => [
      ...decisions.map((d) => ({ what: oneLine(d.data.what), why: oneLine(d.data.why), at: d.at })),
      ...reports.flatMap((r) => (Array.isArray(r.data.rulings) ? r.data.rulings : []).map((what) => ({ what: oneLine(what), why: '', at: r.at }))),
    ].filter((d) => d.what).sort(newestFirst).slice(0, 20), []),
    risks: part(missing, 'risks', () => values(state?.risks).filter((r) => isRecord(r.data)).sort(newestFirst)
      .map((r) => ({ what: oneLine(r.data.what), costLater: oneLine(r.data.costLater) })), []),
    usage: {
      ...Object.fromEntries(['front-desk', 'foreman', 'feature'].map((role) => {
        const figure = figures?.byPart?.[role];
        return [role, { tokens: figure?.tokens ?? null, usd: figure?.usd ?? null }];
      })),
      subagents: typeof figures?.bySubagents?.tokens === 'number' ? figures.bySubagents.tokens : null,
    },
  };

  return { project, builtAt, director, build, missing: [...new Set(missing)] };
}
