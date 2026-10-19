// scripts/mod/settings-pane.js
// The settings pane's rows, what a choice sets, and the press on one. The bridge hands a press
// here for the origin `pane` only. A press is both the change and the director's confirmation of
// it (design sections 9 and 14.4): the setting goes through the helper, by the setting's home, and
// the confirmation a Confirm click on its card would earn is signed, kept and sent as the prompt
// record signs it. The helper's write routes answer the new event's id, so the event is read back
// from the state or profile clone for the confirmation to name.
//
// A choice carries no time. "Away until 18:00" and "until 09:00 tomorrow" are worked out at the
// press, in the bridge's own time zone, so a row drawn before 18:00, or before midnight, can't
// carry an old time. The morning choices end at the next 09:00 to come: this morning's between
// midnight and 09:00, and then their label drops "tomorrow". The setting's `before` is the value in force when the confirmation lands,
// which the views work out from the confirmed events, so a change made in the chat meanwhile is
// the one handed back to.
//
// Under STOP the helper refuses every write, so a press records nothing and says so. Budget
// allocation is in the backlog (design section 14.1): the budget row offers no choice.
import { SETTINGS, definitionOf, checkSetting, say } from '../settings/catalogue.js';
import { effectiveSettings, sayTime, sayValue } from '../settings/effective.js';
import { AWAY } from '../lib/mod-numbers.js';
import { confirmationFor, listEvents } from '../state/events.js';
import { keepEarned, sendKept } from '../hooks/prompt-record.js';
import { withinBudget, BUDGET_MS } from '../hooks/pending.js';
import { localViews } from '../hooks/session-start.js';
import { readProfileViews } from '../profile/store.js';
import { helperClient } from '../host/helper-client.js';
import { stateDir, profileDir } from '../lib/paths.js';

export const ADVANCED = 'Advanced settings: ask the front desk';
const ASK = 'Changed by asking the front desk';
const BUDGET_WHY = 'The other budget levels come with the budget design';
const STOP_REFUSED = 'STOP is on';
// What the helper client answers when the helper doesn't answer in time.
const HELPER_LATE = 'the host helper did not answer in time';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const SAYS = {
  notOffered: 'That choice isn\'t offered now',
  stopOn: 'Settings change once STOP is lifted',
  notTaken: 'That setting couldn\'t be changed now: the helper didn\'t take it',
  late: 'The helper didn\'t answer in time; if the change lands, it waits for your Confirm',
  failed: 'That setting couldn\'t be changed this time',
};

const FROM = { profile: 'yours', project: 'this project', default: 'the default' };
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const no = (says) => ({ made: false, says });
const lower = (text) => text.charAt(0).toLowerCase() + text.slice(1);

// The pane's rows, in the order of design section 14.1 with the profile's two extras (the board's
// first tab and working hours) after notifications, as section 14.3 lists them. `kind` says how a
// row is drawn: 'levels' (one choice per catalogue level), 'presence', or one that offers nothing.
const LEVEL_WORDS = {
  autonomy: { cautious: 'Cautious', balanced: 'Balanced', trusting: 'Trusting' },
  showFirst: { always: 'Always', visual: 'Visual changes', asked: 'Only when asked' },
  milestones: { demos: 'Midpoint demos', 'to-the-end': 'Run to the end', ask: 'Ask per feature' },
  efficiency: { lean: 'Lean', balanced: 'Balanced', thorough: 'Thorough' },
  budget: { report: 'Report only', 'weekly-share': 'Weekly share', 'per-feature': 'Per feature' },
  pace: { 1: '1', 2: '2', 3: '3' },
  briefing: { short: 'Short', standard: 'Standard', detailed: 'Detailed' },
  explanations: { plain: 'Plain', 'some-terms': 'Some technical terms' },
  boardTab: { director: 'Director', build: 'Build' },
  phase: { 'before-launch': 'Before launch', launched: 'Launched' },
};
const PANE = {
  autonomy: { label: 'Autonomy', kind: 'levels' },
  showFirst: { label: 'Show before build', kind: 'levels' },
  presence: { label: 'Presence', kind: 'presence' },
  milestones: { label: 'Feature milestones', kind: 'levels' },
  efficiency: { label: 'Token efficiency', kind: 'levels' },
  budget: { label: 'Budget', kind: 'none', why: BUDGET_WHY },
  pace: { label: 'Pace', kind: 'levels' },
  briefing: { label: 'Briefing', kind: 'levels' },
  briefingGapHours: { label: 'Briefing gap', kind: 'none', why: ASK },
  explanations: { label: 'Explanations', kind: 'levels' },
  notifications: { label: 'Notifications', kind: 'none', why: ASK },
  boardTab: { label: 'Board tab', kind: 'levels' },
  hours: { label: 'Working hours', kind: 'none', why: ASK },
  phase: { label: 'Product phase', kind: 'levels' },
  protection: { label: 'Protection', kind: 'none', why: ASK },
};

