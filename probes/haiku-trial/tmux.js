// probes/haiku-trial/tmux.js
// The trial's front desk: a Claude Code session in tmux whose environment carries no starter variable, so the hooks take
// it for the director's own session and count typed replies.
import { spawnSync } from 'node:child_process';
import { withoutHostVariables } from '../../scripts/lib/claude.js';

// The variables that make a session look as if a script started it.
const STARTER_VARIABLES = ['WHEELHOUSE_ROLE', 'WHEELHOUSE_SESSION', 'WHEELHOUSE_AGENT', 'WHEELHOUSE_ENGINE_RUN', 'CLAUDECODE'];
const SCRIPT_ENTRYPOINT = /^sdk-/;

export const SESSION_PREFIX = 'haiku-trial-';
// A run's sessions are named `haiku-trial-<label>-<name>`, so two runs on one Mac never share a tmux session. Without a label
// the prefix is the plain one.
export const sessionPrefix = (label) => (label ? `${SESSION_PREFIX}${label}-` : SESSION_PREFIX);
// A wide, tall window, so a long line is one line on screen, and a deep history, so a long reply is still there to read.
export const PANE_COLUMNS = 220;
export const PANE_ROWS = 60;
export const HISTORY_LINES = 20000;

// A copy of `from` without what marks a session as script-started, and without every variable a Claude Code session sets
// for what it starts (its session id, its child-session marker, its messaging socket, its settings' env): the runner is
// often started from a Claude Code session, and a front desk that inherits those is taken for that session's child, which
// saves no transcript. CLAUDE_CONFIG_DIR is kept.
export function cleanEnv(from = process.env) {
  const env = withoutHostVariables(from);
  for (const name of STARTER_VARIABLES) delete env[name];
  if (typeof env.CLAUDE_CODE_ENTRYPOINT === 'string' && SCRIPT_ENTRYPOINT.test(env.CLAUDE_CODE_ENTRYPOINT)) delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

// Text goes in as a person types it: short bursts with a pause between. All at once, Claude Code takes it as a paste, and
// the front desk rightly reads pasted text as material, not the director's own request. A burst never ends with a
// semicolon, which tmux would read as the end of its command and drop.
export const TYPE_BURST = 16;
export const TYPE_GAP_MS = 30;
// How long Claude Code is given to take in the text before Enter: an Enter that comes while it is still reading is
// swallowed, and the request sits unsent in the input box.
export const SETTLE_MS = 1500;
export function bursts(text, size = TYPE_BURST) {
  const flat = String(text).replace(/\s*\n\s*/g, ' ');
  const out = [];
  let i = 0;
  while (i < flat.length) {
    let end = Math.min(i + size, flat.length);
    while (end < flat.length && flat[end - 1] === ';') end += 1;
    out.push(flat.slice(i, end));
    i = end;
  }
  return out;
}
const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// A name that already carries the trial prefix (one a run log recorded, under this run's prefix or an older plain one) is kept.
export const sessionName = (label, name) => (String(name).startsWith(SESSION_PREFIX) ? String(name) : `${sessionPrefix(label)}${name}`);

// The tmux calls the trial makes. `run(command, args)` is spawnSync-shaped; tests inject it. `label` is the run's label.
export function makeTmux({ run = spawnSync, pause = wait, label } = {}) {
  const named = (name) => sessionName(label, name);
  const tmux = (...args) => run('tmux', args, { encoding: 'utf8' });
  const said = (got) => String(got?.stdout ?? '');
  return {
    // The session starts with exactly `env`, nothing inherited from the tmux server, in place of any session of the same name.
    start({ name, cwd, command, env }) {
      const pairs = Object.entries(env ?? {}).filter(([, v]) => typeof v === 'string').map(([k, v]) => `${k}=${v}`);
      // A session left by an earlier run under the same name would take this run's typing, so it goes first.
      tmux('kill-session', '-t', named(name));
      // The history size is read when a pane is made, so it is set first, for sessions made after this one too.
      tmux('set-option', '-g', 'history-limit', String(HISTORY_LINES));
      return tmux('new-session', '-d', '-s', named(name), '-x', String(PANE_COLUMNS), '-y', String(PANE_ROWS), '-c', cwd, 'env', '-i', ...pairs, ...command);
    },
    // The text is typed in bursts, as a person would; Enter follows once it has settled.
    type(name, text) {
      for (const burst of bursts(text)) {
        tmux('send-keys', '-t', named(name), '-l', '--', burst);
        pause(TYPE_GAP_MS);
      }
      pause(SETTLE_MS);
      return tmux('send-keys', '-t', named(name), 'Enter');
    },
    keys(name, ...keys) {
      return tmux('send-keys', '-t', named(name), ...keys);
    },
    capture(name) {
      // -J joins the lines the window wrapped, -S - starts at the top of the history.
      return said(tmux('capture-pane', '-p', '-J', '-S', '-', '-t', named(name)));
    },
    kill(name) {
      return tmux('kill-session', '-t', named(name));
    },
    // This run's sessions; `all` lists every trial session, whichever run made it.
    list({ all = false } = {}) {
      const prefix = all ? SESSION_PREFIX : sessionPrefix(label);
      return said(tmux('list-sessions', '-F', '#{session_name}')).split(/\r?\n/).filter((n) => n.startsWith(prefix));
    },
  };
}

// The front desk's command and its clean environment.
export function frontDeskCommand({ claude = 'claude', model = 'haiku' } = {}) {
  return { command: [claude, '--model', model], env: cleanEnv() };
}
