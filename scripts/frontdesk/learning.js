// scripts/frontdesk/learning.js
// What Wheelhouse learns from the director's clicks (design section 5.3): the settings they would like.
// Each is a proposal the director confirms with one click on a one-line card; nothing learnt changes
// anything until then. Nothing is learnt about which concepts the director knows or which decisions
// could be made without them: explanations follow the `explanations` setting alone, and every decision
// at levels 3 and 4 is the director's card.
// The board-context hook runs it once a visit, outside the sandbox, since the front desk can't read
// the state or the profile; the hook writes what it proposes.
//
// The shapes the proposals take:
//   events    the project's events, as its state holds them
//   profile   { events, settings, unconfirmed }: the profile's events, the settings in force
//             (effectiveSettings, project over profile over defaults) and the profile views' `unconfirmed`
//   options   { now, enrolled, outcomes, boardAsks }: the clock; the enrolled keys a signed
//             record is checked against (readEnrolled() when not given); the cards' outcomes from
//             clickOutcomes (worked out here when not given); and seen.json's `boardAsks`, the last
//             board commands as { at, tab, visit }
// A card's click is judged as the waiting view judges it (cardOutcomes): a reply code's signed
// record counts as the click it stands for. A proposal already waiting for its confirmation, or put
// off with Not now or kept as is (Keep as is, ruling F48) on its card in the last TURNED_DOWN_DAYS,
// is not made again. One kept as is no longer waits, though it stays unconfirmed.
import { cardOutcomes } from '../state/views.js';
import { readEnrolled } from '../state/signing.js';
import { KEEP_AS_IS } from '../cards/compose.js';

// How long a Not now or a Keep as is on a proposal's card holds the proposal back.
export const TURNED_DOWN_DAYS = 30;
// Explain more or Why? on this many different cards within this many days proposes plain explanations.
export const EXPLAINED_CARDS = 3;
export const EXPLAINED_DAYS = 7;
// The build tab asked for on this many visits running proposes it as the board's first tab.
export const BOARD_VISITS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
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

// Whether a card's answers turned its proposal down within TURNED_DOWN_DAYS of now: Not now or Keep as is.
export const turnedDown = (answers, nowMs) => answers.some((a) => (a.data?.label === 'Not now' || a.data?.label === KEEP_AS_IS) && nowMs - ms(a.at) < TURNED_DOWN_DAYS * DAY_MS);

// Whether a proposal of `kind` (a setting) setting `key` to `value` is held back: waiting
// for its confirmation, or turned down within TURNED_DOWN_DAYS of now, by Not now or Keep as is on
// a card whose confirm line names an event of that kind, key and value. One whose card was decided
// by Keep as is no longer waits, though `unconfirmed` still lists it. `events` are where the
// proposals and their cards are; `unconfirmed` the views' proposals waiting.
function heldBack({ events, unconfirmed, outcomes, nowMs }, kind, key, value) {
  const proposals = new Map(list(events).filter((e) => e?.kind === kind).map((e) => [e.id, e]));
  const kept = new Set();
  let declined = false;
  for (const { card, answers, decided } of outcomes) {
    const named = /^Confirm ([a-z-]+) (\S+): "/.exec(typeof card.data?.line === 'string' ? card.data.line : '');
    const target = named && named[1] === kind ? proposals.get(named[2]) : undefined;
    if (!target || target.data?.key !== key || !same(target.data?.value, value)) continue;
    if (decided?.label === KEEP_AS_IS) kept.add(target.id);
    if (turnedDown(answers, nowMs)) declined = true;
  }
  return declined || list(unconfirmed).some((u) => u?.kind === kind && !kept.has(u.id) && u.data?.key === key && same(u.data?.value, value));
}

// What heldBack needs for the director's profile settings: the project's and the profile's
// events, and the profile views' proposals waiting.
const profileContext = ({ events, profile, outcomes, nowMs }) => ({
  events: [...list(events), ...list(profile?.events)], unconfirmed: profile?.unconfirmed, outcomes, nowMs,
});

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
      propose('boardTab', 'build', `you asked for the Logbook's Build tab on each of your last ${BOARD_VISITS} visits`);
    }
  }

  if (profile?.settings?.explanations?.value === 'some-terms') {
    const since = latestSetting(profile, 'explanations')?.at;
    const recent = outcomes.filter((o) => o.explained.some((at) => nowMs - ms(at) <= EXPLAINED_DAYS * DAY_MS && after(at, since)));
    if (recent.length >= EXPLAINED_CARDS) propose('explanations', 'plain', `you asked for more explanation on ${EXPLAINED_CARDS} cards this week`);
  }
  return out;
}
