// scripts/lib/vscode-pane.js
// The small files that say a VS Code panel is open beside a project: vscode-<project>.json (the panel's tick and
// when it was last seen) and vscode-<project>.here.json (cards the director wants asked in the chat), both in
// <wheelhouseHome()>/panes/. Only Copilot's card commands and the board tool read them. Everything in a file is
// untrusted: every reader treats a missing, unreadable or half-written file as absent and never throws; every
// writer is atomic and returns false rather than throw. A project id that stateDir refuses names no file.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome, stateDir } from './paths.js';
import { LIVE_MS, HERE_MS } from './session-files.js';

const isTime = (n) => typeof n === 'number' && Number.isFinite(n);
const isIds = (list) => Array.isArray(list) && list.every((id) => typeof id === 'string' && id !== '');

// The file for a project, or null when the id is unsafe.
function fileOf(project, suffix) {
  try {
    stateDir(project); // refuses an unsafe id
    return path.join(wheelhouseHome(), 'panes', `vscode-${project}${suffix}.json`);
  } catch {
    return null;
  }
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

// Marks the project's VS Code panel as ticking at `at` and last seen at `visible` (null while never seen).
export function markVscodePane(project, { at, visible, window } = {}) {
  if (!isTime(at)) return false;
  return writeJson(fileOf(project, ''), {
    at,
    visible: isTime(visible) ? visible : null,
    surface: 'vscode',
    window: typeof window === 'string' ? window : null,
  });
}

// Whether a VS Code panel is live for the project at `now`: a tick and a sighting both within LIVE_MS.
export function vscodePaneLive(project, now) {
  try {
    const mark = readJson(fileOf(project, ''));
    if (mark === null || !isTime(mark.at) || !isTime(mark.visible) || !isTime(now)) return false;
    return now - mark.at <= LIVE_MS && now - mark.visible <= LIVE_MS;
  } catch {
    return false;
  }
}

// The unexpired marks of the here file, as { id: at }.
function hereMarks(project, now) {
  const marks = readJson(fileOf(project, '.here'))?.marks;
  const kept = {};
  if (marks === null || typeof marks !== 'object' || Array.isArray(marks)) return kept;
  for (const [id, at] of Object.entries(marks)) {
    if (isTime(at) && now - at <= HERE_MS) kept[id] = at;
  }
  return kept;
}

// Marks cards as ones the director wants asked in the chat, for HERE_MS.
export function markVscodeHere(project, cardIds, now) {
  if (!isIds(cardIds) || cardIds.length === 0 || !isTime(now)) return false;
  const marks = hereMarks(project, now);
  for (const id of cardIds) marks[id] = now;
  return writeJson(fileOf(project, '.here'), { marks });
}

// True once, when every id is in an unexpired mark; removes the ids it took.
export function takeVscodeHere(project, cardIds, now) {
  if (!isIds(cardIds) || cardIds.length === 0 || !isTime(now)) return false;
  const marks = hereMarks(project, now);
  if (!cardIds.every((id) => Object.hasOwn(marks, id))) return false;
  for (const id of cardIds) delete marks[id];
  return writeJson(fileOf(project, '.here'), { marks });
}
