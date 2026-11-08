// probes/haiku-trial/tmux.js
// The trial's front desk: a Claude Code session in tmux whose environment carries no starter variable, so the hooks take
// it for the director's own session and count typed replies.
import { spawnSync } from 'node:child_process';

// The variables that make a session look as if a script started it.
const STARTER_VARIABLES = ['WHEELHOUSE_ROLE', 'WHEELHOUSE_SESSION', 'WHEELHOUSE_AGENT', 'WHEELHOUSE_ENGINE_RUN', 'CLAUDECODE'];
const SCRIPT_ENTRYPOINT = /^sdk-/;

export const SESSION_PREFIX = 'haiku-trial-';

// A copy of `from` without what marks a session as script-started.
export function cleanEnv(from = process.env) {
  const env = { ...from };
  for (const name of STARTER_VARIABLES) delete env[name];
  if (typeof env.CLAUDE_CODE_ENTRYPOINT === 'string' && SCRIPT_ENTRYPOINT.test(env.CLAUDE_CODE_ENTRYPOINT)) delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

const named = (name) => (String(name).startsWith(SESSION_PREFIX) ? String(name) : `${SESSION_PREFIX}${name}`);

// The tmux calls the trial makes. `run(command, args)` is spawnSync-shaped; tests inject it.
export function makeTmux({ run = spawnSync } = {}) {
  const tmux = (...args) => run('tmux', args, { encoding: 'utf8' });
  const said = (got) => String(got?.stdout ?? '');
  return {
    // The session starts with exactly `env`, nothing inherited from the tmux server.
    start({ name, cwd, command, env }) {
      const pairs = Object.entries(env ?? {}).filter(([, v]) => typeof v === 'string').map(([k, v]) => `${k}=${v}`);
      return tmux('new-session', '-d', '-s', named(name), '-c', cwd, 'env', '-i', ...pairs, ...command);
    },
    // The text goes in literally, then Enter.
    type(name, text) {
      tmux('send-keys', '-t', named(name), '-l', text);
      return tmux('send-keys', '-t', named(name), 'Enter');
    },
    keys(name, ...keys) {
      return tmux('send-keys', '-t', named(name), ...keys);
    },
    capture(name) {
      return said(tmux('capture-pane', '-p', '-t', named(name)));
    },
    kill(name) {
      return tmux('kill-session', '-t', named(name));
    },
    list() {
      return said(tmux('list-sessions', '-F', '#{session_name}')).split(/\r?\n/).filter((n) => n.startsWith(SESSION_PREFIX));
    },
  };
}

// The front desk's command and its clean environment.
export function frontDeskCommand({ claude = 'claude' } = {}) {
  return { command: [claude, '--model', 'haiku'], env: cleanEnv() };
}
