// tests/probes/haiku-trial/tmux.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEnv, makeTmux, frontDeskCommand, bursts, TYPE_GAP_MS, SETTLE_MS } from '../../../probes/haiku-trial/tmux.js';
import { startedByScript } from '../../../scripts/decisions/answer.js';

test('cleanEnv removes every starter variable', () => {
  const from = {
    CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', WHEELHOUSE_ROLE: 'feature', WHEELHOUSE_SESSION: 's', WHEELHOUSE_AGENT: 'a',
    WHEELHOUSE_ENGINE_RUN: 'r', CLAUDECODE: '1', PATH: '/bin',
  };
  const env = cleanEnv(from);
  assert.equal(startedByScript(env), false);
  assert.equal(env.PATH, '/bin');
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(from.WHEELHOUSE_ROLE, 'feature', 'the original is left alone');
});

test('cleanEnv drops what the Claude Code session the runner runs in sets for its children, and keeps the config folder', () => {
  const env = cleanEnv({
    CLAUDE_CODE_SESSION_ID: 'host', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_MESSAGING_SOCKET: '/s', CLAUDE_PID: '9',
    CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '40', CLAUDE_EFFORT: 'medium', CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CONFIG_DIR: '/trial-config', HOME: '/h',
  });
  assert.deepEqual(env, { CLAUDE_CONFIG_DIR: '/trial-config', HOME: '/h' });
});

test('type types the text in short bursts, as a person would, then Enter once it has settled', () => {
  const calls = [];
  const tmux = makeTmux({
    run: (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: '' }; },
    pause: (ms) => calls.push(['pause', ms]),
  });
  tmux.type('haiku-trial-desk', '-1 B and a second part');
  assert.deepEqual(calls, [
    ['tmux', 'send-keys', '-t', 'haiku-trial-desk', '-l', '--', '-1 B and a secon'],
    ['pause', TYPE_GAP_MS],
    ['tmux', 'send-keys', '-t', 'haiku-trial-desk', '-l', '--', 'd part'],
    ['pause', TYPE_GAP_MS],
    ['pause', SETTLE_MS],
    ['tmux', 'send-keys', '-t', 'haiku-trial-desk', 'Enter'],
  ]);
});

test('no burst ends with a semicolon, which tmux would drop, and every character is kept', () => {
  const text = 'Greenbarrow Fresh → groceries; Pennywhistle Market → groceries;; Lowtide;\nnext line';
  const got = bursts(text, 8);
  assert.equal(got.join(''), text.replace('\n', ' '));
  for (const b of got.slice(0, -1)) assert.ok(!b.endsWith(';'), b);
});

test('start ends a session left under the same name, gives the new one only the environment it is handed, and list shows only the trial\'s sessions', () => {
  const calls = [];
  const tmux = makeTmux({ run: (cmd, args) => { calls.push(args); return { status: 0, stdout: 'haiku-trial-desk\nmine\n' }; } });
  tmux.start({ name: 'desk', cwd: '/w', command: ['claude', '--model', 'haiku'], env: { PATH: '/bin' } });
  assert.deepEqual(calls[0], ['kill-session', '-t', 'haiku-trial-desk']);
  assert.deepEqual(calls[1], ['set-option', '-g', 'history-limit', '20000']);
  assert.deepEqual(calls[2], ['new-session', '-d', '-s', 'haiku-trial-desk', '-x', '220', '-y', '60', '-c', '/w', 'env', '-i', 'PATH=/bin', 'claude', '--model', 'haiku']);
  assert.deepEqual(tmux.list(), ['haiku-trial-desk']);
});

test('front desk runs on haiku', () => {
  assert.deepEqual(frontDeskCommand().command, ['claude', '--model', 'haiku']);
  assert.equal(startedByScript(frontDeskCommand().env), false);
});

test('front desk runs on the model it is given', () => {
  assert.deepEqual(frontDeskCommand({ model: 'sonnet' }).command, ['claude', '--model', 'sonnet']);
});

test('capture joins wrapped lines and reads the whole history', () => {
  const calls = [];
  const tmux = makeTmux({ run: (cmd, args) => { calls.push(args); return { status: 0, stdout: 'text' }; } });
  assert.equal(tmux.capture('desk'), 'text');
  assert.deepEqual(calls[0], ['capture-pane', '-p', '-J', '-S', '-', '-t', 'haiku-trial-desk']);
});
