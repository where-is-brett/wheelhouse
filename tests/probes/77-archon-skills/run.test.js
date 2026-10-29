// tests/probes/77-archon-skills/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testFirst, suiteRuns, skillsOpened, tokensPerRound, askedAPerson, unknownSkills } from '../../../probes/77-archon-skills/run.js';

// A Claude Code session transcript, one JSON line per entry, built from a list of steps.
let next = 0;
function transcript(steps) {
  const lines = [];
  for (const step of steps) {
    if (step.say) {
      lines.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: step.say }] } }));
      continue;
    }
    const id = `toolu_${++next}`;
    lines.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: step.tool, input: step.input }] } }));
    lines.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: step.result ?? '', is_error: step.error === true }] } }));
  }
  return lines;
}

const writeTest = { tool: 'Write', input: { file_path: '/w/test/price.test.ts', content: 'test' } };
const writeCode = { tool: 'Write', input: { file_path: '/w/src/price.ts', content: 'code' } };
const redRun = { tool: 'Bash', input: { command: 'bun test test/price.test.ts' }, result: 'error: Cannot find module "../src/price.ts"\n 0 pass\n 1 fail', error: true };
const greenRun = { tool: 'Bash', input: { command: 'bun test test/price.test.ts' }, result: ' 4 pass\n 0 fail' };

test('testFirst passes when a test file is written and run red before any source file is written', () => {
  const result = testFirst(transcript([writeTest, redRun, writeCode, greenRun]));
  assert.equal(result.pass, true);
  assert.ok(result.testWrittenAt < result.testFailedAt && result.testFailedAt < result.codeWrittenAt);
});

test('testFirst fails when source comes first', () => {
  const result = testFirst(transcript([writeCode, writeTest, redRun, greenRun]));
  assert.equal(result.pass, false);
});

test('testFirst fails when the test is never seen failing', () => {
  const result = testFirst(transcript([writeTest, writeCode, greenRun]));
  assert.equal(result.pass, false);
  assert.equal(result.testFailedAt, null);
});

test('suiteRuns counts each run of the suite command', () => {
  const lines = transcript([
    { tool: 'Bash', input: { command: 'bun test test/price.test.ts' } },
    { tool: 'Bash', input: { command: 'bun test' } },
    { tool: 'Bash', input: { command: 'cd /w && bun test 2>&1 | tail -5' } },
    { tool: 'Bash', input: { command: 'sh check.sh' } },
  ]);
  assert.equal(suiteRuns(lines, 'bun test'), 2);
  assert.equal(suiteRuns(lines, ['bun test', 'sh check.sh']), 3);
});

test('skillsOpened lists Skill tool calls in order', () => {
  const lines = transcript([
    { tool: 'Skill', input: { skill: 'tdd' } },
    { tool: 'Read', input: { file_path: '/w/README.md' } },
    { tool: 'Skill', input: { skill: 'codebase-design' } },
  ]);
  assert.deepEqual(skillsOpened(lines), ['tdd', 'codebase-design']);
});

test('askedAPerson finds a question to the user in the final message', () => {
  assert.equal(askedAPerson(transcript([writeTest, { say: 'Which seams would you like me to test?' }])), true);
  assert.equal(askedAPerson(transcript([writeTest, { say: 'Done. I assumed the seam is formatPrice. Suite green.' }])), false);
  assert.equal(askedAPerson(transcript([{ tool: 'AskUserQuestion', input: { questions: [] } }, { say: 'Done.' }])), true);
});

test('tokensPerRound reads one figure per loop iteration from the record', () => {
  const spend = (input, output) => ({ spend: { tokens: { source: 'provider', value: { input, output, cacheRead: input - 10, cacheWrite: 5 } } } });
  const record = {
    nodes: [
      { nodeId: 'build', iteration: 1, execution: spend(1000, 50) },
      { nodeId: 'build', iteration: 2, execution: spend(2000, 70) },
      { nodeId: 'build', iteration: 3, execution: spend(1500, 60) },
    ],
  };
  assert.deepEqual(tokensPerRound(record), [1050, 2070, 1560]);
});

test('tokensPerRound reads each round from its session when the record keeps one row for the loop', () => {
  // Archon v0.13.0: one row for the loop, its total, and one session id per round.
  const record = { nodes: [{ nodeId: 'build', sessionIds: ['s1', 's2'], execution: { node: { kind: 'loop' }, spend: { tokens: { value: { input: 9999, output: 99 } } } } }] };
  const reply = (id, fresh, cached, out) => JSON.stringify({ type: 'assistant', message: { id, usage: { input_tokens: fresh, cache_creation_input_tokens: 0, cache_read_input_tokens: cached, output_tokens: out } } });
  const transcripts = {
    s1: [reply('m1', 10, 1000, 5), reply('m1', 10, 1000, 5), reply('m2', 20, 2000, 7)],
    s2: [reply('m3', 30, 3000, 9)],
  };
  assert.deepEqual(tokensPerRound(record, transcripts), [1015 + 2027, 3039]);
  assert.deepEqual(tokensPerRound(record, { s1: transcripts.s1 }), [], 'a round with no transcript gives no figures');
});

test('unknownSkills names a skill that matches no copy, with or without the plugin prefix', () => {
  assert.deepEqual(unknownSkills(['wheelhouse:tdd', 'tddd', 'codebase-design'], ['tdd', 'codebase-design']), ['tddd']);
});

test('a run with no transcript fails every item', () => {
  for (const empty of [[], '', undefined]) {
    assert.equal(testFirst(empty).pass, false);
    assert.equal(suiteRuns(empty, 'bun test'), 0, 'item 12 needs exactly one run, so none fails it');
    assert.deepEqual(skillsOpened(empty), []);
    assert.equal(askedAPerson(empty), true, 'with nothing to read, the step cannot be shown not to have asked');
  }
  assert.deepEqual(tokensPerRound(undefined), []);
  assert.deepEqual(tokensPerRound({}), []);
});

test('testFirst reads a shell call that writes the test with a heredoc and runs it red in one go', () => {
  const lines = transcript([
    { tool: 'Bash', input: { command: "cat > test/price.test.ts <<'EOF'\nimport { test } from 'bun:test';\nEOF\nbun test test/price.test.ts 2>&1 | tail -8" }, result: "error: Cannot find module '../src/price'\n 0 pass\n 1 fail" },
    { tool: 'Bash', input: { command: "cat > src/price.ts <<'EOF'\nexport const formatPrice = () => '$0.00';\nEOF\nbun test test/price.test.ts" }, result: ' 1 pass\n 0 fail' },
  ]);
  assert.equal(testFirst(lines).pass, true);
});

test('testFirst ignores a test command written inside a heredoc body', () => {
  const lines = transcript([
    { tool: 'Bash', input: { command: "cat > src/price.ts <<'EOF'\n// run with bun test\nEOF" }, result: '' },
    writeTest, redRun,
  ]);
  const result = testFirst(lines);
  assert.equal(result.pass, false);
  assert.equal(result.codeWrittenAt < result.testWrittenAt, true);
});
