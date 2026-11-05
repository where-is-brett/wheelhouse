// scripts/lib/session-files.js
// The small files Wheelhouse keeps beside a session's role.json, in sessions/<id>/: whether a live
// pane is drawn beside the session (pane.json), the cards the director asked to have in the chat
// (here.json) and the cards a chat question is open on (open.json). Every reader treats a missing,
// unreadable or half-written file as absent and never throws; every writer is atomic and returns
// false rather than throw. An unsafe session id names no folder, so it reads as absent.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { roleFile } from './role.js';

// A tick and a draw within this long of now make the pane live: the pane's own staleness rule,
// STALE_TICKS ticks of TICK_MS (design section 4.2).
export const LIVE_MS = 45000;
// How long a "ask me here" mark lasts.
export const HERE_MS = 120000;
// The switch in design section 9.1: false ships the live-pane deny off, and the card hook then
// leaves a card the pane could answer to the chat.
export const HOLD_FOR_PANE = true;

const PANE = 'pane.json';
const HERE = 'here.json';
const OPEN = 'open.json';

function fileOf(sessionId, name) {
  const role = roleFile(sessionId);
  return role === null ? null : path.join(path.dirname(role), name);
}

function readJson(file) {
  if (file === null) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// Writes the file whole to a temporary name and renames it.
function writeJson(file, value) {
  if (file === null) return false;
  const temp = `${file}.${crypto.randomUUID().slice(0, 12)}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify(value)}\n`, { flag: 'wx' });
    fs.renameSync(temp, file);
    return true;
  } catch {
    return false;
  } finally {
    try { fs.rmSync(temp, { force: true }); } catch { /* nothing to remove */ }
  }
}

const isTime = (n) => typeof n === 'number' && Number.isFinite(n);
const isIds = (list) => Array.isArray(list) && list.every((id) => typeof id === 'string' && id !== '');

// Marks the session's pane as ticking at `at` and last drawn at `drawn` (null while the mod can't
// say). Returns whether it was written.
export function markPane(sessionId, { at, drawn, surface }) {
  if (!isTime(at)) return false;
  return writeJson(fileOf(sessionId, PANE), {
    at,
    drawn: isTime(drawn) ? drawn : null,
    surface: typeof surface === 'string' ? surface : null,
  });
}

// Whether a live pane is beside the session at `now`: a tick and a draw both within LIVE_MS. While
// the mod sends no draw time, the tick alone counts.
export function paneLive(sessionId, now) {
  const mark = readJson(fileOf(sessionId, PANE));
  if (mark === null || !isTime(mark.at) || !isTime(now)) return false;
  if (now - mark.at > LIVE_MS) return false;
  if (mark.drawn === null || mark.drawn === undefined) return true;
  return isTime(mark.drawn) && now - mark.drawn <= LIVE_MS;
}

// The unexpired marks of here.json, as { id: at }.
function hereMarks(sessionId, now) {
  const marks = readJson(fileOf(sessionId, HERE))?.marks;
  const kept = {};
  if (marks === null || typeof marks !== 'object' || Array.isArray(marks)) return kept;
  for (const [id, at] of Object.entries(marks)) {
    if (isTime(at) && now - at <= HERE_MS) kept[id] = at;
  }
  return kept;
}

// The mark for every card: a command that doesn't know the ids its cards will be recorded under (the update's) leaves it.
export const ANY_CARD = '*';

// Marks cards as ones the director wants asked in the chat, for HERE_MS.
export function markHere(sessionId, cardIds, now) {
  if (!isIds(cardIds) || cardIds.length === 0 || !isTime(now)) return false;
  const marks = hereMarks(sessionId, now);
  for (const id of cardIds) marks[id] = now;
  return writeJson(fileOf(sessionId, HERE), { marks });
}

// True once, when every id is in an unexpired mark, or the mark for every card is; removes what it took.
export function takeHere(sessionId, cardIds, now) {
  if (!isIds(cardIds) || cardIds.length === 0 || !isTime(now)) return false;
  const marks = hereMarks(sessionId, now);
  const any = Object.hasOwn(marks, ANY_CARD);
  if (!any && !cardIds.every((id) => Object.hasOwn(marks, id))) return false;
  if (any) delete marks[ANY_CARD];
  for (const id of cardIds) delete marks[id];
  return writeJson(fileOf(sessionId, HERE), { marks });
}

// Notes the cards a chat question is open on.
export function markOpen(sessionId, cardIds, now) {
  if (!isIds(cardIds) || !isTime(now)) return false;
  return writeJson(fileOf(sessionId, OPEN), { cards: cardIds, at: now });
}

// The cards a chat question is open on and when it was noted, or null.
export function readOpen(sessionId) {
  const mark = readJson(fileOf(sessionId, OPEN));
  if (mark === null || !isIds(mark.cards) || !isTime(mark.at)) return null;
  return { cards: mark.cards, at: mark.at };
}

export function clearOpen(sessionId) {
  const file = fileOf(sessionId, OPEN);
  if (file === null) return;
  try { fs.rmSync(file, { force: true }); } catch { /* nothing to clear */ }
}
