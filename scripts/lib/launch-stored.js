// scripts/lib/launch-stored.js
// The launch command this computer's director saved, read from their settings (the profile views) for whatever starts a
// builder. A value that is there and fails a check is named and not used, never skipped: starting plain `claude` would run
// the program the director meant to wrap.
import { computerId } from './paths.js';
import { checkLaunch } from './launch-words.js';
import { profileViewsFault, readProfileViews } from '../profile/store.js';

// The words saved for this computer, or null when none are (plain `claude`). Throws, in plain words, when the settings
// can't be read or the saved words fail a check. `check` is for tests (the default is checkLaunch on this computer).
export function storedLaunch({ id = computerId(), readViews = readProfileViews, fault = profileViewsFault, check = checkLaunch, platform = process.platform } = {}) {
  const views = readViews();
  const broken = views === null ? fault() : null;
  if (broken !== null && broken !== undefined) {
    throw new Error(`Your settings can't be read, so the launch command is unknown (${broken.file}, line ${broken.line}, column ${broken.column}). ${broken.hint ?? ''}`.trim());
  }
  const entry = views?.settings?.[`builderLaunch:${id}`];
  if (entry === undefined || entry === null || entry.value === null || entry.value === undefined) return null;
  const checked = check(entry.value, { platform });
  if (!checked.ok) throw new Error(`The launch command saved for this computer can't be used: ${checked.why} Mend it in the settings.`);
  return entry.value;
}
