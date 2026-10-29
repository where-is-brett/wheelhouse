// scripts/engine/caps.js
// The caps on one run (Archon design, section 10.2): minutes of running time (waiting at an ask doesn't count) and
// tokens spent. The limits are the project's capMinutes and capTokens for the run's lane; Give it more raises them
// once, by half. A run that carries on earlier work counts the spend of the runs before it, so a cap never starts
// again from nothing.
import { LANE_CAPS } from './order.js';

// The settings' lanes: the others take the nearest one's caps.
const NEAREST = { feature: 'slice', 'fix-main': 'bug' };
export const RAISE = 1.5;

// The limits for `lane`: { minutes, tokens }.
export function limitsFor(lane, { capMinutes = {}, capTokens = {} } = {}, { raised = false } = {}) {
  const key = Object.hasOwn(capMinutes, lane) || Object.hasOwn(capTokens, lane) ? lane : NEAREST[lane] ?? lane;
  const fallback = LANE_CAPS[lane] ?? LANE_CAPS.quick;
  const minutes = Number.isFinite(capMinutes[key]) ? capMinutes[key] : fallback.minutes;
  const tokens = Number.isFinite(capTokens[key]) ? capTokens[key] : fallback.tokens;
  return raised ? { minutes: Math.round(minutes * RAISE), tokens: Math.round(tokens * RAISE) } : { minutes, tokens };
}

// The spend of the earlier runs named in `runIds`, from the project's `cost` records.
export function carriedSpend(costs = [], runIds = []) {
  const wanted = new Set(runIds);
  let tokens = 0;
  let minutes = 0;
  for (const c of costs) {
    if (!wanted.has(c?.data?.runId)) continue;
    if (Number.isFinite(c.data.tokens)) tokens += c.data.tokens;
    if (Number.isFinite(c.data.minutes)) minutes += c.data.minutes;
  }
  return { tokens, minutes };
}

// Whether `run` ({ lane, minutes, tokens, raised?, carried? }) must stop: null, or { cap, used, limit }.
export function capReached(run, caps = {}) {
  const limits = limitsFor(run.lane, caps, { raised: run.raised === true });
  const minutes = Math.round(((run.minutes ?? 0) + (run.carried?.minutes ?? 0)) * 100) / 100;
  const tokens = (run.tokens ?? 0) + (run.carried?.tokens ?? 0);
  if (minutes > limits.minutes) return { cap: 'minutes', used: minutes, limit: limits.minutes };
  if (tokens > limits.tokens) return { cap: 'tokens', used: tokens, limit: limits.tokens };
  return null;
}
