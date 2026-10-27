// scripts/mod/settings-pane.js
// The settings pane's rows, what a choice sets, and the press on one. The bridge hands a press
// here for the origin `pane` only. A press is both the change and the director's confirmation of
// it (design sections 9 and 14.4): the setting goes through the helper, by the setting's home, and
// the confirmation a Confirm click on its card would earn is signed, kept and sent as the prompt
// record signs it. The helper's write routes answer the new event's id, so the event is read back
// from the private record or the settings for the confirmation to name.
//
// A choice carries no time. "Away until 18:00" and "until 09:00 tomorrow" are worked out at the
// press, in the bridge's own time zone, so a row drawn before 18:00, or before midnight, can't
// carry an old time. The morning choices end at the next 09:00 to come: this morning's between
// midnight and 09:00, and then their label drops "tomorrow". The setting's `before` is the value in force when the confirmation lands,
// which the views work out from the confirmed events, so a change made in the chat meanwhile is
// the one handed back to.
//
// A row also offers Undo for UNDO_MS after its latest change was confirmed: the choice `undo`
// sets the value in force before that change, signed and confirmed as any pick is.
//
// Under STOP every pick, Undo included, records nothing and says so. Budget allocation is in the
// backlog (design section 14.1): the budget row offers no choice.
import { SETTINGS, definitionOf, checkSetting, say } from '../settings/catalogue.js';
import { effectiveSettings, sayTime, sayValue } from '../settings/effective.js';
import { AWAY, UNDO_MS } from '../lib/mod-numbers.js';
import { SETTINGS_UNDER_STOP, STOP_HALTS, ONLY_YOU_LIFT, NOTHING_TO_UNDO, TOO_LATE_TO_UNDO, awayToast } from '../lib/calm-words.js';
import { stopState as defaultStopState } from '../lib/stop.js';
import { confirmationFor, listEvents } from '../state/events.js';
import { keepEarned, sendKept } from '../hooks/prompt-record.js';
import { withinBudget, BUDGET_MS } from '../hooks/pending.js';
import { helperGrace } from '../lib/helper-grace.js';
import { localViews } from '../hooks/session-start.js';
import { readProfileViews } from '../profile/store.js';
import { helperClient } from '../host/helper-client.js';
import { stateDir, profileDir } from '../lib/paths.js';
import { PREMIUM_ON } from '../routing/premium.js';

export const ADVANCED = 'Advanced settings: ask the First Mate';
const ASK = 'Changed by asking the First Mate';
const BUDGET_WHY = 'The other budget levels come with the budget design';
// The helper's refusal under All stop, in its words before and after the ship's-crew names.
const STOP_REFUSED = new Set(['All stop is on', 'STOP is on']);
// What the helper client answers when the helper doesn't answer in time.
const HELPER_LATE = 'the host helper did not answer in time';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const SAYS = {
  notOffered: 'That choice isn\'t offered now',
  stopOn: SETTINGS_UNDER_STOP,
  nothingToUndo: NOTHING_TO_UNDO,
  tooLateToUndo: TOO_LATE_TO_UNDO,
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
  efficiency: { lightest: 'Lightest', lean: 'Lean', balanced: 'Balanced', thorough: 'Thorough' },
  usageMark: { off: 'Off', 50: 'At 50%', 65: 'At 65%', 75: 'At 75%', 90: 'At 90%' },
  budget: { report: 'Report only', 'weekly-share': 'Weekly share', 'per-feature': 'Per feature' },
  pace: { 1: '1', 2: '2', 3: '3' },
  briefing: { short: 'Short', standard: 'Standard', detailed: 'Detailed' },
  explanations: { plain: 'Plain', 'some-terms': 'Some technical terms' },
  boardTab: { director: 'Captain', build: 'Build' },
  phase: { 'before-launch': 'Before launch', launched: 'Launched' },
};
const PANE = {
  autonomy: { label: 'Autonomy', kind: 'levels' },
  showFirst: { label: 'Show before building', kind: 'levels' },
  presence: { label: 'Availability', kind: 'presence' },
  milestones: { label: 'Feature milestones', kind: 'levels' },
  efficiency: { label: 'Thoroughness', kind: 'levels' },
  premium: { label: 'Premium model', kind: 'none', why: ASK },
  budget: { label: 'Budget', kind: 'none', why: BUDGET_WHY },
  pace: { label: 'Crew at once', kind: 'levels' },
  briefing: { label: 'Briefing length', kind: 'levels' },
  briefingGapHours: { label: 'Hours before a new briefing', kind: 'none', why: ASK },
  explanations: { label: 'Explanations', kind: 'levels' },
  notifications: { label: 'Notifications', kind: 'none', why: ASK },
  usageMark: { label: 'Usage nudge', kind: 'levels' },
  boardTab: { label: 'Logbook opens on', kind: 'levels' },
  hours: { label: 'Working hours', kind: 'none', why: ASK },
  phase: { label: 'Product phase', kind: 'levels' },
  protection: { label: 'Protection', kind: 'none', why: ASK },
};

