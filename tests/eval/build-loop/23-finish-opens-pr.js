// tests/eval/build-loop/23-finish-opens-pr.js
// Scenario 23 (design section 15): a feature session finishes its branch.
// Pass: it opens one pull request through the helper (`open-pr`); it does not
// merge locally and does not wait for a menu (no `git merge`, no
// AskUserQuestion). Run it with `npm run eval -- 23 --variant with` and
// `--variant without`.
//
// The branch already holds the plan's one task, built and committed with its
// test; the session is told to finish it. The `with` brief is the rendered
// Wheelhouse brief (the override first, the small lane), with Wheelhouse's own
// agents in a scratch plugin; the `without` brief is the feature section
// alone. Judged from the events and the stand-in helper's records.
import { locateSuperpowers } from '../../../scripts/eval/harness.js';
import { agentText, callsOf, cliCalls, mergeCalls, setUpFeature } from '../../../scripts/eval/feature-project.js';

const WORK = 'greeting';
const PLAN = 'docs/superpowers/plans/2026-10-19-greeting.md';
const GOAL = 'A `greet(name)` helper that gives the greeting shown at the top of the home page.';
const DONE = ["greet('Ada') is 'Hello, Ada!'."];

const plan = `# Greeting Implementation Plan

**Goal:** ${GOAL}

**Architecture:** One plain Node.js ES module, no dependencies, tested with \`node --test\`.

### Task 1: greet

**Files:**
- Create: \`greet.js\`, \`greet.test.js\`

- [ ] **Step 1:** Write the failing test in \`greet.test.js\`: \`greet('Ada')\` is \`'Hello, Ada!'\`.
- [ ] **Step 2:** Run \`node --test\` and see it fail.
- [ ] **Step 3:** Write \`greet.js\` exporting \`greet(name)\`.
- [ ] **Step 4:** Run \`node --test\` and see it pass.
- [ ] **Step 5:** Commit.
`;

// The task, built and committed on the branch before the session starts.
const built = {
  'greet.js': "export function greet(name) {\n  return `Hello, ${name}!`;\n}\n",
  'greet.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from './greet.js';\n\ntest('greets by name', () => {\n  assert.equal(greet('Ada'), 'Hello, Ada!');\n});\n",
};

const plainBrief = `# Brief: greeting

${GOAL}

What done means:
${DONE.map((line) => `- ${line}`).join('\n')}

The plan is at \`${PLAN}\`.
`;

export function judge({ calls, opened }) {
  const merges = mergeCalls(calls);
  if (merges.length > 0) return { pass: false, why: `it merged locally: ${merges[0].input.command.slice(0, 120)}` };
  if (calls.some((call) => call.name === 'AskUserQuestion')) return { pass: false, why: 'it called AskUserQuestion' };
  const commands = cliCalls(calls, 'open-pr').length;
  if (opened.length === 0) return { pass: false, why: `no pull request was opened through the helper (${commands} open-pr command(s))` };
  if (opened.length > 1) return { pass: false, why: `${opened.length} pull requests were opened, not one` };
  return { pass: true, why: `one pull request opened through the helper (#${opened[0].number}); no git merge and no AskUserQuestion` };
}

export default {
  id: 23,
  title: 'Finishing a branch opens a pull request through the helper, without a menu or a local merge',

  setup: (dir, variant) => setUpFeature(dir, {
    work: WORK,
    lane: 'small',
    goal: GOAL,
    done: DONE,
    plan: { path: PLAN, text: plan },
    branchFiles: built,
    brief: variant === 'with' ? 'wheelhouse' : plainBrief,
    agents: variant === 'with' ? { builder: agentText('builder'), reviewer: agentText('reviewer'), tester: agentText('tester') } : null,
  }),

  prompt: 'Read `.wheelhouse/feature/brief.md` and follow it. Every task in the plan is built and committed on this branch; finish the branch. Run each shell command on its own, written out in full: no shell variables and no command substitution.',

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers()]; } },
    without: { get pluginDirs() { return [locateSuperpowers()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 60,

  pass: ({ events, context }) => judge({
    calls: callsOf(events),
    opened: context.helper.records().filter((r) => r.route === 'pr/open' && !r.refused),
  }),
};
