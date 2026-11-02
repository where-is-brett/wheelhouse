// scripts/settings/compact-window.js
// The compaction window: the context size at which Claude Code compacts a conversation. It is
// `autoCompactWindow` in the project's .claude/settings.json, a protected file that agents cannot
// edit, so a change to it travels as a pull request the director approves, never as a write by an
// agent. The catalogue's `compactWindow` setting records what the director chose; this file checks
// it against the gauge's prepare point and makes the one-key change to the settings file.
import fs from 'node:fs';
import path from 'node:path';
import { COMPACT_WINDOW } from '../protection/settings.js';
import { SETTINGS } from './catalogue.js';

export const SETTINGS_FILE = '.claude/settings.json';
// How far past the window an automatic compaction may still be held back for unsaved work.
export const NEAR_LIMIT_MARGIN = 60000;
export const WINDOW_BRANCH = 'wheelhouse-compact-window';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sayTokens = (n) => n.toLocaleString('en-AU');

// A plain reason when the window and the prepare point don't fit together, else null. The prepare
// point must sit below the window, or the session would be told to prepare after it had compacted.
export function windowRefusal({ window = COMPACT_WINDOW, prepare = SETTINGS.compactPrepare.default } = {}) {
  if (Number.isInteger(window) && Number.isInteger(prepare) && window <= prepare) {
    return `The compaction window (${sayTokens(window)}) has to be larger than the point to prepare at (${sayTokens(prepare)}). Lower the prepare point first, or pick a larger window.`;
  }
  return null;
}

// The window in a settings object: a whole number of tokens, else null.
export function windowIn(settings) {
  const value = isObject(settings) ? settings.autoCompactWindow : undefined;
  return Number.isInteger(value) && value > 0 ? value : null;
}

// The window the project's Claude Code settings name now (the shared file, then this computer's), or null.
export function windowOf(folder) {
  if (typeof folder !== 'string' || folder === '') return null;
  for (const name of ['settings.json', 'settings.local.json']) {
    try {
      const found = windowIn(JSON.parse(fs.readFileSync(path.join(folder, '.claude', name), 'utf8')));
      if (found !== null) return found;
    } catch {
      // Missing or damaged: nothing named there.
    }
  }
  return null;
}

// The point where an automatic compaction stops being held back for unsaved work: a little past the window.
export function nearLimit(folder, fallback) {
  const window = windowOf(folder);
  return window === null ? fallback : window + NEAR_LIMIT_MARGIN;
}

// The settings with only `autoCompactWindow` changed. Throws for a window the catalogue refuses.
export function withWindow(settings, window) {
  if (!SETTINGS.compactWindow.check(window)) throw new Error(`compactWindow can't be ${window}`);
  return { ...(isObject(settings) ? settings : {}), autoCompactWindow: window };
}

// The pull request that carries the change, in the shape the foreman's opener takes
// ({ branch, file, text, title, body }), or null when the project already has that window.
// The settings file is protected, so the director's approval of this pull request is what makes the change.
export function windowChange({ settings, window, prepare }) {
  const refusal = windowRefusal({ window, prepare });
  if (refusal !== null) throw new Error(refusal);
  if (windowIn(settings) === window) return null;
  return {
    branch: WINDOW_BRANCH,
    file: SETTINGS_FILE,
    text: `${JSON.stringify(withWindow(settings, window), null, 2)}\n`,
    title: `Compact conversations at ${sayTokens(window)} tokens`,
    body: `Sets the compaction window to ${sayTokens(window)} tokens, as the director chose. Only autoCompactWindow in ${SETTINGS_FILE} changes.`,
  };
}
