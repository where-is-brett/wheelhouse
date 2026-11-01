// scripts/lib/build-loop.js
// The build loop's numbers and the words its records share, named once.

// How much work builds at once, and how much of that may be in the feature lane.
export const PACE = Object.freeze({ building: 3, featureLane: 1 });
// The pace in force, from the effective settings (the `pace` entry's value, or that value alone where the settings are
// already read down to their values): the director's one, two or three at once, else PACE.
export function paceOf(settings) {
  const value = settings?.pace?.value ?? settings?.pace;
  return [1, 2, 3].includes(value) ? { building: value, featureLane: PACE.featureLane } : { ...PACE };
}
// How long a feature's status may stand still, in awake time, before it counts as stuck.
export const STUCK_MS = 20 * 60 * 1000;
// How long the watcher gathers what woke it before it wakes the foreman.
export const BUNDLE_MS = 60 * 1000;
// How many rounds of review fixes a pull request gets before the foreman asks.
export const FIX_ROUNDS = 3;
// When an upgrade may be offered: the upstream commit must be this old, and offers are this far apart.
export const UPGRADE = Object.freeze({ minAgeDays: 7, everyDays: 30 });
// The lowest Claude Code Wheelhouse runs on: from 2.1.295 a guard that fails stops the tool call,
// and from 2.1.299 the mod's files load (check 40).
export const CLAUDE_CODE_FLOOR = '2.1.299';
// The context size at which the foreman compacts when the model's own limit is unknown.
export const FOREMAN_FALLBACK_COMPACT = 100000;
// The most words a feature's report may have.
export const REPORT_WORDS = 300;

export const LANES = Object.freeze(['quick', 'small', 'feature', 'bug']);
// The appetite the foreman gives quick, bug and small work, whose documents set none: only a feature's pitch
// proposes one (design section 7.4), yet every brief carries one (build-loop design, section 5). Generous, since a
// one-task build with its reviews took about 0.5 to 2 million tokens in the evaluation (docs/evals/build-loop.md).
// A document that sets its own is read instead. Designer's call.
export const LANE_APPETITE = Object.freeze({
  quick: Object.freeze({ sessions: 1, tokens: 1500000 }),
  bug: Object.freeze({ sessions: 1, tokens: 2000000 }),
  small: Object.freeze({ sessions: 1, tokens: 3000000 }),
});
export const FEATURE_STEPS = Object.freeze(['started', 'planned', 'building', 'paused', 'closed']);
export const REPORT_OUTCOMES = Object.freeze(['merged', 'closed', 'blocked']);
// A work or incident id: lower-case letters, digits and hyphens, at most 40 characters.
export const SLUG = /^[a-z0-9-]{1,40}$/;
// A hash a card can show as its first twelve characters: lower-case hex, 12 to 64 long.
export const HASH = /^[0-9a-f]{12,64}$/;
// The first number of the foreman's own question ids, `q-<work>-<n>`. A
// feature's own count up from 1 and never reach it.
export const FOREMAN_QUESTIONS = 1000000;
// Why a feature is paused: the director's amendment, or the five-hour window.
export const PAUSED_FOR = Object.freeze(['director', 'five-hour']);

// A question id `q-<work>-<n>` as `{ work, n, foreman }`, where `foreman` says
// it is one of the foreman's own; null when it is not one.
export function questionIdOf(id) {
  const m = typeof id === 'string' ? /^q-([a-z0-9-]+)-([0-9]+)$/.exec(id) : null;
  if (m === null || !SLUG.test(m[1])) return null;
  const n = Number(m[2]);
  return { work: m[1], n, foreman: n >= FOREMAN_QUESTIONS };
}
