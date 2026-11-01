// scripts/mod/courier.js
// Which needs-you items wake the front desk, once each across every session, by the director's
// presence and quiet hours (design section 13). The bridge's front-desk tick finds the items in
// the pane's model and hands back the wake as the tick's `submit`. What has been sent is kept in
// projects/<project>/mod/courier.json, under a start lock, so two front desks of one project wake
// once for an item, with the sessions that have ticked, so a session's first tick is known. A wake
// the mod couldn't hand on is undone by courierUnsent, so the next tick wakes for it again. A card
// a wake named that still waits unasked REMIND_MS later wakes once more, as its reminder (ruling
// 68). The wake carries counts and card numbers, never an event's words.
//
// A wake is two texts. The prompt the mod submits is one plain line for the director, who sees it in
// the chat ("Wheelhouse: 1 waiting on you: card 2."); the instructions for the front desk are kept in
// courier.json beside it, and board-context.js hands them to the front desk as hidden context when
// that line arrives (courierContext), so no agent is spoken to in front of the director.
//
// courier.json also keeps the desk's watch cursor beside the sent ids (courierCursor): each tick the
// bridge asks the desk for the changes since it (a card added, All stop, a notice) and the wake keeps
// the cursor the desk gave back. What wakes is still decided from the pane's model and the sent ids,
// which also carry what a change alone doesn't: a card's number, whether it blocks or was asked, a
// wake held back by a running turn or the gap, and a reminder that comes due with no change at all.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';
import { takeStartLock } from '../lib/start-lock.js';
import { COURIER_GAP_MS, LEADS, REMIND_MS, STALE_TICKS, TICK_MS } from '../lib/mod-numbers.js';
import { hashOf } from './status.js';
import { NOTIFICATION_TITLE, NOTIFICATION_TITLE_STOP, STOP_NOTIFICATION, waitingOnYou } from '../lib/calm-words.js';

// How many sent ids courier.json keeps, beside every one still among the current items.
export const SENT_KEPT = 500;
// How long a tick waits for another session's courier before leaving its items for the next tick.
export const LOCK_WAIT_MS = 500;
// How many sessions courier.json remembers, the latest to tick last.
export const SESSIONS_KEPT = 20;
const BUSY = 'The courier is busy in another session';
// A courier.json larger than this reads as nothing sent.
const FILE_BYTES = 1024 * 1024;
// A watch cursor longer than this isn't kept.
const CURSOR_CHARS = 64 * 1024;
// The notification first, in its exact words and title: in Desktop the cards wait for the
// director's answer, so a notification sent after them would reach the phone only once the
// director had answered.
const SEND = (title, saying) => `Send Claude's notification in one line, titled "${title}", saying: ${saying}`;
const ASK = 'Then ask any new cards now, once.';
// A reminder's ask: the cards it names weren't asked at their wake (its notification wasn't sent),
// so they are asked now, whatever the notification answers this time.
const REMIND_ASK = (cards) => `Then ask ${cards === 1 ? 'it' : 'them'} now, once.`;
// A goal's ending, in set words, as everything a wake says is.
const GOAL_STOPPED = 'A goal stopped early';
const GOAL_FINISHED = 'A goal finished';
// The items that wake at once, inside the gap after the last wake.
const AT_ONCE = ['stop', 'incident'];

// How long after a wake its line still brings its instructions, and how many wakes are kept for it.
export const WAKE_CONTEXT_MS = 10 * 60 * 1000;
const WAKES_KEPT = 20;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value.filter(isRecord) : []);

