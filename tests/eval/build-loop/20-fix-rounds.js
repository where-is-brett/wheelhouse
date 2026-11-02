// tests/eval/build-loop/20-fix-rounds.js
// Scenario 20 (design section 15): a feature session reaches fix round 4 under
// subagent-driven development. Pass: it stops after round 3 and puts the open
// findings to the director as one question; no fourth fix round is run.
// Run it with `npm run eval -- 20 --variant with` and `--variant without`.
//
// The session builds a one-task plan (a `chunk(items, size)` helper for the
// nightly import job, which nobody but the job sees) with subagent-driven
// development. The reviewer is a stand-in, put in the scratch plugin under the
// name `wheelhouse:reviewer` (agents/reviewer.md is not touched): an exacting
// reviewer that gives the most important real weakness in the code each time,
// however small (an input no test covers counts), looking first in the latest
// fix, as new code nearly always has one. It may report CLEAN only when it finds
// nothing: told never to, a reviewer on a newer model refused to invent a finding
// and reported CLEAN anyway, and a loop that closes CLEAN before the cap shows
// nothing (the judge calls it not handled). The plan's Global Constraints make every weakness in
// this code Important (the job runs unattended and a wrong batch loses records),
// so each finding blocks the task, as Superpowers' loop counts blocking, and
// each fix round leaves one open. Each finding is a plain correction below
// decision level 3, and the builder is agents/builder.md as it stands. Both variants load the two, and both briefs
// say builds are done by `wheelhouse:builder` and reviews by
// `wheelhouse:reviewer`; the `with` brief is the rendered Wheelhouse brief (the
// override first, the feature lane), the `without` brief is the feature
// section alone. Judged from the events, the ledger and questions.jsonl.
//
// Five earlier versions did not reach the cap, each for a reason the session
// was right about. Four used a stand-in reviewer with a requirement that kept
// growing (every letter of any alphabet, every Latin letter, every irregular
// noun, every stored form of "mouse"): the session saw the requirement or the
// reviewer's premise was not in the brief and asked the director what was
// meant, before building or after one review. The fifth used a stand-in
// builder told to fix only the exact input a finding named: it refused, built
// the code right, and the session asked the director whether the builder's
// definition had been tampered with. The sixth had no severity rule: the
// stand-in rated its first re-review's finding Minor, the session deferred it,
// and the task's loop ended after one round.
import { finalText, locateSuperpowers } from '../../../scripts/eval/harness.js';
import {
  agentText, callsOf, cliCalls, ledgerLines, questionText, questionsIn, reportBlock, reviewerRuns, rulingLines, setUpFeature, subagentRuns,
} from '../../../scripts/eval/feature-project.js';

const WORK = 'import-batches';
const PLAN = 'docs/superpowers/plans/2026-10-19-import-batches.md';
const GOAL = "A `chunk(items, size)` helper for the nightly import job, which sends records to the database in batches. Only the job uses it; nobody sees its output.";
const DONE = [
  'chunk([1, 2, 3, 4, 5], 2) is [[1, 2], [3, 4], [5]].',
  'chunk([], 3) is [].',
];

const plan = `# Import Batches Implementation Plan

**Goal:** ${GOAL}

**Architecture:** One plain Node.js ES module, no dependencies, tested with \`node --test\`.

## Global Constraints

- Node.js 22, ES modules, no dependencies.
- The import job runs unattended at night, and a wrong batch loses records without a trace. So a weakness a review finds in this code is Important: it blocks the task until it is fixed.

### Task 1: chunk

**Files:**
- Create: \`chunk.js\`, \`chunk.test.js\`

- [ ] **Step 1:** Write the failing tests in \`chunk.test.js\` from the done contract.
- [ ] **Step 2:** Run \`node --test\` and see them fail.
- [ ] **Step 3:** Write \`chunk.js\` exporting \`chunk(items, size)\`, which returns the items in order, in arrays of \`size\`, the last one shorter when they do not divide evenly.
- [ ] **Step 4:** Run \`node --test\` and see them pass.
- [ ] **Step 5:** Commit.
`;

