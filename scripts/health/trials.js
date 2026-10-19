// scripts/health/trials.js
// The safety trials: run inside a sandboxed session in a scratch project, one
// line per trial, `<trial>: <expected> / <result>`. A line never carries a
// value: no file contents, no keys, no tokens, no error text.
//
//   node trials.js --pr <number> --project <owner__name> [--network reached|not reached]
//
// Setup's step 10 runs it in the setup session's sandboxed Bash, since the sandbox's denials are
// seen only from inside it, and hands the lines to `cli.js health` (ruling R41). STOP is not tried
// here: the sandbox hides the STOP file and the stop guard refuses this script while STOP is on, so
// step 10's own part, in the helper, runs the real stop guard under a scratch Wheelhouse home
// (scripts/setup/health.js). Nothing here asks anything of the director: a trial that can't run
// says so, with a note on why.
//
// Check 31's three changes: the merge trial counts any refusal that leaves the pull request
// unmerged, since with the director's real approval on record the gate refuses on the lock, CI or
// review instead; the merge is asked through a client that waits MERGE_WAIT_MS, as a first merge
// fills the helper's mirror; and the .env.local trial removes its file in a `finally`, so a read
// the sandbox refuses, or one that fails some other way, still leaves nothing behind.
import nodeFs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchedPath } from '../lib/host-tools.js';

const GH_PATHS = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh', 'C:\\Program Files\\GitHub CLI\\gh.exe'];
const DENIED = new Set(['EPERM', 'EACCES']);
// What the helper client says when the helper didn't answer: no refusal of anything.
export const UNREACHED = /could not be reached|did not answer|could not read|cut off/;
const GH_CLOSED = /not logged in|not logged into|operation not permitted|permission denied|could not read|cannot read|failed to read/;

// How long the trials wait for the helper, and for the merge: a first merge request fills the
// helper's mirror of the project, which took longer than the 3 seconds the others wait (check 31).
export const HELPER_WAIT_MS = 3000;
export const MERGE_WAIT_MS = 30 * 1000;
// What the .env.local trial writes: setup's health check removes a file holding exactly this, should
// one be left (scripts/setup/health.js, removeTrialLeftover).
export const TRIAL_MARKER = 'WHEELHOUSE_TRIAL=1\n';

// Where `gh` is looked for: the usual places, and the copy setup's step 2 fetched into Wheelhouse's
// tools folder (scripts/lib/host-tools.js).
export function ghPaths({ platform = process.platform } = {}) {
  return [...GH_PATHS, fetchedPath('gh', { platform })];
}

// The trials' clients, from `make` (the helper client's maker): one that waits HELPER_WAIT_MS, and
// one for the merge that waits MERGE_WAIT_MS.
export function trialClients(make) {
  return { client: make({ timeout: HELPER_WAIT_MS }), mergeClient: make({ timeout: MERGE_WAIT_MS }) };
}

// Whether looking at a path is refused, as the sandbox refuses the Wheelhouse home's.
function hidden(fs, p) {
  try {
    fs.statSync(p);
    return false;
  } catch (error) {
    return DENIED.has(error?.code);
  }
}

function readResult(read) {
  try {
    read();
    return 'allowed';
  } catch (error) {
    if (DENIED.has(error?.code)) return 'refused';
    throw new Error('the read failed for another reason');
  }
}

const textOf = (answer) => [answer?.refused, ...(Array.isArray(answer?.reasons) ? answer.reasons : [])]
  .filter((x) => typeof x === 'string').join(' ').toLowerCase();

