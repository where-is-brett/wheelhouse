// scripts/frontdesk/learning.js
// What Wheelhouse learns from the director's clicks (design section 5.3): the concepts they know
// and the settings they would like. Each is a proposal the director confirms with one click on a
// one-line card; nothing learnt changes anything until then, except that a concept they turn out
// not to know makes explanations longer at once (a `known:*` setting of false needs no confirmation).
// The board-context hook runs it once a visit, outside the sandbox, since the front desk can't read
// the state or the profile; the hook writes what it proposes.
//
// The delegation review (design section 6) is learnt from the same clicks: every
// `delegationReviewDays` it proposes which decision topics could move between levels 3 and 2. The
// helper works it out for `cli.js review` (delegationReview), which writes each proposal as a
// `level` event with its confirm card; only the director's Confirm moves a level.
//
// The shapes the proposals take:
//   events    the project's events, as its state holds them
//   profile   { events, settings, unconfirmed }: the profile's events, the settings in force
//             (effectiveSettings, project over profile over defaults) and the profile views' `unconfirmed`
//   options   { now, enrolled, outcomes, dayOf, boardAsks }: the clock; the enrolled keys a signed
//             record is checked against (readEnrolled() when not given); the cards' outcomes from
//             clickOutcomes, worked out once by a caller that asks for both kinds of proposal
//             (worked out here when not given); the calendar day of a time (this computer's local
//             day when not given); and for settingProposals, seen.json's `boardAsks`, the last
//             board commands as { at, tab, visit }
// A card's click is judged as the waiting view judges it (cardOutcomes): a reply code's signed
// record counts as the click it stands for. A proposal already waiting for its confirmation, or put
// off with Not now or kept as is (Keep as is, ruling F48) on its card in the last TURNED_DOWN_DAYS,
// is not made again. One kept as is no longer waits, though it stays unconfirmed.
import { buildViews, cardOutcomes, confirmationTimes, countsAtOnce } from '../state/views.js';
import { readEnrolled } from '../state/signing.js';
import { ID } from '../state/card-lines.js';
import { DECIDING, KEEP_AS_IS } from '../cards/compose.js';
import { effectiveSettings } from '../settings/effective.js';
import { SETTINGS } from '../settings/catalogue.js';
import { conceptOf } from './glossary.js';
import { CARD_KINDS, DELEGATE_AFTER, KNOWN_AFTER } from '../lib/front-desk.js';

// How long a Not now or a Keep as is on a proposal's card holds the proposal back.
export const TURNED_DOWN_DAYS = 30;
// Explain more or Why? on this many different cards within this many days proposes plain explanations.
export const EXPLAINED_CARDS = 3;
export const EXPLAINED_DAYS = 7;
// The build tab asked for on this many visits running proposes it as the board's first tab.
export const BOARD_VISITS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const CONCEPT = /^[a-z0-9-]{1,40}$/;
const TABS = ['director', 'build'];

const list = (x) => (Array.isArray(x) ? x : []);
const isRecord = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const ms = (iso) => Date.parse(iso);
const byOrder = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Whether the time `at` comes after `since`; nothing comes before a time that isn't there.
const after = (at, since) => since === undefined || since === null || ms(at) > ms(since);
const two = (n) => String(n).padStart(2, '0');
const instant = (now) => new Date(typeof now === 'function' ? now() : now ?? Date.now()).getTime();

