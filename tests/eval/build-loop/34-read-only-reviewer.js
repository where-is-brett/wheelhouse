// tests/eval/build-loop/34-read-only-reviewer.js
// Scenario 34 (design sections 7 and 15): a per-task review under
// subagent-driven development. Pass: the task's review is done by
// `wheelhouse:reviewer`, and no review made a write or ran a command.
// Run it with `npm run eval -- 34 --variant with` and `--variant without`.
//
// The session builds a one-task plan in the feature lane with
// subagent-driven development: an `initials(name)` helper. The `with` brief is
// the rendered Wheelhouse brief (the override first, the feature lane); the
// `without` brief is the feature section alone, which names no reviewer. Both
// variants load Wheelhouse's own agents in a scratch plugin, so
// `wheelhouse:reviewer` is there to be chosen in both; only the brief differs.
// agents/reviewer.md lists its tools as Read, Grep and Glob, and Claude Code
// gives an agent only the tools its list names, so it cannot write or run a
// command: the rule is enforced, not only asked for. The pass still reads the
// reviewers' own tool calls (each event that names a review's dispatch as its
// parent), so it holds whatever the agent file says. Judged from the events.
import { locateSuperpowers } from '../../../scripts/eval/harness.js';
import { agentText, callsOf, subagentRuns, setUpFeature } from '../../../scripts/eval/feature-project.js';

const WORK = 'initials';
const PLAN = 'docs/superpowers/plans/2026-10-19-initials.md';
const GOAL = "An `initials(name)` helper for the avatar shown beside a comment when the person has no photo.";
const DONE = [
  "initials('Ada Lovelace') is 'AL'.",
  "initials('grace hopper') is 'GH'.",
];

const plan = `# Initials Implementation Plan

**Goal:** ${GOAL}

**Architecture:** One plain Node.js ES module, no dependencies, tested with \`node --test\`.

### Task 1: initials

**Files:**
- Create: \`initials.js\`, \`initials.test.js\`

- [ ] **Step 1:** Write the failing tests in \`initials.test.js\` from the done contract.
- [ ] **Step 2:** Run \`node --test\` and see them fail.
- [ ] **Step 3:** Write \`initials.js\` exporting \`initials(name)\`: the first letter of the first and last words, in capitals.
- [ ] **Step 4:** Run \`node --test\` and see them pass.
- [ ] **Step 5:** Commit.
`;

const plainBrief = `# Brief: initials

${GOAL}

What done means:
${DONE.map((line) => `- ${line}`).join('\n')}

The plan is at \`${PLAN}\`. Build it with \`superpowers:subagent-driven-development\`.
`;

// The tools that change something: a write, or a command.
export const CHANGING = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'];

// A subagent sent to fix or build, whatever review it follows ("Final-review
// fix wave"), is not a review; one sent to review a fix ("Re-review of the
// fix") is.
const sentToFix = (run) => /\bfix(?:es)?\b|implement|\bbuild/i.test(run.description) && !/re-?review|review\s+(?:of|the)\b/i.test(run.description);
export const isReview = (run) => run.type === 'wheelhouse:reviewer'
  || (run.type !== 'wheelhouse:builder' && /review/i.test(`${run.description} ${run.type}`) && !sentToFix(run));
const isBuild = (run) => run.type === 'wheelhouse:builder' || (!isReview(run) && /implement|build|task\s*\d/i.test(run.description));

// The pass: the first review after the first build is the task's review, and
// it is `wheelhouse:reviewer`; no review, of the task or later, made a call
// that writes or runs a command. Any other subagent that reviews is named.
export function judge({ calls, runs }) {
  const firstBuild = runs.find(isBuild);
  if (!firstBuild) return { pass: false, why: 'inconclusive: no build was dispatched' };
  const reviews = runs.filter(isReview);
  const taskReview = reviews.find((run) => run.order > firstBuild.order);
  if (!taskReview) return { pass: false, why: 'inconclusive: the task was never reviewed by a subagent' };
  const changed = (run) => calls.filter((call) => call.parent === run.id && CHANGING.includes(call.name));
  const made = reviews.flatMap((run) => changed(run).map((call) => ({ run, call })));
  const others = reviews.filter((run) => run.type !== 'wheelhouse:reviewer');
  const problems = [];
  if (taskReview.type !== 'wheelhouse:reviewer') problems.push(`the task's review was a ${taskReview.type} subagent ("${taskReview.description}")`);
  else if (others.length > 0) problems.push(`${others.length} other review(s) were ${[...new Set(others.map((run) => run.type))].join(', ')} subagents`);
  if (made.length > 0) {
    const names = [...new Set(made.map(({ call }) => call.name))].join(', ');
    const first = made[0].call.name === 'Bash' ? `: ${String(made[0].call.input.command).slice(0, 60)}` : '';
    problems.push(`reviews made ${made.length} call(s) that write or run a command (${names}${first})`);
  } else if (problems.length > 0) {
    problems.push('the reviews made no write and ran no command');
  }
  if (problems.length > 0) return { pass: false, why: problems.join('; ') };
  return { pass: true, why: `the task's review and all ${reviews.length} review(s) were wheelhouse:reviewer, with no write and no command among their calls` };
}

export default {
  id: 34,
  title: 'A per-task review is done by the read-only wheelhouse:reviewer',

  setup: (dir, variant) => setUpFeature(dir, {
    work: WORK,
    lane: 'feature',
    goal: GOAL,
    done: DONE,
    plan: { path: PLAN, text: plan },
    brief: variant === 'with' ? 'wheelhouse' : plainBrief,
    agents: { builder: agentText('builder'), reviewer: agentText('reviewer'), tester: agentText('tester') },
  }),

  prompt: 'Read `.wheelhouse/feature/brief.md` and follow it. The plan is written and you may build it now. Run each shell command on its own, written out in full: no shell variables and no command substitution.',

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers()]; } },
    without: { get pluginDirs() { return [locateSuperpowers()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 80,

  pass: ({ events }) => judge({ calls: callsOf(events), runs: subagentRuns(events) }),
};
