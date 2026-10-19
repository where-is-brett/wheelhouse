// scripts/health/trials.js
// The safety trials: run inside a sandboxed session in a scratch project, one
// line per trial, `<trial>: <expected> / <result>`. A line never carries a
// value: no file contents, no keys, no tokens, no error text.
//
//   node trials.js --pr <number> --project <owner__name> [--network reached|not reached]
//
// STOP cannot be tried from inside this script: the sandbox hides the STOP file
// and the stop guard refuses this script while STOP is on. The last line says
// so, and a note says how the director's session tries it with its own tools.
import nodeFs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { startedAsScript } from '../lib/started-as-script.js';

const GH_PATHS = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh', 'C:\\Program Files\\GitHub CLI\\gh.exe'];
const DENIED = new Set(['EPERM', 'EACCES']);
const UNREACHED = /could not be reached|did not answer|could not read|cut off/;
const GH_CLOSED = /not logged in|not logged into|operation not permitted|permission denied|could not read|cannot read|failed to read/;

export const STOP_NOTE = 'To try STOP: ask the director to type `stop` in this session, then try a Write (create a file in the project) and a Read (README.md or package.json) as two separate tool calls. Expect the Write refused and the Read allowed, and record both results.';

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
      fs.writeFileSync(file, 'TRIAL=1\n', { flag: 'wx' });
      made = true;
    } catch (error) {
      if (error?.code !== 'EEXIST') return 'could not run';
    }
    try {
      return readResult(() => fs.readFileSync(file, 'utf8'));
    } finally {
      if (made) {
        try { fs.rmSync(file, { force: true }); } catch { /* left for the director */ }
      }
    }
  });

  await trial('read keys folder', 'refused', () => readResult(() => fs.readdirSync(path.join(home, '.wheelhouse', 'keys'))));
  // A missing keys folder is not a refusal: setup makes it.
  if (lines.at(-1).endsWith('could not run')) notes.push('The keys folder is missing or unreadable for another reason; setup makes it, so run the trials again after setup.');

  const wantNetwork = deps.expectNetwork === undefined ? 'not reached' : deps.expectNetwork;
  await trial('reach github.com', ['reached', 'not reached'].includes(wantNetwork) ? wantNetwork : 'not reached', () => {
    if (!['reached', 'not reached'].includes(wantNetwork)) return 'needs the director';
    const out = spawn('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '8', 'https://github.com/']);
    if (out?.error?.code === 'ENOENT') throw new Error('curl is not installed');
    const code = Number.parseInt(String(out?.stdout ?? '').trim(), 10);
    return code >= 200 && code <= 399 ? 'reached' : 'not reached';
  });

  await trial('run gh', 'refused', () => {
    const gh = GH_PATHS.find((p) => fs.existsSync(p));
    if (!gh) return 'not installed';
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
    if (!ready) return 'needs the director';
    const answer = await client.state.record({
      project: deps.project,
      event: { kind: 'approval', pr: Number(pr), head: 'f'.repeat(40), forged: true, signature: 'forged' },
    });
    if (answer?.ok === true) return 'allowed';
    return UNREACHED.test(textOf(answer)) ? 'could not run' : 'refused';
  });

  await trial('merge with forged approval', 'refused', async () => {
    if (!ready) return 'needs the director';
    const forged = path.join(folder, 'forged-approval.json');
    try {
      try {
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(forged, `${JSON.stringify({ kind: 'approval', pr: Number(pr), forged: true })}\n`);
      } catch { /* the folder file is a stand-in; the helper never reads it */ }
      const answer = await client.merge({ project: deps.project, number: Number(pr), stop: false, bypass: false, approvalRequired: true });
      if (answer?.ok === true && answer.merged === true) return 'MERGED (unexpected)';
      if (answer?.ok === false && textOf(answer).includes('approv')) return 'refused';
      return 'could not run';
    } finally {
      try { fs.rmSync(folder, { recursive: true, force: true }); } catch { /* nothing to clean */ }
    }
  });

  lines.push('stop: write refused, read allowed / needs the director');
  notes.push(STOP_NOTE);

  Object.defineProperty(lines, 'notes', { value: notes, enumerable: false });
  return lines;
}

function argOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (startedAsScript(import.meta.url)) {
  try {
    const { helperClient } = await import('../host/helper-client.js');
    const argv = process.argv.slice(2);
    const lines = await runTrials({
      client: helperClient({ timeout: 3000 }),
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
