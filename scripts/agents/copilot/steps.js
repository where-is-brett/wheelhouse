// scripts/agents/copilot/steps.js
// Thoroughness on an Auto-only Copilot plan (Copilot return design, section 5.3). Auto picks the model, so the level
// can't change the model or the effort; it changes how many Copilot steps a piece of work takes, since each step is a
// request against the month. A pure function: callers pass the level, the lane and whether the work is critical.
//
//   Lightest (the default on Copilot) and Lean
//             a quick change or a bug: one session builds and checks its own work, the helper's tests are the review.
//             A small piece or a feature: one plan, one build session, one review.
//   Balanced  a separate reviewer for every piece, and a tester for a feature.
//   Thorough  isn't offered on this plan; it is read as Balanced.
//
// A reviewer of critical work is its own session at every level: if the allowance can't cover one, the work waits
// (scripts/agents/copilot/usage.js, mayStart) rather than merging unreviewed.
export const LEVELS = Object.freeze(['lightest', 'lean', 'balanced', 'thorough']);
export const LANES = Object.freeze(['quick', 'bug', 'small', 'feature']);
// The level a Copilot computer starts at.
export const DEFAULT_LEVEL = 'lightest';
// The levels offered on an Auto-only plan.
export const OFFERED = Object.freeze(['lightest', 'lean', 'balanced']);

// The level a plan really runs at: Thorough is not offered on an Auto-only plan.
export function levelFor(level, plan = 'auto-only') {
  const chosen = LEVELS.includes(level) ? level : DEFAULT_LEVEL;
  return plan === 'auto-only' && chosen === 'thorough' ? 'balanced' : chosen;
}

// stepsFor({ level, lane, critical, plan }) ->
//   { level, plan, build, reviewer, tester, sessions }
// `plan` (the plan step) is whether a plan session runs first; `build` is the build sessions (always 1); `reviewer` is
// `tests` (the helper's tests are the review) or `separate` (its own session); `tester` is whether a tester session
// runs; `sessions` counts the Copilot sessions in all, which is the least requests a piece takes.
export function stepsFor({ level, lane, critical = false, plan: planKind = 'auto-only' } = {}) {
  if (!LANES.includes(lane)) throw new Error(`A lane is one of ${LANES.join(', ')}`);
  const run = levelFor(level, planKind);
  const planned = lane === 'small' || lane === 'feature';
  const balanced = run === 'balanced';
  const reviewer = critical || planned || balanced ? 'separate' : 'tests';
  const tester = balanced && lane === 'feature';
  const sessions = (planned ? 1 : 0) + 1 + (reviewer === 'separate' ? 1 : 0) + (tester ? 1 : 0);
  return { level: run, plan: planned, build: 1, reviewer, tester, sessions };
}
