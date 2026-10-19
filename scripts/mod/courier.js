// scripts/mod/courier.js
// Which needs-you items wake the front desk, once each across every session, by the director's
// presence and quiet hours (design section 13). The bridge's front-desk tick finds the items in
// the pane's model and hands back the wake as the tick's `submit`. What has been sent is kept in
// projects/<project>/mod/courier.json, under a start lock, so two front desks of one project wake
// once for an item, with the sessions that have ticked, so a session's first tick is known. The
// wake carries counts and card numbers, never an event's words.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';
import { takeStartLock } from '../lib/start-lock.js';
import { COURIER_GAP_MS, LEADS, STALE_TICKS, TICK_MS } from '../lib/mod-numbers.js';
import { hashOf } from './status.js';

// How many sent ids courier.json keeps, beside every one still among the current items.
export const SENT_KEPT = 500;
// How long a tick waits for another session's courier before leaving its items for the next tick.
export const LOCK_WAIT_MS = 500;
// How many sessions courier.json remembers, the latest to tick last.
export const SESSIONS_KEPT = 20;
const BUSY = 'The courier is busy in another session';
// A courier.json larger than this reads as nothing sent.
const FILE_BYTES = 1024 * 1024;
const ASK = 'Ask any new cards now, once, then send Claude\'s notification in one line.';
// The items that wake at once, inside the gap after the last wake.
const AT_ONCE = ['stop', 'incident'];

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value.filter(isRecord) : []);

// What each presence lets wake the front desk. Inside the quiet hours, as do not disturb.
export const PRESENCE_LETS = Object.freeze({
  here: () => true,
  away: (item) => ['stop', 'incident', 'health'].includes(item.kind) || (item.kind === 'card' && item.blocking === true),
  dnd: (item) => AT_ONCE.includes(item.kind),
});

// projects/<project>/mod/courier.json; stateDir refuses a name that is not a folder name.
export function courierFile(project) {
  return path.join(stateDir(project), '..', 'mod', 'courier.json');
}

// needsYou({ after }) -> the needs-you items the pane's model `after` holds now, each with an id
// that names it across ticks and sessions: STOP turned on (`stop:<since>`, only when its time can
// be read), an open incident, a health line at its stop level (`health:<hash of its text>`) that
// isn't STOP's or an incident's own, each waiting card the front desk hasn't asked (`card:<id>`,
// with its number and whether it blocks) and each finished feature. What has been woken for is
// courier.json's to say, so an item held back wakes on a later tick; the model as last kept isn't
// needed.
export function needsYou({ after } = {}) {
  if (!isRecord(after)) return [];
  const items = [];
  const since = after.stop?.since;
  if (after.stop?.on === true && typeof since === 'string' && Number.isFinite(Date.parse(since))) items.push({ id: `stop:${since}`, kind: 'stop' });
  for (const id of Array.isArray(after.incidents) ? after.incidents : []) {
    if (typeof id === 'string' && id !== '') items.push({ id: `incident:${id}`, kind: 'incident' });
  }
  for (const line of list(after.health)) {
    // STOP's and an incident's own lines wake as STOP and the incident, once.
    if (line.level === 'stop' && typeof line.text === 'string' && line.of !== 'stop' && line.of !== 'incident') {
      items.push({ id: `health:${hashOf(line.text)}`, kind: 'health' });
    }
  }
  // A card the front desk has asked has reached the director already (a question from the build
  // is never asked until its card is made).
  for (const card of list(after.cards)) {
    if (typeof card.id === 'string' && Number.isInteger(card.n) && card.asked !== true) items.push({ id: `card:${card.id}`, kind: 'card', n: card.n, blocking: card.blocking === true });
  }
  for (const work of Array.isArray(after.finished) ? after.finished : []) {
    if (typeof work === 'string' && work !== '') items.push({ id: `finished:${work}`, kind: 'finished' });
  }
  const seen = new Set();
  return items.filter((item) => !seen.has(item.id) && seen.add(item.id));
}

const instantOf = (now) => {
  const value = typeof now === 'function' ? now() : now;
  return (value instanceof Date ? value : new Date(value ?? Number.NaN)).getTime();
};

const isSession = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200;

// The minutes past midnight at `ms` in the time zone, or in UTC when the zone isn't known.
function minutesAt(ms, timeZone) {
  let format;
  try {
    format = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
  } catch {
    format = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesOf = (hhmm) => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// Whether `ms` falls inside the quiet hours { from, to } (HH:MM, the computer's own time), which
// may run past midnight. The hours start at `from` and have ended at `to`.
export function inQuietHours(quiet, ms, timeZone) {
  const from = minutesOf(quiet?.from);
  const to = minutesOf(quiet?.to);
  if (from === null || to === null || from === to || !Number.isFinite(ms)) return false;
  const t = minutesAt(ms, timeZone);
  return from < to ? t >= from && t < to : t >= from || t < to;
}

// The presence in force: `here`, `away` or `dnd`. One whose end time has passed counts as here;
// an end time that can't be read leaves it as it is. Inside the quiet hours, as do not disturb.
function presenceAt(presence, quiet, ms, timeZone) {
  let value = Object.hasOwn(PRESENCE_LETS, presence?.value) ? presence.value : 'here';
  const until = typeof presence?.until === 'string' ? Date.parse(presence.until) : Number.NaN;
  if (Number.isFinite(until) && Number.isFinite(ms) && ms >= until) value = 'here';
  return inQuietHours(quiet, ms, timeZone) ? 'dnd' : value;
}

// What courier.json keeps, or nothing sent when it isn't there or can't be read.
function readKept(project) {
  try {
    const file = courierFile(project);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > FILE_BYTES) return { sent: [], lastWakeAt: null, sessions: [] };
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      sent: list(kept?.sent).filter((s) => typeof s.id === 'string'),
      lastWakeAt: typeof kept?.lastWakeAt === 'string' ? kept.lastWakeAt : null,
      sessions: list(kept?.sessions).filter((s) => isSession(s.id) && typeof s.at === 'string'),
    };
  } catch {
    return { sent: [], lastWakeAt: null, sessions: [] };
  }
}

