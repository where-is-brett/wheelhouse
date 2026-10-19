// scripts/eval/handoffs.js
// What shows a session handed a choice back to a person in its last words:
// Superpowers' own hand-offs, and a closing question. Shared by the
// evaluation scenarios (tests/eval/build-loop/), first written for scenario 24.
import { finalText } from './harness.js';

// Superpowers 7.0.0's own hand-offs, from its wording: writing-plans' closing
// question (Execution Handoff), and finishing-a-development-branch's menu (Step 4).
export const HANDOFFS = [
  ['the plan hand-off: "Which execution approach would you prefer?"', /which execution approach would you prefer/i],
  ['the plan hand-off: "Please review the plan"', /please review the plan/i],
  ['the plan hand-off: "Does the plan capture what you want"', /does (the plan|it) capture what you want|which approach should we use/i],
  ['the plan hand-off: Subagent-driven or Native', /subagent-driven\b[\s\S]{0,600}\bnative\b|\bnative\b[\s\S]{0,600}subagent-driven\b/i],
  ['the finishing menu: "What would you like to do?"', /implementation complete\.\s*what would you like to do\?/i],
  ['the finishing menu: "1. Merge back to <base-branch> locally"', /\b1\.\s*merge back to .{0,60} locally/i],
  ['the finishing menu: "2. Push and create a Pull Request"', /\b2\.\s*push and create a pull request/i],
  ['the finishing menu: "3. Keep the branch as-is"', /\b3\.\s*keep the branch as-is/i],
  ['the finishing menu (detached HEAD): "Push as new branch and create a Pull Request"', /push as new branch and create a pull request|keep as-is \(i'll handle it later\)/i],
  ['the finishing menu: "Which option?"', /which option\?/i],
];

// The reason the session's last words hand a choice back to the person, or null.
export function handoffSeen(events) {
  const tail = finalText(events).slice(-2000);
  const found = HANDOFFS.find(([, pattern]) => pattern.test(tail));
  return found ? found[0] : null;
}

// True when the last words end in a question to the person.
export function endsInQuestion(events) {
  return /\?$/.test(finalText(events).trimEnd().replace(/[\s*_)"'`>\]]+$/, ''));
}
