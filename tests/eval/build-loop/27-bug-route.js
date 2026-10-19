// tests/eval/build-loop/27-bug-route.js
// Scenario 27 (design sections 5.3 and 15): a bug report. The front desk
// sends it down route 4, and the foreman starts a bug session with the bug
// brief; this scenario starts from that brief, so route 4 itself is the front
// desk's and not checked here. Pass: the bug session reproduces the bug before
// any fix: it writes a test file and runs a test command that fails, before
// its first write to a source file.
// Run it with `npm run eval -- 27 --variant with` and `--variant without`.
//
// The project has `formatDuration(seconds)`, which shows a video's length on
// its card, and its tests, which pass. It pads the seconds only when they are
// 0, so a 65-second clip shows as "1:5". The bug is plain and its fix is one
// step, so the bug lane's step 4 applies: the quick lane's loop, with a
// regression test that fails before the fix. The `with` brief is the rendered
// Wheelhouse brief (the override first, the bug lane), with Wheelhouse's own
// agents in a scratch plugin; the `without` brief is the report and the done
// contract alone. Both variants load Superpowers and Matt Pocock's skills, as
// a director's project has both. Judged from the order of the events: every
// tool call, the session's and its subagents', by the order it was made.
import path from 'node:path';
import { locateMattSkills, locateSuperpowers } from '../../../scripts/eval/harness.js';
import { agentText, callsOf, setUpFeature } from '../../../scripts/eval/feature-project.js';

const WORK = 'video-length';
const GOAL = 'A customer reports: "The length on a video\'s card is wrong. A 65-second clip shows as 1:5." The length comes from `formatDuration(seconds)` in `duration.js`.';
const DONE = [
  'formatDuration(65) is "1:05".',
  'formatDuration(60) is still "1:00" and formatDuration(754) still "12:34".',
];

// The project as it stands: the bug, and tests that pass because none covers it.
const files = {
  'duration.js': `// The length shown on a video's card, as minutes and seconds.
export function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return \`\${minutes}:\${rest === 0 ? '00' : rest}\`;
}
`,
  'duration.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from './duration.js';

test('a whole minute', () => {
  assert.equal(formatDuration(60), '1:00');
});

test('minutes and seconds', () => {
  assert.equal(formatDuration(754), '12:34');
});
`,
};

const plainBrief = `# Brief: video length

${GOAL}

What done means:
${DONE.map((line) => `- ${line}`).join('\n')}
`;

const WRITES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const CODE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/;
const TEST_NAME = /(?:^|[\\/])(?:tests?|__tests__)[\\/]|\.(?:test|spec)\.[^.\\/]+$/;
// Folders whose files are the session's papers, not the product's source.
const NOT_SOURCE = /(?:^|[\\/])(?:\.wheelhouse|\.superpowers|\.claude|docs|node_modules)[\\/]/;

export const isTestFile = (file) => TEST_NAME.test(file);
export const isSourceFile = (file) => CODE.test(file) && !isTestFile(file) && !NOT_SOURCE.test(file);

// The files a call writes: a write tool's file, or a shell command that writes
// into a file by redirect, `tee`, `sed -i` or `cp`/`mv` onto it.
export function filesWritten(call) {
  if (WRITES.includes(call.name)) return [String(call.input.file_path ?? call.input.notebook_path ?? '')];
  if (call.name !== 'Bash' || typeof call.input.command !== 'string') return [];
  const command = call.input.command;
  const found = [];
  for (const m of command.matchAll(/(?:>>?|\btee\s+(?:-a\s+)?)\s*["']?([^\s"'|;&<>]+)/g)) found.push(m[1]);
  if (/\bsed\s+(?:-[a-zA-Z]*i|--in-place)/.test(command)) {
    for (const m of command.matchAll(/([^\s"'|;&<>]+\.[A-Za-z]+)(?=["']?\s*(?:$|[|;&]))/g)) found.push(m[1]);
  }
  for (const m of command.matchAll(/\b(?:cp|mv)\s+(?:-\S+\s+)*\S+\s+["']?([^\s"'|;&<>]+)/g)) found.push(m[1]);
  return found.filter((file) => file !== '/dev/null');
}

// A shell command that runs tests.
export const isTestCommand = (call) => call.name === 'Bash'
  && /\bnode\b[^\n|;&]*\s--test\b|\bnpm\s+(?:run\s+)?test\b|\bnpx\s+(?:vitest|jest)\b/.test(String(call.input.command ?? ''));

// A test command's result that shows a failure.
export const failed = (call) => Boolean(call.result) && (
  call.result.isError
  || /^#\s*fail\s+[1-9]/m.test(call.result.text)
  || /\bnot ok\b|✖|Exit code [1-9]/.test(call.result.text)
);

// The pass, from the order of the calls: a test file written, then a test
// command that fails, both before the first write to a source file.
export function judge({ calls }) {
  const writes = calls.flatMap((call) => filesWritten(call).map((file) => ({ call, file })));
  const firstSource = writes.find((w) => isSourceFile(w.file));
  const firstTest = writes.find((w) => isTestFile(w.file));
  const debugging = calls.some((call) => call.name === 'Skill' && /systematic-debugging/.test(String(call.input.skill ?? call.input.command ?? '')));
  const note = debugging ? 'it started systematic-debugging' : 'it did not start systematic-debugging';
  if (!firstSource) return { pass: false, why: `inconclusive: no source file was changed (${note})` };
  const sourceAt = firstSource.call.order;
  const sourceName = path.basename(firstSource.file);
  if (!firstTest || firstTest.call.order > sourceAt) {
    return { pass: false, why: `it changed ${sourceName} before writing any test (${note})` };
  }
  const run = calls.find((call) => isTestCommand(call) && call.order > firstTest.call.order && call.order < sourceAt && failed(call));
  if (!run) {
    const ran = calls.filter((call) => isTestCommand(call) && call.order < sourceAt).length;
    return { pass: false, why: `it wrote ${path.basename(firstTest.file)} but ran no failing test before changing ${sourceName} (${ran} test command(s) before it; ${note})` };
  }
  return {
    pass: true,
    why: `it wrote ${path.basename(firstTest.file)}, ran \`${run.input.command.slice(0, 60)}\` and saw it fail, then changed ${sourceName} (${note})`,
  };
}

export default {
  id: 27,
  title: 'A bug session reproduces the bug with a failing test before any fix',

  setup: (dir, variant) => setUpFeature(dir, {
    work: WORK,
    lane: 'bug',
    goal: GOAL,
    done: DONE,
    files,
    brief: variant === 'with' ? 'wheelhouse' : plainBrief,
    agents: { builder: agentText('builder'), reviewer: agentText('reviewer'), tester: agentText('tester') },
  }),

  prompt: 'Read `.wheelhouse/feature/brief.md` and follow it. Run each shell command on its own, written out in full: no shell variables and no command substitution.',

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
    without: { get pluginDirs() { return [locateSuperpowers(), locateMattSkills()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 80,

  pass: ({ events }) => judge({ calls: callsOf(events) }),
};
