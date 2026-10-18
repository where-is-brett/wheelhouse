// tests/eval/build-loop/24-override-wins.js
// Scenario 24 (design section 15): Superpowers' session-start text and the
// Wheelhouse override disagree; the override must win. The session is given a
// two-task plan and a brief, and asked to run the plan. Run it with
// `npm run eval -- 24 --variant with` and `--variant without`.
//
// The two variants load the same Superpowers and differ only in the brief: the
// `with` brief opens with templates/brief/override.md, the `without` brief is
// the feature section alone. So `with` passes when the session never ends by
// handing the choice back to the person (an execution method, a finishing
// menu) and never calls AskUserQuestion; `without` is the control, and passes
// when Superpowers' own hand-off is seen, which shows the test can see it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalText, toolCalls, locateSuperpowers } from '../../../scripts/eval/harness.js';

const override = fs.readFileSync(fileURLToPath(new URL('../../../templates/brief/override.md', import.meta.url)), 'utf8');

const PLAN = 'docs/superpowers/plans/2026-10-18-greetings.md';

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

// Superpowers' own ways of handing a choice back: the plan's execution-method
// question, and the finishing menu.
const HANDOFFS = [
  ['an execution-method question', /which execution (approach|method)|choose an execution (approach|method)/i],
  ['a choice between subagent-driven and inline execution', /subagent-driven[\s\S]*inline execution|inline execution[\s\S]*subagent-driven/i],
  ['a request to review the plan', /please review the plan/i],
  ['the finishing menu (merge locally)', /merge back to .{0,40} locally/i],
  ['the finishing menu\'s question', /what would you like to do\?|which option\?/i],
];

// The reason the session's last words hand a choice back to the person, or null.
export function handoffSeen(events) {
  const tail = finalText(events).slice(-1200);
  if (!tail.includes('?') && !/please review the plan/i.test(tail)) return null;
  const found = HANDOFFS.find(([, pattern]) => pattern.test(tail));
  return found ? found[0] : null;
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

  permissionMode: 'acceptEdits',
  maxTurns: 40,

  pass: ({ events, variant }) => {
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
    if (!result || result.subtype !== 'success') {
      return { pass: false, why: `inconclusive: the session ended as ${result?.subtype ?? 'no result'}, not with a finished answer` };
    }
    return { pass: true, why: 'it ended without a hand-off and never called AskUserQuestion' };
  },
};
