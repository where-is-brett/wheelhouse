// scripts/engine/lanes.js
// Which engine builds a piece of work (Archon design, section 17, step 2). A project's `engine` setting says which
// engine it builds on and `engineLanes` which lanes go there. Work in those lanes goes to the new engine, but for a
// piece the old engine started before the switch (a feature record since the work was queued): that one finishes
// where it began, and its records stay as they are. Everything else stays with the old engine.
import { effectiveSettings } from '../settings/effective.js';
import { since } from '../foreman/queue.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Whether the old engine started `id` since the work was queued.
export function startedOnOldEngine(features, id, entry) {
  const feature = isPlain(features) ? features[id] : undefined;
  return isPlain(feature?.data) && since(feature, entry?.work);
}

// The lanes on the new engine for the project's settings view, or none while the project builds on the old one.
export function newEngineLanes(settingsView, { now = new Date() } = {}) {
  const settings = effectiveSettings({ project: isPlain(settingsView) ? settingsView : {}, now });
  if (settings.engine?.value !== 'archon') return [];
  return Array.isArray(settings.engineLanes?.value) ? settings.engineLanes.value : [];
}

// Whether the new engine builds `id`, from the project's views. `engineOn` is the helper's word that the engine can
// build the project (scripts/engine/switch.js): without it, the old engine builds everything, as before the switch.
export function onNewEngine(views, id, { now = new Date() } = {}) {
  const entry = isPlain(views?.work) ? views.work[id] : undefined;
  if (views?.engineOn !== true || !isPlain(entry?.work?.data)) return false;
  return newEngineLanes(views.settings, { now }).includes(entry.work.data.lane) && !startedOnOldEngine(views.features, id, entry);
}
