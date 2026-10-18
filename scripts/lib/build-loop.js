// scripts/lib/build-loop.js
// The build loop's numbers and the words its records share, named once.

// How much work builds at once, and how much of that may be in the feature lane.
export const PACE = Object.freeze({ building: 3, featureLane: 1 });
// How long a feature's status may stand still, in awake time, before it counts as stuck.
export const STUCK_MS = 20 * 60 * 1000;
// How long the watcher gathers what woke it before it wakes the foreman.
export const BUNDLE_MS = 60 * 1000;
// How many rounds of review fixes a pull request gets before the foreman asks.
export const FIX_ROUNDS = 3;
// When an upgrade may be offered: the upstream commit must be this old, and offers are this far apart.
export const UPGRADE = Object.freeze({ minAgeDays: 7, everyDays: 30 });
// The context size at which the foreman compacts when the model's own limit is unknown.
export const FOREMAN_FALLBACK_COMPACT = 100000;
// The most words a feature's report may have.
export const REPORT_WORDS = 300;

export const LANES = Object.freeze(['quick', 'small', 'feature', 'bug']);
export const FEATURE_STEPS = Object.freeze(['started', 'planned', 'building', 'paused', 'closed']);
export const REPORT_OUTCOMES = Object.freeze(['merged', 'closed', 'blocked']);
// A work or incident id: lower-case letters, digits and hyphens, at most 40 characters.
export const SLUG = /^[a-z0-9-]{1,40}$/;
// A hash a card can show as its first twelve characters: lower-case hex, 12 to 64 long.
export const HASH = /^[0-9a-f]{12,64}$/;
