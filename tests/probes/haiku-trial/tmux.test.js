// tests/probes/haiku-trial/tmux.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEnv, makeTmux, frontDeskCommand } from '../../../probes/haiku-trial/tmux.js';
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

test('cleanEnv keeps a non-script entrypoint', () => {
  assert.equal(cleanEnv({ CLAUDE_CODE_ENTRYPOINT: 'cli' }).CLAUDE_CODE_ENTRYPOINT, 'cli');
});

test('type sends the text literally then Enter', () => {
  const calls = [];
  const tmux = makeTmux({ run: (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: '' }; } });
  tmux.type('haiku-trial-desk', '1 B');
  assert.deepEqual(calls, [
    ['tmux', 'send-keys', '-t', 'haiku-trial-desk', '-l', '1 B'],
    ['tmux', 'send-keys', '-t', 'haiku-trial-desk', 'Enter'],
  ]);
});

test('start gives the session only the environment it is handed, and list shows only the trial\'s sessions', () => {
  const calls = [];
  const tmux = makeTmux({ run: (cmd, args) => { calls.push(args); return { status: 0, stdout: 'haiku-trial-desk\nmine\n' }; } });
  tmux.start({ name: 'desk', cwd: '/w', command: ['claude', '--model', 'haiku'], env: { PATH: '/bin' } });
  assert.deepEqual(calls[0], ['set-option', '-g', 'history-limit', '20000']);
  assert.deepEqual(calls[1], ['new-session', '-d', '-s', 'haiku-trial-desk', '-x', '220', '-y', '60', '-c', '/w', 'env', '-i', 'PATH=/bin', 'claude', '--model', 'haiku']);
  assert.deepEqual(tmux.list(), ['haiku-trial-desk']);
});

test('front desk runs on haiku', () => {
  assert.deepEqual(frontDeskCommand().command, ['claude', '--model', 'haiku']);
  assert.equal(startedByScript(frontDeskCommand().env), false);
});

test('capture joins wrapped lines and reads the whole history', () => {
  const calls = [];
  const tmux = makeTmux({ run: (cmd, args) => { calls.push(args); return { status: 0, stdout: 'text' }; } });
  assert.equal(tmux.capture('desk'), 'text');
  assert.deepEqual(calls[0], ['capture-pane', '-p', '-J', '-S', '-', '-t', 'haiku-trial-desk']);
});
