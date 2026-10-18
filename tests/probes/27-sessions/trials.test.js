// tests/probes/27-sessions/trials.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  parseOptions, makeEnv, strippedNames, waitForText, judgeFresh, transcriptUsage, subtractUsage, findTranscript, parseTranscript, MESSAGES,
  once, settlePause, runCleanups, runRoute, Interrupted, installSignalCleanup, sessionName, isOurSession,
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

test('a cleanup runs once however many callers ask, and runCleanups runs each registered one', async () => {
  let calls = 0;
  const cleanup = once(async () => { calls += 1; });
  await Promise.all([cleanup(), cleanup()]);
  await cleanup();
  assert.equal(calls, 1);
  const order = [];
  const ctx = { cleanups: new Set([once(async () => order.push('a')), once(async () => { order.push('b'); throw new Error('x'); }), once(async () => order.push('c'))]) };
  await runCleanups(ctx);
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('Ctrl+C runs the cleanups once, then leaves; a second signal leaves at once', async () => {
  const target = new EventEmitter();
  const exits = [];
  let cleaned = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const ctx = { cleanups: new Set([async () => { cleaned += 1; await gate; }]), interrupted: false };
  const quiet = console.error;
  console.error = () => {};
  const uninstall = installSignalCleanup(ctx, { exit: (code) => exits.push(code), target });
  try {
    target.emit('SIGINT', 'SIGINT');
    assert.equal(ctx.interrupted, true);
    assert.deepEqual(exits, []);
    target.emit('SIGINT', 'SIGINT');
    assert.deepEqual(exits, [130]);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cleaned, 1);
    assert.deepEqual(exits, [130, 130]);
    uninstall();
    assert.equal(target.listenerCount('SIGINT'), 0);
    assert.equal(target.listenerCount('SIGTERM'), 0);
  } finally {
    console.error = quiet;
  }
});

test('a termination signal leaves with 143', async () => {
  const target = new EventEmitter();
  const exits = [];
  const ctx = { cleanups: new Set(), interrupted: false };
  const quiet = console.error;
  console.error = () => {};
  try {
    installSignalCleanup(ctx, { exit: (code) => exits.push(code), target });
    target.emit('SIGTERM', 'SIGTERM');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(exits, [143]);
  } finally {
    console.error = quiet;
  }
});

test('the trials recognise their own background sessions by name and process', () => {
  assert.equal(sessionName('one', 42), 'probe27-one-42');
  assert.equal(isOurSession('probe27-two-42', 42), true);
  assert.equal(isOurSession('probe27-two-43', 42), false);
  assert.equal(isOurSession('my-session-42', 42), false);
  assert.equal(isOurSession(undefined, 42), false);
});

// A route that never runs claude: node stands in for it, so the cleanup's calls to `claude` fail harmlessly.
function fakeContext(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trials-test-'));
  return {
    dir,
    ctx: {
      options: { model: 'm', settingSources: 'project,local', worktreesOf: '', pauseAtEnd: false },
      resolved: { kind: 'direct', file: process.execPath },
      env: { overrides: {}, full: {} },
      version: 'test',
      log: path.join(dir, 'log.jsonl'),
      backgrounded: new Set(),
      cleanups: new Set(),
      interrupted: false,
      ...extra,
    },
  };
}

test('no route starts after an interrupt', async () => {
  const { dir, ctx } = fakeContext({ interrupted: true });
  let starts = 0;
  const route = { name: 'fake', start: async () => { starts += 1; }, settle: async () => ({}), finish: async () => {} };
  await assert.rejects(runRoute(ctx, route), Interrupted);
  assert.equal(starts, 0);
  assert.equal(ctx.cleanups.size, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an interrupt during a route stops it before the next step, and the route cleans up', async () => {
  const { dir, ctx } = fakeContext();
  const started = [];
  const route = {
    name: 'fake',
    start: async (c, { dir: where }) => {
      started.push(where);
      fs.writeFileSync(path.join(where, 'pong.txt'), 'pong-1\n');
      return { startedAt: Date.now(), gaveUp: () => false };
    },
    settle: async (c) => { c.interrupted = true; return { sessionId: 's1', usage: { input: 0, output: 0 }, msToExit: null }; },
    finish: async () => {},
  };
  await assert.rejects(runRoute(ctx, route), Interrupted);
  assert.equal(started.length, 1, 'the second session was not started');
  assert.equal(ctx.cleanups.size, 0);
  assert.equal(fs.existsSync(started[0]), false, 'the throwaway project is gone');
  assert.equal(fs.existsSync(`${started[0]}-second`), false, 'and its worktree');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runCleanups also runs a cleanup registered while another was running', async () => {
  const order = [];
  const ctx = { cleanups: new Set() };
  ctx.cleanups.add(async () => { order.push('first'); ctx.cleanups.add(async () => { order.push('late'); }); });
  await runCleanups(ctx);
  assert.deepEqual(order, ['first', 'late']);
});

test('--pause-at-end is switched off, with one line saying so, when there is no terminal', () => {
  const options = { pauseAtEnd: true };
  assert.match(settlePause(options, false), /not a terminal/);
  assert.equal(options.pauseAtEnd, false);
  const kept = { pauseAtEnd: true };
  assert.equal(settlePause(kept, true), null);
  assert.equal(kept.pauseAtEnd, true);
  assert.equal(settlePause({ pauseAtEnd: false }, false), null);
});
