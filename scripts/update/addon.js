// scripts/update/addon.js
// The VS Code add-on left on a computer, which the core no longer carries. The update names it on its card only where VS Code
// lists it, and removes it with VS Code's own command (`code --uninstall-extension wheelhouse.wheelhouse`) only once the
// director has clicked that card. A refusal is said in plain words and not tried again; the add-on does nothing either way,
// since the helper no longer answers what it asks.
import fs from 'node:fs';
import path from 'node:path';
import { quoteForCmd, resolveCommand } from '../lib/claude.js';
import { run as realRun } from '../lib/run.js';

export const ADDON_ID = 'wheelhouse.wheelhouse';
export const ADDON_ON_CARD = 'The Wheelhouse add-on is installed in VS Code on this computer; the update removes it, since Wheelhouse no longer carries one. Not now leaves it installed, and it does nothing.';
export const ADDON_REMOVED_LINE = 'The Wheelhouse add-on was removed from VS Code.';
export const ADDON_BY_HAND_LINE = `VS Code did not remove the Wheelhouse add-on, so it stays installed and does nothing. To remove it by hand, open Extensions in VS Code, find Wheelhouse, and choose Uninstall (or run: code --uninstall-extension ${ADDON_ID}).`;

// Runs `code <args>`, through cmd.exe where VS Code's command line is a .cmd shim. Resolves { code, stdout }.
async function code({ run, platform, env, args, timeoutMs }) {
  const resolved = resolveCommand({ name: 'code', platform, env });
  const call = resolved.kind === 'cmd'
    ? { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${[resolved.file, ...args].map(quoteForCmd).join(' ')}"`], verbatim: true }
    : { file: resolved.file, args, verbatim: false };
  return run(call.file, call.args, { env, input: '', timeoutMs, windowsVerbatimArguments: call.verbatim });
}

// Whether VS Code lists the add-on: `code --list-extensions`. Null when that can't be asked (no command line, or it failed),
// which is "none to offer". Never throws.
export async function addonInstalled({ run = realRun, platform = process.platform, env = process.env } = {}) {
  try {
    const result = await code({ run, platform, env, args: ['--list-extensions'], timeoutMs: 15000 });
    if (result?.code !== 0) return null;
    return String(result.stdout ?? '').split(/\r?\n/).some((l) => l.trim().toLowerCase() === ADDON_ID);
  } catch {
    return null;
  }
}

// Whether the plan the director's click was for named the add-on: only then does the removal run.
export function planNamedAddon(journal) {
  try {
    return JSON.parse(fs.readFileSync(path.join(journal.folder, 'plan.json'), 'utf8'))?.plan?.addon === true;
  } catch {
    return false;
  }
}

// Removes the add-on once. `progress` is the finish step's saved progress; its `addon` entry is the journal's record of
// the removal ({ removed, at, refused }), so a second run asks and removes nothing. Resolves { done: true, lines }: a removal
// VS Code refuses is a line, not a stop for the update.
export async function removeAddon({
  run = realRun, platform = process.platform, env = process.env, progress, save = () => {}, now = () => new Date(),
} = {}) {
  if (progress.addon !== undefined) return { done: true, lines: [] };
  const installed = await addonInstalled({ run, platform, env });
  if (installed !== true) {
    // Gone already, or VS Code can't be asked: nothing to remove, and nothing to put back.
    progress.addon = { removed: false, at: now().toISOString() };
    save();
    return { done: true, lines: [] };
  }
  let taken = false;
  try {
    taken = (await code({ run, platform, env, args: ['--uninstall-extension', ADDON_ID], timeoutMs: 120000 }))?.code === 0;
  } catch { /* said below */ }
  progress.addon = taken ? { removed: true, at: now().toISOString() } : { removed: false, refused: true, at: now().toISOString() };
  save();
  return { done: true, lines: [taken ? ADDON_REMOVED_LINE : ADDON_BY_HAND_LINE] };
}
