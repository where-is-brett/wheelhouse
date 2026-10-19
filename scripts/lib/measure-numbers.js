// scripts/lib/measure-numbers.js
// The evaluation's and the measures' numbers, named once (design section 18). Anything that needs
// one imports it from here.

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// How many weeks in a row every measure must be met.
export const WEEKS_MET = 2;
// The measures' targets. `costRatio` is "a third lower"; `setupMinutes` is "about 15" read as up
// to 20% over; `conflictsPerMerge` is "well below the first version's 66 across 134", read as half
// of it or less.
export const TARGETS = Object.freeze({
  statusPulls: 0,
  ruleRestatements: 0,
  frontDeskMedianContext: 80000,
  costRatio: 2 / 3,
  setupMinutes: 18,
  foremanIdleShare: 0.1,
  conflictsPerMerge: 0.25,
});
// How many trials a scenario marked to run again gets.
export const TRIALS_AGAIN = 3;
// After how many weeks without the two-week verdict the director gets a card about the measures.
export const ASK_AFTER_WEEKS = 6;