// Thoroughness levels whose columns are ready whatever the state says; Lean and Lightest are
// ready only when the state's `column-ready` list holds them.
const ALWAYS_READY = ['balanced', 'thorough'];
const isReady = (level, ready) => ALWAYS_READY.includes(level) || (Array.isArray(ready) && ready.includes(level));
const NOT_READY = 'not ready yet';
const LIGHTEST_NOTE = 'Lightest: the lighter model also designs and checks risky work, so mistakes are likelier to slip through. Every check still runs.';

// Whether the Premium model row shows (design section 14.6): never on an account the helper's check found without the
// model, and otherwise at Thorough, where its card is offered, or while it is allowed. `view` is the project's
// `premium` view (premiumViewOf), null when there is none to read.
export function premiumRowShown(view, level) {
  if (isRecord(view) && view.absent === true) return false;
  return level === 'thorough' || PREMIUM_ON.includes(view?.value);
}

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

function rowOf(key, { effective, changes, nowMs, timeZone, locked, ready }) {
  const spec = PANE[key];
  const base = { key, label: spec.label };
  if (key === 'protection') {
    // Locked lives in the computer-wide file, which the pane doesn't read.
    const current = locked === true ? 'Locked' : locked === false ? 'Standard' : 'Ask the First Mate';
    return { ...base, current, from: FROM.profile, choices: [], here: false, why: spec.why };
  }
  const held = heldOf(effective, key);
  const out = { ...base, from: FROM[held.from] ?? FROM.default };
  if (undoOf(key, changes, nowMs) !== null) out.changed = { at: changes[key].at, undo: true };
  if (typeof held.until === 'string') out.until = held.until;
  if (spec.kind === 'presence') {
    const chosen = presenceChosen(held, nowMs, timeZone);
    const choices = presenceOffered(nowMs, timeZone).map((c) => ({ id: c.id, label: labelNow(c, nowMs, timeZone), chosen: c.id === chosen }));
    return { ...out, current: sayPresence(held, nowMs, timeZone), choices, here: true };
  }
  if (spec.kind === 'levels') {
    const choices = SETTINGS[key].levels.map((level) => ({
      id: String(level),
      label: key === 'efficiency' && !isReady(level, ready) ? `${wordOf(key, level)}: ${NOT_READY}` : wordOf(key, level),
      chosen: level === held.value,
    }));
    return { ...out, current: wordOf(key, held.value), choices, here: true };
  }
  const current = key === 'budget' ? wordOf(key, held.value) : sayValue(key, held.value);
  return { ...out, current, choices: [], here: false, why: spec.why };
}

// --- the groups ---

const PROJECT_NOTE = 'Only for this project. A pick changes it at once and counts as your confirmation; Undo stays for a minute. Protection and build commands need your password or a careful yes, so the First Mate asks for them.';
const YOU_NOTE = 'These follow you to every project. Notifications and working hours are changed with the First Mate, which checks them with you.';
const WINDOWS_LEVELS = { ask: 'Ask', guarded: 'Guarded', unattended: 'Unattended' };
// The settings the front desk changes: a value and Change….
const CHANGE_KEYS = ['protection', 'premium', 'briefingGapHours', 'notifications', 'hours'];

// A pane row as a group's row: a select for a setting with levels, a change for one the front desk
// changes, else a value alone. `changed` goes with it while the change can still be undone.
function groupRow(row) {
  const out = { key: row.key, label: row.label };
  if (row.here) {
    const chosen = row.choices.find((c) => c.chosen);
    Object.assign(out, { value: chosen ? chosen.id : null, kind: 'select', options: row.choices.map((c) => ({ value: c.id, label: c.label })) });
    if (!chosen) out.current = row.current;
  } else {
    Object.assign(out, { value: row.current, kind: CHANGE_KEYS.includes(row.key) ? 'change' : 'value' });
  }
  if (row.changed) out.changed = row.changed;
  return out;
}