// How a level reads: the design's word for it, else the value as said.
const wordOf = (key, value) => LEVEL_WORDS[key]?.[value] ?? say(value);

// --- the clock, in a time zone ---

const instantOf = (now) => new Date(typeof now === 'function' ? now() : now).getTime();

const formatters = new Map();
// The formatter for a zone, or UTC's for a zone name that isn't one.
function formatterFor(timeZone) {
  const zone = typeof timeZone === 'string' && timeZone !== '' ? timeZone : 'UTC';
  if (!formatters.has(zone)) {
    const options = { hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' };
    try {
      formatters.set(zone, new Intl.DateTimeFormat('en-GB', { ...options, timeZone: zone }));
    } catch {
      formatters.set(zone, formatterFor('UTC'));
    }
  }
  return formatters.get(zone);
}

// The wall clock in the zone at an instant: { y, m, d, h, mi, s }.
function wallAt(ms, timeZone) {
  const got = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) got[part.type] = Number(part.value);
  return { y: got.year, m: got.month, d: got.day, h: got.hour, mi: got.minute, s: got.second };
}

// How far the zone is ahead of UTC at an instant, in milliseconds.
function offsetAt(ms, timeZone) {
  const w = wallAt(ms, timeZone);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

// The instant a wall-clock time is on a calendar day in the zone. Worked out twice, so a day on
// which the clocks change still lands on the wall time asked for.
function instantAt({ y, m, d }, [hours, minutes], timeZone) {
  const guess = Date.UTC(y, m - 1, d, hours, minutes);
  const first = guess - offsetAt(guess, timeZone);
  return guess - offsetAt(first, timeZone);
}

const clockOf = (hhmm) => hhmm.split(':').map(Number);
// The calendar day after the one given.
function nextDay({ y, m, d }) {
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}
// Whole calendar days from `from` to `to` in the zone.
function daysBetween(fromMs, toMs, timeZone) {
  const a = wallAt(fromMs, timeZone);
  const b = wallAt(toMs, timeZone);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
}
const two = (n) => String(n).padStart(2, '0');
const hhmmOf = (ms, timeZone) => {
  const w = wallAt(ms, timeZone);
  return `${two(w.h)}:${two(w.mi)}`;
};

// An end time as the row says it: the time alone today, "09:00 tomorrow", else the full date.
function sayUntil(until, nowMs, timeZone) {
  const ms = Date.parse(until);
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return sayTime(until);
  const days = daysBetween(nowMs, ms, timeZone);
  if (days === 0) return hhmmOf(ms, timeZone);
  return days === 1 ? `${hhmmOf(ms, timeZone)} tomorrow` : sayTime(until);
}

// --- presence ---

const PRESENCE = [
  { id: 'here', label: 'Here' },
  { id: 'away-hours', label: `Away for ${AWAY.hours} hours` },
  { id: 'away-evening', label: `Away until ${AWAY.evening}` },
  { id: 'away-morning', label: `Away until ${AWAY.morning}`, morning: true },
  { id: 'dnd-morning', label: `Do not disturb until ${AWAY.morning}`, morning: true },
  { id: 'dnd-open', label: 'Do not disturb until I change it' },
];

// The end of today's evening edge, if it is still ahead at `nowMs`; else null.
function eveningAfter(nowMs, timeZone) {
  const until = instantAt(wallAt(nowMs, timeZone), clockOf(AWAY.evening), timeZone);
  return until > nowMs ? until : null;
}
// The next morning edge to come: today's while it is still ahead (between midnight and then),
// else the next day's.
function nextMorning(nowMs, timeZone) {
  const today = wallAt(nowMs, timeZone);
  const edge = instantAt(today, clockOf(AWAY.morning), timeZone);
  return edge > nowMs ? edge : instantAt(nextDay(today), clockOf(AWAY.morning), timeZone);
}

// A choice's label now: a morning choice says "tomorrow" only when its edge is on another day.
function labelNow(choice, nowMs, timeZone) {
  if (!choice.morning || !Number.isFinite(nowMs)) return choice.morning ? `${choice.label} tomorrow` : choice.label;
  return daysBetween(nowMs, nextMorning(nowMs, timeZone), timeZone) === 0 ? choice.label : `${choice.label} tomorrow`;
}

function presenceChoice(id, nowMs, timeZone) {
  const clockOk = Number.isFinite(nowMs);
  const iso = (ms) => new Date(ms).toISOString();
  switch (id) {
    case 'here': return { value: 'here' };
    case 'dnd-open': return { value: 'dnd' };
    case 'away-hours': return clockOk ? { value: 'away', until: iso(nowMs + AWAY.hours * HOUR_MS) } : null;
    case 'away-evening': {
      const until = clockOk ? eveningAfter(nowMs, timeZone) : null;
      return until === null ? null : { value: 'away', until: iso(until) };
    }
    case 'away-morning': return clockOk ? { value: 'away', until: iso(nextMorning(nowMs, timeZone)) } : null;
    case 'dnd-morning': return clockOk ? { value: 'dnd', until: iso(nextMorning(nowMs, timeZone)) } : null;
    default: return null;
  }
}

// The choices drawn now: Away until the evening only while it is before then.
function presenceOffered(nowMs, timeZone) {
  return PRESENCE.filter((c) => presenceChoice(c.id, nowMs, timeZone) !== null || (!Number.isFinite(nowMs) && (c.id === 'here' || c.id === 'dnd-open')));
}

// The choice in force, by the end time's place on the clock: an away that ends at the evening
// edge is Away until 18:00, one that ends at the morning edge today or tomorrow is the morning's.
// Two hours has no mark of its own: an end time that fits none of the others is only said.
function presenceChosen(held, nowMs, timeZone) {
  if (held.value === 'here') return 'here';
  if (held.until === undefined) return held.value === 'dnd' ? 'dnd-open' : null;
  const ms = Date.parse(held.until);
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return null;
  const at = hhmmOf(ms, timeZone);
  const days = daysBetween(nowMs, ms, timeZone);
  if (held.value === 'away' && at === AWAY.evening && days === 0) return 'away-evening';
  if (at === AWAY.morning && (days === 0 || days === 1)) return held.value === 'away' ? 'away-morning' : 'dnd-morning';
  return null;
}

function sayPresence(held, nowMs, timeZone) {
  const name = held.value === 'here' ? 'Here' : held.value === 'away' ? 'Away' : 'Do not disturb';
  return held.until === undefined ? name : `${name} until ${sayUntil(held.until, nowMs, timeZone)}`;
}

// --- rows ---

// What the setting in force is: the effective entry, else the catalogue's default.
function heldOf(effective, key) {
  const found = isRecord(effective) && Object.hasOwn(effective, key) && isRecord(effective[key]) ? effective[key] : null;
  if (found) return found;
  return { value: structuredClone(SETTINGS[key].default), from: 'default' };
}

function rowOf(key, { effective, nowMs, timeZone, locked }) {
  const spec = PANE[key];
  const base = { key, label: spec.label };
  if (key === 'protection') {
    // Locked lives in the computer-wide file, which the pane doesn't read.
    const current = locked === true ? 'Locked' : locked === false ? 'Standard' : 'Ask the front desk';
    return { ...base, current, from: FROM.profile, choices: [], here: false, why: spec.why };
  }
  const held = heldOf(effective, key);
  const out = { ...base, from: FROM[held.from] ?? FROM.default };
  if (typeof held.until === 'string') out.until = held.until;
  if (spec.kind === 'presence') {
    const chosen = presenceChosen(held, nowMs, timeZone);
    const choices = presenceOffered(nowMs, timeZone).map((c) => ({ id: c.id, label: labelNow(c, nowMs, timeZone), chosen: c.id === chosen }));
    return { ...out, current: sayPresence(held, nowMs, timeZone), choices, here: true };
  }
  if (spec.kind === 'levels') {
    const choices = SETTINGS[key].levels.map((level) => ({ id: String(level), label: wordOf(key, level), chosen: level === held.value }));
    return { ...out, current: wordOf(key, held.value), choices, here: true };
  }
  const current = key === 'budget' ? wordOf(key, held.value) : sayValue(key, held.value);
  return { ...out, current, choices: [], here: false, why: spec.why };
}

// settingsRows({ effective, now, timeZone, locked? }) -> Array<SettingsRow>
// `effective` is effectiveSettings' answer; `locked` is whether the project is Locked, when the
// caller knows it. Every row is plain data. Never throws.
export function settingsRows({ effective, now = () => new Date(), timeZone, locked } = {}) {
  const context = { effective, nowMs: instantOf(now), timeZone, locked };
  return Object.keys(PANE).map((key) => rowOf(key, context));
}

// choiceOf(key, id, { now, timeZone }) -> { value, until? } | null
// The setting a choice sets, worked out now. Null for a setting that offers no choice and for an
// id that isn't offered now.
export function choiceOf(key, id, { now = () => new Date(), timeZone } = {}) {
  if (typeof key !== 'string' || typeof id !== 'string' || !Object.hasOwn(PANE, key)) return null;
  const spec = PANE[key];
  if (spec.kind === 'presence') return presenceChoice(id, instantOf(now), timeZone);
  if (spec.kind !== 'levels') return null;
  const level = SETTINGS[key].levels.find((l) => String(l) === id);
  return level === undefined ? null : { value: level };
}

// The label a choice has in its row, for the press to say.
function labelOf(key, id, value, { nowMs, timeZone }) {
  if (PANE[key].kind !== 'presence') return wordOf(key, value);
  const found = PRESENCE.find((c) => c.id === id);
  return found ? labelNow(found, nowMs, timeZone) : say(value);
}

// The settings in force for a project, from the views as the last sync left them. Settings that
// can't be read are the defaults.
export function effectiveFor({ project, now }) {
  let projectViews = {};
  let profileViews = {};
  try {
    const own = localViews(project, ['settings'])?.settings;
    if (isRecord(own)) projectViews = own;
  } catch {
    // The defaults still hold.
  }
  try {
    const profile = readProfileViews()?.settings;
    if (isRecord(profile)) profileViews = profile;
  } catch {
    // The defaults still hold.
  }
  return effectiveSettings({ project: projectViews, profile: profileViews, now });
}

// The setting event the helper made, read back from the clone it kept it in.
// It must be the setting that was pressed: the key, the value and the end time all equal, so an
// answer naming some other event signs nothing.
function eventOf(home, project, id, data) {
  if (typeof id !== 'string') return null;
  const dir = home === 'profile' ? profileDir() : stateDir(project);
  return listEvents(dir, { report: () => {} }).find((e) => e.id === id && e.kind === 'setting'
    && e.data?.key === data.key && e.data.value === data.value && e.data.until === data.until) ?? null;
}

// pressSetting({ project, key, choice, client, now, timeZone, budget })
//   -> Promise<{ made, says }>
// `made` is true once the setting is written and its confirmation signed. A setting written but
// not confirmed is not in force, and the press says it waits for the director's Confirm. Records
// nothing for a choice that isn't offered or that the catalogue refuses. Never throws.
export async function pressSetting({ project, key, choice, client, now = () => new Date(), timeZone, budget = BUDGET_MS } = {}) {
  try {
    return await press({ project, key, choice, client, now, timeZone, budget });
  } catch {
    return no(SAYS.failed);
  }
}

async function press({ project, key, choice, client, now, timeZone, budget }) {
  const clock = typeof now === 'function' ? now : () => new Date(now);
  const picked = choiceOf(key, choice, { now: clock, timeZone });
  if (picked === null) {
    // The evening edge passes while a row is open: say which choice has gone, and why.
    const past = key === 'presence' && choice === 'away-evening' && Number.isFinite(instantOf(clock));
    return no(past ? `It's past ${AWAY.evening}, so Away until ${AWAY.evening} isn't offered now` : SAYS.notOffered);
  }
  try {
    checkSetting(key, picked.value, picked.until);
  } catch (error) {
    return no(error.message);
  }
  const home = definitionOf(key).home;
  const data = { key, value: picked.value, ...(picked.until === undefined ? {} : { until: picked.until }) };
  const api = client ?? helperClient({ timeout: budget });
  const left = withinBudget(Date.now() + budget);
  let wrote = null;
  try {
    wrote = await left(home === 'profile' ? api.profile.write({ kind: 'setting', data }) : api.state.write({ project, kind: 'setting', data }));
  } catch {
    // Nothing was taken.
  }
  if (wrote?.ok !== true) {
    // A write that timed out (or whose answer never came) may still land, so it isn't said to be refused.
    if (wrote === null || wrote.refused === HELPER_LATE) return no(SAYS.late);
    return no(wrote.refused === STOP_REFUSED ? SAYS.stopOn : SAYS.notTaken);
  }

  const label = PANE[key].label;
  const waits = no(`${label} was set but not confirmed, so it waits for your Confirm`);
  const event = eventOf(home, project, wrote.id, data);
  if (event === null) return waits;
  let record;
  try {
    record = keepEarned(project, { made: confirmationFor(event), ...(home === 'profile' ? { profile: true } : {}) }, { now: clock });
  } catch {
    return waits;
  }
  let sent = false;
  try {
    sent = await sendKept(api, left, record);
  } catch {
    // Kept in pending/ for the next session start to send.
  }
  const where = home === 'profile' ? 'for all your projects' : 'for this project';
  return { made: true, says: `${label} is now ${lower(labelOf(key, choice, picked.value, { nowMs: instantOf(clock), timeZone }))}, ${where}${sent ? '' : ' (kept until the helper takes it)'}` };
}
