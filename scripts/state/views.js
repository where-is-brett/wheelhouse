// scripts/state/views.js
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome, profileDir, stateDir } from '../lib/paths.js';
import { listEvents, eventHash, dataHash, CONFIRMABLE_KINDS } from './events.js';
import { approvalLine, ciPushLine } from './card-lines.js';
import { verify, readEnrolled } from './signing.js';
import { REPLY_CODE_DAYS } from '../lib/core-numbers.js';
import { KEEP_AS_IS, PUT_OFF } from '../lib/front-desk.js';

const byOrder = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const isPlainKey = (k) => typeof k === 'string' && k !== '';
// The computer whose key signed a verified record, when that is the computer the record names;
// otherwise null. A record signed by one computer that names another was made on neither.
const signedOn = (e) => (typeof e?.computer === 'string' && e.sig?.computer === e.computer ? e.computer : null);
const uniqueIds = (ids) => [...new Set(ids.filter(isPlainKey))];

// The latest event per key, in the sorted order the caller supplies.
function latestPerKey(events, keyOf) {
  const out = {};
  for (const e of events) {
    const key = keyOf(e);
    if (isPlainKey(key)) out[key] = { key, id: e.id, at: e.at, data: e.data };
  }
  return out;
}

// pull request -> commit -> latest verified record
function recordsByPr(events, kind, enrolled) {
  const out = {};
  for (const e of events) {
    if (e.kind !== kind || !verify(e, enrolled)) continue;
    const pr = e.data?.pr;
    const commit = e.data?.commit;
    if (pr === undefined || pr === null || !isPlainKey(String(commit ?? ''))) continue;
    const bucket = (out[String(pr)] ??= {});
    bucket[String(commit)] = e;
  }
  return out;
}

// The latest verified record for a pull request across all its commits, or null.
export function latestFor(viewsMap, pr) {
  const commits = viewsMap?.[String(pr)];
  if (!commits) return null;
  const all = Object.values(commits).sort(byOrder);
  return all.length > 0 ? all[all.length - 1] : null;
}

// The click the merge gate waits for, by pull request (ruling R117): the latest `gate-asks` record
// for each, with the set line of the card that asks for it, the latest card carrying that line
// (its id, or null), when a visit last handed that card out, and when the click was made: the
// latest verified approval of the pull request at that commit, or verified CI push of that branch
// at that commit. A later record for a pull request takes the place of an earlier one, since the
// gate waits for one click at a time. The front desk makes and asks the cards from this (ruling F72).
function gateAsksOf(sorted, { enrolled, approvals, handedOut }) {
  const cards = sorted.filter((e) => e.kind === 'card');
  const pushes = sorted.filter((e) => e.kind === 'action' && e.data?.action === 'ci-push' && verify(e, enrolled));
  const out = {};
  for (const e of sorted) {
    const d = e.data;
    if (e.kind !== 'gate-asks' || !Number.isInteger(d?.pr) || typeof d.sha !== 'string') continue;
    let line;
    let clicked;
    if (d.ask === 'approval') {
      line = approvalLine(d.pr, d.sha);
      clicked = approvals[String(d.pr)]?.[d.sha];
    } else if (d.ask === 'ci-push' && isPlainKey(d.branch)) {
      line = ciPushLine(d.branch, d.sha);
      clicked = pushes.filter((a) => a.data.branch === d.branch && a.data.sha === d.sha).at(-1);
    } else {
      continue;
    }
    const card = cards.filter((c) => c.data?.line === line).at(-1);
    const asked = card === undefined ? undefined : handedOut.filter((h) => h.data.cards.includes(card.id)).at(-1);
    out[String(d.pr)] = { id: e.id, at: e.at, data: d, line, card: card?.id ?? null, askedAt: asked?.at ?? null, clickedAt: clicked?.at ?? null };
  }
  return out;
}

// Work whose feature has ended: its pull request waits for nothing more.
const FINISHED = ['merged', 'closed'];

