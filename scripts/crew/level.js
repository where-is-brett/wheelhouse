// scripts/crew/level.js
// How much of the crew's work the director sees for a piece (crew visibility design, section 6): `off`, `steps` or
// `transcript`. The project setting `watchCrew` gives it; a `watch` record for a piece, while the piece is open, gives
// that piece its own. The Bosun (`foreman`) follows the project setting only.
import { buildViews } from '../state/views.js';
import { listEvents } from '../state/events.js';
import { readEnrolled } from '../state/signing.js';
import { effectiveSettings } from '../settings/effective.js';
import { stateDir } from '../lib/paths.js';

import { LEVELS } from './levels.js';

export { LEVELS };

const BOSUN = 'foreman';

const isRecord = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The project's level, from a `settings` view or the effective settings. A value that is not a level counts as off.
export function watchCrewIn(settings) {
  const value = isRecord(settings) && isRecord(settings.watchCrew) ? settings.watchCrew.value : undefined;
  return LEVELS.includes(value) ? value : 'off';
}

// The level for `work`: its own latest `watch` choice (views.watch[work]) while it is open, else the project's.
export function levelFor(views, settings, work) {
  const project = watchCrewIn(settings);
  if (work === BOSUN) return project;
  const feature = isRecord(views?.features) ? views.features[work] : undefined;
  const isOpen = isRecord(feature) && feature.step !== 'closed';
  const own = isRecord(views?.watch) ? views.watch[work] : undefined;
  return isOpen && LEVELS.includes(own) ? own : project;
}

// The level for `work` in a project, from its records and settings. An unreadable records folder gives the project's default; only an unexpected failure
// gives off.
export function levelOf(project, work, { now = () => new Date() } = {}) {
  try {
    const views = buildViews(listEvents(stateDir(project), { report: () => {} }), readEnrolled());
    return levelFor(views, effectiveSettings({ project: views.settings, now }), work);
  } catch {
    return 'off';
  }
}
