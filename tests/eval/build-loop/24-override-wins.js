// tests/eval/build-loop/24-override-wins.js
// Scenario 24 (design section 15): Superpowers' session-start text and the
// Wheelhouse override disagree; the override must win. The session is given a
// two-task plan and a brief, and asked to run the plan. Run it with
// `npm run eval -- 24 --variant with` and `--variant without`.
//
// The two variants load the same Superpowers and differ only in the brief: the
// `with` brief opens with templates/brief/override.md, the `without` brief is
// the feature section alone. So `with` passes when the plan was built (both
// files exist and are committed), the session never ends by handing a choice
// back to the person (Superpowers' execution-method question, its finishing
// menu, or any closing question) and never calls AskUserQuestion; `without` is
// the control, and passes when Superpowers' own hand-off is seen, which shows
// the test can see it.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { finalText, toolCalls, locateSuperpowers } from '../../../scripts/eval/harness.js';

const override = fs.readFileSync(fileURLToPath(new URL('../../../templates/brief/override.md', import.meta.url)), 'utf8');

const PLAN = 'docs/superpowers/plans/2026-10-18-greetings.md';
const PLAN_FILES = ['greet.js', 'farewell.js'];

// The commands the plan needs, allowed in the scratch project's own settings.
const SETTINGS = {
  permissions: {
    allow: ['Bash(git add *)', 'Bash(git commit *)', 'Bash(git status *)', 'Bash(git log *)', 'Bash(git diff *)', 'Bash(git show *)', 'Bash(git branch *)', 'Bash(git rev-parse *)', 'Bash(node *)'],
  },
};

const plan = `# Greetings Implementation Plan

**Goal:** Two small text helpers, each in its own file.

**Architecture:** Plain Node.js ES modules, no dependencies.

### Task 1: The greeting

**Files:**
- Create: \`greet.js\`

- [ ] **Step 1:** Create \`greet.js\` exporting \`greet(name)\`, which returns \`Hello, <name>!\`.
- [ ] **Step 2:** Commit.

### Task 2: The farewell

**Files:**
- Create: \`farewell.js\`

- [ ] **Step 1:** Create \`farewell.js\` exporting \`farewell(name)\`, which returns \`Goodbye, <name>.\`.
- [ ] **Step 2:** Commit.
`;

const feature = `# Brief: greetings

The feature is two small text helpers, \`greet.js\` and \`farewell.js\`. The plan is at \`${PLAN}\`; build it.
`;

// Superpowers 7.0.0's own hand-offs, from its wording: writing-plans' closing
// question (Execution Handoff), and finishing-a-development-branch's menu (Step 4).
const HANDOFFS = [
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

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// What shows the plan was run: each file its tasks create exists in the
// project, or is committed on some branch (the session may have worked on one),
// and each task's commit is there, as two separate commits. Returns the
// problems found, empty when the plan was built.
export function buildProblems(dir) {
  const problems = [];
  const commitsAdding = [];
  for (const file of PLAN_FILES) {
    let commits = [];
    try {
      commits = git(dir, 'log', '--all', '--diff-filter=A', '--format=%H', '--', file).split('\n').filter(Boolean);
    } catch { /* no commits at all */ }
    if (!commits.length && !fs.existsSync(path.join(dir, file))) problems.push(`${file} was never created`);
    else if (!commits.length) problems.push(`${file} was never committed`);
    commitsAdding.push(commits[0] ?? null);
  }
  if (!problems.length && commitsAdding[0] === commitsAdding[1]) problems.push('both files came in one commit, not one per task');
  return problems;
}

function resultOf(events) {
  return events.findLast((event) => event.type === 'result');
}

export default {
  id: 24,
  title: 'Superpowers\' session-start text and the override disagree: the override wins',

  setup: async (dir, variant) => {
    const write = (relative, content) => {
      const file = path.join(dir, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
    };
    write('.claude/settings.json', JSON.stringify(SETTINGS, null, 2) + '\n');
    write(PLAN, plan);
    write('.wheelhouse/feature/brief.md', variant === 'with' ? `${override.trimEnd()}\n\n---\n\n${feature}` : feature);
  },

  prompt: 'Read `.wheelhouse/feature/brief.md` and follow it; then run the plan.',

  // Superpowers' installed folder is found when a run starts, from Claude Code's
  // own list of installed plugins, not when this file is read.
  variants: {
    with: { get pluginDirs() { return [locateSuperpowers()]; } },
    without: { get pluginDirs() { return [locateSuperpowers()]; } },
  },

  // Edits are accepted; the commands the plan needs are allowed by the scratch project's settings.
  permissionMode: 'acceptEdits',
  maxTurns: 40,

  pass: ({ events, dir, variant }) => {
    const asked = toolCalls(events).some((call) => call.name === 'AskUserQuestion');
    const handoff = handoffSeen(events);
    const result = resultOf(events);
    if (variant === 'without') {
      if (asked) return { pass: true, why: 'Superpowers\' own hand-off seen: it called AskUserQuestion' };
      if (handoff) return { pass: true, why: `Superpowers' own hand-off seen: ${handoff}` };
      return { pass: false, why: 'control shows no hand-off, so this run cannot show the override winning' };
    }
    if (asked) return { pass: false, why: 'it called AskUserQuestion' };
    if (handoff) return { pass: false, why: `it ended with a hand-off: ${handoff}` };
    if (endsInQuestion(events)) return { pass: false, why: 'it ended on a question to the person' };
    if (!result || result.subtype !== 'success') {
      return { pass: false, why: `inconclusive: the session ended as ${result?.subtype ?? 'no result'}, not with a finished answer` };
    }
    const problems = buildProblems(dir);
    if (problems.length) return { pass: false, why: `inconclusive: the plan was not built (${problems.join('; ')})` };
    return { pass: true, why: 'the plan was built, it ended without a hand-off and never called AskUserQuestion' };
  },
};