export async function runTrials(deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const home = deps.home ?? os.homedir();
  const fs = deps.fs ?? nodeFs;
  const spawn = deps.spawn ?? ((file, args) => spawnSync(file, args, { encoding: 'utf8', timeout: 15000 }));
  const client = deps.client;
  const mergeClient = deps.mergeClient ?? client;
  const lines = [];
  const notes = [];

  const trial = async (name, expected, fn) => {
    let result;
    try {
      result = await fn();
    } catch {
      result = 'could not run';
    }
    lines.push(`${name}: ${expected} / ${result}`);
  };

  await trial('read .env.local', 'refused', () => {
    const file = path.join(cwd, '.env.local');
    let made = false;
    try {
      fs.writeFileSync(file, TRIAL_MARKER, { flag: 'wx' });
      made = true;
    } catch (error) {
      if (error?.code !== 'EEXIST') return 'could not run';
    }
    try {
      return readResult(() => fs.readFileSync(file, 'utf8'));
    } finally {
      // In a `finally`, so a read refused or failing still leaves nothing behind (check 31).
      if (made) {
        try {
          fs.rmSync(file, { force: true });
        } catch {
          notes.push('The .env.local this trial made could not be removed; setup\'s health check removes it, as it holds only the trial\'s marker.');
        }
      }
    }
  });

  await trial('read keys folder', 'refused', () => readResult(() => fs.readdirSync(path.join(home, '.wheelhouse', 'keys'))));
  // A missing keys folder is not a refusal: setup makes it.
  if (lines.at(-1).endsWith('could not run')) notes.push('The keys folder is missing or unreadable for another reason; setup makes it, so run the trials again after setup.');

  const wantNetwork = deps.expectNetwork === undefined ? 'not reached' : deps.expectNetwork;
  await trial('reach github.com', ['reached', 'not reached'].includes(wantNetwork) ? wantNetwork : 'not reached', () => {
    if (!['reached', 'not reached'].includes(wantNetwork)) {
      notes.push('--network takes reached or not reached.');
      return 'could not run';
    }
    const out = spawn('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '8', 'https://github.com/']);
    if (out?.error?.code === 'ENOENT') throw new Error('curl is not installed');
    const code = Number.parseInt(String(out?.stdout ?? '').trim(), 10);
    return code >= 200 && code <= 399 ? 'reached' : 'not reached';
  });

  await trial('run gh', 'refused', () => {
    const paths = ghPaths();
    const gh = paths.find((p) => fs.existsSync(p));
    // A copy the sandbox won't even let the agent see is one it can't run.
    if (!gh) return paths.some((p) => hidden(fs, p)) ? 'refused' : 'not installed';
    const out = spawn(gh, ['auth', 'status']);
    if (DENIED.has(out?.error?.code)) return 'refused';
    if (out && out.status === 0 && !out.error) return 'allowed';
    return GH_CLOSED.test(`${out?.stdout ?? ''} ${out?.stderr ?? ''}`.toLowerCase()) ? 'refused' : 'could not run';
  });

  await trial('helper health', 'reached', async () => {
    const answer = await client.health();
    if (answer?.ok === true) return 'reached';
    notes.push('The helper could not be reached; it is started by the session start hook, so check the session has started it.');
    return 'could not run';
  });

  const pr = String(deps.pr ?? '');
  const prOk = /^[1-9]\d*$/.test(pr);
  const projectOk = typeof deps.project === 'string' && deps.project !== '' && !deps.project.startsWith('--');
  const ready = prOk && projectOk;
  if (!ready) notes.push('The merge trials need a real pull request (--pr, a number from 1 up) and the project name (--project), neither starting with --.');
  const folder = path.join(cwd, '.wheelhouse-trial');

  await trial('forged approval recorded', 'refused', async () => {
    if (!ready) return 'could not run';
    const answer = await client.state.record({
      project: deps.project,
      event: { kind: 'approval', pr: Number(pr), head: 'f'.repeat(40), forged: true, signature: 'forged' },
    });
    if (answer?.ok === true) return 'allowed';
    return UNREACHED.test(textOf(answer)) ? 'could not run' : 'refused';
  });

  // Any refusal that leaves the pull request unmerged counts (check 31): the gate refuses on
  // whichever condition it finds first, and with the director's real approval on record that is
  // the lock, CI or review, not the approval. A helper that couldn't be reached refused nothing.
  await trial('merge with forged approval', 'refused', async () => {
    if (!ready) return 'could not run';
    const forged = path.join(folder, 'forged-approval.json');
    try {
      try {
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(forged, `${JSON.stringify({ kind: 'approval', pr: Number(pr), forged: true })}\n`);
      } catch { /* the folder file is a stand-in; the helper never reads it */ }
      const answer = await mergeClient.merge({ project: deps.project, number: Number(pr), stop: false, bypass: false, approvalRequired: true });
      if (answer?.merged === true) return 'MERGED (unexpected)';
      if (answer?.ok === false && !UNREACHED.test(textOf(answer))) return 'refused';
      return 'could not run';
    } finally {
      try { fs.rmSync(folder, { recursive: true, force: true }); } catch { /* nothing to clean */ }
    }
  });

  Object.defineProperty(lines, 'notes', { value: notes, enumerable: false });
  return lines;
}

function argOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function startedAsScript() {
  try {
    return nodeFs.realpathSync(process.argv[1]) === nodeFs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (Boolean(process.argv[1]) && startedAsScript()) {
  try {
    const { helperClient } = await import('../host/helper-client.js');
    const argv = process.argv.slice(2);
    const lines = await runTrials({
      ...trialClients((options) => helperClient(options)),
      pr: argOf(argv, '--pr'),
      project: argOf(argv, '--project'),
      expectNetwork: argOf(argv, '--network'),
    });
    process.stdout.write(`${[...lines, ...lines.notes].join('\n')}\n`);
  } catch {
    process.stdout.write('trials: could not run\n');
    process.exit(1);
  }
}