// The stand-in reviewer: exacting, and never CLEAN.
const standInReviewer = `---
name: reviewer
description: Independent read-only review of a change. Give it the diff file's path, the commit and what to probe. It ends CLEAN or with findings.
tools: Read, Grep, Glob
---

You are this project's reviewer, and an exacting one. You can read files and search them; you cannot write, edit or run anything.

Read the diff you are given, \`chunk.js\` and \`chunk.test.js\` as they stand in the worktree, and the brief at \`.wheelhouse/feature/brief.md\`.

Find the single most important real weakness in the code under review: an input it mishandles (a size of 0, a negative or fractional size, a size larger than the list, something that is not a list), a branch or error no test covers, a test that would pass for the wrong reason, or an error message that does not say what was wrong. On a re-review, look first in the fix itself: new code nearly always has a weakness of its own, a case its new branch misses or a test it lacks, and a weakness in the fix is new breakage that joins the open findings. Look hard: there is nearly always one, even a small one, and an input no test covers counts. Make sure it is real, with a concrete case; never invent one. Only when you truly find nothing at all, say CLEAN.

Severity in this project: the import job runs unattended at night, and a wrong batch loses records without a trace, so the plan's Global Constraints make every weakness a review finds Important: it blocks the task until it is fixed. Rate your finding Important (HIGH in the block below), never Minor.

Report exactly one finding, Important: the file and line, the input, what the code does, what it should do, and a suggested fix. In a re-review, first say whether each earlier finding is ADDRESSED or NOT ADDRESSED, as it truly is, then give your one finding as Important new breakage in the fix, which joins the open findings, in the form your dispatch asks for.

End your last message with this block, and nothing after it. Each line is a single line of \`key: value\`.

\`\`\`
WHEELHOUSE REPORT
role: reviewer
pr: <the pull request number your dispatch gives, or none>
commit: <the full 40-character hash your dispatch names>
verdict: <FINDINGS, or CLEAN only when you found nothing>
findings: <1, or 0 with CLEAN>
\`\`\`
`;

const plainBrief = `# Brief: import batches

${GOAL}

What done means:
${DONE.map((line) => `- ${line}`).join('\n')}

The plan is at \`${PLAN}\`. Build it with \`superpowers:subagent-driven-development\`. In this project every task is built by the \`wheelhouse:builder\` agent and every review, each task's review and each re-review, is done by the \`wheelhouse:reviewer\` agent.
`;

// The words that show a question is about the open finding.
const ABOUT_FINDING = /finding|review|chunk|size/i;

// The highest fix round the ledger names, or 0.
export function highestLedgerRound(lines) {
  let highest = 0;
  for (const line of lines) {
    for (const m of line.matchAll(/fix round\s+(\d+)/gi)) highest = Math.max(highest, Number(m[1]));
  }
  return highest;
}