// Whether pull request `pr` has finished, by its work's latest report (`reports` is the views'): it
// says merged or closed, and it names that pull request or is no older than `at`, the record that
// asked about it. A report of an earlier life of the work, older and naming another pull request,
// doesn't end a later one's. With no work known, a report naming the pull request.
export function prFinished(reports, { work, pr, at }) {
  const all = reports !== null && typeof reports === 'object' ? reports : {};
  const named = isPlainKey(work) ? [all[work]] : Object.values(all).filter((r) => r?.data?.pr === pr);
  return named.some((r) => FINISHED.includes(r?.data?.outcome) && (r.data.pr === pr || (typeof r.at === 'string' && typeof at === 'string' && r.at >= at)));
}

const APPROVAL_LINE = /^Approve pull request #([1-9][0-9]*) at commit [0-9a-f]{12}$/;
// The line a gate-asks record's card carries, or null.
const gateLineOf = (d) => (d.ask === 'approval' ? approvalLine(d.pr, d.sha) : d.ask === 'ci-push' && isPlainKey(d.branch) ? ciPushLine(d.branch, d.sha) : null);

// Whether an approval or CI push card no longer waits, because the decision it asks for is gone
// (ruling F107): its pull request has finished (prFinished), or the gate has since asked about
// another commit for that pull request and click (the latest gate-asks for them carries another
// line, and came after the card). An approval card names its pull request; a CI push card's comes
// from the gate-asks that carries its line. An approval may carry across a clean update, so a CI
// push asked later leaves an approval card waiting. Any other card is never outdated here.
function outdatedBy(sorted, reports) {
  const asks = sorted.filter((e) => e.kind === 'gate-asks' && Number.isInteger(e.data?.pr) && typeof e.data.sha === 'string')
    .map((e) => ({ e, line: gateLineOf(e.data) })).filter((a) => a.line !== null);
  return (card) => {
    const line = card.data?.line;
    if (typeof line !== 'string') return false;
    const approval = APPROVAL_LINE.exec(line);
    const ask = approval ? 'approval' : asks.some((a) => a.line === line && a.e.data.ask === 'ci-push') ? 'ci-push' : null;
    if (ask === null) return false;
    const pr = approval ? Number(approval[1]) : asks.filter((a) => a.line === line).at(-1).e.data.pr;
    const mine = asks.filter((a) => a.e.data.pr === pr && a.e.data.ask === ask);
    const own = mine.filter((a) => a.line === line).at(-1);
    const latest = mine.at(-1);
    if (latest !== undefined && latest.line !== line && byOrder(card, latest.e) < 0) return true;
    const work = (own ?? asks.filter((a) => a.e.data.pr === pr).at(-1))?.e.data.work;
    return prFinished(reports, { work, pr, at: (own?.e ?? card).at });
  };
}

// The lineage holds the session start recorded (ruling R146), in order, each with the card made for
// it (its id, or null): a card names the hold it was made from by its `event` (ruling F71).
function lineageHoldsOf(sorted) {
  const cards = sorted.filter((e) => e.kind === 'card');
  return sorted.filter((e) => e.kind === 'lineage-hold' && Array.isArray(e.data?.mismatches))
    .map((e) => ({ id: e.id, at: e.at, data: e.data, card: cards.find((c) => c.data?.event === e.id)?.id ?? null }));
}

// The events with an id no other event carries, in order, and a line for each repeated one: an id
// carried by more than one event is damage, so every copy is left out and listed.
function uniqueSorted(events) {
  const counts = new Map();
  for (const e of events) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  const repeated = [...events].filter((e) => counts.get(e.id) > 1).sort(byOrder)
    .map((e) => `an event with a repeated id: ${e.id} (${e.kind}, ${e.at})`);
  return { sorted: events.filter((e) => counts.get(e.id) === 1).sort(byOrder), repeated };
}

// A confirmation counts only for a ruling, level or setting whose id it names and whose content
// hash it names, so it confirms that exact event alone. { confirmed: ids, confirmations: [{ target, event }] }.
function confirmationsOf(sorted, enrolled) {
  const byId = new Map(sorted.map((e) => [e.id, e]));
  const confirmed = new Set();
  const confirmations = [];
  for (const e of sorted) {
    if (e.kind !== 'confirmation' || typeof e.data?.confirms !== 'string' || typeof e.data?.confirmsHash !== 'string') continue;
    const target = byId.get(e.data.confirms);
    if (!target || !CONFIRMABLE_KINDS.includes(target.kind) || !verify(e, enrolled)) continue;
    let hash;
    try {
      hash = eventHash(target);
    } catch {
      continue;
    }
    if (hash === e.data.confirmsHash) {
      confirmed.add(target.id);
      confirmations.push({ target, event: e });
    }
  }
  return { confirmed, confirmations };
}

