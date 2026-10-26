// scripts/lib/claude.js
// Finding and starting the `claude` command line, shared by the evaluation
// harness and the watcher's waker. resolveCommand and quoteForCmd serve any
// other command line an adapter starts the same way.
import fs from 'node:fs';
import path from 'node:path';

// Where the program `name` is. Elsewhere than Windows the name is enough. On
// Windows a program is only started without a shell if it is an .exe, and npm
// installs command lines as .cmd shims, so look for <name>.exe on the PATH
// first, then <name>.cmd (run through cmd.exe with every argument passed through
// quoteForCmd); say so if neither is there.
export function resolveCommand({ name, platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`This isn't the name of a program: ${JSON.stringify(name)}`);
  if (platform !== 'win32') return { kind: 'direct', file: name };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  const folders = (pathKey ? env[pathKey] : '').split(';').map((folder) => folder.trim().replace(/^"|"$/g, '')).filter(Boolean);
  for (const [file, kind] of [[`${name}.exe`, 'direct'], [`${name}.cmd`, 'cmd']]) {
    for (const folder of folders) {
      const found = path.win32.join(folder, file);
      if (exists(found)) return { kind, file: found };
    }
  }
  throw new Error(`Cannot find ${name}.exe or ${name}.cmd on the PATH.`);
}

// Where `claude` is: resolveCommand's answer for `claude`, with its own words
// when neither claude.exe nor claude.cmd is on the PATH.
export function resolveClaude({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  try {
    return resolveCommand({ name: 'claude', platform, env, exists });
  } catch {
    throw new Error('Cannot find claude.exe or claude.cmd on the PATH. Install Claude Code, or open a terminal where `claude` runs.');
  }
}

// An argument for a command line cmd.exe will read. Characters cmd expands even
// inside double quotes cannot be quoted safely, so they are refused: a double
// quote, `%`, `!` (delayed expansion), a line break, and a backslash closing an
// argument that needs quotes (it would escape the closing quote).
export function quoteForCmd(arg) {
  const plain = /^[\w.:\\/@=,+-]+$/.test(arg);
  if (/["%!\r\n]/.test(arg) || (!plain && arg.endsWith('\\'))) throw new Error(`Cannot pass this to a .cmd program safely: ${JSON.stringify(arg)}`);
  return plain ? arg : `"${arg}"`;
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

// The variables Claude Code signs in with, to Anthropic (a key, or the director's OAuth token), or
// through Amazon Bedrock (and its Mantle endpoint), Google Cloud's Vertex AI, Microsoft Foundry or
// Claude Platform on AWS (Claude Code's documentation, read 19 October 2026 for Bedrock and Vertex,
// and its environment-variables page on 23 October 2026 for the rest): the switches, the keys and
// cloud credentials, and the profile, region, project, resource, workspace, credential-file and
// endpoint variables, spelt exactly. Some name a secret, and the switches and the OAuth token start
// "CLAUDE": a list that drops secrets or the host session's variables keeps these by name. Beside
// them, every VERTEX_REGION_CLAUDE_* variable (CLAUDE_SIGN_IN_PREFIXES).
export const CLAUDE_SIGN_IN_NAMES = Object.freeze([
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_MANTLE', 'CLAUDE_CODE_SKIP_BEDROCK_AUTH', 'CLAUDE_CODE_SKIP_MANTLE_AUTH',
  'AWS_BEARER_TOKEN_BEDROCK', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE',
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_CONFIG_FILE',
  'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_BEDROCK_MANTLE_BASE_URL', 'ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION',
  'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_SKIP_VERTEX_AUTH', 'GOOGLE_APPLICATION_CREDENTIALS', 'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLOUD_ML_REGION', 'ANTHROPIC_VERTEX_BASE_URL', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT',
  'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_SKIP_FOUNDRY_AUTH', 'ANTHROPIC_FOUNDRY_API_KEY', 'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_RESOURCE', 'ANTHROPIC_FOUNDRY_BASE_URL',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS', 'CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH', 'ANTHROPIC_AWS_API_KEY', 'ANTHROPIC_AWS_WORKSPACE_ID', 'ANTHROPIC_AWS_BASE_URL',
]);
export const CLAUDE_SIGN_IN_PREFIXES = Object.freeze(['VERTEX_REGION_CLAUDE_']);

// Whether `name`, spelt exactly, is one Claude Code signs in with.
export function isClaudeSignIn(name) {
  return CLAUDE_SIGN_IN_NAMES.includes(name) || CLAUDE_SIGN_IN_PREFIXES.some((prefix) => name.startsWith(prefix));
}

// What every session Wheelhouse starts with `claude` takes beside its environment: subagents run in the
// foreground. Claude Code 2.1.302 runs a subagent in the background when its dispatch leaves out
// run_in_background, and then a background subagent is refused any permission it would have to ask for, and the
// session can end its turn while one still runs. With the switch, the dispatch has no such choice, every subagent
// is waited for, and a subagent resumed with SendMessage runs in the foreground too. Background shell commands go
// with it: a session's command waits as long as its own time limit allows.
export const FOREGROUND_ONLY = Object.freeze({ CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' });

// `env` without the host session's variables.
export function withoutHostVariables(env) {
  const drop = new Set(hostVariableNames(env));
  return Object.fromEntries(Object.entries(env).filter(([name]) => !drop.has(name)));
}
