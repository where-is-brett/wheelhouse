// scripts/lib/claude.js
// Finding and starting the `claude` command line, shared by the evaluation
// harness and the watcher's waker.
import fs from 'node:fs';
import path from 'node:path';

// Where `claude` is. Elsewhere than Windows the name is enough. On Windows a
// program is only started without a shell if it is an .exe, and npm installs
// claude as a .cmd shim, so look for claude.exe on the PATH first, then
// claude.cmd (run through cmd.exe, see `invocation`); say so if neither is there.
export function resolveClaude({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (platform !== 'win32') return { kind: 'direct', file: 'claude' };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  const folders = (pathKey ? env[pathKey] : '').split(';').map((folder) => folder.trim().replace(/^"|"$/g, '')).filter(Boolean);
  for (const [name, kind] of [['claude.exe', 'direct'], ['claude.cmd', 'cmd']]) {
    for (const folder of folders) {
      const file = path.win32.join(folder, name);
      if (exists(file)) return { kind, file };
    }
  }
  throw new Error('Cannot find claude.exe or claude.cmd on the PATH. Install Claude Code, or open a terminal where `claude` runs.');
}

// An argument for a command line cmd.exe will read. Characters cmd expands even
// inside double quotes cannot be quoted safely, so they are refused.
export function quoteForCmd(arg) {
  if (/["%\r\n]/.test(arg)) throw new Error(`Cannot pass this to claude.cmd safely: ${JSON.stringify(arg)}`);
  return /^[\w.:\\/@=,+-]+$/.test(arg) ? arg : `"${arg}"`;
}

// What to start, and what to feed it, for `claude <args>` when the prompt is
// `prompt`. Through a .cmd shim the prompt goes in on stdin (`claude -p` reads
// it there), because a prompt cannot be quoted safely on a cmd command line.
export function invocation(resolved, lead, args, prompt) {
  const print = prompt === undefined ? [] : ['-p'];
  if (resolved.kind !== 'cmd') {
    return { file: resolved.file, args: [...lead, ...print, ...(prompt === undefined ? [] : [prompt]), ...args], input: '', verbatim: false };
  }
  const line = [resolved.file, ...lead, ...print, ...args].map(quoteForCmd).join(' ');
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], input: prompt ?? '', verbatim: true };
}

// The names of the variables a Claude Code session sets for what it starts,
// which change how a session started from it behaves (a host-supplied gateway,
// bare mode): every name starting `claude` or `anthropic_base_url`, in any
// case, except CLAUDE_CONFIG_DIR, which only moves the configuration folder.
// Check 27 started its sessions without them, as a terminal would.
export function hostVariableNames(env) {
  return Object.keys(env).filter((name) => /^(claude|anthropic_base_url)/i.test(name) && name.toUpperCase() !== 'CLAUDE_CONFIG_DIR');
}

// `env` without the host session's variables.
export function withoutHostVariables(env) {
  const drop = new Set(hostVariableNames(env));
  return Object.fromEntries(Object.entries(env).filter(([name]) => !drop.has(name)));
}