// The kind and id a confirm line in `text` names, or null; and the first confirmation of exactly
// that event after `record`, or undefined. A waiting card and a shown card are spent by the same rule.
const confirmNamed = (text) => /Confirm ([a-z-]+) (\S+): "/.exec(text);
const confirmedAfter = (confirmations, record, named) => (named === null ? undefined : confirmations.find((c) => byOrder(record, c.event) < 0
  && c.target.id === named[2] && c.target.kind === named[1]));

// The verified approvals and actions that carry the question they were clicked on.
const answeredByOf = (sorted, enrolled) => sorted.filter((e) => (e.kind === 'approval' || e.kind === 'action') && typeof e.data?.question === 'string' && verify(e, enrolled));

// The time each ruling, level or setting came into force by a verified confirmation of its own
// hash: id -> the time of the first such confirmation.
export function confirmationTimes(events, enrolled) {
  const { confirmations } = confirmationsOf(uniqueSorted(events).sorted, enrolled);
  const out = new Map();
  for (const { target, event } of confirmations) if (!out.has(target.id)) out.set(target.id, event.at);
  return out;
}

// How each card was decided (ruling F33), one entry per card in order: { card, answers, decided, explained }.
// An answer names its card by id (data.card) or, as the prompt record writes it, quotes the
// question shown (data.question): that matches a card's question, or its title when it has none.
// Two cards asking the same question both close on one answer. A card is decided by an answer
// whose label is one of its options other than Not now, Explain more and Show me (Keep as is
// decides, signing nothing), or by a verified signed record after it that carries its question or
// confirms the event its confirm line names, which is what a reply code earns. `decided` is the
// first of these, { at, label }: a signed record's label is the one it carries (an answer's), or
// null when it carries none (an approval, a confirmation). It is null while the card waits. A card
// written before cards carried options has none to check, so any label but those three decides it.
// `answers` are all its answers, in order; `explained` the times of its Explain more answers.
function outcomesOf(sorted, { confirmations, answeredBy }) {
  const answers = sorted.filter((e) => e.kind === 'card-answer');
  const questionOf = (card) => (typeof card.data?.question === 'string' ? card.data.question : card.data?.title);
  const answersTo = (card) => answers.filter((a) => (typeof a.data?.card === 'string' ? a.data.card === card.id
    : (a.data?.card === undefined || a.data?.card === null) && typeof a.data?.question === 'string' && a.data.question === questionOf(card)));
  const decides = (card, label) => !PUT_OFF.includes(label) && (!Array.isArray(card.data?.options) || card.data.options.includes(label));
  const signedFor = (card) => {
    const question = questionOf(card);
    const carried = answeredBy.find((e) => byOrder(card, e) < 0 && e.data.question === question);
    const confirmed = confirmedAfter(confirmations, card, confirmNamed(typeof card.data?.line === 'string' ? card.data.line : question))?.event;
    return [carried, confirmed].filter(Boolean).sort(byOrder)[0];
  };
  return sorted.filter((e) => e.kind === 'card').map((card) => {
    const mine = answersTo(card);
    const answered = mine.find((a) => decides(card, a.data?.label));
    const signed = signedFor(card);
    const first = [answered, signed].filter(Boolean).sort(byOrder)[0];
    const label = typeof first?.data?.label === 'string' ? first.data.label : null;
    const decided = first === undefined ? null : { at: first.at, label };
    return { card, answers: mine, decided, explained: mine.filter((a) => a.data?.label === 'Explain more').map((a) => a.at) };
  });
}

// cardOutcomes(events, enrolled) -> how each card among the events was decided, as outcomesOf
// says, judged as the waiting view judges it.
export function cardOutcomes(events, enrolled) {
  const { sorted } = uniqueSorted(events);
  return outcomesOf(sorted, { confirmations: confirmationsOf(sorted, enrolled).confirmations, answeredBy: answeredByOf(sorted, enrolled) });
}