// settingsGroups({ effective, changes?, now, timeZone, locked?, stop?, windows? }) -> Array<Group>
// The Settings view's groups, each { id, title, note, rows }, in the order of design section
// 23.6. `stop` is stopState's answer (Halted since the time it was set, else Working); `windows`
// is the level this computer runs build commands at. Every row is plain data. Never throws.
// `premium` is the project's premium view: its row shows as premiumRowShown says, with "(not in use at <level>)" after
// its value while it is allowed below Thorough.
export function settingsGroups({ effective, changes, now = () => new Date(), timeZone, locked, stop, windows, ready, premium } = {}) {
  const byKey = new Map(settingsRows({ effective, changes, now, timeZone, locked, ready }).map((row) => [row.key, groupRow(row)]));
  const level = heldOf(effective, 'efficiency').value ?? 'balanced';
  const premiumShown = premiumRowShown(premium, level);
  const premiumRow = byKey.get('premium');
  if (premiumShown && premiumRow && PREMIUM_ON.includes(heldOf(effective, 'premium').value) && level !== 'thorough') {
    byKey.set('premium', { ...premiumRow, value: `${premiumRow.value} (not in use at ${wordOf('efficiency', level)})` });
  }
  const pick = (...keys) => keys.map((key) => byKey.get(key));
  const halted = isRecord(stop) && stop.on === true;
  const sinceMs = halted && typeof stop.at === 'string' ? Date.parse(stop.at) : NaN;
  const builders = !halted ? 'Working' : Number.isFinite(sinceMs) ? `Halted since ${hhmmOf(sinceMs, timeZone)}` : 'Halted';
  const build = { key: 'windowsBuildCommands', label: 'Build commands on Windows', value: WINDOWS_LEVELS[windows] ?? WINDOWS_LEVELS.ask, kind: 'change' };
  return [
    { id: 'stop', title: 'All stop', note: `All stop ${lower(STOP_HALTS)} ${ONLY_YOU_LIFT}`, rows: [{ key: 'builders', label: 'Crew', value: builders, kind: 'value' }] },
    {
      id: 'project',
      title: 'This project',
      note: heldOf(effective, 'efficiency').value === 'lightest' ? `${PROJECT_NOTE} ${LIGHTEST_NOTE}` : PROJECT_NOTE,
      rows: [...pick('autonomy', 'showFirst', 'milestones', 'pace', 'efficiency', ...(premiumShown ? ['premium'] : []), 'phase'), build, ...pick('budget', 'protection')],
    },
    {
      id: 'you',
      title: 'You, in every project',
      note: YOU_NOTE,
      rows: pick('presence', 'briefing', 'briefingGapHours', 'explanations', 'usageMark', 'boardTab', 'notifications', 'hours'),
    },
    { id: 'advanced', title: 'Advanced settings', note: '', rows: [{ key: 'advanced', label: 'Advanced settings', value: '', kind: 'change' }] },
  ];
}

