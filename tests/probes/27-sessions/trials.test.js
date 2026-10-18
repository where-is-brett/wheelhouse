// tests/probes/27-sessions/trials.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseOptions, makeEnv, strippedNames, waitForText, judgeFresh, transcriptUsage, subtractUsage, findTranscript, parseTranscript, MESSAGES,
} from '../../../probes/27-sessions/trials.js';

test('the model must be named, by option or by variable, and looks like a name', () => {
  assert.throws(() => parseOptions([], {}), /Name the model/);
  assert.equal(parseOptions(['--model', 'x-model'], {}).model, 'x-model');
  assert.equal(parseOptions([], { WHEELHOUSE_PROBE_MODEL: 'y-model' }).model, 'y-model');
  assert.throws(() => parseOptions(['--model', '--bg'], {}), /model name/);
  assert.throws(() => parseOptions(['--model', 'a b'], {}), /model name/);
});

test('routes and setting sources are checked', () => {
  assert.deepEqual(parseOptions(['--model=m', '--routes', 'print,bg'], {}).routes, ['print', 'bg']);
  assert.throws(() => parseOptions(['--model', 'm', '--routes', 'carrier'], {}), /--routes/);
  assert.throws(() => parseOptions(['--model', 'm', '--setting-sources', 'managed'], {}), /setting-sources/);
  assert.throws(() => parseOptions(['--model', 'm', '--nope'], {}), /Unknown option/);
});

test('the sessions get the environment a terminal would give them', () => {
  const base = { PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_SIMPLE: '1', ANTHROPIC_BASE_URL: 'http://host', ANTHROPIC_API_KEY: 'k', CLAUDE_CONFIG_DIR: '/c' };
  assert.deepEqual(strippedNames(base).sort(), ['ANTHROPIC_BASE_URL', 'CLAUDECODE', 'CLAUDE_CODE_SIMPLE']);
  const env = makeEnv({ base });
  assert.deepEqual(Object.keys(env.full).sort(), ['ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR', 'PATH']);
  assert.equal(env.overrides.CLAUDECODE, undefined);
  assert.ok('CLAUDECODE' in env.overrides);
  assert.deepEqual(makeEnv({ inherit: true, base }).full, base);
});

test('waitForText sees a file arrive, and gives up on a timeout or when told', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trials-test-'));
  const file = path.join(dir, 'pong.txt');
  setTimeout(() => fs.writeFileSync(file, 'pong-1\n'), 120);
  const ms = await waitForText(file, 'pong-1', { timeoutMs: 5000 });
  assert.ok(ms >= 100 && ms < 3000, `took ${ms}`);
  assert.equal(await waitForText(file, 'pong-2', { timeoutMs: 150 }), null);
  assert.equal(await waitForText(file, 'pong-2', { timeoutMs: 5000, gaveUp: () => true }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

function entry(type, content, extra = {}) {
  return { type, sessionId: 's3', message: { role: type, content }, ...extra };
}

test('a fresh third session passes, even if it reads a file the others left', () => {
  const entries = [
    { type: 'queue-operation', sessionId: 's3' },
    entry('user', MESSAGES.third),
    entry('assistant', [{ type: 'tool_use', name: 'Bash', input: { command: 'cat pong.txt' } }]),
    entry('user', [{ type: 'tool_result', content: 'pong-1' }]),
    entry('assistant', [{ type: 'text', text: 'done' }]),
    { type: 'attachment', sessionId: 's3', attachment: { type: 'date' } },
  ];
  const verdict = judgeFresh({ entries, sessionId: 's3', otherIds: ['s1', 's2'], markers: [MESSAGES.first, MESSAGES.second], prompt: MESSAGES.third });
  assert.equal(verdict.pass, true, verdict.why);
});

test('a third session that carries another session fails', () => {
  const args = { sessionId: 's3', otherIds: ['s1'], markers: [MESSAGES.first], prompt: MESSAGES.third };
  const own = entry('user', MESSAGES.third);
  assert.match(judgeFresh({ ...args, entries: [own, entry('user', 'x', { sessionId: 's1' })] }).why, /another session/);
  assert.match(judgeFresh({ ...args, entries: [own, entry('user', 'more')] }).why, /2 prompts/);
  assert.match(judgeFresh({ ...args, entries: [entry('user', 'something else')] }).why, /not the one/);
  assert.match(judgeFresh({ ...args, entries: [own, entry('assistant', [{ type: 'text', text: `earlier: ${MESSAGES.first}` }])] }).why, /mentions/);
  assert.match(judgeFresh({ ...args, entries: [own, entry('assistant', [{ type: 'text', text: 'see session s1' }])] }).why, /mentions s1/);
  assert.match(judgeFresh({ ...args, entries: [] }).why, /empty/);
});

test('transcript tokens count each model reply once', () => {
  const reply = (id, usage) => ({ type: 'assistant', message: { id, usage } });
  const entries = [
    reply('a', { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 }),
    reply('a', { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 }),
    reply('b', { input_tokens: 1, output_tokens: 7 }),
    { type: 'user', message: {} },
  ];
  assert.deepEqual(transcriptUsage(entries), { input: 113, output: 12 });
  assert.deepEqual(subtractUsage({ input: 10, output: 3 }, { input: 4, output: 5 }), { input: 6, output: 0 });
});

test('a transcript is found by session id in any project folder, and half-written lines are skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trials-test-'));
  fs.mkdirSync(path.join(dir, 'projects', '-a-b'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', '-a-b', 'abc.jsonl'), '{"type":"user"}\n{"type":"as');
  assert.equal(findTranscript('abc', dir), path.join(dir, 'projects', '-a-b', 'abc.jsonl'));
  assert.equal(findTranscript('zzz', dir), null);
  assert.equal(findTranscript('abc', path.join(dir, 'nowhere')), null);
  assert.deepEqual(parseTranscript(fs.readFileSync(findTranscript('abc', dir), 'utf8')), [{ type: 'user' }]);
  fs.rmSync(dir, { recursive: true, force: true });
});
