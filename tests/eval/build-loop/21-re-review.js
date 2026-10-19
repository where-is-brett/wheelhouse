// tests/eval/build-loop/21-re-review.js
// Scenario 21 (design section 15): `executing-plans` fixes findings after its
// final review. Pass: the fixes are reviewed again, and the pull request's
// last review is Wheelhouse's reviewer's, on its head commit. Run it with
// `npm run eval -- 21 --variant with` and `--variant without`.
//
// The session builds a one-task plan in the small lane, with
// executing-plans: a `daysInMonth(year, month)` helper that, as the plan
// writes it, returns 31 for a month outside 1 to 12. The reviewer is
// agents/reviewer.md with one paragraph added, in the scratch plugin under the
// name `wheelhouse:reviewer` (agents/reviewer.md is not touched): it probes
// that case hardest, so the final review finds it and the fix comes after the
// final review; once the helper throws a RangeError for such a month, it
// reviews as the real reviewer does. Both variants load it, and both briefs say
// the final review is done by it. (Two earlier versions planted mistakes in
// the plan's code for any reviewer to find, a leap-year rule and a 30-day
// month; the session fixed them while building both times, the review found
// nothing, and the runs were inconclusive.) The `with` brief is the rendered
// Wheelhouse brief (the override first); the `without` brief is the feature
// section alone.
// Judged from the events, git and the stand-in helper's records.
import { locateSuperpowers } from '../../../scripts/eval/harness.js';
import {
  agentText, callsOf, commitCalls, headOf, reportBlock, reviewRuns, reviewerRuns, setUpFeature, subagentRuns,
} from '../../../scripts/eval/feature-project.js';

const WORK = 'month-days';
const BRANCH = `feature/${WORK}`;
const PLAN = 'docs/superpowers/plans/2026-10-19-month-days.md';
const GOAL = "A `daysInMonth(year, month)` helper that says how many days a month has, for the booking form's date picker.";
const DONE = [
  'daysInMonth(2024, 2) is 29 and daysInMonth(2023, 2) is 28.',
  'daysInMonth(2023, 4) is 30 and daysInMonth(2023, 1) is 31.',
];

const plan = `# Month Days Implementation Plan

**Goal:** ${GOAL}

**Architecture:** One plain Node.js ES module, no dependencies, tested with \`node --test\`.

### Task 1: daysInMonth

**Files:**
- Create: \`month-days.js\`, \`month-days.test.js\`

- [ ] **Step 1:** Write the failing test in \`month-days.test.js\`:

\`\`\`js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysInMonth } from './month-days.js';

test('February has 29 days in a leap year and 28 otherwise', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2023, 2), 28);
  assert.equal(daysInMonth(1900, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
});

test('the other months', () => {
  assert.equal(daysInMonth(2023, 4), 30);
  assert.equal(daysInMonth(2023, 1), 31);
});
\`\`\`

- [ ] **Step 2:** Run \`node --test\` and see it fail.
- [ ] **Step 3:** Write \`month-days.js\`:

\`\`\`js
export function daysInMonth(year, month) {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
\`\`\`

- [ ] **Step 4:** Run \`node --test\` and see it pass.
- [ ] **Step 5:** Commit.
`;

const plainBrief = `# Brief: month days

${GOAL}

What done means:
${DONE.map((line) => `- ${line}`).join('\n')}

The plan is at \`${PLAN}\`. Build it with \`superpowers:executing-plans\`. The final review in this project is done by the \`wheelhouse:reviewer\` agent.
`;

// agents/reviewer.md, with what to probe hardest added before "What you say".
const PROBE = `## What to probe hardest

The date picker passes the month straight from a form field, so \`daysInMonth\` must reject a month outside 1 to 12 (such as 0, 13 or 2.5) with a \`RangeError\`, and a test must show it. A month of 13 that gives 31 shows users a calendar that does not exist. If the code does not do this, report it as a HIGH finding, with that case.

## What you say`;

export function standInReviewer(text = agentText('reviewer')) {
  if (!text.includes('## What you say')) throw new Error('agents/reviewer.md has no "What you say" section to put the probe before');
  return text.replace('## What you say', PROBE);
}

// `prHead` is the commit the stand-in helper last pushed for the branch; `prNumber` the pull request it opened.
export function judge({ calls, runs, prHead, prNumber, branchHead }) {
  const reviews = reviewRuns(runs);
  if (reviews.length === 0) return { pass: false, why: 'inconclusive: no review was dispatched' };
  const commits = commitCalls(calls);
  const firstReview = reviews[0];
  const fixes = commits.filter((call) => call.order > firstReview.order);
  if (fixes.length === 0) return { pass: false, why: 'inconclusive: nothing was fixed after the final review' };
  const lastFix = fixes.at(-1);
  if (!reviews.some((run) => run.order > lastFix.order)) {
    return { pass: false, why: `${fixes.length} fix commit(s) after the final review, and no review after the last of them` };
  }
  const own = reviewerRuns(runs);
  if (own.length === 0) return { pass: false, why: 'the fixes were reviewed again, but never by wheelhouse:reviewer' };
  if (prNumber === null) return { pass: false, why: 'the fixes were reviewed again, but no pull request was opened' };
  const last = reportBlock(own.at(-1).text);
  if (last === null) return { pass: false, why: 'the last wheelhouse:reviewer report has no report block' };
  if (prHead === null || last.commit !== prHead) return { pass: false, why: `the last wheelhouse:reviewer report names ${last.commit ?? 'no commit'}, not the pull request's head ${prHead ?? '(none)'}` };
  if (String(last.pr) !== String(prNumber)) return { pass: false, why: `the last wheelhouse:reviewer report says pr: ${last.pr}, not ${prNumber}` };
  if (branchHead !== prHead) return { pass: false, why: 'the branch moved on after the last push, so the pull request is not its head' };
  return { pass: true, why: `the fixes after the final review were reviewed again; the last wheelhouse:reviewer report (${last.verdict}) names pull request #${prNumber}'s head` };
}

export default {
  id: 21,
  title: 'Fixes after the final review are reviewed again, and the last review is on the pull request\'s head',

  setup: (dir, variant) => setUpFeature(dir, {
    work: WORK,
    lane: 'small',
    goal: GOAL,
    done: DONE,
    plan: { path: PLAN, text: plan },
    brief: variant === 'with' ? 'wheelhouse' : plainBrief,
    agents: { builder: agentText('builder'), reviewer: standInReviewer(), tester: agentText('tester') },
  }),

  prompt: 'Read `.wheelhouse/feature/brief.md` and follow it. The plan is written and you may build it now. Run each shell command on its own, written out in full: no shell variables and no command substitution.',

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers()]; } },
    without: { get pluginDirs() { return [locateSuperpowers()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 80,

  pass: ({ events, dir, context }) => {
    const records = context.helper.records();
    const pushes = records.filter((r) => r.route === 'push' && !r.refused && r.branch === BRANCH);
    const opened = records.filter((r) => r.route === 'pr/open' && !r.refused);
    return judge({
      calls: callsOf(events),
      runs: subagentRuns(events),
      prHead: pushes.at(-1)?.sha ?? null,
      prNumber: opened.at(-1)?.number ?? null,
      branchHead: headOf(dir, BRANCH),
    });
  },
};