// Writes courier.json whole through a temporary file. The sent ids keep their order, each once,
// cut to the last SENT_KEPT, except that every id still among the current items is kept, so a
// long-standing item (a feature finished long ago) never wakes again.
function writeKept(project, { sent, lastWakeAt, sessions }, current) {
  const latest = new Map();
  for (const entry of sent) {
    latest.delete(entry.id);
    latest.set(entry.id, entry);
  }
  const entries = [...latest.values()];
  const kept = entries.filter((e, i) => current.has(e.id) || i >= entries.length - SENT_KEPT);
  const file = courierFile(project);
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify({ sent: kept, lastWakeAt, sessions })}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const andList = (words) => (words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

// The wake's words: counts, card numbers and fixed words only.
function whatOf(items) {
  const count = (kind) => items.filter((i) => i.kind === kind).length;
  const numbers = [...new Set(items.filter((i) => i.kind === 'card').map((i) => i.n))].sort((a, b) => a - b);
  const parts = [];
  if (numbers.length > 0) parts.push(`${plural(numbers.length, 'new card', 'new cards')} (${andList(numbers.map(String))})`);
  if (count('stop') > 0) parts.push('STOP is on');
  if (count('incident') > 0) parts.push(`${plural(count('incident'), 'incident', 'incidents')} open`);
  if (count('health') > 0) parts.push(`${plural(count('health'), 'health line', 'health lines')} at its stop level`);
  if (count('finished') > 0) parts.push(`${plural(count('finished'), 'feature', 'features')} finished`);
  return parts.join('; ');
}

const NOTHING = Object.freeze({ submit: null, sent: [] });

// courierWake({ project, session, items, presence, quiet, idle, now, timeZone }) -> { submit, sent }.
// `session` is the ticking session's id; `items` are needsYou's; `presence` the effective
// presence ({ value, until }); `quiet` the notifications' quiet hours ({ from, to }); `idle` false
// while a turn runs; `timeZone` the computer's own.
//
// A session's first tick (an id courier.json hasn't seen) is its opening: the director has just
// opened it, and the visit asks what waits, so nothing wakes. It marks every item sent, unless
// another session ticked within STALE_TICKS ticks: that one is still waking for what it found, so
// a second front desk's opening marks nothing and leaves those items to the next tick.
//
// Otherwise the items not yet sent that the presence lets through make one wake, unless a turn
// runs or the last wake was under COURIER_GAP_MS ago (STOP and an incident wake inside the gap);
// then nothing is marked sent and they wait for the next tick, however long until it comes.
// `sent` names the items marked sent by this call: each once the wake that carries it is handed
// back. Another session holding courier.json past LOCK_WAIT_MS is a quiet wait for the next tick.
// Throws when courier.json can't be kept, so nothing is lost.
export async function courierWake({ project, session, items, presence, quiet, idle, now = () => new Date(), timeZone } = {}) {
  const t = instantOf(now);
  if (!Number.isFinite(t) || !isSession(session)) return NOTHING;
  const found = list(items).filter((i) => typeof i.id === 'string');
  let release;
  try {
    release = await takeStartLock(`${courierFile(project)}.lock`, { message: BUSY, waitMs: LOCK_WAIT_MS });
  } catch (error) {
    if (error?.message === BUSY) return NOTHING;
    throw error;
  }
  try {
    const kept = readKept(project);
    const stamp = new Date(t).toISOString();
    const opening = !kept.sessions.some((s) => s.id === session);
    const othersTicking = kept.sessions.some((s) => s.id !== session && t - Date.parse(s.at) <= STALE_TICKS * TICK_MS);
    const sessions = [...kept.sessions.filter((s) => s.id !== session), { id: session, at: stamp }].slice(-SESSIONS_KEPT);
    const sentIds = new Set(kept.sent.map((s) => s.id));
    const current = new Set(found.map((i) => i.id));
    const fresh = found.filter((i) => !sentIds.has(i.id) && sentIds.add(i.id));
    const mark = (marked, lastWakeAt) => writeKept(project, { sent: [...kept.sent, ...marked.map((i) => ({ id: i.id, at: stamp }))], lastWakeAt, sessions }, current);

    if (opening) {
      const marked = othersTicking ? [] : fresh;
      mark(marked, kept.lastWakeAt);
      return { submit: null, sent: marked.map((i) => i.id) };
    }
    const lets = PRESENCE_LETS[presenceAt(presence, quiet, t, timeZone)];
    const waking = fresh.filter((i) => lets(i));
    const last = kept.lastWakeAt === null ? Number.NaN : Date.parse(kept.lastWakeAt);
    const sinceLast = t - last;
    const inGap = Number.isFinite(sinceLast) && sinceLast >= 0 && sinceLast < COURIER_GAP_MS;
    if (waking.length === 0 || idle !== true || (inGap && !waking.some((i) => AT_ONCE.includes(i.kind)))) {
      // Only that this session ticked is kept.
      mark([], kept.lastWakeAt);
      return NOTHING;
    }
    mark(waking, stamp);
    return { submit: `${LEADS.courier} ${whatOf(waking)}. ${ASK}`, sent: waking.map((i) => i.id) };
  } finally {
    release();
  }
}
