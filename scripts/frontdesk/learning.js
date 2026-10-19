// scripts/frontdesk/learning.js
// What Wheelhouse learns from the director's clicks (design section 5.3): the concepts they know
// and the settings they would like. Each is a proposal the director confirms with one click on a
// one-line card; nothing learnt changes anything until then, except that a concept they turn out
// not to know makes explanations longer at once (a `known:*` setting of false needs no confirmation).
// The board-context hook runs it once a visit, outside the sandbox, since the front desk can't read
// the state or the profile; the hook writes what it proposes.
//
// The shapes the proposals take:
//   events    the project's events, as its state holds them
//   profile   { events, settings, unconfirmed }: the profile's events, the settings in force
//             (effectiveSettings, project over profile over defaults) and the profile views' `unconfirmed`
//   options   { now, enrolled, dayOf, boardAsks }: the clock; the enrolled keys a signed record is
//             checked against (readEnrolled() when not given); the calendar day of a time (this
//             computer's local day when not given); and for settingProposals, seen.json's
//             `boardAsks`, the last board commands as { at, tab, visit }
// A card's click is judged as the waiting view judges it (cardOutcomes): a reply code's signed
// record counts as the click it stands for. A proposal already waiting for its confirmation in the
// profile, or put off with Not now on its card in the last TURNED_DOWN_DAYS, is not made again.
import { cardOutcomes } from '../state/views.js';
import { readEnrolled } from '../state/signing.js';
import { conceptOf } from './glossary.js';
import { KNOWN_AFTER } from '../lib/front-desk.js';

// How long a Not now on a proposal's card holds the proposal back.
export const TURNED_DOWN_DAYS = 30;
// Explain more on this many different cards within this many days proposes plain explanations.
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

// Whether a proposal of `key` set to `value` is held back: waiting for its confirmation in the
// profile, or put off with Not now on a card whose confirm line names a setting of that key and
// value, within TURNED_DOWN_DAYS of now.
function heldBack({ events, profile, outcomes, nowMs }, key, value) {
  if (list(profile?.unconfirmed).some((u) => u?.kind === 'setting' && u.data?.key === key && same(u.data?.value, value))) return true;
  const settings = new Map([...list(events), ...list(profile?.events)].filter((e) => e?.kind === 'setting').map((e) => [e.id, e]));
  return outcomes.some(({ card, answers }) => {
    const named = /^Confirm setting (\S+): "/.exec(typeof card.data?.line === 'string' ? card.data.line : '');
    const target = named && settings.get(named[1]);
    if (!target || target.data?.key !== key || !same(target.data?.value, value)) return false;
    return answers.some((a) => a.data?.label === 'Not now' && nowMs - ms(a.at) < TURNED_DOWN_DAYS * DAY_MS);
  });
}

// The concepts a card holds, as `known:<concept>` names them.
function conceptsOf(card) {
  return [...new Set(list(card.data?.concepts).filter((t) => typeof t === 'string').map(conceptOf).filter((c) => CONCEPT.test(c)))];
}

// conceptProposals(events, profile, { now, enrolled, dayOf }) -> [{ concept, known, confirm }], by concept.
// A concept is proposed as known (confirm: true, a card for the `known:<concept>` setting) once
// cards holding it were decided with no Explain more on KNOWN_AFTER different days, counting only
// cards decided after the latest Explain more on any card holding it and after its latest setting
// in the profile. Explain more on a card holding a concept known in force, after that setting,
// proposes it as not known (confirm: false: written at once, no card), unless false is already the
// latest value in the profile.
export function conceptProposals(events, profile, { now, enrolled, dayOf: day = dayOf } = {}) {
  const outcomes = clickOutcomes(events, profile, { enrolled: enrolled ?? readEnrolled() });
  const context = { events, profile, outcomes, nowMs: instant(now) };
  const concepts = [...new Set(outcomes.flatMap(({ card }) => conceptsOf(card)))].sort();
  const out = [];
  for (const concept of concepts) {
    const key = `known:${concept}`;
    const holding = outcomes.filter(({ card }) => conceptsOf(card).includes(concept));
    const since = latestSetting(profile, key)?.at;
    if (profile?.settings?.[key]?.value === true) {
      const explained = holding.some((o) => o.explained.some((at) => after(at, since)));
      if (explained && latestSetting(profile, key)?.data?.value !== false) out.push({ concept, known: false, confirm: false });
      continue;
    }
    const lastExplained = holding.flatMap((o) => o.explained).sort().at(-1);
    const counted = holding.filter((o) => o.decided !== null && o.explained.length === 0 && after(o.decided.at, lastExplained) && after(o.decided.at, since));
    const days = new Set(counted.map((o) => day(o.decided.at)));
    if (days.size >= KNOWN_AFTER && !heldBack(context, key, true)) out.push({ concept, known: true, confirm: true });
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

// settingProposals(events, profile, { now, enrolled, boardAsks }) -> [{ key, value, because }].
// `boardTab: build` when the latest board command of each of the last BOARD_VISITS visits that had
// one named build, and `explanations: plain` when EXPLAINED_CARDS different cards got Explain more
// within EXPLAINED_DAYS while some-terms is in force. Either counts only what came after that
// setting's latest event in the profile, and neither is proposed when it is the value in force.
export function settingProposals(events, profile, { now, enrolled, boardAsks = [] } = {}) {
  const nowMs = instant(now);
  const outcomes = clickOutcomes(events, profile, { enrolled: enrolled ?? readEnrolled() });
  const context = { events, profile, outcomes, nowMs };
  const out = [];
  const propose = (key, value, because) => { if (!heldBack(context, key, value)) out.push({ key, value, because }); };

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
