// scripts/settings/compact-window-pr.js
// The compaction window's pull request, for a window the director chose and confirmed (the `compactWindow` setting):
// one commit the helper makes in its own mirror on top of the default branch, changing only `autoCompactWindow` in the
// project's .claude/settings.json. Modelled on the engine switch (scripts/engine/switch-pr.js). The helper's gate
// recognises a pull request on this branch whose whole diff is that one key in that one file, changed to the value of
// the director's signed setting: every byte of it is the helper's, so it has no review and no provenance to check. The
// file is a guardrail, so the director's approval is still asked for, and the pull request still needs its checks.
import { effectiveSettings } from './effective.js';
import { SETTINGS } from './catalogue.js';
import { SETTINGS_FILE, windowIn, windowRefusal } from './compact-window.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export const COMPACT_BRANCH = /^wheelhouse-compact-window-[0-9a-f]{12}$/;
export const compactBranch = (base) => `wheelhouse-compact-window-${String(base).slice(0, 12)}`;
export const COMPACT_WORK = 'compact-window';
export const COMPACT_NAME = 'the change to where conversations compact';
export const COMPACT_TITLE = 'Change where conversations compact';
export const compactBody = (value) => [
  `This sets the compaction window to ${value.toLocaleString('en-AU')} tokens: Claude Code compacts a conversation when its context reaches that size.`,
  '',
  `Only \`autoCompactWindow\` in \`${SETTINGS_FILE}\` changes.`,
  '',
  'The director chose it in their settings. Wheelhouse wrote this change itself, and merges it once the director approves it.',
].join('\n');

// The window the director chose, from the project's settings view: null until they have chosen one.
export function chosenWindow(settingsView, { now = new Date() } = {}) {
  if (!isPlain(settingsView) || !Object.hasOwn(settingsView, 'compactWindow')) return null;
  const value = effectiveSettings({ project: settingsView, now }).compactWindow?.value;
  if (!SETTINGS.compactWindow.check(value)) return null;
  // The window stays above the point to prepare at, whichever way either was set.
  const prepare = effectiveSettings({ project: settingsView, now }).compactPrepare?.value;
  return windowRefusal({ window: value, prepare }) === null ? value : null;
}

// The text of the settings file with only `autoCompactWindow` set to `value`, or null when `before` isn't a JSON object.
export function changedText(before, value) {
  let parsed;
  try { parsed = JSON.parse(before); } catch { return null; }
  if (!isPlain(parsed) || !SETTINGS.compactWindow.check(value)) return null;
  return `${JSON.stringify({ ...parsed, autoCompactWindow: value }, null, 2)}\n`;
}

// compactChange({ headRef, paths, files, value }) -> { matched: false } | { matched: true, ok, why? }
// Whether a pull request is the window's own: on the window's branch, changing only the settings file, a plain file
// that differs from the base in `autoCompactWindow` alone, which it sets to `value`, the one the director signed.
// `files` is the merge gate's read of each file, { base, head, headMode }.
export function compactChange({ headRef, paths, files, value }) {
  if (typeof headRef !== 'string' || !COMPACT_BRANCH.test(headRef)) return { matched: false };
  const no = (why) => ({ matched: true, ok: false, why });
  if (!Array.isArray(paths) || paths.length !== 1 || paths[0] !== SETTINGS_FILE) return no(`it changes more than ${SETTINGS_FILE}`);
  if (!SETTINGS.compactWindow.check(value)) return no('the director has not chosen a compaction window');
  const read = files?.[SETTINGS_FILE];
  if (typeof read?.base !== 'string' || typeof read?.head !== 'string' || read.headMode !== '100644') return no(`${SETTINGS_FILE} isn't a plain file that was there before`);
  let before;
  let after;
  try { before = JSON.parse(read.base); after = JSON.parse(read.head); } catch { return no(`${SETTINGS_FILE} isn't JSON`); }
  if (!isPlain(before) || !isPlain(after)) return no(`${SETTINGS_FILE} isn't a JSON object`);
  if (windowIn(after) !== value) return no('it sets a window other than the one the director chose');
  if (before.autoCompactWindow === value) return no('the window is already that value');
  const [restBefore, restAfter] = [{ ...before }, { ...after }];
  delete restBefore.autoCompactWindow;
  delete restAfter.autoCompactWindow;
  if (JSON.stringify(restBefore) !== JSON.stringify(restAfter)) return no('it changes more than autoCompactWindow');
  if (read.head !== changedText(read.base, value)) return no(`${SETTINGS_FILE} isn't the text Wheelhouse writes`);
  return { matched: true, ok: true, value };
}
