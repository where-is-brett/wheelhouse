// tests/scripts/agents/hook-seam.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { Readable } from 'node:stream';
import { hookMain, answer, TRANSLATORS } from '../../../scripts/hooks/kit.js';
import { READ_TOOLS, HALT_TOOLS, NOTIFY_TOOLS } from '../../../scripts/hooks/stop-guard.js';
import { AGENTS, adapterFor } from '../../../scripts/agents/index.js';
import claudeCode from '../../../adapters/claude-code/index.js';
import tools from '../../../adapters/claude-code/tools.js';
import { answer as adapterAnswer } from '../../../adapters/claude-code/answers.js';

function harness(input, extra = {}) {
  const out = [];
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  return { out, io: { stdin: Readable.from([text]), write: (t) => out.push(t), self: '/plugin/scripts/hooks/kit.js', dir: '/nowhere', ...extra } };
}

const INPUT = { hook_event_name: 'PreToolUse', cwd: os.tmpdir(), session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } };

test('Claude Code input reaches decide byte for byte as before', async () => {
  let seen;
  const h = harness(INPUT);
  await hookMain((input) => { seen = input; }, { failClosed: true, event: 'PreToolUse' }, h.io);
  assert.equal(JSON.stringify(seen), JSON.stringify(INPUT));
  assert.deepEqual(h.out, []);
});

test('a guard\'s answer is written byte for byte as before', async () => {
  const out = answer.deny('no');
  const h = harness(INPUT);
  await hookMain(() => out, { failClosed: true, event: 'PreToolUse' }, h.io);
  assert.deepEqual(h.out, [`${JSON.stringify(out)}\n`]);
  assert.equal(adapterAnswer, answer);
  assert.equal(claudeCode.translate.fromGuardAnswer(out, 'PreToolUse'), out);
  assert.equal(claudeCode.translate.toGuardInput(INPUT, 'PreToolUse'), INPUT);
});

const refusing = { ...claudeCode, translate: { toGuardInput: () => null, fromGuardAnswer: (out) => out } };

test('an adapter that cannot translate an input makes a fail-closed hook refuse', async () => {
  let called = false;
  const h = harness(INPUT, { adapter: refusing });
  await hookMain(() => { called = true; }, { failClosed: true, event: 'PreToolUse' }, h.io);
  assert.equal(called, false);
  assert.deepEqual(h.out, [`${JSON.stringify(answer.deny('Wheelhouse\'s check could not run'))}\n`]);
});

test('an adapter that cannot translate an input makes an informing hook write nothing', async () => {
  let called = false;
  const h = harness(INPUT, { adapter: refusing });
  await hookMain(() => { called = true; }, { failClosed: false, event: 'PreToolUse' }, h.io);
  assert.equal(called, false);
  assert.deepEqual(h.out, []);
});

test('READ_TOOLS, HALT_TOOLS and NOTIFY_TOOLS keep their values', () => {
  assert.deepEqual([...READ_TOOLS], ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'AskUserQuestion', 'TodoWrite', 'ToolSearch']);
  assert.deepEqual([...HALT_TOOLS], ['TaskStop', 'KillShell']);
  assert.deepEqual([...NOTIFY_TOOLS], ['PushNotification']);
  assert.equal(READ_TOOLS, tools.read);
  assert.equal(claudeCode.tools, tools);
  assert.equal(tools.ask, 'AskUserQuestion');
  assert.deepEqual([...tools.shell], ['Bash', 'PowerShell']);
});

// The real route a Copilot-shaped input takes today: no hook_event_name, so the kit has no translation for it.
const COPILOT_SHAPED = { toolName: 'bash', sessionId: 's' };

test('an input shaped like another agent\'s, which the kit has no translation for, makes a guard refuse', async () => {
  let called = false;
  const h = harness(COPILOT_SHAPED);
  await hookMain(() => { called = true; }, { failClosed: true, event: 'PreToolUse' }, h.io);
  assert.equal(called, false);
  assert.deepEqual(h.out, [`${JSON.stringify(answer.deny('Wheelhouse\'s check could not run'))}\n`]);
});

test('an input shaped like another agent\'s, which the kit has no translation for, makes an informing hook write nothing', async () => {
  let called = false;
  const h = harness(COPILOT_SHAPED);
  await hookMain(() => { called = true; }, { failClosed: false, event: 'SessionStart' }, h.io);
  assert.equal(called, false);
  assert.deepEqual(h.out, []);
});

test('every agent has a kit translation, and Claude Code\'s is the adapter\'s own', () => {
  for (const name of AGENTS) assert.ok(Object.hasOwn(TRANSLATORS, name), `the kit has no translation for ${name}`);
  assert.equal(TRANSLATORS['claude-code'].translate, adapterFor('claude-code').translate);
});
