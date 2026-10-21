// tests/scripts/agents/contract.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ADAPTER_PARTS, checkAdapter } from '../../../scripts/agents/contract.js';
import { AGENTS, adapterFor, agentOfInput, agentOfProject } from '../../../scripts/agents/index.js';
import claudeCode from '../../../adapters/claude-code/index.js';

test('the Claude Code adapter has every part, each of the right type', () => {
  assert.deepEqual(ADAPTER_PARTS, ['identity', 'hooks', 'translate', 'tools', 'settings', 'sessions', 'cards', 'packaging', 'toolSheet', 'safetyLine', 'evalRunner']);
  assert.deepEqual(checkAdapter(claudeCode), []);
  assert.equal(claudeCode.identity.name, 'claude-code');
  assert.match(claudeCode.identity.floor, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof claudeCode.identity.find({ platform: 'linux', env: {} }).found, 'boolean');
  assert.equal(claudeCode.identity.find({ platform: 'win32', env: { Path: '' } }).found, false);
  assert.equal(claudeCode.hooks.file(), 'hooks/hooks.json');
  assert.ok(claudeCode.hooks.registration().hooks.PreToolUse);
  const raw = { hook_event_name: 'PreToolUse', tool_name: 'Read' };
  assert.equal(claudeCode.translate.toGuardInput(raw, 'PreToolUse'), raw);
  assert.deepEqual(claudeCode.tools.halt, ['TaskStop', 'KillShell']);
  assert.equal(claudeCode.tools.ask, 'AskUserQuestion');
  assert.deepEqual(claudeCode.cards.binding, ['signed-hook']);
  assert.ok(claudeCode.packaging.files().includes('.claude/settings.json'));
  assert.equal(claudeCode.sessions.finalAnswer('{"type":"system"}\nnot json\n{"type":"result","result":"done"}\n'), 'done');
  assert.equal(claudeCode.sessions.finalAnswer(''), null);
  const start = claudeCode.sessions.featureStartCall({ sessionId: 'abc', prompt: 'go', args: ['--x'], claude: { kind: 'direct', file: 'claude' } });
  assert.deepEqual(start.args, ['-p', 'go', '--session-id', 'abc', '--x']);
  const resume = claudeCode.sessions.featureResumeCall({ sessionId: 'abc', prompt: 'go', claude: { kind: 'direct', file: 'claude' } });
  assert.deepEqual(resume.args, ['-p', 'go', '--resume', 'abc']);
});

test('checkAdapter names a missing part in plain words', () => {
  const { toolSheet, ...rest } = claudeCode;
  assert.deepEqual(checkAdapter(rest), ['The adapter has no toolSheet part']);
  assert.deepEqual(checkAdapter({ ...claudeCode, toolSheet: 3 }), ['The toolSheet part must be a string, and it is number']);
  assert.deepEqual(checkAdapter({ ...claudeCode, tools: { ...claudeCode.tools, read: 'Read' } }), ["The tools part's read must be an array, and it is string"]);
  assert.deepEqual(checkAdapter({ ...claudeCode, hooks: {} }), ['The hooks part has no registration', 'The hooks part has no file']);
  assert.equal(checkAdapter(null).length, 1);
});

test('adapterFor throws for an agent it does not know', () => {
  assert.deepEqual(AGENTS, ['claude-code']);
  assert.equal(adapterFor('claude-code'), claudeCode);
  assert.throws(() => adapterFor('copilot'), /no adapter for the agent "copilot"/);
  assert.throws(() => adapterFor('toString'), /no adapter/);
  assert.throws(() => adapterFor(undefined), /no adapter/);
});

test('agentOfInput reads Claude Code\'s input as claude-code', () => {
  assert.equal(agentOfInput({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }), 'claude-code');
  assert.equal(agentOfInput({ hook_event_name: 'PreToolUse', toolName: 'bash', sessionId: 's' }), 'claude-code');
  assert.equal(agentOfInput({ toolName: 'bash' }), 'copilot');
  assert.equal(agentOfInput({ sessionId: 's' }), 'copilot');
});

test('agentOfInput gives null for input it cannot place', () => {
  for (const raw of [null, undefined, 'x', 3, [], {}, { tool_name: 'Read' }]) assert.equal(agentOfInput(raw), null);
});

test('agentOfProject defaults to claude-code and reads the computer\'s entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-'));
  try {
    assert.equal(agentOfProject(dir, { computerId: 'c1' }), 'claude-code');
    fs.mkdirSync(path.join(dir, '.claude'));
    const file = path.join(dir, '.claude', 'wheelhouse.json');
    fs.writeFileSync(file, '{ not json');
    assert.equal(agentOfProject(dir, { computerId: 'c1' }), 'claude-code');
    fs.writeFileSync(file, JSON.stringify({ agents: { c1: 'copilot' } }));
    assert.equal(agentOfProject(dir, { computerId: 'c1' }), 'copilot');
    assert.equal(agentOfProject(dir, { computerId: 'c2' }), 'claude-code');
    assert.equal(agentOfProject(dir), 'claude-code');
    fs.writeFileSync(file, JSON.stringify({ agents: ['copilot'] }));
    assert.equal(agentOfProject(dir, { computerId: '0' }), 'claude-code');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
