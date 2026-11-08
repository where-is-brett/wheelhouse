// scripts/digest/model.js
// The daily digest as plain data (design section 9 of the director's way of working): what merged by itself, what finished and
// waits for the director's approval, what waits on decisions and what each piece did meanwhile, and the usage. Once a week it
// also carries the decision log, the calls the agents made on their own side of the decision line. Nothing here reads or writes a
// file, and nothing throws: a part that can't be built is empty.
//
// The words of a title or a decision came from agents, so they pass through `oneLine` (no links, no marks, one line) and are cut
// to a length that reads on a phone screen.
import { oneLine, tokenWords, dollarWords, creditWords } from '../board/model.js';
import { cardOutcomes } from '../state/views.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// The most entries a section lists; the rest are counted.
export const MOST_LISTED = 12;
const WORDS_MAX = 160;
const APPROVAL = /^Approve pull request #(\d+) at commit [0-9a-f]+/;

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function words(text) {
  const one = oneLine(text);
  return one.length > WORDS_MAX ? `${one.slice(0, WORDS_MAX - 1).trimEnd()}…` : one;
}

function clockMs(now) {
  try {
    const value = typeof now === 'function' ? now() : now;
    const ms = new Date(value === undefined ? Date.now() : value).getTime();
    return Number.isFinite(ms) ? ms : Date.now();
  } catch {
    return Date.now();
  }
}

function part(build, fallback) {
  try {
    return build();
  } catch {
    return fallback;
  }
}

// The changes the helper merged by itself (`self-merged` events) since `sinceMs`, oldest first.
function selfMergedOf(events, sinceMs, nowMs) {
  return list(events).filter((e) => isRecord(e) && e.kind === 'self-merged' && isRecord(e.data) && Number.isInteger(e.data.pr))
    .filter((e) => { const at = Date.parse(e.at); return at >= sinceMs && at <= nowMs; })
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .map((e) => ({
      pr: e.data.pr,
      reason: e.data.reason === 'decision-records' ? 'decision records' : 'no change users see',
      ...(typeof e.data.title === 'string' && words(e.data.title) !== '' ? { title: words(e.data.title) } : {}),
      ...(typeof e.data.work === 'string' ? { work: e.data.work } : {}),
    }));
}

// The finished work waiting for the director's approval: the approval cards no answer has decided, oldest first.
function waitingApprovalOf(events, enrolled) {
  const waiting = cardOutcomes(list(events), list(enrolled)).filter((o) => o.decided === null && isRecord(o.card?.data) && typeof o.card.data.line === 'string' && APPROVAL.test(o.card.data.line));
  return waiting.sort((a, b) => (a.card.at < b.card.at ? -1 : a.card.at > b.card.at ? 1 : 0)).map((o) => {
    const pr = Number(APPROVAL.exec(o.card.data.line)[1]);
    const ask = words(String(o.card.data.question ?? '').split('\n')[0]);
    return { pr, ...(ask !== '' ? { title: ask } : {}) };
  });
}

function usageOf(usage) {
  const week = isRecord(usage?.week) ? usage.week : null;
  if (week === null) return null;
  const out = {};
  if (isNumber(week.tokens) && week.tokens >= 0) out.tokens = week.tokens;
  if (isNumber(week.usd) && week.usd >= 0) out.usd = week.usd;
  if (isNumber(week.credits) && week.credits >= 0) out.credits = week.credits;
  if (isNumber(week.share) && week.share >= 0) out.share = Math.round(week.share);
  return Object.keys(out).length === 0 ? null : out;
}

