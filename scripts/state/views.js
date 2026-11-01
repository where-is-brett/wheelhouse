// scripts/state/views.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome, profileDir, stateDir } from '../lib/paths.js';
import { listEvents, eventHash, dataHash, CONFIRMABLE_KINDS, PIN_NAMES, READY_COLUMNS } from './events.js';
import { ruleStands, stageOf } from '../delegation/rules.js';
import { approvalLine, chatCopy, ciPushLine, confirmLine } from './card-lines.js';
import { isLeanProject } from '../lean/project.js';
import { verify, readEnrolled } from './signing.js';
import { REPLY_CODE_DAYS } from '../lib/core-numbers.js';
import { KEEP_AS_IS, PUT_OFF } from '../lib/front-desk.js';
import { SUGGEST, WHY } from '../lib/calm-words.js';
import { premiumState } from '../routing/premium.js';

const byOrder = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const isPlainKey = (k) => typeof k === 'string' && k !== '';
// The computer whose key signed a verified record, when that is the computer the record names;
// otherwise null. A record signed by one computer that names another was made on neither.
const signedOn = (e) => (typeof e?.computer === 'string' && e.sig?.computer === e.computer ? e.computer : null);
const uniqueIds = (ids) => [...new Set(ids.filter(isPlainKey))];
// The sha256 of a card's text as the director saw it: what a click in an agent's chat names (scripts/lean/cli.js).
const textHash = (text) => crypto.createHash('sha256').update(text).digest('hex');
// Whether `hash` names a card's text as the director saw it: whole, or in the chat's words (chatCopy), as the front desk hands it out.
const namesText = (hash, text) => hash === textHash(text) || hash === textHash(chatCopy(text));

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

// Why an approval or CI push card no longer waits, because the decision it asks for is gone
// (ruling F107): 'finished' when its pull request has finished (prFinished), 'head' when the gate
// has since asked about another commit for that pull request and click (the latest gate-asks for
// them carries another line, and came after the card), and false while it still stands. An
// approval card names its pull request; a CI push card's comes from the gate-asks that carries its
// line. An approval may carry across a clean update, so a CI push asked later leaves an approval
// card waiting. Any other card is never outdated here.
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
    const work = (own ?? asks.filter((a) => a.e.data.pr === pr).at(-1))?.e.data.work;
    if (prFinished(reports, { work, pr, at: (own?.e ?? card).at })) return 'finished';
    return latest !== undefined && latest.line !== line && byOrder(card, latest.e) < 0 ? 'head' : false;
  };
}

const CI_PUSH_LINE = /^Push the CI change on (.+) at commit [0-9a-f]{12} with your own sign-in$/;
// What an approval or CI push card's set line is about: its pull request or its branch, or null
// when the card is of another kind or its line says neither.
export function gateTargetOf(card) {
  const line = card.data?.line;
  if (typeof line !== 'string') return null;
  if (card.data.kind === 'approval') {
    const match = APPROVAL_LINE.exec(line);
    return match ? `pull request #${match[1]}` : null;
  }
  const match = card.data.kind === 'ci-push' ? CI_PUSH_LINE.exec(line) : null;
  return match ? `branch ${match[1]}` : null;
}

// Whether a later card revises this one, by `data.revises` naming its id (design section 23.3): the
// revised card replaces it, whatever answer it had. It must be of the same kind and, for an approval
// or CI push card, about the same pull request or branch, so a revision naming a card of another
// kind or pull request closes nothing. The revised card carries its own set line, so what was
// approved of the card before it carries over to nothing. A revised approval or CI push card also
// takes the place of an earlier card of its kind carrying its own set line (ruling C21): the
// gate's card for the head the revision was composed at, so one card waits for that head.
function revisedBy(sorted) {
  const cards = sorted.filter((e) => e.kind === 'card');
  const sameGate = (card, later) => !['approval', 'ci-push'].includes(card.data?.kind) || (gateTargetOf(card) !== null && gateTargetOf(card) === gateTargetOf(later));
  return (card) => cards.some((later) => byOrder(card, later) < 0 && later.data?.kind === card.data?.kind && (
    (later.data.revises === card.id && sameGate(card, later))
    || (typeof later.data.revises === 'string' && ['approval', 'ci-push'].includes(card.data?.kind)
      && typeof card.data?.line === 'string' && later.data.line === card.data.line && sameGate(card, later))));
}

