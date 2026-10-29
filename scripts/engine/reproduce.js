// scripts/engine/reproduce.js
// The bug lane's scripted steps around its reproduction (Archon design, section 7.2). Each prints one JSON line and
// exits 0, for the pack to branch on:
//   --gate  { reproduced }: the work already has a reproduction an earlier run kept, whose commit is in this branch,
//           so the reproduce step is skipped.
//   --red   { red, line, commit?, check? }: the reproduce step's check (from the engine's record, through the helper)
//           fails at the branch's head, which is a commit of its own after the base holding only the test files the
//           step listed, on a branch that changes nothing else since the base, with nothing left uncommitted. A kept reproduction is red as it was kept.
//   --keep  { kept, line }: the helper keeps the reproduction from the engine's record, and the order copy in the
//           run's artefacts is written again, with the reproduction among its done checks.
//   node scripts/engine/reproduce.js --gate|--red|--keep --run <run id> --artefacts <folder> --base <ref>
import { helperClient } from '../host/helper-client.js';
import { withTicket } from './ticket.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { run as defaultRun } from '../lib/run.js';
import { safeGit } from '../lib/safe-git.js';
import { runArg, runDoneChecks } from './done-check.js';
import { main as orderCopy } from './order-copy.js';

const USAGE = 'usage: node scripts/engine/reproduce.js --gate|--red|--keep --run <run id> --artefacts <folder> --base <ref>';
const GIT_MS = 30000;

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 30000 }), cwd = process.cwd(), out = (line) => process.stdout.write(`${line}\n`), run = defaultRun, platform } = {}) {
  const client = withTicket(given, argv);
  const runId = runArg(argv);
  const base = runArg(argv, '--base');
  const mode = ['--gate', '--red', '--keep'].find((m) => argv.includes(m));
  if (!runId || !mode || (mode !== '--keep' && !base)) {
    out(USAGE);
    return 2;
  }
  const said = (answer) => {
    out(JSON.stringify(answer));
    return 0;
  };
  // Git behind Wheelhouse's fence alone: the worktree's own settings are an agent's to write.
  const fenced = safeGit({ run, cwd, look: 'never', timeoutMs: GIT_MS });
  const git = async (...args) => {
    try {
      return await fenced(args);
    } catch {
      return { code: 1, stdout: '' };
    }
  };
  // The work's kept reproduction, when its commit is in this branch's history.
  const keptHere = async (found) => (found?.kept && (await git('merge-base', '--is-ancestor', found.kept.commit, 'HEAD')).code === 0 ? found.kept : null);

  if (mode === '--keep') {
    const kept = await client.engine.reproduction({ runId });
    if (kept?.ok !== true) return said({ kept: false, line: `The reproduction wasn't kept: ${kept?.refused ?? 'the helper gave no answer'}` });
    const artefacts = runArg(argv, '--artefacts');
    const copied = artefacts ? await orderCopy(['--run', runId, '--out', artefacts, '--artefacts', artefacts], { client: given, out: () => {} }) : 1;
    return said({ kept: true, line: copied === 0 ? 'The reproduction is kept, and the work order holds it.' : 'The reproduction is kept; the work order copy wasn\'t written again.' });
  }

  const found = await client.engine.reproductionFind({ runId });
  const kept = await keptHere(found);
  if (mode === '--gate') return said({ reproduced: kept !== null });

  const notRed = (line) => said({ red: false, line });
  if (kept) return said({ red: true, commit: kept.commit, check: kept.check, line: 'The reproduction an earlier run kept stands.' });
  if (found?.ok !== true || !found.given) return notRed('The reproduce step gave no reproduction.');
  const status = await git('status', '--porcelain', '--untracked-files=all');
  if (status.code !== 0 || status.stdout.trim() !== '') return notRed('The reproduction isn\'t committed on its own: there are changes that aren\'t committed.');
  const ahead = await git('rev-list', '--count', `${base}..HEAD`);
  if (ahead.code !== 0 || !(Number(ahead.stdout.trim()) >= 1)) return notRed('The reproduction has no commit of its own after the base.');
  const listed = (got) => (got.code === 0 ? got.stdout.split('\n').map((f) => f.trim()).filter(Boolean) : null);
  const onlyTests = (files) => files !== null && files.length > 0 && files.every((f) => found.given.files.includes(f));
  if (!onlyTests(listed(await git('--literal-pathspecs', 'diff', '--name-only', 'HEAD~1', 'HEAD')))) {
    return notRed('The reproduction\'s commit changes more than its test.');
  }
  // The whole branch, too: a product change in an earlier commit would make the test fail on a tree the agent made.
  if (!onlyTests(listed(await git('--literal-pathspecs', 'diff', '--name-only', `${base}...HEAD`)))) {
    return notRed('The branch changes more than the reproduction\'s test, so the test wouldn\'t show the bug as it was reported.');
  }
  const head = await git('rev-parse', 'HEAD');
  const commit = head.code === 0 ? head.stdout.trim() : '';
  const answer = await client.engine.order({ runId });
  if (answer?.ok !== true || !answer.order) return notRed(`The work order couldn't be read: ${answer?.refused ?? 'no answer'}.`);
  const [result] = await runDoneChecks({ ...answer.order, done: [found.given.check] }, { cwd, run, platform });
  if (result.ok) return notRed('The test passes before any fix, so it doesn\'t reproduce the bug.');
  if (/could not be started|took longer/.test(result.line)) return notRed(`The reproduction couldn't be run: ${result.line}.`);
  return said({ red: true, commit, check: found.given.check, line: `The reproduction fails, as it should while the bug is there: ${result.line}.` });
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
