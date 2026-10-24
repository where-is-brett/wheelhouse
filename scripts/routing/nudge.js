// scripts/routing/nudge.js
// The usage cards (design section 14.6, "The usage nudge"): from the weekly allowance's reading, the level in force,
// the director's mark and what the front desk has already offered, which card, if any, to put to the director now.
// A pure function: callers pass what they have read, and the card is the composer's input (scripts/cards/compose.js)
// with a record of the offer. It never switches anything: the director's pick of a card's first option is a setting
// change the front desk writes and the director confirms the usual way (section 14.4).
import { LEVELS } from './thoroughness.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// A reading older than a day says nothing about now.
export const STALE_MS = DAY_MS;
// The reset must be further off than this for a card to switch down, and nearer than UP_WITHIN_MS for the upward card.
export const DOWN_MIN_MS = DAY_MS;
export const UP_WITHIN_MS = 2 * DAY_MS;
// Used at or above this at Lean offers Lightest; below UP_BELOW with the reset near offers Thorough.
export const LIGHTEST_AT = 90;
export const UP_BELOW = 40;
// Two resets this close are one allowance week: the reading's reset time may move a little between readings.
const SAME_WEEK_MS = 12 * HOUR_MS;

const NAMES = { lightest: 'Lightest', lean: 'Lean', balanced: 'Balanced', thorough: 'Thorough' };
const nameOf = (level) => NAMES[level];
const time = (x) => (typeof x === 'string' ? Date.parse(x) : NaN);

// "Thursday at 09:00" in `timeZone` (this computer's own when it is undefined).
export function whenOf(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} at ${get('hour')}:${get('minute')}`;
}

const dayOf = (iso, timeZone) => new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long' }).format(new Date(iso));
const dateKey = (ms, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

// How a reset that has passed is said on a return card: "this morning", "today", or "on <weekday>".
function passedWords(resetIso, nowMs, timeZone) {
  const resetMs = Date.parse(resetIso);
  if (dateKey(resetMs, timeZone) !== dateKey(nowMs, timeZone)) return `on ${dayOf(resetIso, timeZone)}`;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(resetMs)));
  return hour < 12 ? 'this morning' : 'today';
}

// The weekly window of `usage/allowance.json`'s contents ({ at, windows }) as { used, resetsAt, at }, or null.
export function weeklyOf(reading) {
  const window = Array.isArray(reading?.windows) ? reading.windows.find((w) => w?.kind === 'seven_day') : undefined;
  if (!window || !Number.isFinite(window.percentUsed) || Number.isNaN(time(window.resetsAt)) || Number.isNaN(time(reading.at))) return null;
  return { used: window.percentUsed, resetsAt: window.resetsAt, at: reading.at };
}

const sameWeek = (a, b) => Math.abs(time(a) - time(b)) < SAME_WEEK_MS;

// The level a return card goes back to: the level before the switch, and before any earlier switch in the same week
// that led to it (Balanced to Lean, then Lean to Lightest, goes back to Balanced).
function levelBefore(offers, offer) {
  let from = offer.from;
  for (const earlier of [...offers].sort((a, b) => time(b.at) - time(a.at))) {
    if (SWITCHING.includes(earlier.card) && time(earlier.at) < time(offer.at) && earlier.to === from && sameWeek(earlier.reset, offer.reset)) from = earlier.from;
  }
  return from;
}

const SWITCHING = ['nudge', 'lightest', 'up'];

// The card for each kind, as the composer's input for a product question. The words are section 14.6's; the
// composer's recommendation is the option and "because", so the design's recommendation reads across the two.
function nudgeInput({ used, resets, level }) {
  return {
    kind: 'question',
    level: 3,
    ask: 'Switch to Lean until it resets?',
    what: `You've used ${Math.round(used)}% of this week's allowance. It resets on ${resets}.`,
    why: 'Only you choose how thorough the work is.',
    options: [
      { label: 'Switch to Lean until it resets', says: 'Thoroughness changes to Lean until your allowance resets, once you confirm it.' },
      { label: `Stay on ${nameOf(level)}`, says: `Thoroughness stays on ${nameOf(level)}.` },
    ],
    recommend: 'Switch to Lean until it resets',
    because: 'work keeps going, a little lighter, so it\'s less likely to stop before the reset. I\'ll offer to switch back after the reset',
    meanwhile: 'Work carries on as it is.',
  };
}

function lightestInput({ used, resets }) {
  return {
    kind: 'question',
    level: 3,
    ask: 'Switch to Lightest until it resets?',
    what: `You've used ${Math.round(used)}% of this week's allowance, and you're on Lean. It resets on ${resets}.`,
    why: 'Lightest saves more, but it\'s less safe, so only you can choose it.',
    options: [
      { label: 'Switch to Lightest until it resets', says: 'Thoroughness changes to Lightest until your allowance resets, once you confirm it.' },
      { label: 'Stay on Lean', says: 'Thoroughness stays on Lean.' },
    ],
    recommend: 'Stay on Lean',
    because: 'unless work stopping before the reset matters more than catching mistakes. On Lightest, a lighter model also designs and checks risky work, so mistakes are likelier to slip through. Every check still runs',
    meanwhile: 'Work carries on on Lean.',
  };
}