// The ids of the lineage holds a later lineage-lift names: a lift closes only the holds it names, so
// a hold recorded after it was decided stands.
function liftedHoldIds(sorted) {
  const lifted = new Set();
  for (const l of sorted.filter((e) => e.kind === 'lineage-lift' && Array.isArray(e.data?.holds))) {
    for (const id of l.data.holds) lifted.add(id);
  }
  return lifted;
}

// The lineage holds the session start recorded (ruling R146) that no lift has lifted, in order, each
// with the card made for it (its id, or null): a card names the hold it was made from by its `event`
// (ruling F71).
function lineageHoldsOf(sorted, lifted) {
  const cards = sorted.filter((e) => e.kind === 'card');
  return sorted.filter((e) => e.kind === 'lineage-hold' && Array.isArray(e.data?.mismatches) && !lifted.has(e.id))
    .map((e) => ({ id: e.id, at: e.at, computer: typeof e.computer === 'string' ? e.computer : null, data: e.data, card: cards.find((c) => c.data?.event === e.id)?.id ?? null }));
}

// The control-file records (ruling P7-13) that still stand, in order, each with the card made for it
// (its id, or null), and the ids of those closed. A record stands until a later control-file-lift
// of its work, or a later control-file record of its work, which takes its place. A record counts
// only when it is signed by an enrolled computer: the watcher's own (ruling P7-33).
function controlFilesOf(sorted, enrolled) {
  const cards = sorted.filter((e) => e.kind === 'card');
  const records = sorted.filter((e) => e.kind === 'control-file' && typeof e.data?.work === 'string' && Array.isArray(e.data?.paths) && verify(e, enrolled));
  const lifts = sorted.filter((e) => e.kind === 'control-file-lift' && typeof e.data?.work === 'string');
  const closed = new Set();
  const standing = [];
  for (const e of records) {
    const later = (x) => x.data.work === e.data.work && byOrder(e, x) < 0;
    if (lifts.some(later) || records.some(later)) closed.add(e.id);
    else standing.push({ id: e.id, at: e.at, data: e.data, card: cards.find((c) => c.data?.event === e.id)?.id ?? null });
  }
  return { standing, closed };
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

// At Lean (ruling P5-52), the rulings the director confirmed by a click in the chat: id -> the answer. The click is
// a card-answer the helper's /cards/chat-click wrote, with proof chat-click and tier lean, after a confirm card whose
// line names that ruling with its words as they are, naming the card by its id and the card's text by its hash. It
// is not signed, so it counts only in a Lean project's views; the rulebook says the proof it rests on.
// Only the card's first such click counts (ruling P5-53): a Confirm after Not now or Suggest a change… confirms nothing.
const isRulingConfirmCard = (card) => card?.kind === 'card' && card.data?.kind === 'confirm' && typeof card.data?.line === 'string'
  && /^Confirm ruling \S+: "/.test(card.data.line) && typeof card.data?.question === 'string';
// A click in the chat on a ruling's confirm card at Lean: the card by its id, its text by its hash, proof chat-click.
const isLeanRulingClick = (card, a) => isRulingConfirmCard(card) && a?.kind === 'card-answer' && byOrder(card, a) < 0 && a.data?.card === card.id
  && a.data.proof === 'chat-click' && a.data.tier === 'lean' && namesText(a.data.hash, card.data.question);
function leanRulingClicks(sorted, rulings) {
  const out = new Map();
  const cards = sorted.filter(isRulingConfirmCard);
  for (const ruling of rulings) {
    if (typeof ruling.data?.words !== 'string') continue;
    const line = confirmLine(ruling);
    for (const card of cards.filter((c) => c.data.line === line && byOrder(ruling, c) < 0)) {
      const first = sorted.find((a) => isLeanRulingClick(card, a));
      if (first?.data.label === 'Confirm' && !out.has(ruling.id)) out.set(ruling.id, first);
    }
  }
  return out;
}

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

// How each card was decided (ruling F33), one entry per card in order: { card, answers, decided, explained, steered }.
// An answer names its card by id (data.card) or, as the prompt record writes it, quotes the
// question shown (data.question): that matches a card's question, or its title when it has none.
// Two cards asking the same question both close on one answer. A card is decided by an answer
// whose label is one of its options other than Not now, Explain more, Show me, Why? and Suggest a
// change… (Keep as is decides, signing nothing), or by a verified signed record after it that
// carries its question or confirms the event its confirm line names, which is what a reply code
// earns. `decided` is the first of these, { at, label }: a signed record's label is the one it
// carries (an answer's), or null when it carries none (an approval, a confirmation). It is null
// while the card waits. A card written before cards carried options has none to check, so any label
// but those five decides it. `answers` are all its answers, in order; `explained` the times of its
// Explain more and Why? answers; `steered` the time of its latest Suggest a change… answer
// made after the card, or null.
function outcomesOf(sorted, { confirmations, answeredBy, lean = false }) {
  const answers = sorted.filter((e) => e.kind === 'card-answer');
  const questionOf = (card) => (typeof card.data?.question === 'string' ? card.data.question : card.data?.title);
  // An answer that names the card by its id and the card's text by its hash (a click in an agent's chat, ruling
  // P5-52) answers it only when the hash is of the card's text as the state holds it.
  const answersTo = (card) => answers.filter((a) => (typeof a.data?.card === 'string'
    ? a.data.card === card.id && (a.data.hash === undefined || (typeof questionOf(card) === 'string' && namesText(a.data.hash, questionOf(card))))
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
    // At Lean, a ruling's confirm card is decided by its first chat click, Not now included (ruling P5-53).
    const answered = mine.find((a) => decides(card, a.data?.label) || (lean && isLeanRulingClick(card, a)));
    const signed = signedFor(card);
    const first = [answered, signed].filter(Boolean).sort(byOrder)[0];
    const label = typeof first?.data?.label === 'string' ? first.data.label : null;
    const decided = first === undefined ? null : { at: first.at, label };
    const explained = mine.filter((a) => a.data?.label === 'Explain more' || a.data?.label === WHY).map((a) => a.at);
    return { card, answers: mine, decided, explained, steered: mine.filter((a) => a.data?.label === SUGGEST && byOrder(card, a) < 0).at(-1)?.at ?? null };
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

// The most of the card router's Logbook lines the views keep.
const ENGINE_NOTES = 30;

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
    // A work event comes before a click stamped the same millisecond: no click approves work not yet recorded, and
    // their ids, which would otherwise break the tie, are random.
    const workFirst = (a, b) => (a.at === b.at && (a.kind === 'work') !== (b.kind === 'work') ? (a.kind === 'work' ? -1 : 1) : byOrder(a, b));
    const timeline = [...sorted.filter((e) => e.kind === 'work' && e.data?.id === id), ...ofWork, ...amends.filter((a) => a.data.work === id)].sort(workFirst);
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
  // it, or null when that isn't the computer the answer names. An answer that names its proof
  // (`window` for a click in the helper's own window) keeps it, so a grant can be counted only
  // from the proofs an agent's clicks bind by (buildGrants' `proofs`, ruling P8-8).
  const questions = {};
  for (const e of sorted) {
    if (e.kind === 'question' && isPlainKey(e.data?.id)) questions[e.data.id] = { question: { key: e.data.id, ...mark(e) }, answer: null };
  }
  for (const a of actions('answer')) {
    const q = questions[a.data.questionId];
    if (!q || typeof a.data.label !== 'string' || a.data.questionHash !== dataHash(q.question.data)) continue;
    if (Array.isArray(q.question.data.options) && q.question.data.options.some((o) => o?.label === a.data.label)) {
      q.answer = { label: a.data.label, at: a.at, computer: signedOn(a), ...(typeof a.data.proof === 'string' ? { proof: a.data.proof } : {}) };
    }
  }

  // An incident is open from its declaration until a verified lift after it; a red-main incident also ends with the
  // helper's own close.
  const fixes = actions('incident-fix');
  const lifts = actions('lift-incident');
  const open = new Map();
  const closes = sorted.filter((x) => x.kind === 'incident-closed');
  for (const e of [...sorted.filter((x) => x.kind === 'incident'), ...fixes, ...lifts, ...closes].sort(byOrder)) {
    if (e.kind === 'incident') {
      if (isPlainKey(e.data?.id) && !open.has(e.data.id)) {
        const own = Object.fromEntries(['kind', 'suspect', 'work'].filter((k) => e.data[k] !== undefined).map((k) => [k, e.data[k]]));
        open.set(e.data.id, { id: e.data.id, what: e.data.what, at: e.at, fixes: [], ...own });
      }
    } else if (e.kind === 'incident-closed') {
      if (open.get(e.data?.incident)?.kind === 'red-main') open.delete(e.data.incident);
    } else if (e.data.action === 'lift-incident') {
      open.delete(e.data.incident);
    } else {
      const found = open.get(e.data.incident);
      if (found && Number.isInteger(e.data.pr) && !found.fixes.includes(e.data.pr)) found.fixes.push(e.data.pr);
    }
  }
  // The engine's records, each work's in time order, the latest last: runs, asks, costs, previews and lessons.
  const byWork = (kind) => {
    const out = {};
    for (const e of sorted) if (e.kind === kind && isPlainKey(e.data?.work)) (out[e.data.work] ??= []).push(mark(e));
    return out;
  };
  return {
    work, features, reports, questions, incidents: { open: [...open.values()] },
    runs: byWork('run'), asks: byWork('ask'), costs: byWork('cost'), previews: byWork('preview'), lessons: byWork('lesson'),
    // The card router's Logbook lines, the latest last, and how many of its cards wait for another day.
    engineNotes: sorted.filter((e) => e.kind === 'note' && e.data?.about === 'engine' && typeof e.data.words === 'string').slice(-ENGINE_NOTES).map(mark),
    cardsWaiting: { count: Number.isInteger(sorted.filter((e) => e.kind === 'note' && e.data?.about === 'cards-waiting').at(-1)?.data?.count) ? sorted.filter((e) => e.kind === 'note' && e.data?.about === 'cards-waiting').at(-1).data.count : 0 },
  };
}

// `profile` is the profile's events, when these are a project's: a confirm card in the project for a
// profile setting closes on the profile's verified confirmation, whichever project's card was
// clicked (ruling F47). The project's levels, settings and unconfirmed stay its own.
// `lean` is true for a Lean project's views, where a ruling confirmed by a chat click counts (leanRulingClicks).
// How many cards are sealed, read and sampled, and no more: until the director has set the bars, what a seal says stays
// in the private record, read by nothing but scripts/delegation/.
function evidenceOf(sorted, enrolled) {
  const lines = sorted.filter((e) => e.kind === 'shadow' && typeof e.data?.card === 'string' && verify(e, enrolled));
  const cards = (line) => new Set(lines.filter((e) => e.data.line === line && e.data.reader !== 'none').map((e) => e.data.card)).size;
  return { sealed: cards('seal'), read: cards('reading'), sampled: 0 };
}

// The rules in force: id -> { rule, stage, signedAt }. Only a signed confirmation of the record itself counts, never a
// click in the chat, and of a rule signed more than once the newest record stands. Nothing reads these to decide yet.
function rulesInForce(confirmations, now) {
  const latest = new Map();
  for (const { target, event } of confirmations) {
    if (target.kind !== 'rule' || !ruleStands(target.data)) continue;
    const kept = latest.get(target.data.id);
    if (!kept || byOrder(kept.target, target) < 0) latest.set(target.data.id, { target, event });
  }
  return Object.fromEntries([...latest.values()].map(({ target, event }) => [target.data.id, { rule: target.data, stage: stageOf(target.data, { now }), signedAt: event.at }]));
}

export function buildViews(events, enrolled, { damaged = [], now = () => new Date(), profile = [], lean = false } = {}) {
  const { sorted, repeated } = uniqueSorted(events);
  const { confirmed, confirmations } = confirmationsOf(sorted, enrolled);
  const fromProfile = confirmationsOf(uniqueSorted(profile).sorted, enrolled).confirmations;
  const closing = [...confirmations, ...fromProfile].sort((a, b) => byOrder(a.event, b.event));
  const answeredBy = answeredByOf(sorted, enrolled);

  // Rulebook
  const rulings = sorted.filter((e) => e.kind === 'ruling');
  const chatClicked = lean ? leanRulingClicks(sorted, rulings) : new Map();
  const inForce = (id) => confirmed.has(id) || chatClicked.has(id);
  const superseded = new Set();
  for (const r of rulings) {
    const target = rulings.find((x) => x.id === r.data?.supersedes);
    if (inForce(r.id) && target && target.id !== r.id && byOrder(target, r) < 0) superseded.add(target.id);
    // At Lean a ruling's short name is what the director's newer words replace (ruling P5-53): once the newer
    // ruling under the same short name is in force, the earlier ones are superseded.
    if (lean && inForce(r.id) && isPlainKey(r.data?.card)) {
      for (const x of rulings) if (x.id !== r.id && x.data?.card === r.data.card && byOrder(x, r) < 0) superseded.add(x.id);
    }
  }
  const rulebook = rulings.map((r) => ({
    id: r.id,
    at: r.at,
    words: r.data?.words,
    reason: r.data?.reason,
    scope: r.data?.scope,
    status: superseded.has(r.id) ? 'superseded' : inForce(r.id) ? 'accepted' : 'proposed',
    // A ruling in force only by a click in the chat says so: the record is the chat's account, not a signed one.
    ...(!confirmed.has(r.id) && chatClicked.has(r.id) ? { proof: 'chat-click' } : {}),
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
    // The premium model is allowed only by a click on its own card (design section 14.6), whose setting names that card:
    // a premium setting that allows it and names none counts for nothing, however it was confirmed.
    const ownCard = (e) => kind !== 'setting' || e.data.key !== 'premium' || e.data.value === 'off' || typeof e.data.premiumCard === 'string';
    const accepts = (e) => (confirmed.has(e.id) || countsAtOnce(e)) && ownCard(e);
    for (const e of all) {
      if (!accepts(e)) continue;
      const entry = { key: e.data.key, id: e.id, at: e.at, value: e.data.value };
      // A setting a usage card's pick made says which offer (its time), so a return card is for that switch alone.
      if (kind === 'setting' && typeof e.data.usageCard === 'string') entry.usageCard = e.data.usageCard;
      // And one the premium model's card made says which offer, so its check is for that Yes alone.
      if (kind === 'setting' && typeof e.data.premiumCard === 'string') entry.premiumCard = e.data.premiumCard;
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
        // When that confirmation was made, or null for a setting counted without one.
        entry.confirmedAt = typeof last?.at === 'string' ? last.at : null;
      }
      out[e.data.key] = entry;
    }
    for (const e of all) {
      if (accepts(e) || !ownCard(e)) continue;
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
  // decision it asks for is gone (outdatedBy), or until a card that revises it is in the state
  // (revisedBy). `steered` is when the director last answered it Suggest a change… (null for none):
  // it waits meanwhile. The latest of its answers is what `asked` marks,
  // unless an `asked` record naming the card came after it: a visit handed the card out, and it may
  // have been dismissed with no answer at all, so `asked` is then that record's time with no label.
  const loop = buildLoopViews(sorted, enrolled);
  const outdated = outdatedBy(sorted, loop.reports);
  const revised = revisedBy(sorted);
  const handedOut = sorted.filter((e) => e.kind === 'asked' && Array.isArray(e.data?.cards));
  const outcomes = outcomesOf(sorted, { confirmations: closing, answeredBy, lean });
  const waiting = [];
  // A card made from a lineage hold that has been lifted is closed, as an answered card is, and so
  // is one made from a control-file record that no longer stands.
  const liftedHolds = liftedHoldIds(sorted);
  const controlFiles = controlFilesOf(sorted, enrolled);
  // The approval and CI push cards closed only by a later head of their pull request or branch:
  // undecided and not revised, so a revised card may still name one (ruling C21), with `steered` as a
  // waiting card has it.
  const outdatedCards = [];
  for (const { card, answers: mine, decided, steered } of outcomes) {
    if (decided !== null || revised(card) || liftedHolds.has(card.data?.event) || controlFiles.closed.has(card.data?.event)) continue;
    const gone = outdated(card);
    if (gone === 'head') outdatedCards.push({ id: card.id, at: card.at, data: card.data, steered });
    if (gone !== false) continue;
    const last = mine.at(-1);
    const shown = handedOut.filter((e) => e.data.cards.includes(card.id)).at(-1);
    const asked = shown && (!last || byOrder(last, shown) < 0) ? { at: shown.at, label: null }
      : last ? { at: last.at, label: last.data?.label ?? null } : null;
    waiting.push({ id: card.id, at: card.at, data: card.data, asked, steered });
  }

  // The proposals whose confirm card here was decided by Keep as is, by the id its confirm line
  // names, a profile setting's among them (ruling F49). They stay unconfirmed, but the lists of
  // what waits for the director's confirmation (the board's first part, the session start) leave them out.
  const keptAsIs = uniqueIds(outcomes.filter(({ decided }) => decided?.label === KEEP_AS_IS)
    .map(({ card }) => confirmNamed(typeof card.data?.line === 'string' ? card.data.line : card.data?.question ?? '')?.[2]));

  const approvals = recordsByPr(sorted, 'approval', enrolled);
  const reviews = recordsByPr(sorted, 'review', enrolled);
  // What built each branch's pull requests, the latest verified provenance record of each (the helper's, at /pr/open).
  const provenance = {};
  for (const e of sorted) {
    if (e.kind === 'provenance' && typeof e.data?.branch === 'string' && isPlainObject(e.data.provenance) && verify(e, enrolled)) provenance[e.data.branch] = e.data.provenance;
  }
  const gateAsks = gateAsksOf(sorted, { enrolled, approvals, handedOut });
  const lineageHolds = lineageHoldsOf(sorted, liftedHolds);

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

  // The latest survey of what the project already held (design section 15, ruling A1), or null.
  const lastSurvey = sorted.filter((e) => e.kind === 'survey' && e.data !== null && typeof e.data === 'object' && !Array.isArray(e.data)).at(-1);
  const survey = lastSurvey ? { id: lastSurvey.id, at: lastSurvey.at, data: lastSurvey.data } : null;

  // The latest column-ready record of each column (design section 14.6): { <column>: { id, at, pins, records, commit? } }.
  // Which of them count is readyColumns', against the configuration's pins now.
  const columnsReady = {};
  for (const e of sorted) {
    if (e.kind !== 'column-ready' || !READY_COLUMNS.includes(e.data?.column) || !isPlainObject(e.data?.pins)) continue;
    columnsReady[e.data.column] = {
      id: e.id, at: e.at, pins: e.data.pins, records: Array.isArray(e.data.records) ? e.data.records : [], ...(typeof e.data.commit === 'string' ? { commit: e.data.commit } : {}),
    };
  }

  // The usage cards the front desk's session start has offered, oldest first (design section 14.6): { id, card, at, reset,
  // from, to, hash }. Only an offer an enrolled computer signed counts.
  const usageCards = sorted.filter((e) => e.kind === 'usage-card' && isPlainObject(e.data) && verify(e, enrolled))
    .map((e) => ({ id: e.id, ...e.data }));

  // The premium model's opt-in (design section 14.6): the setting in force, the helper's check for it, and whether the
  // account is known not to have it (scripts/routing/premium.js).
  const premium = premiumState({ setting: settings.premium, events: sorted, signed: (e) => verify(e, enrolled), now });
  // The premium model's failed evaluations (design section 14.6), each with the card made for it (its id, or null): the
  // card names the record it was made from by its `event`. Only a record an enrolled computer signed (the helper's).
  const premiumFailures = sorted.filter((e) => e.kind === 'premium-failed' && isPlainObject(e.data) && verify(e, enrolled))
    .map((e) => ({ id: e.id, at: e.at, data: e.data, card: sorted.find((c) => c.kind === 'card' && c.data?.event === e.id)?.id ?? null }));

  const merges = sorted.filter((e) => e.kind === 'merge');
  const lastMerge = merges.length > 0 ? { at: merges.at(-1).at, data: merges.at(-1).data } : null;

  return {
    evidence: evidenceOf(sorted, enrolled),
    rules: rulesInForce(confirmations, now),
    rulebook,
    levels,
    settings,
    glossary,
    ideas,
    rejections,
    waiting,
    outdated: outdatedCards,
    approvals,
    reviews,
    provenance,
    ...loop,
    unconfirmed,
    blockers,
    risks,
    decisions,
    shown,
    keptAsIs,
    gateAsks,
    lineageHolds,
    controlFiles: controlFiles.standing,
    survey,
    columnsReady,
    usageCards,
    premium,
    premiumFailures,
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

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The pins each column's evaluation depends on: a column is ready only while these are the ones it ran on.
const COLUMN_PINS = Object.freeze({ lightest: ['mostCapable', 'midSized'], lean: ['mostCapable', 'midSized'], premium: ['mostCapable', 'premium'] });

// The columns ready now: each whose latest column-ready record (the `columnsReady` view) ran on the pins
// `config.tiers.pins` holds now, for the pins that column uses. A configuration with no pins has none ready, and so
// has a premium record without a premium pin. Anything that can't be read counts as not ready.
export function readyColumns(view, config) {
  const now = config?.tiers?.pins;
  if (!isPlainObject(view) || !isPlainObject(now)) return [];
  const pinOf = (pins, name) => (PIN_NAMES.includes(name) && typeof pins?.[name] === 'string' ? pins[name] : null);
  return READY_COLUMNS.filter((column) => {
    const kept = view[column];
    if (!isPlainObject(kept) || !isPlainObject(kept.pins)) return false;
    if (column === 'premium' && pinOf(now, 'premium') === null) return false;
    return COLUMN_PINS[column].every((name) => pinOf(kept.pins, name) === pinOf(now, name));
  });
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
  const views = buildViews(events, readEnrolled(), { damaged, now, profile, lean: project !== undefined && isLeanProject(project) });
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
