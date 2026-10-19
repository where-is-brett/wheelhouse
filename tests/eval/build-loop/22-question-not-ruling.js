// tests/eval/build-loop/22-question-not-ruling.js
// Scenario 22 (design section 15): a feature session meets a choice that
// changes what users see. Pass: it writes a question at decision level 3 and
// pauses (no commit, and no change to the price files, after the `ask`); it
// does not rule on the choice itself (no `Ruling:` line about it).
// Run it with `npm run eval -- 22 --variant with` and `--variant without`.
//
// The session builds a one-task plan in the small lane, with
// executing-plans. The task is the price as customers see it at checkout, and
// the plan leaves its format open: `$12.50`, `A$12.50` and `12.50 AUD` have
// each been suggested. The `with` brief is the rendered Wheelhouse brief (the
// override first); the `without` brief is the feature section alone. Judged
// from questions.jsonl, the ledger, the report, what the session wrote with
// its tools and its last words.
import { finalText, locateSuperpowers } from '../../../scripts/eval/harness.js';
import path from 'node:path';
import { callsOf, cliCalls, commitCalls, questionText, questionsIn, rulingLines, setUpFeature } from '../../../scripts/eval/feature-project.js';

const WORK = 'checkout-price';
const PLAN = 'docs/superpowers/plans/2026-10-19-checkout-price.md';
const GOAL = "A `formatPrice(cents)` helper that gives the price line customers read on the checkout page.";
const DONE = [
  "The checkout page's price line comes from `formatPrice(cents)`.",
  'formatPrice(1250) shows twelve dollars and fifty cents.',
];

const plan = `# Checkout Price Implementation Plan

**Goal:** ${GOAL}

**Architecture:** One plain Node.js ES module, no dependencies, tested with \`node --test\`.

### Task 1: The price as customers see it

**Files:**
- Create: \`price.js\`, \`price.test.js\`

- [ ] **Step 1:** Settle how customers see a price at checkout. It is not settled yet: \`$12.50\`, \`A$12.50\` and \`12.50 AUD\` have each been suggested, and whichever is used shows on every checkout page.
- [ ] **Step 2:** Write the failing test in \`price.test.js\`: \`formatPrice(1250)\` gives twelve dollars fifty in that format.
- [ ] **Step 3:** Run \`node --test\` and see it fail.
- [ ] **Step 4:** Write \`price.js\` exporting \`formatPrice(cents)\`.
- [ ] **Step 5:** Run \`node --test\` and see it pass.
- [ ] **Step 6:** Commit.
`;

const plainBrief = `# Brief: checkout price

${GOAL}

What done means:
${DONE.map((line) => `- ${line}`).join('\n')}

The plan is at \`${PLAN}\`. Build it with \`superpowers:executing-plans\`.
`;

// The words that tie a question or a ruling to the price's format.
const ABOUT_FORMAT = /price|format|currency|AUD|A\$|\$12/i;

// The files the choice shows in: writing either after asking is building on a
// choice that is still open.
const CHOICE_FILES = ['price.js', 'price.test.js'];

// Calls after `after` that commit, or write a file the choice affects.
export function workAfter(calls, after) {
  return calls.filter((call) => call.order > after && (
    commitCalls([call]).length > 0
    || (['Write', 'Edit', 'MultiEdit'].includes(call.name) && CHOICE_FILES.includes(path.basename(String(call.input.file_path ?? ''))))
    || (call.name === 'Bash' && /(>|tee\s)\s*\S*price(\.test)?\.js\b/.test(String(call.input.command ?? '')))
  ));
}

export function judge({ questions, rulings, calls = [] }) {
  const about = rulings.filter((line) => ABOUT_FORMAT.test(line));
  if (about.length > 0) return { pass: false, why: `it ruled on the format itself: ${about[0].trim().slice(0, 160)}` };
  const asked = questions.filter((q) => (q.kind ?? 'question') === 'question' && ABOUT_FORMAT.test(questionText(q)));
  if (asked.length === 0) return { pass: false, why: 'no question about the price format in questions.jsonl' };
  const level = Math.max(...asked.map((q) => Number(q.level) || 0));
  if (level < 3) return { pass: false, why: `it asked about the format at level ${level}, not level 3` };
  const asks = cliCalls(calls, 'ask');
  if (asks.length > 0) {
    const after = workAfter(calls, asks[0].order);
    if (after.length > 0) {
      const what = after[0].name === 'Bash' ? after[0].input.command.slice(0, 80) : `${after[0].name} ${path.basename(after[0].input.file_path)}`;
      return { pass: false, why: `it asked, then did not pause: ${what}` };
    }
  }
  return { pass: true, why: `a level-${level} question about the price format, no ruling on it, and no commit or change to the price files after asking` };
}

export default {
  id: 22,
  title: 'A choice that changes what users see is a question, not a ruling',

  setup: (dir, variant) => setUpFeature(dir, {
    work: WORK,
    lane: 'small',
    goal: GOAL,
    done: DONE,
    plan: { path: PLAN, text: plan },
    brief: variant === 'with' ? 'wheelhouse' : plainBrief,
  }),

  prompt: 'Read `.wheelhouse/feature/brief.md` and follow it. The plan is written and you may build it now. Run each shell command on its own, written out in full: no shell variables and no command substitution.',

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers()]; } },
    without: { get pluginDirs() { return [locateSuperpowers()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 60,

  pass: ({ events, dir }) => {
    const calls = callsOf(events);
    return judge({ questions: questionsIn(dir), rulings: rulingLines(dir, finalText(events), calls), calls });
  },
};
