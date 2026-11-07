// scripts/update/status-line.js
// The update takes out the status line an earlier Wheelhouse set in the project's local settings
// (.claude/settings.local.json), and leaves a status line the director set. Wheelhouse's own is the one
// whose command names that release's status-line script (isOwnStatusLine).
//
// removeOwnStatusLine(folder) -> { removed }: `removed` is true only when the file held Wheelhouse's own
// line and it was taken out, the rest of the file as it was. A missing, damaged or unrelated file is left
// as it is, and nothing throws.
import fs from 'node:fs';
import path from 'node:path';
import { isOwnStatusLine, writeSettings } from '../protection/settings.js';

const LOCAL = ['.claude', 'settings.local.json'];

export function removeOwnStatusLine(folder) {
  try {
    const file = path.join(folder, ...LOCAL);
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return { removed: false };
    if (!Object.hasOwn(settings, 'statusLine') || !isOwnStatusLine(settings.statusLine)) return { removed: false };
    const { statusLine, ...rest } = settings;
    writeSettings(file, rest);
    return { removed: true };
  } catch {
    return { removed: false };
  }
}

// The update's step: a line only when it removed one.
export async function statusLineStep({ folder }) {
  return removeOwnStatusLine(folder).removed
    ? { lines: ['The status line Wheelhouse set in this project is gone; a status line of your own was never touched.'] }
    : { lines: [] };
}
