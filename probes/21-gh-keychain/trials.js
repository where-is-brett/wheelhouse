// probes/21-gh-keychain/trials.js
// Check 21: run by an agent inside the sandbox, and once outside it. Each trial
// tries to reach the director's existing GitHub or GitLab sign-in and prints
// only whether it worked and how many characters came back, never the value.
// The first line says whether the sandbox is on; a "read" result means
// something only when it says on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const denied = (error) => error?.code === 'EPERM' || error?.code === 'EACCES';

// Runs a command and returns what it printed, held in memory only.
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 20000 });
  if (result.error) {
    if (result.error.code === 'ENOENT') return { kind: 'not installed' };
    return { kind: denied(result.error) ? 'refused' : 'failed' };
  }
  return {
    kind: 'ran',
    status: result.status,
    stdout: `${result.stdout ?? ''}`.trim(),
    stderr: `${result.stderr ?? ''}`.trim(),
  };
}

// Turns a command's outcome into the secret text, or a plain-words outcome.
function secretFrom(outcome, pick) {
  if (outcome.kind !== 'ran') return { word: outcome.kind };
  const secret = pick(outcome);
  if (secret) return { secret };
  return { word: outcome.status === 0 ? 'no output' : 'no output (not signed in?)' };
}

function fileSecret(file) {
  try {
    return { secret: fs.readFileSync(file, 'utf8') };
  } catch (error) {
    return { word: denied(error) ? 'refused' : error?.code === 'ENOENT' ? 'file not found' : 'failed' };
  }
}

const sandboxLine = () => {
  try {
    fs.readdirSync(path.join(os.homedir(), '.ssh')).length;
    return 'sandbox: OFF — results prove nothing';
  } catch (error) {
    if (denied(error)) return 'sandbox: on';
    return 'sandbox: unknown (~/.ssh could not be listed, and not because it was denied)';
  }
};

// The token on glab's "Token found:" line ("Token found in operating system
// keyring:" with keyring storage), or failing that a glpat- value. A run of
// asterisks is glab hiding the token, not the token.
function glabToken(text) {
  const shown = /^[ \t]*\S*[ \t]*Token found\b[^:\n]*:[ \t]*(\S+)/im.exec(text)?.[1];
  return (shown && !/^\*+$/.test(shown) ? shown : undefined) ?? /\bglpat-[\w-]+/.exec(text)?.[0] ?? '';
}

const trials = {
  'gh auth token': () => secretFrom(run('gh', ['auth', 'token']), (o) => o.stdout),
  'keychain item gh:github.com': () => {
    if (process.platform !== 'darwin') return { word: 'not applicable' };
    const outcome = run('security', ['find-generic-password', '-s', 'gh:github.com', '-w']);
    // `security` exits 44 when the item does not exist, which is not a refusal.
    if (outcome.kind === 'ran' && outcome.status === 44) return { word: 'item not found' };
    if (outcome.kind === 'ran' && outcome.status !== 0) return { word: 'refused' };
    return secretFrom(outcome, (o) => o.stdout);
  },
  'file ~/.config/gh/hosts.yml': () => fileSecret(path.join(os.homedir(), '.config', 'gh', 'hosts.yml')),
  // glab writes its status to stderr; only the token itself is counted.
  'glab auth status --show-token': () =>
    secretFrom(run('glab', ['auth', 'status', '--show-token']), (o) =>
      glabToken(`${o.stdout}\n${o.stderr}`)),
};

console.log(sandboxLine());
for (const [trial, attempt] of Object.entries(trials)) {
  let outcome;
  try {
    outcome = attempt();
  } catch {
    outcome = { word: 'failed' };
  }
  const label = trial.startsWith('glab') ? 'glab' : trial;
  if (outcome.secret) console.log(`${trial}: read ${outcome.secret.length} characters`);
  else if (outcome.word === 'not installed') console.log(`${label.split(' ')[0]}: not installed`);
  else console.log(`${trial}: ${outcome.word}`);
}
