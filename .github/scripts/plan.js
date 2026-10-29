// .github/scripts/plan.js
// CI's first job (.github/workflows/ci.yml): plans the test jobs. It names the computers the tests
// run on and how many parts each splits them into, and whether a pull request needs the tests at
// all. A pull request that changes only text no test, check or build reads still gets every test
// job, each passing at once without running the tests, so a required check still turns green. A
// push to main and a run started by hand always run the tests.
//   node .github/scripts/plan.js    (reads GitHub's event from the environment, writes $GITHUB_OUTPUT)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { startedAsScript } from '../../scripts/lib/started-as-script.js';

// The folders of text nothing reads: the design documents and the build plans. Tests that name
// docs/specs/ or docs/plans/ make files of their own at those paths in a temporary folder; the
// rest of docs/ is read by tests (docs/checks/, docs/research/, docs/superpowers/ and more).
export const TEXT_ONLY = ['docs/specs/', 'docs/plans/'];

// How many parts each computer splits the tests into (node --test-shard). The parts of one
// computer run side by side. On Windows the tests run only when started by hand, in one part.
export const PARTS = { 'ubuntu-latest': 2, 'macos-latest': 3, 'windows-latest': 1 };

// Whether every changed path is text nothing reads. No paths at all is not: an empty list means
// the change couldn't be read, and the tests run.
export function textOnly(paths) {
  return paths.length > 0 && paths.every((p) => TEXT_ONLY.some((folder) => p.startsWith(folder)));
}

// The computers: Linux always; macOS too once a pull request is out of draft, on main and on a run
// started by hand (a macOS minute costs about ten Linux minutes); Windows only on a run started by
// hand with Windows ticked.
export function computers({ draft, windows }) {
  if (windows) return ['ubuntu-latest', 'windows-latest', 'macos-latest'];
  if (draft) return ['ubuntu-latest'];
  return ['ubuntu-latest', 'macos-latest'];
}

// The plan: `tests` is 'run' or 'skip', and `matrix` lists one { os, part } per test job, part
// as node's --test-shard takes it ("2/3").
export function plan({ event, draft = false, windows = false, paths = [] }) {
  const matrix = computers({ draft, windows }).flatMap((os) =>
    Array.from({ length: PARTS[os] }, (_, i) => ({ os, part: `${i + 1}/${PARTS[os]}` })));
  const tests = event === 'pull_request' && textOnly(paths) ? 'skip' : 'run';
  return { tests, matrix };
}

// The paths a pull request changes. CI checks out the merge of the pull request into its base
// with one parent's depth behind it, so the first parent is the base as it is now. A rename names
// both paths.
export function changedPaths(cwd = process.cwd()) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', 'HEAD^1', 'HEAD'], { cwd, encoding: 'utf8' });
    return out.split('\0').filter((p) => p !== '');
  } catch {
    return [];
  }
}

if (startedAsScript(import.meta.url)) {
  const event = process.env.GITHUB_EVENT_NAME;
  const payload = process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const paths = event === 'pull_request' ? changedPaths() : [];
  const got = plan({ event, draft: payload.pull_request?.draft === true, windows: payload.inputs?.windows === true || payload.inputs?.windows === 'true', paths });
  console.log(`Changed: ${paths.length === 0 ? '(not read)' : paths.join(', ')}`);
  console.log(`Tests: ${got.tests === 'skip' ? 'skipped, as the change is only text nothing reads' : 'run'}`);
  console.log(`Jobs: ${got.matrix.map((m) => `${m.os} ${m.part}`).join(', ')}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `tests=${got.tests}\nmatrix=${JSON.stringify(got.matrix)}\n`);
}
