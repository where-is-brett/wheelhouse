// scripts/agents/reviews.js
// Each agent's review module, for the helper's signed review in a clean session (ruling P7-14): its kind, whether it
// is switched on, the kinds of review the gate counts for that agent, and its session. Claude Code has none (null):
// its reviewer is its own subagent, signed by the report check, and the gate keeps today's rule for it. Kept apart
// from the registry (scripts/agents/index.js), as translators.js and tool-sheets.js are, so the helper loads only
// each adapter's review code. A test holds each entry to its adapter's own.
import copilot from '../../adapters/copilot/review.js';
import { noAdapter } from './project-agent.js';

export const REVIEWS = Object.freeze({ 'claude-code': null, copilot });

// The review module of the agent `name`, or null for one whose reviews are not the helper's.
export function reviewsFor(name) {
  if (typeof name !== 'string' || !Object.hasOwn(REVIEWS, name)) throw noAdapter(name);
  return REVIEWS[name];
}
