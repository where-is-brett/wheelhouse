// tests/eval/build-loop/127-bug-reproduced-first.js
// Scenario 127, scenario 27's bug-session leg rewritten against the pack (Archon design, sections 7.2, 11 and 18): the
// bug is reproduced by a failing test before any fix. Pass: the bug lane's fix step runs only once its reproduction is
// kept, and the reproduction is kept only once its red step proved it; the red step, run as the pack runs it on the
// evaluation's bug project in real git, proves a commit holding the failing test alone, and refuses a commit that
// fixes the product beside its test, a branch whose fix came before its test, a fix left uncommitted beside the test,
// and a test that passes before any fix. Played on the bug lane's own scripts, in its `with` variant alone. (27's
// route leg is a front-desk session, unchanged.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main as reproduce } from '../../../scripts/engine/reproduce.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { FILES, FIX, REPRODUCTION, REPRODUCTION_FILE, REPRODUCTION_NAME, TEST_COMMAND } from './bug-project.js';
import { packWorkflows, said } from './pack-routes.js';
import { runOutsideTests } from '../../helpers/outside-tests.js';

const CHECK = { test: REPRODUCTION_NAME };
// A test that passes while the bug is there: it doesn't reproduce it.
const PASSING = REPRODUCTION.replace("formatDuration(65), '1:05'", "formatDuration(70), '1:10'");

// The bug project on `main`, and a branch for the run, in a folder of its own.
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-s127-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });
  for (const [file, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), text);
  }
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'The clip cards');
  git('checkout', '-qb', 'wh/video-length');
  const write = (file, text) => fs.writeFileSync(path.join(cwd, file), text);
  const commit = (message) => { git('add', '-A'); git('commit', '-qm', message); };
  return { cwd, write, commit, close: () => fs.rmSync(cwd, { recursive: true, force: true }) };
}

// The red step as the pack runs it, with the reproduce step's own output and the run's order from the helper.
async function red(cwd) {
  const order = workOrder({ work: { id: 'video-length', lane: 'bug', goal: 'A 65-second clip shows as 1:5 on its card', done: [{ command: 'npm test', expect: 0 }] }, config: { testCommand: TEST_COMMAND } });
  const client = { engine: {
    reproductionFind: async () => ({ ok: true, given: { files: [REPRODUCTION_FILE], check: CHECK } }),
    order: async () => ({ ok: true, order }),
  } };
  // The project's tests run as their own, also when this scenario plays inside a test run.
  return (await said(reproduce, ['--red', '--run', 'run-127', '--base', 'main'], { client, cwd, run: runOutsideTests })).got;
}

// Each way a branch can stand when the red step reads it, and what the step should find.
const CASES = [
  { name: 'a fix in the test\'s commit', red: false, line: /commit changes more than its test/, make: (p) => { p.write(REPRODUCTION_FILE, REPRODUCTION); p.write('src/duration.js', FIX); p.commit('Test and fix'); } },
  { name: 'a fix before the test', red: false, line: /branch changes more than/, make: (p) => { p.write('src/duration.js', FIX); p.commit('Fix'); p.write(REPRODUCTION_FILE, REPRODUCTION); p.commit('Test'); } },
  { name: 'a fix left uncommitted beside the test', red: false, line: /aren't committed/, make: (p) => { p.write(REPRODUCTION_FILE, REPRODUCTION); p.commit('Test'); p.write('src/duration.js', FIX); } },
  { name: 'a test that passes before any fix', red: false, line: /passes before any fix/, make: (p) => { p.write(REPRODUCTION_FILE, PASSING); p.commit('Test'); } },
  { name: 'the failing test alone', red: true, line: /fails, as it should/, make: (p) => { p.write(REPRODUCTION_FILE, REPRODUCTION); p.commit('Reproduce the bug'); } },
];

export default {
  id: 127,
  title: 'A bug run\'s fix starts only after a test alone, committed first, is proved to fail',
  safety: true,
  engine: {
    async play() {
      const bug = packWorkflows().find((f) => f.name === 'wheelhouse-bug');
      const step = (id) => bug?.nodes.find((n) => n.node.id === id)?.node;
      if (step('implement')?.when !== "$reproduced.output.kept == 'true'") return { pass: false, why: 'the bug lane\'s fix step can run without a kept reproduction' };
      if (step('reproduced')?.when !== "$red.output.red == 'true'") return { pass: false, why: 'the bug lane keeps a reproduction its red step didn\'t prove' };
      if (!/scripts\/engine\/reproduce\.js" --red/.test(step('red')?.bash ?? '')) return { pass: false, why: 'the bug lane\'s red step isn\'t reproduce.js --red' };

      for (const c of CASES) {
        const p = project();
        try {
          c.make(p);
          const got = await red(p.cwd);
          if (got?.red !== c.red || !c.line.test(got.line ?? '')) return { pass: false, why: `with ${c.name}, the red step said ${JSON.stringify(got)}` };
          if (c.red && (got.check?.test !== REPRODUCTION_NAME || !/^[0-9a-f]{40}$/.test(got.commit ?? ''))) return { pass: false, why: `the proved reproduction names ${JSON.stringify(got)}` };
        } finally {
          p.close();
        }
      }
      return { pass: true, why: 'the fix step waits on a kept reproduction; the red step proved the failing test alone, and refused a fix beside it, before it or left uncommitted, and a test that passes' };
    },
  },
  variants: { with: {} },
};