// What each presence lets wake the front desk. Inside the quiet hours, as do not disturb.
export const PRESENCE_LETS = Object.freeze({
  here: () => true,
  away: (item) => ['stop', 'incident', 'health', 'goal-stopped'].includes(item.kind) || (['card', 'remind'].includes(item.kind) && item.blocking === true),
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
// with its number and whether it blocks), passing over one the day's budget holds back, each finished feature and the latest goal's ending. What has been woken for is
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
    if (typeof card.id === 'string' && Number.isInteger(card.n) && card.asked !== true && card.heldBack !== true) items.push({ id: `card:${card.id}`, kind: 'card', n: card.n, blocking: card.blocking === true });
  }
  for (const work of Array.isArray(after.finished) ? after.finished : []) {
    if (typeof work === 'string' && work !== '') items.push({ id: `finished:${work}`, kind: 'finished' });
  }
  // A goal's ending (unattended goals design, section 11): one that stopped early passes Away, as a blocking card does; one that
  // finished wakes only while the director is here, and otherwise waits in the briefing.
  const goal = after.goalEnd;
  if (typeof goal?.id === 'string' && goal.id !== '') items.push({ id: `goal:${goal.id}`, kind: goal.stoppedEarly === true ? 'goal-stopped' : 'goal-finished' });
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

// How many First Mate sessions have ticked for `project` lately: those the phone can reach, and that can stop a goal from it.
export function sessionsTicking(project, { now = () => new Date() } = {}) {
  const t = instantOf(now);
  return readKept(project).sessions.filter((s) => t - Date.parse(s.at) <= STALE_TICKS * TICK_MS).length;
}

// What courier.json keeps, or nothing sent when it isn't there or can't be read.
function readKept(project) {
  try {
    const file = courierFile(project);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > FILE_BYTES) return { sent: [], lastWakeAt: null, sessions: [], wakes: [], cursor: null };
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      sent: list(kept?.sent).filter((s) => typeof s.id === 'string'),
      lastWakeAt: typeof kept?.lastWakeAt === 'string' ? kept.lastWakeAt : null,
      sessions: list(kept?.sessions).filter((s) => isSession(s.id) && typeof s.at === 'string'),
      wakes: list(kept?.wakes).filter((w) => isSession(w.session) && typeof w.at === 'string' && typeof w.line === 'string' && typeof w.context === 'string'),
      cursor: typeof kept?.cursor === 'string' && kept.cursor.length <= CURSOR_CHARS ? kept.cursor : null,
    };
  } catch {
    return { sent: [], lastWakeAt: null, sessions: [], wakes: [], cursor: null };
  }
}

// courierCursor(project) -> the desk's watch cursor courier.json keeps, or null. Read without the
// lock: courier.json is replaced whole, and a cursor read twice gives its changes again, never fewer.
export function courierCursor(project) {
  return readKept(project).cursor;
}

