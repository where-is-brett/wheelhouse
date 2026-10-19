// scripts/host/foreman-run.js
// The foreman's two commands, run by the host helper (ruling R156). The foreman is a session in
// the project's main checkout, and its Bash commands run inside the project's sandbox, which
// can't read or write the Wheelhouse home. So `node <root>/scripts/foreman/act.js …` and
// `node <root>/scripts/foreman/wake.js …` only forward their arguments to the helper's
// /foreman/run (scripts/foreman/forward.js), and the helper runs the scripts' own logic outside
// the sandbox, as a child process: scripts/foreman/runner.js, in the project's main checkout,
// with the environment below. This file holds what the helper checks and gives that child.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutHostVariables } from '../lib/claude.js';
import { withoutGitVars } from '../lib/run.js';

// The scripts /foreman/run runs, by the name the foreman's command line gives them.
export const FOREMAN_SCRIPTS = Object.freeze(['act', 'wake']);

// What the helper runs: never a command a session is given.
export const FOREMAN_RUNNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'foreman', 'runner.js');

// How long one foreman command may run (a start makes a worktree; a merge brings a branch up to
// date) before it is stopped, and the most of its output that is kept.
export const FOREMAN_RUN_MS = 15 * 60 * 1000;
export const FOREMAN_OUTPUT_BYTES = 1024 * 1024;

const MOST_ARGUMENTS = 256;
const MOST_ARGUMENT_CHARS = 16 * 1024;

// Variables that carry a host's key, a sign-in or a way to one: none reaches the child.
const KEY_NAMES = new Set([
  'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GITLAB_TOKEN', 'GL_TOKEN', 'GLAB_TOKEN',
  'CI_JOB_TOKEN', 'SSH_AUTH_SOCK', 'SSH_ASKPASS', 'SUDO_ASKPASS',
]);
// Any other name that says it holds a secret.
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY/i;
const ROLE = 'WHEELHOUSE_ROLE';

// Claude Code's sign-in variables that the sessions the watcher starts are given (sessionEnv,
// scripts/watcher/waker.js), kept so a session the foreman starts can sign in as they can
// (ruling R159). None is one of the host session's own (scripts/lib/claude.js): those, such as
// CLAUDE_CODE_OAUTH_TOKEN, are dropped for every started session, so they are dropped here too.
export const SIGN_IN_NAMES = Object.freeze(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AWS_BEARER_TOKEN_BEDROCK']);

// The child's environment: the helper's own, less the host session's variables (as a session
// started by the waker gets it), every GIT_* variable, every spelling of WHEELHOUSE_ROLE, and
// every variable that holds or leads to a host's key or any other secret, but for the sign-in
// variables above, spelt exactly. WHEELHOUSE_HOME and PATH stay, so the scripts find
// Wheelhouse's records and git.
export function foremanEnv(env = process.env) {
  return Object.fromEntries(Object.entries(withoutGitVars(withoutHostVariables(env))).filter(([name]) => {
    if (SIGN_IN_NAMES.includes(name)) return true;
    const upper = name.toUpperCase();
    return upper !== ROLE && !KEY_NAMES.has(upper) && !SECRET_NAME.test(name);
  }));
}

// Why a /foreman/run request can't be run, or null when it can: the script must be act or wake,
// and its arguments a short list of plain text.
export function foremanRequestRefusal({ script, argv } = {}) {
  if (!FOREMAN_SCRIPTS.includes(script)) return `the foreman's commands are ${FOREMAN_SCRIPTS.join(' and ')}`;
  if (!Array.isArray(argv) || argv.length > MOST_ARGUMENTS) return 'the arguments must be a list of at most 256';
  if (!argv.every((a) => typeof a === 'string' && a.length <= MOST_ARGUMENT_CHARS && !a.includes('\0'))) {
    return 'each argument must be text of at most 16,384 characters';
  }
  return null;
}