// A `known:<concept>` setting of false counts without a confirmation: it only makes explanations
// longer, so forgetting a concept fails safe (design section 5.3).
export const countsAtOnce = (e) => e.kind === 'setting' && typeof e.data?.key === 'string' && e.data.key.startsWith('known:') && e.data.value === false;

// The build loop's views: work and its approvals, features, questions and incidents.
// Every approval, answer, amendment and lift here is read from a verified action,
// so a plain event of any kind stands in for none of them.
function buildLoopViews(sorted, enrolled) {
  const actions = (name) => sorted.filter((e) => e.kind === 'action' && e.data?.action === name && verify(e, enrolled));
  const mark = (e) => ({ id: e.id, at: e.at, data: e.data });

  const latestWork = {};
  for (const e of sorted) if (e.kind === 'work' && isPlainKey(e.data?.id)) latestWork[e.data.id] = e;
  const amendments = sorted.filter((e) => e.kind === 'amendment');
  const approvals = actions('approve-work');
  // An amend counts when it names a change that was proposed for that work.
  const amends = actions('amend').filter((a) => amendments.some((m) => m.data?.work === a.data?.work && m.data?.hash === a.data?.hash));
  const work = {};
  for (const [id, w] of Object.entries(latestWork)) {
    // Only an approval for the work's current lane counts: a work event that moves the work to another lane asks again.
    const ofWork = approvals.filter((a) => a.data.work === id && a.data.lane === w.data.lane);
    const detail = (a, hash) => ({ hash, shownFirst: a.data.shownFirst, lane: a.data.lane });
    // In time order the document the work names (each work event, each approved change) is the one an
    // approval must name. The director's click on a change approves the changed work as it approved
    // the work before it; a work event that names another document starts again, and one that names
    // the document an approved change already moved to leaves the approval standing.
    let current = null;
    let carried = null;
    const timeline = [...sorted.filter((e) => e.kind === 'work' && e.data?.id === id), ...ofWork, ...amends.filter((a) => a.data.work === id)].sort(byOrder);
    for (const e of timeline) {
      if (e.kind === 'work') {
        current = e.data.doc?.hash ?? null;
        if (carried && carried.hash !== current) carried = null;
      } else if (e.data.action === 'amend') {
        current = e.data.hash;
        if (carried) carried = { ...carried, hash: current };
      } else if (current !== null && e.data.hash === current) {
        carried = detail(e, current);
      }
    }
    let approval = null;
    if (typeof current === 'string' && current !== '') {
      // An approval of the document the work now names counts wherever it falls in time.
      const direct = ofWork.filter((a) => a.data.hash === current).at(-1);
      approval = direct ? detail(direct, current) : carried;
    }
    // `since` is when the work was first recorded: re-recording it (a changed document) keeps its place in the queue.
    const since = sorted.find((e) => e.kind === 'work' && e.data?.id === id).at;
    // The director's wish to see the work before it merges stands once any of their approvals said so,
    // in whatever lane and for whatever document (ruling R120), so a lapsed approval never drops it.
    const shownFirst = approvals.some((a) => a.data.work === id && a.data.shownFirst === true);
    work[id] = {
      work: { key: id, ...mark(w) }, since, approved: approval !== null, ...(approval ? { approval } : {}), ...(shownFirst ? { shownFirst } : {}),
    };
  }

  const featureEvents = sorted.filter((e) => e.kind === 'feature');
  const features = latestPerKey(featureEvents, (e) => e.data?.work);
  // When each feature's current life began: its first event after its latest close. Work
  // closed and queued again starts a new life, and what held for the one before ends with it.
  const lives = {};
  for (const e of featureEvents) {
    const id = e.data?.work;
    if (!isPlainKey(id)) continue;
    if (lives[id] === undefined || lives[id].closed) lives[id] = { began: e.at, closed: false };
    if (e.data.step === 'closed') lives[id].closed = true;
  }
  for (const [id, f] of Object.entries(features)) f.began = lives[id].began;
  // The latest report for each work: how its feature ended (merged, closed or blocked).
  const reports = latestPerKey(sorted.filter((e) => e.kind === 'report'), (e) => e.data?.work);

  // An answer counts for the question as it was shown: it names the hash of the question's data, and
  // one question recorded again with other words or options needs a fresh answer. It keeps the
  // computer the click was made on, where a build-command grant holds: the computer that signed
  // it, or null when that isn't the computer the answer names.
  const questions = {};
  for (const e of sorted) {
    if (e.kind === 'question' && isPlainKey(e.data?.id)) questions[e.data.id] = { question: { key: e.data.id, ...mark(e) }, answer: null };
  }
  for (const a of actions('answer')) {
    const q = questions[a.data.questionId];
    if (!q || typeof a.data.label !== 'string' || a.data.questionHash !== dataHash(q.question.data)) continue;
    if (Array.isArray(q.question.data.options) && q.question.data.options.some((o) => o?.label === a.data.label)) {
      q.answer = { label: a.data.label, at: a.at, computer: signedOn(a) };
    }
  }

  // An incident is open from its declaration until a verified lift after it.
  const fixes = actions('incident-fix');
  const lifts = actions('lift-incident');
  const open = new Map();
  for (const e of [...sorted.filter((x) => x.kind === 'incident'), ...fixes, ...lifts].sort(byOrder)) {
    if (e.kind === 'incident') {
      if (isPlainKey(e.data?.id) && !open.has(e.data.id)) open.set(e.data.id, { id: e.data.id, what: e.data.what, at: e.at, fixes: [] });
    } else if (e.data.action === 'lift-incident') {
      open.delete(e.data.incident);
    } else {
      const found = open.get(e.data.incident);
      if (found && Number.isInteger(e.data.pr) && !found.fixes.includes(e.data.pr)) found.fixes.push(e.data.pr);
    }
  }
  return { work, features, reports, questions, incidents: { open: [...open.values()] } };
}