// Writes courier.json whole through a temporary file. The sent ids keep their order, each once,
// cut to the last SENT_KEPT, except that every id still among the current items is kept, so a
// long-standing item (a feature finished long ago) never wakes again.
function writeKept(project, { sent, lastWakeAt, sessions, wakes = [], cursor = null }, current) {
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
    fs.writeFileSync(temp, `${JSON.stringify({ sent: kept, lastWakeAt, sessions, wakes: wakes.slice(-WAKES_KEPT), ...(typeof cursor === 'string' && cursor.length <= CURSOR_CHARS ? { cursor } : {}) })}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const andList = (words) => (words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

const numbersOf = (items, kind) => [...new Set(items.filter((i) => i.kind === kind).map((i) => i.n))].sort((a, b) => a - b);

// The wake's words: counts, card numbers and fixed words only.
function whatOf(items) {
  const count = (kind) => items.filter((i) => i.kind === kind).length;
  const numbers = numbersOf(items, 'card');
  const still = numbersOf(items, 'remind');
  const parts = [];
  if (numbers.length > 0) parts.push(`${plural(numbers.length, 'new card', 'new cards')} (${andList(numbers.map(String))})`);
  if (still.length > 0) parts.push(`${still.length === 1 ? 'card' : 'cards'} ${andList(still.map(String))} ${still.length === 1 ? 'is' : 'are'} still waiting`);
  if (count('stop') > 0) parts.push('All stop is on');
  if (count('incident') > 0) parts.push(`${plural(count('incident'), 'incident', 'incidents')} open`);
  if (count('health') > 0) parts.push(`${plural(count('health'), 'health line', 'health lines')} at its stop level`);
  if (count('finished') > 0) parts.push(`${plural(count('finished'), 'feature', 'features')} finished`);
  if (count('goal-stopped') > 0) parts.push(GOAL_STOPPED.toLowerCase());
  if (count('goal-finished') > 0) parts.push(GOAL_FINISHED.toLowerCase());
  return parts.join('; ');
}

// What the notification says, counts and card numbers only: STOP's own words when STOP wakes,
// otherwise the cards waiting on the director, then any incident, health line or finished feature.
function sayingOf(items) {
  const count = (kind) => items.filter((i) => i.kind === kind).length;
  if (count('stop') > 0) return STOP_NOTIFICATION;
  const cards = [...new Set([...numbersOf(items, 'card'), ...numbersOf(items, 'remind')])].sort((a, b) => a - b);
  const parts = [];
  if (cards.length > 0) parts.push(waitingOnYou(cards));
  if (count('incident') > 0) parts.push(`${plural(count('incident'), 'incident', 'incidents')} open.`);
  if (count('health') > 0) parts.push(`${plural(count('health'), 'health line', 'health lines')} at its stop level.`);
  if (count('finished') > 0) parts.push(`${plural(count('finished'), 'feature', 'features')} finished.`);
  if (count('goal-stopped') > 0) parts.push(`${GOAL_STOPPED}.`);
  if (count('goal-finished') > 0) parts.push(`${GOAL_FINISHED}.`);
  return parts.join(' ');
}

// The line the director sees: what the notification says, under the Wheelhouse name. Under STOP, that All stop is
// on, with the cards waiting, since STOP's notification tells them to open Claude, where they are.
function lineOf(items) {
  if (!items.some((i) => i.kind === 'stop')) return `${LEADS.wake} ${sayingOf(items)}`;
  const cards = [...new Set([...numbersOf(items, 'card'), ...numbersOf(items, 'remind')])].sort((a, b) => a - b);
  return `${LEADS.wake} All stop is on.${cards.length > 0 ? ` ${waitingOnYou(cards)}` : ''}`;
}

const NOTHING = Object.freeze({ submit: null, sent: [] });

// courierWake({ project, session, items, presence, quiet, idle, now, timeZone, cursor }) -> { submit, context?, sent, at? }.
// `submit` is the line the director sees; `context` the front desk's instructions, kept with it in courier.json.
// `session` is the ticking session's id; `items` are needsYou's; `presence` the effective
// presence ({ value, until }); `quiet` the notifications' quiet hours ({ from, to }); `idle` false
// while a turn runs; `timeZone` the computer's own; `cursor` the desk's watch cursor this tick's changes
// came with, kept in courier.json in place of the last (the one kept stays when none is given).
//
// A session's first tick (an id courier.json hasn't seen) is its opening: the director has just
// opened it, and the visit asks what waits, so nothing wakes. It marks every item sent, unless
// another session ticked within STALE_TICKS ticks: that one is still waking for what it found, so
// a second front desk's opening marks nothing and leaves those items to the next tick.
//
// Otherwise the items not yet sent that the presence lets through make one wake, unless a turn
// runs or the last wake was under COURIER_GAP_MS ago (STOP and an incident wake inside the gap);
// then nothing is marked sent and they wait for the next tick, however long until it comes.
// A card item a wake marked (not an opening), still among the items (so not yet asked, nor set
// aside), is due its reminder (`remind:<card id>`) REMIND_MS after that wake, once; it is let
// through, held and marked as a new item is, and its wake asks for the cards whatever the
// notification answers. While STOP is among the items no reminder is due, since under STOP the
// front desk asks only Lift STOP; it is due again once STOP is lifted. A build question no card
// asks yet (`card:q:<question id>`) has its reminder too, since its wake may have asked nothing
// (ruling 72): the reminder's `cards` makes its card when it can. STOP and an incident have none.
// `sent` names the items marked sent by this call: each once the wake that carries it is handed
// back. A wake's marks name its session, its stamp (`at`, handed back with the wake) and the
// lastWakeAt before it, so courierUnsent can put them back. Another session holding courier.json
// past LOCK_WAIT_MS is a quiet wait for the next tick. Throws when courier.json can't be kept, so
// nothing is lost.
export async function courierWake({ project, session, items, presence, quiet, idle, now = () => new Date(), timeZone, cursor } = {}) {
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
    // The latest mark of each id is the one in force, as writeKept keeps it.
    const marks = new Map(kept.sent.map((entry) => [entry.id, entry]));
    const sentIds = new Set(marks.keys());
    const reminders = found.filter((i) => i.kind === 'card').map((i) => ({ item: i, id: `remind:${i.id.slice('card:'.length)}` }));
    const stopped = found.some((i) => i.kind === 'stop');
    const current = new Set([...found.map((i) => i.id), ...reminders.map((r) => r.id)]);
    const fresh = found.filter((i) => !sentIds.has(i.id) && sentIds.add(i.id));
    const due = reminders.filter(({ item, id }) => {
      const woke = marks.get(item.id);
      return !stopped && !sentIds.has(id) && isSession(woke?.by) && t - Date.parse(woke.at) >= REMIND_MS;
    }).map(({ item, id }) => ({ id, kind: 'remind', n: item.n, blocking: item.blocking }));
    const mark = (marked, lastWakeAt, woke = {}, wake = null) => writeKept(project, {
      sent: [...kept.sent, ...marked.map((i) => ({ id: i.id, at: stamp, ...woke }))], lastWakeAt, sessions, wakes: wake === null ? kept.wakes : [...kept.wakes, wake],
      cursor: typeof cursor === 'string' ? cursor : kept.cursor,
    }, current);

    if (opening) {
      const marked = othersTicking ? [] : fresh;
      mark(marked, kept.lastWakeAt);
      return { submit: null, sent: marked.map((i) => i.id) };
    }
    const lets = PRESENCE_LETS[presenceAt(presence, quiet, t, timeZone)];
    const waking = [...fresh, ...due].filter((i) => lets(i));
    const last = kept.lastWakeAt === null ? Number.NaN : Date.parse(kept.lastWakeAt);
    const sinceLast = t - last;
    const inGap = Number.isFinite(sinceLast) && sinceLast >= 0 && sinceLast < COURIER_GAP_MS;
    if (waking.length === 0 || idle !== true || (inGap && !waking.some((i) => AT_ONCE.includes(i.kind)))) {
      // Only that this session ticked is kept.
      mark([], kept.lastWakeAt);
      return NOTHING;
    }
    const reminding = waking.some((i) => i.kind === 'remind');
    const ask = reminding ? REMIND_ASK([...numbersOf(waking, 'card'), ...numbersOf(waking, 'remind')].length) : ASK;
    const title = stopped || waking.some((i) => i.kind === 'stop') ? NOTIFICATION_TITLE_STOP : NOTIFICATION_TITLE;
    const line = lineOf(waking);
    const context = `${LEADS.courier} ${whatOf(waking)}. ${SEND(title, sayingOf(waking))} ${ask}`;
    mark(waking, stamp, { by: session, before: kept.lastWakeAt }, { session, at: stamp, line, context });
    return { submit: line, context, sent: waking.map((i) => i.id), at: stamp };
  } finally {
    release();
  }
}

// courierUnsent({ project, session, ids, at }) -> { unsent }: the mod couldn't hand on the wake
// of `session`'s stamped `at` that marked `ids`, so each of those ids whose mark in force is still
// that wake's (its session and its stamp) is taken out of what was sent, however long ago, and
// lastWakeAt goes back to what it was before that wake, unless a wake since has moved it. A mark
// another wake has made since, an opening's marks, and an undo naming another session or stamp
// stay as they are. `unsent` names the ids taken out. Another session holding courier.json past
// LOCK_WAIT_MS leaves the marks as they are. Throws when courier.json can't be kept.
export async function courierUnsent({ project, session, ids, at } = {}) {
  const named = new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  if (!isSession(session) || typeof at !== 'string' || at === '' || named.size === 0) return { unsent: [] };
  let release;
  try {
    release = await takeStartLock(`${courierFile(project)}.lock`, { message: BUSY, waitMs: LOCK_WAIT_MS });
  } catch (error) {
    if (error?.message === BUSY) return { unsent: [] };
    throw error;
  }
  try {
    const kept = readKept(project);
    // The latest mark of each id is the one in force, as writeKept keeps it.
    const latest = new Map(kept.sent.map((entry) => [entry.id, entry]));
    const undoing = [...latest.values()].filter((entry) => named.has(entry.id) && entry.by === session && entry.at === at);
    if (undoing.length === 0) return { unsent: [] };
    const out = new Set(undoing.map((entry) => entry.id));
    const before = typeof undoing[0].before === 'string' ? undoing[0].before : null;
    // Every other id stays, however many: the undo cuts nothing.
    const sent = kept.sent.filter((entry) => !out.has(entry.id));
    writeKept(project, { sent, lastWakeAt: kept.lastWakeAt === at ? before : kept.lastWakeAt, sessions: kept.sessions, wakes: kept.wakes, cursor: kept.cursor }, new Set(sent.map((entry) => entry.id)));
    return { unsent: [...out] };
  } finally {
    release();
  }
}

// courierContext({ project, session, prompt, now }) -> the instructions of the wake whose line `prompt` is, for the
// front desk `session`, or null: the latest such wake, made for that session no more than WAKE_CONTEXT_MS ago. Read
// without the lock: courier.json is replaced whole.
export function courierContext({ project, session, prompt, now = () => new Date() } = {}) {
  if (!isSession(session) || typeof prompt !== 'string') return null;
  const line = prompt.replace(/\p{Cf}/gu, '').trim();
  const t = instantOf(now);
  const wake = readKept(project).wakes.filter((w) => w.session === session && w.line === line).at(-1);
  if (wake === undefined) return null;
  const age = t - Date.parse(wake.at);
  return Number.isFinite(age) && age >= 0 && age <= WAKE_CONTEXT_MS ? wake.context : null;
}