// digestModel({ events, calls, pending, usage, now, weekly, since, enrolled, alertFailures }) ->
//   { selfMerged: [{ pr, title?, work?, reason }], waitingApproval: [{ pr, title? }],
//     waitingDecisions: [{ n, question, meanwhile, work }], usage: { tokens?, usd?, credits?, share? } | null,
//     alerts: [channel, ...], calls? }
// `events` are the project's, `pending` is pendingDecisions' list, `usage` is usageFigures', and `calls` the calls recorded since the
// last log (projectCalls). `since` is when the director was last shown a digest (a day ago when none, never longer ago than a week), `weekly`
// says this digest carries the decision log (`calls`, and only then), and `alertFailures` lists the channels a phone alert could not
// reach, which the digest says so the director knows to look in the chat.
export function digestModel({ events, calls, pending, usage, now, weekly = false, since, enrolled, alertFailures, held } = {}) {
  const nowMs = clockMs(now);
  const sinceParsed = typeof since === 'string' ? Date.parse(since) : NaN;
  const sinceMs = Number.isFinite(sinceParsed) ? Math.max(sinceParsed, nowMs - 7 * DAY_MS) : nowMs - DAY_MS;
  const model = {
    selfMerged: part(() => selfMergedOf(events, sinceMs, nowMs), []),
    waitingApproval: part(() => waitingApprovalOf(events, enrolled), []),
    waitingDecisions: part(() => list(pending).filter(isRecord).map((d) => ({
      n: d.n, question: words(d.question), meanwhile: words(d.meanwhile), work: typeof d.work === 'string' ? words(d.work) : null,
    })), []),
    usage: part(() => usageOf(usage), null),
    alerts: part(() => [...new Set(list(alertFailures).filter((c) => typeof c === 'string'))], []),
  };
  // The pieces the director holds at the helm, oldest first; the key is there only when some are held.
  const heldPieces = part(() => list(held).filter((h) => isRecord(h) && typeof h.work === 'string' && h.work !== '')
    .map((h) => ({ work: words(h.work), since: typeof h.since === 'string' ? h.since : null }))
    .sort((a, b) => String(a.since).localeCompare(String(b.since)) || a.work.localeCompare(b.work)), []);
  if (heldPieces.length > 0) model.held = heldPieces;
  if (weekly === true) {
    model.calls = part(() => list(calls).filter(isRecord).map((c) => ({
      work: typeof c.work === 'string' ? words(c.work) : null,
      at: typeof c.at === 'string' ? c.at : null,
      decided: words(c.decided),
      why: words(c.why),
      options: list(c.options).map((o) => words(typeof o === 'string' ? o : o?.label)).filter(Boolean),
    })), []);
  }
  return model;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CHANNEL_NAMES = { ntfy: 'ntfy', telegram: 'Telegram' };

// A time as "8 November 2026", this computer's own day.
export function sayDay(now) {
  const at = new Date(clockMs(now));
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

function usageLine(usage) {
  if (usage === null || usage === undefined) return 'Usage this week isn\'t known yet.';
  const said = [
    isNumber(usage.credits) ? `${creditWords(usage.credits)} over the sessions Wheelhouse started` : null,
    isNumber(usage.tokens) ? tokenWords(usage.tokens) : null,
    isNumber(usage.usd) ? `about ${dollarWords(usage.usd)} at API prices` : null,
    isNumber(usage.share) ? `${usage.share}% of your weekly allowance` : null,
  ].filter(Boolean);
  return `Usage this week: ${said.join(', ')}.`;
}

const stop = (text) => String(text).replace(/[.\s]+$/u, '');

function listed(items, say) {
  const shown = items.slice(0, MOST_LISTED).map(say);
  if (items.length > MOST_LISTED) shown.push(`And ${items.length - MOST_LISTED} more.`);
  return shown;
}

// digestText(model, { now }) -> the digest in plain words, in the order of design section 9: merged by itself, waiting for approval,
// waiting on decisions (with what each piece did meanwhile), usage; then, once a week, the decision log; then any phone alert that
// couldn't be sent. Every part is a few short lines, so it reads in the chat and on a phone.
export function digestText(model, { now } = {}) {
  const m = isRecord(model) ? model : {};
  const out = [`Daily digest, ${sayDay(now)}`, ''];
  out.push('Merged by itself');
  const merged = list(m.selfMerged);
  out.push(...(merged.length === 0 ? ['Nothing.'] : listed(merged, (x) => `- Pull request #${x.pr}${x.title ? `: ${x.title}` : ''} (${x.reason})`)));
  out.push('', 'Finished and waiting for your approval');
  const approval = list(m.waitingApproval);
  out.push(...(approval.length === 0 ? ['Nothing.'] : listed(approval, (x) => `- Pull request #${x.pr}${x.title ? `: ${x.title}` : ''}`)));
  out.push('', 'Waiting on your decisions');
  const decisions = list(m.waitingDecisions);
  out.push(...(decisions.length === 0 ? ['Nothing.'] : listed(decisions, (d) => {
    const meanwhile = d.meanwhile ? ` Meanwhile: ${d.meanwhile}` : '';
    return `${d.n}. ${d.question}${d.work ? ` (${d.work})` : ''}${meanwhile}`;
  })));
  const heldNow = list(m.held);
  if (heldNow.length > 0) {
    out.push('', 'Held by you at the helm');
    out.push(...listed(heldNow, (h) => {
      const at = h.since === null ? null : new Date(h.since);
      const clock = at === null || Number.isNaN(at.getTime()) ? null : `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
      return `- ${h.work}, with you${clock === null ? '' : ` since ${clock}`}`;
    }));
  }
  out.push('', usageLine(m.usage ?? null));
  if (Array.isArray(m.calls)) {
    out.push('', 'The week\'s decision log: what the agents decided on their own');
    out.push(...(m.calls.length === 0 ? ['No calls were logged this week.'] : listed(m.calls, (c) => {
      const options = c.options.length > 0 ? ` Options: ${c.options.join(', ')}.` : '';
      return `- ${c.work ? `${c.work}: ` : ''}${stop(c.decided)}.${c.why ? ` Why: ${stop(c.why)}.` : ''}${options}`;
    })));
  }
  const failed = list(m.alerts).map((c) => CHANNEL_NAMES[c] ?? oneLine(c));
  if (failed.length > 0) out.push('', `A phone alert couldn't be sent through ${failed.join(' or ')}. Decisions wait here in the chat all the same.`);
  return out.join('\n');
}

// Whether the digest has anything to say: any section with an entry, a failed alert, or a usage figure.
export const hasNews = (model) => isRecord(model) && (model.selfMerged.length > 0 || model.waitingApproval.length > 0 || model.waitingDecisions.length > 0
  || (Array.isArray(model.held) && model.held.length > 0) || model.alerts.length > 0 || (Array.isArray(model.calls) && model.calls.length > 0) || model.usage !== null);
