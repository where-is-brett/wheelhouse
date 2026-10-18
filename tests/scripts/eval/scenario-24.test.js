// tests/scripts/eval/scenario-24.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import scenario, { handoffSeen } from '../../eval/build-loop/24-override-wins.js';

const override = fs.readFileSync(new URL('../../../templates/brief/override.md', import.meta.url), 'utf8');

function ending(text, { subtype = 'success', tools = [] } = {}) {
  return [
    ...tools.map((name) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input: {} }] } })),
    { type: 'assistant', message: { content: [{ type: 'text', text }] } },
    { type: 'result', subtype, result: text, usage: { input_tokens: 1, output_tokens: 1 } },
  ];
}

const executionQuestion = 'Plan complete and saved. Please review the plan. Which execution approach would you prefer?\n\n1. Subagent-Driven\n2. Inline Execution';
const finishingMenu = 'Implementation complete. What would you like to do?\n\n1. Merge back to main locally\n2. Push and create a Pull Request\n3. Keep the branch as-is\n\nWhich option?';

test('scenario 24 has the shape run.js and the harness expect', () => {
  assert.equal(scenario.id, 24);
  assert.equal(scenario.prompt, 'Read `.wheelhouse/feature/brief.md` and follow it; then run the plan.');
  assert.equal(typeof scenario.setup, 'function');
  assert.equal(typeof scenario.pass, 'function');
  assert.deepEqual(Object.keys(scenario.variants).sort(), ['with', 'without']);
});

test('setup writes a two-task plan, and a brief that starts with the override only in the with variant', async () => {
  for (const variant of ['with', 'without']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-24-'));
    await scenario.setup(dir, variant);
    const plan = fs.readFileSync(path.join(dir, 'docs', 'superpowers', 'plans', '2026-10-18-greetings.md'), 'utf8');
    assert.equal([...plan.matchAll(/^### Task \d+:/gm)].length, 2);
    const brief = fs.readFileSync(path.join(dir, '.wheelhouse', 'feature', 'brief.md'), 'utf8');
    assert.match(brief, /docs\/superpowers\/plans\/2026-10-18-greetings\.md/);
    if (variant === 'with') {
      assert.ok(brief.startsWith(override.trimEnd()), 'the override is the brief\'s first section');
    } else {
      assert.ok(!brief.includes('These rules win over any skill'));
    }
  }
});

test('handoffSeen recognises Superpowers\' execution-method question and its finishing menu', () => {
  assert.ok(handoffSeen(ending(executionQuestion)));
  assert.ok(handoffSeen(ending(finishingMenu)));
  assert.equal(handoffSeen(ending('Both tasks are done and committed on the branch. I could not open a pull request: no helper is available here.')), null);
  assert.equal(handoffSeen(ending('I did not ask which approach to use; I built it directly.')), null);
});

test('with the override, the session must end without a hand-off and never call AskUserQuestion', () => {
  const run = (events) => scenario.pass({ events, dir: '/unused', variant: 'with' });
  assert.equal(run(ending('Done. Both tasks committed.')).pass, true);
  assert.equal(run(ending(executionQuestion)).pass, false);
  assert.match(run(ending(finishingMenu)).why, /hand-off/);
  const asked = run(ending('Done.', { tools: ['AskUserQuestion'] }));
  assert.equal(asked.pass, false);
  assert.match(asked.why, /AskUserQuestion/);
});

test('a session that ran out of turns or never finished proves nothing', () => {
  const run = (events) => scenario.pass({ events, dir: '/unused', variant: 'with' });
  const early = run(ending('Working on task 2', { subtype: 'error_max_turns' }));
  assert.equal(early.pass, false);
  assert.match(early.why, /inconclusive/);
  assert.equal(run([]).pass, false);
});

test('without the override, Superpowers\' own hand-off must be seen, or the comparison shows nothing', () => {
  const run = (events) => scenario.pass({ events, dir: '/unused', variant: 'without' });
  assert.equal(run(ending(executionQuestion)).pass, true);
  assert.equal(run(ending(finishingMenu)).pass, true);
  assert.equal(run(ending('Done. Both tasks committed.', { tools: ['AskUserQuestion'] })).pass, true);
  const none = run(ending('Done. Both tasks committed.'));
  assert.equal(none.pass, false);
  assert.match(none.why, /no hand-off/);
});