// settingsRows({ effective, changes?, now, timeZone, locked? }) -> Array<SettingsRow>
// `effective` is effectiveSettings' answer; `changes` is changesFor's, which gives a row
// `changed: { at, undo: true }` while its latest change can still be undone; `locked` is whether
// the project is Locked, when the caller knows it. Every row is plain data. Never throws.
export function settingsRows({ effective, changes, now = () => new Date(), timeZone, locked, ready } = {}) {
  const context = { effective, changes, nowMs: instantOf(now), timeZone, locked, ready };
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

// The latest confirmed change of each setting that has a home in the views, for the pane's
// Undo: { [key]: { at, before } }, where `at` is when the change was confirmed and `before` the
// value it replaced (null when it replaced none). A setting is read from the view of its home.
export function changesFor({ project }) {
  const views = { project: {}, profile: {} };
  try {
    const own = localViews(project, ['settings'])?.settings;
    if (isRecord(own)) views.project = own;
  } catch {
    // No change can be undone.
  }
  try {
    const profile = readProfileViews()?.settings;
    if (isRecord(profile)) views.profile = profile;
  } catch {
    // No change can be undone.
  }
  const out = {};
  for (const key of Object.keys(PANE)) {
    if (!Object.hasOwn(SETTINGS, key)) continue;
    const view = views[definitionOf(key).home];
    const entry = Object.hasOwn(view, key) && isRecord(view[key]) ? view[key] : null;
    if (entry !== null && typeof entry.confirmedAt === 'string') out[key] = { at: entry.confirmedAt, before: isRecord(entry.before) ? entry.before : null };
  }
  return out;
}

// What Undo would set for a setting at `nowMs`: { value, until? }, or null when its latest change
// was confirmed UNDO_MS or more ago, or isn't known, or the setting offers no choice. A value
// that had ended, or none before, is the catalogue's default.
function undoOf(key, changes, nowMs) {
  if (!isRecord(changes) || !Object.hasOwn(changes, key) || !Object.hasOwn(PANE, key) || !['levels', 'presence'].includes(PANE[key].kind)) return null;
  const { at, before } = changes[key] ?? {};
  const age = nowMs - Date.parse(at);
  if (!Number.isFinite(age) || age >= UNDO_MS || age <= -UNDO_MS) return null;
  const live = isRecord(before) && (before.until === undefined || Date.parse(before.until) > nowMs);
  return live ? { value: structuredClone(before.value), ...(before.until === undefined ? {} : { until: before.until }) } : { value: structuredClone(SETTINGS[key].default) };
}

// Whether a setting that offers Undo has a change confirmed UNDO_MS or more before `nowMs`: an
// Undo pressed then is too late, not one with nothing to undo.
function undoPast(key, changes, nowMs) {
  if (!isRecord(changes) || !Object.hasOwn(changes, key) || !Object.hasOwn(PANE, key) || !['levels', 'presence'].includes(PANE[key].kind)) return false;
  return nowMs - Date.parse(changes[key]?.at) >= UNDO_MS;
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

// pressSetting({ project, key, choice, client, now, timeZone, budget, changes, stopState })
//   -> Promise<{ made, says }>
// `ready` is the Thoroughness levels whose columns are ready beyond Balanced and Thorough.
// `choice` is a choice's id, or `undo`, which sets the value in force before the row's latest
// change while that change is under UNDO_MS old (`changes` is changesFor's answer, read from the
// views when not given); pressed later, it says it is too late.
// `made` is true once the setting is written and its confirmation signed. A setting written but
// not confirmed is not in force, and the press says it waits for the director's Confirm. Records
// nothing for a choice that isn't offered or that the catalogue refuses. Never throws.
export async function pressSetting({ project, key, choice, client, now = () => new Date(), timeZone, budget = BUDGET_MS + helperGrace(), changes, stopState = defaultStopState, ready } = {}) {
  try {
    return await press({ project, key, choice, client, now, timeZone, budget, changes, stopState, ready });
  } catch {
    return no(SAYS.failed);
  }
}

async function press({ project, key, choice, client, now, timeZone, budget, changes, stopState, ready }) {
  const clock = typeof now === 'function' ? now : () => new Date(now);
  if (stopState().on) return no(SAYS.stopOn);
  const undoing = choice === 'undo';
  const known = undoing ? changes ?? changesFor({ project }) : null;
  const picked = undoing ? undoOf(key, known, instantOf(clock)) : choiceOf(key, choice, { now: clock, timeZone });
  if (picked === null && undoing) return no(undoPast(key, known, instantOf(clock)) ? SAYS.tooLateToUndo : SAYS.nothingToUndo);
  if (picked === null) {
    // The evening edge passes while a row is open: say which choice has gone, and why.
    const past = key === 'presence' && choice === 'away-evening' && Number.isFinite(instantOf(clock));
    return no(past ? `It's past ${AWAY.evening}, so Away until ${AWAY.evening} isn't offered now` : SAYS.notOffered);
  }
  if (key === 'efficiency' && !isReady(picked.value, ready)) return no(`${wordOf(key, picked.value)} isn't ready yet, so Thoroughness stays as it is`);
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
    return no(STOP_REFUSED.has(wrote.refused) ? SAYS.stopOn : SAYS.notTaken);
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
  if (key === 'presence') {
    const said = awayToast(sayPresence(picked, instantOf(clock), timeZone), !undoing);
    return { made: true, says: sent ? said : `${said} (kept until the helper takes it)` };
  }
  const where = home === 'profile' ? 'for all your projects' : 'for this project';
  return { made: true, says: `${label} is now ${lower(labelOf(key, choice, picked.value, { nowMs: instantOf(clock), timeZone }))}, ${where}${sent ? '' : ' (kept until the helper takes it)'}` };
}