// `profile` is the profile's events, when these are a project's: a confirm card in the project for a
// profile setting closes on the profile's verified confirmation, whichever project's card was
// clicked (ruling F47). The project's levels, settings and unconfirmed stay its own.
export function buildViews(events, enrolled, { damaged = [], now = () => new Date(), profile = [] } = {}) {
  const { sorted, repeated } = uniqueSorted(events);
  const { confirmed, confirmations } = confirmationsOf(sorted, enrolled);
  const fromProfile = confirmationsOf(uniqueSorted(profile).sorted, enrolled).confirmations;
  const closing = [...confirmations, ...fromProfile].sort((a, b) => byOrder(a.event, b.event));
  const answeredBy = answeredByOf(sorted, enrolled);

  // Rulebook
  const rulings = sorted.filter((e) => e.kind === 'ruling');
  const superseded = new Set();
  for (const r of rulings) {
    const target = rulings.find((x) => x.id === r.data?.supersedes);
    if (confirmed.has(r.id) && target && target.id !== r.id && byOrder(target, r) < 0) superseded.add(target.id);
  }
  const rulebook = rulings.map((r) => ({
    id: r.id,
    at: r.at,
    words: r.data?.words,
    reason: r.data?.reason,
    scope: r.data?.scope,
    status: superseded.has(r.id) ? 'superseded' : confirmed.has(r.id) ? 'accepted' : 'proposed',
  }));

  // Levels and settings: accepted value per key, plus proposals newer than it. A `known:*` setting
  // of false counts as accepted without a confirmation.
  const unconfirmed = rulebook.filter((r) => r.status === 'proposed')
    .map((r) => ({ kind: 'ruling', id: r.id, at: r.at, data: rulings.find((x) => x.id === r.id).data }));
  // The latest confirmation of each event, in time order.
  const lastConfirmation = new Map(confirmations.map((c) => [c.target.id, c.event]));
  const accepted = (kind) => {
    const out = {};
    const all = sorted.filter((e) => e.kind === kind && isPlainKey(e.data?.key));
    const accepts = (e) => confirmed.has(e.id) || countsAtOnce(e);
    for (const e of all) {
      if (!accepts(e)) continue;
      const entry = { key: e.data.key, id: e.id, at: e.at, value: e.data.value };
      if (kind === 'setting') {
        // A setting may end on its own (until) and remembers the accepted value it replaced.
        const prior = out[e.data.key];
        if (typeof e.data.until === 'string') entry.until = e.data.until;
        entry.before = prior ? { value: prior.value, ...(prior.until === undefined ? {} : { until: prior.until }) } : null;
        // The computer its event was written on, the computer that signed its latest confirmation
        // (null when that isn't the computer the confirmation names), and the card line that
        // confirmation carries, if any: build commands on Windows count a level only where the
        // click was made, and Unattended only from its own line. A setting counted without a
        // confirmation (countsAtOnce) has neither.
        const last = lastConfirmation.get(e.id);
        const line = last?.data?.line;
        entry.computer = e.computer;
        entry.confirmedOn = signedOn(last);
        entry.line = typeof line === 'string' ? line : null;
      }
      out[e.data.key] = entry;
    }
    for (const e of all) {
      if (accepts(e)) continue;
      const kept = out[e.data.key];
      if (!kept || byOrder(kept, e) < 0) unconfirmed.push({ kind, id: e.id, at: e.at, key: e.data.key, data: e.data });
    }
    return out;
  };
  const levels = accepted('level');
  const settings = accepted('setting');
  unconfirmed.sort(byOrder);

  const glossary = latestPerKey(sorted.filter((e) => e.kind === 'glossary'), (e) => e.data?.term);
  const keyOrId = (e) => e.data?.key ?? e.id;
  const ideas = latestPerKey(sorted.filter((e) => e.kind === 'idea'), keyOrId);
  const rejections = latestPerKey(sorted.filter((e) => e.kind === 'rejection'), keyOrId);

  // A card waits until it is decided (outcomesOf), or, for an approval or CI push card, until the
  // decision it asks for is gone (outdatedBy). The latest of its answers is what `asked` marks,
  // unless an `asked` record naming the card came after it: a visit handed the card out, and it may
  // have been dismissed with no answer at all, so `asked` is then that record's time with no label.
  const loop = buildLoopViews(sorted, enrolled);
  const outdated = outdatedBy(sorted, loop.reports);
  const handedOut = sorted.filter((e) => e.kind === 'asked' && Array.isArray(e.data?.cards));
  const outcomes = outcomesOf(sorted, { confirmations: closing, answeredBy });
  const waiting = [];
  for (const { card, answers: mine, decided } of outcomes) {
    if (decided !== null || outdated(card)) continue;
    const last = mine.at(-1);
    const shown = handedOut.filter((e) => e.data.cards.includes(card.id)).at(-1);
    const asked = shown && (!last || byOrder(last, shown) < 0) ? { at: shown.at, label: null }
      : last ? { at: last.at, label: last.data?.label ?? null } : null;
    waiting.push({ id: card.id, at: card.at, data: card.data, asked });
  }

  // The proposals whose confirm card here was decided by Keep as is, by the id its confirm line
  // names, a profile setting's among them (ruling F49). They stay unconfirmed, but the lists of
  // what waits for the director's confirmation (the board's first part, the session start) leave them out.
  const keptAsIs = uniqueIds(outcomes.filter(({ decided }) => decided?.label === KEEP_AS_IS)
    .map(({ card }) => confirmNamed(typeof card.data?.line === 'string' ? card.data.line : card.data?.question ?? '')?.[2]));

  const approvals = recordsByPr(sorted, 'approval', enrolled);
  const reviews = recordsByPr(sorted, 'review', enrolled);
  const gateAsks = gateAsksOf(sorted, { enrolled, approvals, handedOut });
  const lineageHolds = lineageHoldsOf(sorted);

  // Launch blockers, shortcuts taken and decisions told.
  const blockers = latestPerKey(sorted.filter((e) => e.kind === 'blocker'), (e) => e.data?.key);
  const risks = latestPerKey(sorted.filter((e) => e.kind === 'risk'), (e) => e.data?.key);
  const decisions = sorted.filter((e) => e.kind === 'decision').reverse().slice(0, 50)
    .map((e) => ({ id: e.id, at: e.at, data: e.data }));

  // Cards shown to the director, from verified records only. A code held by two different
  // questions is ambiguous, so neither is kept. A card is spent once a later verified record
  // carries its question or confirms the one event its confirm line names.
  const shownRecords = sorted.filter((e) => e.kind === 'shown' && verify(e, enrolled)
    && typeof e.data?.code === 'string' && typeof e.data?.question === 'string' && Array.isArray(e.data?.options));
  const spentBy = (shownEvent) => {
    if (answeredBy.some((e) => byOrder(shownEvent, e) < 0 && e.data.question === shownEvent.data.question)) return true;
    return confirmedAfter(confirmations, shownEvent, confirmNamed(shownEvent.data.question)) !== undefined;
  };
  // Only live records take part: not spent, and younger than REPLY_CODE_DAYS. The latest live
  // record holds its code, and two live records with different questions clash. A code with no
  // live record shows its latest record, so a reply can be told why the code can't be used.
  const nowMs = now().getTime();
  const isLive = (e) => !spentBy(e) && !(nowMs - Date.parse(e.at) >= REPLY_CODE_DAYS * 24 * 60 * 60 * 1000);
  const questionsByCode = new Map();
  for (const e of shownRecords.filter(isLive)) {
    const questions = questionsByCode.get(e.data.code) ?? new Set();
    questions.add(e.data.question);
    questionsByCode.set(e.data.code, questions);
  }
  const clashing = [...questionsByCode].filter(([, questions]) => questions.size > 1).map(([code]) => code);
  const shown = {};
  const hold = (e) => { shown[e.data.code] = { id: e.id, at: e.at, question: e.data.question, options: e.data.options, spent: spentBy(e) }; };
  shownRecords.forEach(hold);
  shownRecords.filter(isLive).forEach(hold);
  for (const code of clashing) delete shown[code];
  const clashes = clashing.map((code) => `a shown code held by two different questions: ${code}`);

  const merges = sorted.filter((e) => e.kind === 'merge');
  const lastMerge = merges.length > 0 ? { at: merges.at(-1).at, data: merges.at(-1).data } : null;

  return {
    rulebook,
    levels,
    settings,
    glossary,
    ideas,
    rejections,
    waiting,
    approvals,
    reviews,
    ...loop,
    unconfirmed,
    blockers,
    risks,
    decisions,
    shown,
    keptAsIs,
    gateAsks,
    lineageHolds,
    damaged: [...damaged, ...repeated, ...clashes],
    // The clash lines again, on their own: a clash only means a code can't be used for a reply.
    codeClashes: clashes,
    status: {
      builtAt: now().toISOString(),
      waitingCount: waiting.length,
      unconfirmedCount: unconfirmed.length,
      lastMerge,
      lastEventAt: sorted.length > 0 ? sorted.at(-1).at : null,
    },
  };
}

