// tests/scripts/engine/bug-check.test.js
// The bug lane's build check and size rule (Archon design, section 7.2), on the planted bug of the evaluation's
// project: the loop closes only when every done check passes, the reproduction among them, with the reproduction's test
// as it was when it went red and no test loosened; or on its last round, for the lane to ask. A fix that changes more
// than a bug's share of files, or never passed, is bigger than a bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main as bugCheck } from '../../../scripts/engine/bug-check.js';
import { main as bugSize } from '../../../scripts/engine/bug-size.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { TICKET_FILE } from '../../../scripts/engine/ticket.js';
import { tempFolder } from '../../helpers/homes.js';
import { runOutsideTests as run } from '../../helpers/outside-tests.js';
import { FILES, FIX, REPRODUCTION, REPRODUCTION_FILE, REPRODUCTION_NAME, TEST_COMMAND } from '../../eval/build-loop/bug-project.js';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe' }).toString().trim();
const CHECK = { test: REPRODUCTION_NAME };
const order = workOrder({ work: { id: 'video-length', lane: 'bug', goal: 'A 65-second clip shows as 1:5 on its card', done: [{ command: 'node --test', expect: 0 }] }, config: { testCommand: TEST_COMMAND } });

const write = (dir, file, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
// The project on its bug branch with the reproduction committed; `commit` is the reproduction's.
function project() {
  const dir = tempFolder('wh-bugcheck-');
  git(dir, 'init', '-q');
  for (const [file, text] of Object.entries(FILES)) write(dir, file, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'wh/video-length');
  write(dir, REPRODUCTION_FILE, REPRODUCTION);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'Reproduce');
  return { dir, commit: git(dir, 'rev-parse', 'HEAD') };
}
const commitAll = (dir, message) => { git(dir, 'add', '-A'); git(dir, 'commit', '-qm', message); };
function artefacts() {
  const dir = tempFolder('wh-bugcheck-art-');
  fs.writeFileSync(path.join(dir, TICKET_FILE), `${'a'.repeat(64)}\n`);
  return dir;
}
const client = (commit, files = [REPRODUCTION_FILE]) => ({
  engine: {
    order: async () => ({ ok: true, order: { ...order, done: [...order.done, CHECK] } }),
    reproductionFind: async () => ({ ok: true, kept: { check: CHECK, files, commit }, given: null }),
  },
});
async function check(p, { art = artefacts(), blocked = 'false', files } = {}) {
  const lines = [];
  const code = await bugCheck(['--run', 'run-1', '--artefacts', art, '--base', 'main', '--most', '5', '--blocked', blocked], { client: client(p.commit, files), cwd: p.dir, run, out: (l) => lines.push(l) });
  return { code, lines };
}
async function size(p) {
  const lines = [];
  const code = await bugSize(['--run', 'run-1', '--artefacts', artefacts(), '--base', 'main'], { client: client(p.commit), cwd: p.dir, run, out: (l) => lines.push(l) });
  return { code, got: JSON.parse(lines.at(-1)) };
}

test('the loop closes once the fix makes the reproduction pass, with the rest of the checks', async () => {
  const p = project();
  assert.equal((await check(p)).code, 1, 'the bug is still there');
  write(p.dir, 'src/duration.js', FIX);
  commitAll(p.dir, 'Pad the seconds');
  const { code, lines } = await check(p);
  assert.equal(code, 0, lines.join('\n'));
});

test('a fix that changes the reproduction\'s test never closes the loop', async () => {
  const p = project();
  write(p.dir, REPRODUCTION_FILE, REPRODUCTION.replace("'1:05'", "'1:5'"));
  commitAll(p.dir, 'Make the test agree');
  const { code, lines } = await check(p);
  assert.equal(code, 1);
  assert.ok(lines.some((l) => /reproduction's test changed since it went red/.test(l)), lines.join('\n'));
});

test('the reproduction\'s files are read as plain paths, so no pathspec hides a change to its test', async () => {
  const p = project();
  write(p.dir, REPRODUCTION_FILE, REPRODUCTION.replace("'1:05'", "'1:5'"));
  commitAll(p.dir, 'Make the test agree');
  const { code, lines } = await check(p, { files: [REPRODUCTION_FILE, `:!${REPRODUCTION_FILE}`] });
  assert.equal(code, 1);
  assert.ok(lines.some((l) => /reproduction's test changed since it went red/.test(l)), lines.join('\n'));
});

test('a builder that stopped with a question closes the loop at once, and the last round closes it for the lane to ask', async () => {
  const p = project();
  assert.equal((await check(p, { blocked: 'true' })).code, 0);
  const art = artefacts();
  for (let round = 1; round <= 4; round += 1) assert.equal((await check(p, { art })).code, 1, `round ${round}`);
  const last = await check(p, { art });
  assert.equal(last.code, 0);
  assert.match(last.lines.at(-1), /out of rounds, so the loop closes and the lane asks/);
});

test('a bug\'s fix that passes and stays small is the bug lane\'s', async () => {
  const p = project();
  write(p.dir, 'src/duration.js', FIX);
  commitAll(p.dir, 'Pad the seconds');
  const { code, got } = await size(p);
  assert.equal(code, 0);
  assert.equal(got.blocked, false, got.line);
});

test('a fix that changes more files than a bug\'s, or never passed, is bigger than a bug', async () => {
  const p = project();
  write(p.dir, 'src/duration.js', FIX);
  for (const n of [1, 2, 3, 4, 5]) write(p.dir, `src/extra-${n}.js`, `export const n = ${n};\n`);
  commitAll(p.dir, 'A wide fix');
  const wide = (await size(p)).got;
  assert.equal(wide.blocked, true);
  assert.equal(wide.topic, 'bigger-than-a-bug');
  assert.equal(wide.level, '3');
  assert.equal(wide.recommend, 'small');
  assert.deepEqual(wide.options.map((o) => o.id), ['small', 'feature', 'stop']);
  assert.match(wide.question, /changes 6 files, more than a bug's fix should/);

  const red = (await size(project())).got;
  assert.equal(red.blocked, true);
  assert.match(red.question, /didn't pass its checks within its rounds/);
});
