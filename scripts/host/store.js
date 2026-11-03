// scripts/host/store.js
// The computer's own store of keys. Two ways in:
//   the director's own key   borrowed with `git credential fill` and stored with
//                            `git credential approve`, so pushes and the API share
//                            one entry. Never `git credential reject`: that would
//                            delete the director's key and break their pushes.
//   Wheelhouse's own keys    (a narrow project key, the GitHub app's keys) kept
//                            under the service `wheelhouse` in the keychain,
//                            Credential Manager or git's helper, through
//                            scripts/secrets/secret-box.js.
// A key travels on standard input only: never in an argument or an environment
// variable. `run` is the seam for tests: ({ file, args, input, env }) ->
// { code, stdout }, rejecting when the program is not there.
import { spawn } from 'node:child_process';
import { readSecret, storeSecret, deleteSecret } from '../secrets/secret-box.js';

export const SERVICE = 'wheelhouse';
const NAME = /^(?:github-app|gitlab-project-\d+)$/;
const TRUE = /^(?:true|yes|on|1)$/i;

export function defaultRun({ file, args, input, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env: env ?? process.env });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

// The director's own settings stay in force; git is told never to ask, and
// Git Credential Manager is told never to open a window.
function quietEnv() {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
}

function oneLine(value, what) {
  if (typeof value !== 'string' || value === '' || /[\r\n\0]/.test(value)) {
    throw new Error(`The ${what} for the computer's store is missing or spans lines`);
  }
  return value;
}

function addressOf(host, base) {
  return (base ?? `https://${host}`).replace(/\/+$/, '');
}

function parse(output) {
  const fields = {};
  for (const line of String(output).split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at > 0) fields[line.slice(0, at)] = line.slice(at + 1);
  }
  return fields;
}

async function usesHttpPath(address, run) {
  try {
    const { code, stdout } = await run({ file: 'git', args: ['config', '--get-urlmatch', 'credential.useHttpPath', address], env: quietEnv() });
    return code === 0 && TRUE.test(stdout.trim());
  } catch {
    return false;
  }
}

// The director's key for this host, as { username, key }, or null when git has
// none or cannot give it. `repoPath` is <owner>/<name>; it is sent only where
// the director's git sets credential.useHttpPath.
export async function borrowKey({ host, base, repoPath, run = defaultRun }) {
  const address = addressOf(host, base);
  const lines = ['protocol=https', `host=${oneLine(host, 'host')}`];
  if (repoPath && (await usesHttpPath(address, run))) {
    lines.push(`path=${oneLine(repoPath, 'path').replace(/\.git$/, '')}.git`);
  }
  let result;
  try {
    result = await run({ file: 'git', args: ['credential', 'fill'], input: `${lines.join('\n')}\n\n`, env: quietEnv() });
  } catch {
    return null;
  }
  if (result.code !== 0) return null;
  const { username, password } = parse(result.stdout);
  if (!password) return null;
  return { username: username ?? '', key: password };
}

// Stores the director's key for the host and their user name, replacing only
// that entry, so pushes and the API share it.
export async function storeDirectorKey({ host, base, repoPath, username, key, run = defaultRun }) {
  // Where the director's git sets credential.useHttpPath, the entry carries the path a borrow sends, or the old one still wins.
  const path = repoPath && (await usesHttpPath(addressOf(host, base), run)) ? `path=${oneLine(repoPath, 'path').replace(/\.git$/, '')}.git\n` : '';
  const input = `protocol=https\nhost=${oneLine(host, 'host')}\n${path}username=${oneLine(username, 'user name')}\npassword=${oneLine(key, 'key')}\n\n`;
  let result;
  try {
    result = await run({ file: 'git', args: ['credential', 'approve'], input, env: quietEnv() });
  } catch {
    throw new Error('The key could not be stored: git could not be run');
  }
  if (result.code !== 0) throw new Error('The key could not be stored in the computer\'s store');
}

function checkName(name) {
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new Error('The key name must be github-app or gitlab-project-<number>');
  }
  return { service: SERVICE, account: name };
}

// An adapter from this module's `run` to secret-box's runner.
function runner(run) {
  return run === undefined
    ? undefined
    : async ({ file, args }, input) => {
        const { code, stdout } = await run({ file, args, input, env: quietEnv() });
        return { code, out: stdout };
      };
}

// Keeps a key of Wheelhouse's own under the service `wheelhouse`.
export async function storeKey(name, value, { platform = process.platform, run } = {}) {
  const where = checkName(name);
  const secret = typeof value === 'string' ? value : JSON.stringify(value);
  await storeSecret({ ...where, secret }, platform, runner(run));
}

// The key kept under this name: an object when it was stored as one, else the
// text. Null when there is none.
export async function readKey(name, { platform = process.platform, run } = {}) {
  const text = await readSecret(checkName(name), platform, runner(run));
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function deleteKey(name, { platform = process.platform, run } = {}) {
  await deleteSecret(checkName(name), platform, runner(run));
}