function upInput({ used, resets, level }) {
  return {
    kind: 'question',
    level: 3,
    ask: 'Plenty left: switch to Thorough until it resets?',
    what: `You've used ${Math.round(used)}% of this week's allowance, and it resets on ${resets}.`,
    why: 'Only you choose how thorough the work is.',
    options: [
      { label: 'Switch to Thorough until it resets', says: 'Thoroughness changes to Thorough until your allowance resets, once you confirm it.' },
      { label: `Stay on ${nameOf(level)}`, says: `Thoroughness stays on ${nameOf(level)}.` },
    ],
    recommend: 'Switch to Thorough until it resets',
    because: 'allowance left at the reset is lost, and Thorough checks risky work twice. I\'ll offer to switch back after the reset',
    meanwhile: 'Work carries on as it is.',
  };
}

function returnInput({ day, before, level, when, saved }) {
  return {
    kind: 'question',
    level: 3,
    ask: `Go back to ${nameOf(before)}?`,
    what: `Your allowance reset ${when}. You switched to ${nameOf(level)} on ${day}${saved ? ' to save it' : ' to use what was left'}.`,
    why: 'Only you choose how thorough the work is.',
    options: [
      { label: `Go back to ${nameOf(before)}`, says: `Thoroughness changes back to ${nameOf(before)}, once you confirm it.` },
      { label: `Stay on ${nameOf(level)}`, says: `Thoroughness stays on ${nameOf(level)}.` },
    ],
    recommend: `Go back to ${nameOf(before)}`,
    because: 'there\'s a full week\'s allowance again',
    meanwhile: `Work carries on on ${nameOf(level)}.`,
  };
}

// nudgeCard({ allowance, level, mark, offers, now, timeZone }) -> null, or
//   { card: 'nudge' | 'lightest' | 'up' | 'return', input, switchLabel, switchTo, record }
// `allowance` is the seven-day window ({ used, resetsAt, at }: weeklyOf). `level` the Thoroughness level in force,
// `mark` the usage nudge setting (`off` or a percentage). `offers` the usage-card records so far (views.usageCards),
// each { card, at, reset, from, to }: what an allowance week has offered is read from them, by the reset they name.
// `switched` the accepted `efficiency` setting ({ at, value, usageCard }): a return card is for a switch a card's pick
// made (it names the offer's time), set after the offer and before its reset, never for one made another way.
// `now` a function or a time, `timeZone` the director's (this computer's own when undefined). `input` is the composer's
// input; `switchLabel` the option whose pick is the change to `switchTo`; `record` what to keep once the card is
// handed over (a return card's record names the reset of the week it closes). At most one card.
export function nudgeCard({ allowance, level, mark, offers = [], switched = null, now, timeZone }) {
  if (mark === 'off' || !Number.isFinite(mark) || !LEVELS.includes(level)) return null;
  const nowMs = typeof now === 'function' ? new Date(now()).getTime() : new Date(now ?? Date.now()).getTime();
  if (!allowance || !Number.isFinite(allowance.used) || Number.isNaN(time(allowance.resetsAt)) || Number.isNaN(time(allowance.at))) return null;
  const readMs = time(allowance.at);
  if (nowMs - readMs > STALE_MS || readMs > nowMs + HOUR_MS) return null;
  const list = Array.isArray(offers) ? offers.filter((o) => o && typeof o.card === 'string' && !Number.isNaN(time(o.reset)) && !Number.isNaN(time(o.at))) : [];
  const resetMs = time(allowance.resetsAt);
  const week = list.filter((o) => sameWeek(o.reset, allowance.resetsAt));
  const offered = (card) => week.some((o) => o.card === card);
  const used = allowance.used;
  const untilReset = resetMs - nowMs;
  const make = (card, input, switchTo, reset = resetMs) => ({
    card,
    input,
    switchLabel: input.options[0].label,
    switchTo,
    record: { card, at: new Date(nowMs).toISOString(), reset: new Date(reset).toISOString(), from: level, to: switchTo },
  });

  // Return: the first reading after a reset, when the level in force came from one of these cards.
  const origin = list
    .filter((o) => SWITCHING.includes(o.card) && !sameWeek(o.reset, allowance.resetsAt) && time(o.reset) < resetMs && time(o.reset) <= readMs && o.to === level
      && switched?.value === level && switched.usageCard === o.at && time(switched.at) > time(o.at) && time(switched.at) < time(o.reset))
    .sort((a, b) => time(a.at) - time(b.at)).at(-1);
  if (origin && !list.some((o) => o.card === 'return' && sameWeek(o.reset, origin.reset))) {
    const before = levelBefore(list, origin);
    if (before !== level) {
      return make('return', returnInput({
        day: dayOf(origin.at, timeZone), before, level, when: passedWords(origin.reset, nowMs, timeZone), saved: origin.card !== 'up',
      }), before, time(origin.reset));
    }
  }
  const resets = whenOf(allowance.resetsAt, timeZone);
  if ((level === 'balanced' || level === 'thorough') && used >= mark && untilReset > DOWN_MIN_MS && !offered('nudge')) {
    return make('nudge', nudgeInput({ used, resets, level }), 'lean');
  }
  if (level === 'lean' && used >= LIGHTEST_AT && untilReset > DOWN_MIN_MS && !offered('lightest')) {
    return make('lightest', lightestInput({ used, resets }), 'lightest');
  }
  if (used < UP_BELOW && untilReset > 0 && untilReset < UP_WITHIN_MS && level !== 'thorough'
    && !offered('nudge') && !offered('lightest') && !offered('up')) {
    return make('up', upInput({ used, resets, level }), 'thorough');
  }
  return null;
}