// The profile's events, or none when there is no profile or it can't be read.
function profileEvents() {
  try {
    return listEvents(profileDir(), { report: () => {} });
  } catch {
    return [];
  }
}

// Reads the clone and writes views/*.json beside it, outside the clone. `dir` and `out`
// name another clone of events and its views folder, such as the profile's. A project's views
// count the profile's confirmations when closing its confirm cards (buildViews); the profile's
// own (no project) are built from the profile alone.
export async function writeViews(project, {
  now = () => new Date(), dir = stateDir(project), out = path.join(wheelhouseHome(), 'projects', project, 'views'),
  profile = project === undefined ? [] : profileEvents(),
} = {}) {
  const damaged = [];
  const events = listEvents(dir, { report: () => {}, skipped: damaged });
  const views = buildViews(events, readEnrolled(), { damaged, now, profile });
  // Built whole in a new folder, which then takes the old one's place. The old folder is
  // renamed aside first because Windows will not rename over a folder that has files in it.
  // Between the two renames there is no `views` folder, only `views.old` (a reader that
  // finds `views` missing falls back to it); after them, all of the new views.
  const fresh = `${out}.new`;
  const aside = `${out}.old`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.rmSync(fresh, { recursive: true, force: true });
  fs.rmSync(aside, { recursive: true, force: true });
  fs.mkdirSync(fresh);
  try {
    for (const [name, value] of Object.entries(views)) fs.writeFileSync(path.join(fresh, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
    const hadOld = fs.existsSync(out);
    if (hadOld) fs.renameSync(out, aside);
    try {
      fs.renameSync(fresh, out);
    } catch (error) {
      if (hadOld) fs.renameSync(aside, out);
      throw error;
    }
  } finally {
    fs.rmSync(fresh, { recursive: true, force: true });
  }
  fs.rmSync(aside, { recursive: true, force: true });
  return views;
}