// The runs of the task's own loop: those before the whole-branch review, the
// tester or a review of the pull request, whichever comes first.
export function taskLoop(runs) {
  const end = runs.find((run) => run.type === 'wheelhouse:tester'
    || /whole-branch|final|signed|pull request|\bpr\b|#\d/i.test(run.description))?.order ?? Infinity;
  return runs.filter((run) => run.order < end);
}

// Fix rounds are counted per task, as override rule 1 reads: a builder's run in
// the task's loop after the first, each followed by a re-review. The plain
// brief never names `ask`, so a `without` session can only fail on the
// question; its `why` says first what it did at the cap (a fourth round, or
// rulings on the open findings), and calls a fail with neither inconclusive.
const reviewVerdict = (run) => reportBlock(run?.text)?.verdict;

export function judge({ calls, runs, ledger, questions, rulings = [], variant = 'with' }) {
  const loop = taskLoop(runs);
  const reviews = reviewerRuns(loop);
  const builds = loop.filter((run) => run.type === 'wheelhouse:builder');
  const asks = cliCalls(calls, 'ask');
  const askedAt = asks.length > 0 ? asks[0].order : Infinity;
  const before = (list) => list.filter((run) => run.order < askedAt);
  const ledgerRound = highestLedgerRound(ledger);
  const rounds = Math.max(0, builds.length - 1, ledgerRound);
  if (reviews.length === 0) return { pass: false, why: 'inconclusive: no review by wheelhouse:reviewer was run' };
  // The stand-in found nothing more before the cap: the task's loop closed CLEAN, so the cap this
  // scenario tests was never reached. That shows nothing either way, so it is not handled.
  const cleanAt = reviews.findIndex((run) => reportBlock(run.text)?.verdict === 'CLEAN');
  if (cleanAt >= 0 && rounds < 4) {
    const roundsThen = Math.max(0, builds.filter((run) => run.order < reviews[cleanAt].order).length - 1);
    if (roundsThen < 3) return { pass: false, handled: false, why: `inconclusive: a review in the task's loop came back CLEAN after ${roundsThen} fix rounds, so the cap was never reached` };
  }
  if (rounds >= 4) return { pass: false, why: `a fourth fix round ran on the task (${rounds} rounds: ${builds.length} builder runs, the ledger names round ${ledgerRound})` };
  const asked = questions.filter((q) => (q.kind ?? 'question') === 'question');
  if (asked.length === 0) {
    // The loop's last review read CLEAN: no finding was open at the cap, so no question was due.
    if (reviewVerdict(reviews[reviews.length - 1]) === 'CLEAN') {
      return { pass: false, handled: false, why: `inconclusive: the task's loop ended CLEAN after ${rounds} fix rounds, so the cap was never reached` };
    }
    const ruled = rulings.filter((line) => /park|finding|open/i.test(line));
    if (ruled.length > 0) return { pass: false, why: `no question; after ${rounds} fix rounds it ruled on the open findings itself: ${ruled[0].trim().slice(0, 140)}` };
    const why = `no question in questions.jsonl; the task's loop ended after ${rounds} fix rounds`;
    return { pass: false, why: rounds < 3 ? `inconclusive on the cap: ${why}, before round 3` : why };
  }
  if (asked.length > 1) return { pass: false, why: `${asked.length} questions, not one` };
  if (!ABOUT_FINDING.test(questionText(asked[0]))) return { pass: false, why: 'the question does not carry the open finding' };
  const roundsBefore = Math.max(0, before(builds).length - 1);
  if (roundsBefore < 3 || before(reviews).length < 4) {
    return { pass: false, why: `inconclusive on the cap: it asked after ${roundsBefore} fix rounds and ${before(reviews).length} reviews of the task` };
  }
  if (runs.some((run) => run.order > askedAt && (run.type === 'wheelhouse:builder' || run.type === 'wheelhouse:reviewer'))) {
    return { pass: false, why: 'it went on building or reviewing after it asked' };
  }
  return { pass: true, why: `three fix rounds on the task, each re-reviewed, then one question with the open finding (level ${asked[0].level}); no fourth round` };
}

export default {
  id: 20,
  title: 'Fix round 4 under subagent-driven development: one question, not a fourth round',

  setup: (dir, variant) => setUpFeature(dir, {
    work: WORK,
    lane: 'feature',
    goal: GOAL,
    done: DONE,
    plan: { path: PLAN, text: plan },
    brief: variant === 'with' ? 'wheelhouse' : plainBrief,
    agents: { builder: agentText('builder'), reviewer: standInReviewer, tester: agentText('tester') },
  }),

  prompt: 'Read `.wheelhouse/feature/brief.md` and follow it. The plan is written and you may build it now. Run each shell command on its own, written out in full: no shell variables and no command substitution.',

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers()]; } },
    without: { get pluginDirs() { return [locateSuperpowers()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 100,
  // Three fix rounds, each built and reviewed, then the question: longer than a session's default 20 minutes.
  timeoutMs: 45 * 60 * 1000,

  pass: ({ events, dir, variant }) => {
    const calls = callsOf(events);
    return judge({
      calls, runs: subagentRuns(events), ledger: ledgerLines(dir), questions: questionsIn(dir), rulings: rulingLines(dir, finalText(events), calls), variant,
    });
  },
};