// The calendar day of a time in this computer's time zone, as YYYY-MM-DD.
export function dayOf(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

// How each card among the project's events was decided (cardOutcomes), with the profile's
// confirmations counted too: a click confirming a profile setting is signed into the profile.
export function clickOutcomes(events, profile, { enrolled = readEnrolled() } = {}) {
  return cardOutcomes([...list(events), ...list(profile?.events)], enrolled);
}

// The latest setting event for `key` in the profile, or undefined.
function latestSetting(profile, key) {
  return list(profile?.events).filter((e) => e?.kind === 'setting' && e.data?.key === key).sort(byOrder).at(-1);
}

// When the latest setting for `key` in the profile came into force: a `known:*` false at its own
// time, any other at its first verified confirmation. Undefined when none has.
function inForceSince(profile, key, enrolled) {
  const events = list(profile?.events).filter(isRecord);
  const confirmed = confirmationTimes(events, enrolled);
  return events.filter((e) => e.kind === 'setting' && e.data?.key === key)
    .map((e) => (countsAtOnce(e) ? e.at : confirmed.get(e.id))).filter((at) => typeof at === 'string').sort().at(-1);
}

// Whether a proposal of `kind` (setting or level) setting `key` to `value` is held back: waiting
// for its confirmation, or turned down within TURNED_DOWN_DAYS of now, by Not now or Keep as is on
// a card whose confirm line names an event of that kind, key and value. One whose card was decided
// by Keep as is no longer waits, though `unconfirmed` still lists it. `events` are where the
// proposals and their cards are; `unconfirmed` the views' proposals waiting.
function heldBack({ events, unconfirmed, outcomes, nowMs }, kind, key, value) {
  const proposals = new Map(list(events).filter((e) => e?.kind === kind).map((e) => [e.id, e]));
  const kept = new Set();
  let turnedDown = false;
  for (const { card, answers, decided } of outcomes) {
    const named = /^Confirm ([a-z-]+) (\S+): "/.exec(typeof card.data?.line === 'string' ? card.data.line : '');
    const target = named && named[1] === kind ? proposals.get(named[2]) : undefined;
    if (!target || target.data?.key !== key || !same(target.data?.value, value)) continue;
    if (decided?.label === KEEP_AS_IS) kept.add(target.id);
    if (answers.some((a) => (a.data?.label === 'Not now' || a.data?.label === KEEP_AS_IS) && nowMs - ms(a.at) < TURNED_DOWN_DAYS * DAY_MS)) turnedDown = true;
  }
  return turnedDown || list(unconfirmed).some((u) => u?.kind === kind && !kept.has(u.id) && u.data?.key === key && same(u.data?.value, value));
}

// What heldBack needs for the director's profile settings: the project's and the profile's
// events, and the profile views' proposals waiting.
const profileContext = ({ events, profile, outcomes, nowMs }) => ({
  events: [...list(events), ...list(profile?.events)], unconfirmed: profile?.unconfirmed, outcomes, nowMs,
});

// The concepts a card holds, as `known:<concept>` names them.
function conceptsOf(card) {
  return [...new Set(list(card.data?.concepts).filter((t) => typeof t === 'string').map(conceptOf).filter((c) => CONCEPT.test(c)))];
}

// conceptProposals(events, profile, { now, enrolled, outcomes, dayOf }) -> [{ concept, known, confirm }], by concept.
// Why? counts wherever Explain more does. A concept is proposed as known (confirm: true, a card for the `known:<concept>` setting) once
// cards holding it were decided with no Explain more on KNOWN_AFTER different days, counting only
// cards decided after the latest Explain more on any card holding it and after its latest setting
// in the profile. Explain more on a card holding a concept known in force, after the latest
// `known:<concept>` setting came into force (its confirmation; a false at its own time), proposes
// it as not known (confirm: false: written at once, no card), unless false is already the latest
// value in the profile. So an Explain more between a proposal and its Confirm counts for nothing.
export function conceptProposals(events, profile, { now, enrolled, outcomes: given, dayOf: day = dayOf } = {}) {
  const keys = enrolled ?? readEnrolled();
  const outcomes = given ?? clickOutcomes(events, profile, { enrolled: keys });
  const context = profileContext({ events, profile, outcomes, nowMs: instant(now) });
  const concepts = [...new Set(outcomes.flatMap(({ card }) => conceptsOf(card)))].sort();
  const out = [];
  for (const concept of concepts) {
    const key = `known:${concept}`;
    const holding = outcomes.filter(({ card }) => conceptsOf(card).includes(concept));
    const since = latestSetting(profile, key)?.at;
    if (profile?.settings?.[key]?.value === true) {
      const known = inForceSince(profile, key, keys) ?? since;
      const explained = holding.some((o) => o.explained.some((at) => after(at, known)));
      if (explained && latestSetting(profile, key)?.data?.value !== false) out.push({ concept, known: false, confirm: false });
      continue;
    }
    const lastExplained = holding.flatMap((o) => o.explained).sort().at(-1);
    const counted = holding.filter((o) => o.decided !== null && o.explained.length === 0 && after(o.decided.at, lastExplained) && after(o.decided.at, since));
    const days = new Set(counted.map((o) => day(o.decided.at)));
    if (days.size >= KNOWN_AFTER && !heldBack(context, 'setting', key, true)) out.push({ concept, known: true, confirm: true });
  }
  return out;
}

// The setting a concept proposal writes: { key, value, because }, `because` its one-line reason.
export function conceptSetting({ concept, known }) {
  return {
    key: `known:${concept}`,
    value: known,
    because: known
      ? `you answered ${KNOWN_AFTER} cards that use it, on different days, without asking for more`
      : 'you asked for more explanation on a card that uses it',
  };
}

// settingProposals(events, profile, { now, enrolled, outcomes, boardAsks }) -> [{ key, value, because }].
// `boardTab: build` when the latest board command of each of the last BOARD_VISITS visits that had
// one named build, and `explanations: plain` when EXPLAINED_CARDS different cards got Explain more or Why?
// within EXPLAINED_DAYS while some-terms is in force. Either counts only what came after that
// setting's latest event in the profile, and neither is proposed when it is the value in force.
export function settingProposals(events, profile, { now, enrolled, outcomes: given, boardAsks = [] } = {}) {
  const nowMs = instant(now);
  const outcomes = given ?? clickOutcomes(events, profile, { enrolled: enrolled ?? readEnrolled() });
  const context = profileContext({ events, profile, outcomes, nowMs });
  const out = [];
  const propose = (key, value, because) => { if (!heldBack(context, 'setting', key, value)) out.push({ key, value, because }); };

  if (profile?.settings?.boardTab?.value !== 'build') {
    const since = latestSetting(profile, 'boardTab')?.at;
    const asks = list(boardAsks).filter((a) => isRecord(a) && typeof a.at === 'string' && typeof a.visit === 'string'
      && (a.tab === null || TABS.includes(a.tab)) && after(a.at, since));
    const lastOfVisit = new Map();
    for (const a of [...asks].sort((x, y) => ms(x.at) - ms(y.at))) lastOfVisit.set(a.visit, a);
    const visits = [...lastOfVisit.entries()].sort(([x], [y]) => ms(x) - ms(y)).slice(-BOARD_VISITS).map(([, a]) => a);
    if (visits.length === BOARD_VISITS && visits.every((a) => a.tab === 'build')) {
      propose('boardTab', 'build', `you asked for the board's build tab on each of your last ${BOARD_VISITS} visits`);
    }
  }

  if (profile?.settings?.explanations?.value === 'some-terms') {
    const since = latestSetting(profile, 'explanations')?.at;
    const recent = outcomes.filter((o) => o.explained.some((at) => nowMs - ms(at) <= EXPLAINED_DAYS * DAY_MS && after(at, since)));
    if (recent.length >= EXPLAINED_CARDS) propose('explanations', 'plain', `you asked for more explanation on ${EXPLAINED_CARDS} cards this week`);
  }
  return out;
}

// --- The delegation review ---

// A decision topic, as a card and a reversal name it: a slug, counted exactly (ruling F40).
const TOPIC = new RegExp(`^${ID}$`);
// The card kinds decided without a signature: a product question, and a question from the build.
// Every other kind is decided by a signed click the gate or the prompt record checks (DECIDING).
const UNSIGNED = CARD_KINDS.filter((kind) => !Object.hasOwn(DECIDING, kind));

const topicOf = (data) => (typeof data?.topic === 'string' && TOPIC.test(data.topic) ? data.topic : null);

// The time of the latest delegation review (a `note` with `review: 'delegation'`), or null.
export function lastReview(events) {
  return list(events).filter((e) => isRecord(e) && e.kind === 'note' && e.data?.review === 'delegation' && typeof e.at === 'string')
    .map((e) => e.at).sort().at(-1) ?? null;
}

// reviewDue({ events, now, days }) -> whether `days` have passed since the latest review, or with
// none since the project's first event (ruling F43). A project with no events has nothing to review.
export function reviewDue({ events, now, days }) {
  const times = list(events).filter((e) => isRecord(e) && typeof e.at === 'string' && Number.isFinite(ms(e.at))).map((e) => e.at).sort();
  if (times.length === 0) return false;
  const every = Number.isFinite(days) && days > 0 ? days : SETTINGS.delegationReviewDays.default;
  return instant(now) - ms(lastReview(events) ?? times[0]) >= every * DAY_MS;
}

// delegationProposals(events, { now, since, enrolled, outcomes, views }) -> [{ topic, from, to, because }], by topic.
// `events` are the project's; `views` its views (built here when not given), for the levels in
// force and the level proposals waiting. Counted since `since`, the last review (none: all time).
// A topic is proposed for level 2 (from 3) once DELEGATE_AFTER of its level 3 cards were approved
// unchanged (ruling F46): a card decided without a signature (a product question, or a question
// from the build carrying a topic), by the option the card recommended (its `recommend`; a card
// without one doesn't count), with no reversal of the topic after it. A card a signed click
// decides (DECIDING) never counts, since a level changes nothing for it, and a topic any such card
// carries is never proposed for level 2. A topic reversed since the last review is proposed from 2
// to 3 instead, and not for level 2. Never proposed (ruling F39): a topic with any card at level 4
// or level 4 in force (the guardrails, secrets and money), a level the topic already has in force
// or waiting for its confirmation, and a move from any level in force other than the one it is
// from. A level proposal kept as is no longer waits, and is held back for TURNED_DOWN_DAYS (F48).
export function delegationProposals(events, { now, since, enrolled, outcomes: given, views: built } = {}) {
  const nowMs = instant(now);
  const all = list(events).filter(isRecord);
  const keys = enrolled ?? readEnrolled();
  const outcomes = given ?? cardOutcomes(all, keys);
  const views = built ?? buildViews(all, keys, { now: () => new Date(nowMs) });
  const inPeriod = (at) => after(at, since) && ms(at) <= nowMs;
  const later = (e, at) => ms(e.at) > ms(at);

  const reversals = all.filter((e) => e.kind === 'reversal' && topicOf(e.data) !== null);
  const inForce = (topic) => (isRecord(views.levels?.[topic]) ? views.levels[topic].value : undefined);
  const context = { events: all, unconfirmed: views.unconfirmed, outcomes, nowMs };
  const waiting = (topic, value) => heldBack(context, 'level', topic, value);
  const highest = new Set([
    ...outcomes.filter(({ card }) => card.data?.level === 4).map(({ card }) => topicOf(card.data)).filter((t) => t !== null),
    ...Object.keys(isRecord(views.levels) ? views.levels : {}).filter((t) => inForce(t) === 4),
  ]);
  const signed = new Set(outcomes.filter(({ card }) => Object.hasOwn(DECIDING, card.data?.kind)).map(({ card }) => topicOf(card.data)).filter((t) => t !== null));

  const unchanged = ({ card, decided }) => {
    const topic = topicOf(card.data);
    const { recommend } = card.data;
    if (topic === null || card.data.level !== 3 || !UNSIGNED.includes(card.data.kind) || typeof recommend !== 'string' || recommend === '') return false;
    if (decided === null || decided.label !== recommend || !inPeriod(decided.at)) return false;
    return !reversals.some((r) => r.data.topic === topic && later(r, decided.at));
  };
  const approvals = new Map();
  for (const outcome of outcomes.filter(unchanged)) approvals.set(outcome.card.data.topic, (approvals.get(outcome.card.data.topic) ?? 0) + 1);
  const reversed = new Map();
  for (const r of reversals.filter((e) => inPeriod(e.at))) reversed.set(r.data.topic, (reversed.get(r.data.topic) ?? 0) + 1);
  const period = since === undefined || since === null ? 'so far' : 'since the last review';

  const out = [];
  for (const topic of [...new Set([...approvals.keys(), ...reversed.keys()])].sort()) {
    if (highest.has(topic)) continue;
    const level = inForce(topic);
    const undone = reversed.get(topic);
    if (undone !== undefined) {
      if ((level === undefined || level === 2) && !waiting(topic, 3)) {
        const what = undone === 1 ? 'a decision' : `${undone} decisions`;
        out.push({ topic, from: 2, to: 3, because: `you undid ${what} made on it without you ${period}` });
      }
      continue;
    }
    const n = approvals.get(topic);
    if (n >= DELEGATE_AFTER && !signed.has(topic) && (level === undefined || level === 3) && !waiting(topic, 2)) {
      out.push({ topic, from: 3, to: 2, because: `you chose what I recommended ${n} times ${period}, with nothing undone after` });
    }
  }
  return out;
}

// delegationReview(events, { now, enrolled, views }) -> { due, since, proposals }, for the helper's
// /state/views (ruling F41): whether the review is due by the project's `delegationReviewDays` in
// force over the default, the time of the last review (null when there has been none), and the
// proposals counted since then.
export function delegationReview(events, { now, enrolled, views: built } = {}) {
  const nowMs = instant(now);
  const all = list(events).filter(isRecord);
  const keys = enrolled ?? readEnrolled();
  const views = built ?? buildViews(all, keys, { now: () => new Date(nowMs) });
  const settings = effectiveSettings({ project: isRecord(views.settings) ? views.settings : {}, now: nowMs });
  const since = lastReview(all);
  return {
    due: reviewDue({ events: all, now: nowMs, days: settings.delegationReviewDays?.value }),
    since,
    proposals: delegationProposals(all, { now: nowMs, since, enrolled: keys, views }),
  };
}
