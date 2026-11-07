// scripts/desk/settings-views.js
// The settings views as the last sync left them, read from this computer's files in process.
import { localViews } from '../hooks/session-start.js';
import { readProfileViews } from '../profile/store.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The settings views as the last sync left them: { project, profile }, each {} when it can't be read.
export function settingsViews(project) {
  const views = { project: {}, profile: {} };
  try {
    const own = localViews(project, ['settings'])?.settings;
    if (isRecord(own)) views.project = own;
  } catch {
    // None can be read.
  }
  try {
    const profile = readProfileViews()?.settings;
    if (isRecord(profile)) views.profile = profile;
  } catch {
    // None can be read.
  }
  return views;
}
