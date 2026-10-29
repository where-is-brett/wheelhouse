// tests/scripts/engine/reproduce.test.js
// The bug lane's reproduce steps (Archon design, section 7.2), on the planted bug of the evaluation's project: the gate
// finds a reproduction an earlier run kept, the red step proves the reproduce step's test fails at its own commit,
// which holds only that test, and the keep step has the helper keep it and writes the order copy again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../../../scripts/engine/reproduce.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { TICKET_FILE } from '../../../scripts/engine/ticket.js';
import { tempFolder } from '../../helpers/homes.js';
import { runOutsideTests as run } from '../../helpers/outside-tests.js';
import { FILES, FIX, REPRODUCTION, REPRODUCTION_FILE, REPRODUCTION_NAME, TEST_COMMAND } from '../../eval/build-loop/bug-project.js';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe' }).toString().trim();
const CHECK = { test: REPRODUCTION_NAME };
const GIVEN = { check: CHECK, files: [REPRODUCTION_FILE] };
const order = workOrder({ work: { id: 'video-length', lane: 'bug', goal: 'A 65-second clip shows as 1:5 on its card', done: [{ command: 'npm test', expect: 0 }] }, config: { testCommand: TEST_COMMAND } });

function project({ reproduce = REPRODUCTION, alsoFix = false } = {}) {
  const dir = tempFolder('wh-repro-');
  git(dir, 'init', '-q');
  for (const [file, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'wh/video-length');
  if (reproduce) {
    fs.writeFileSync(path.join(dir, REPRODUCTION_FILE), reproduce);
    if (alsoFix) fs.writeFileSync(path.join(dir, 'src/duration.js'), FIX);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'Reproduce: a 65-second clip shows as 1:5');
  }
  return dir;
}
function artefacts() {
  const dir = tempFolder('wh-repro-art-');
  fs.writeFileSync(path.join(dir, TICKET_FILE), `${'a'.repeat(64)}\n`);
  return dir;
}
function client({ kept = null, given = GIVEN, keep } = {}) {
  const calls = [];
  return {
    calls,
    engine: {
      order: async () => ({ ok: true, order: kept ? { ...order, done: [...order.done, kept.check] } : order }),
      reproductionFind: async () => ({ ok: true, kept, given }),
      reproduction: async (args) => { calls.push(args); return keep ?? { ok: true, check: CHECK, commit: 'c'.repeat(40) }; },
    },
  };
}
async function step(mode, cwd, c, art = artefacts()) {
  const lines = [];
  const code = await main([`--${mode}`, '--run', 'run-1', '--artefacts', art, '--base', 'main'], { client: c, cwd, run, out: (l) => lines.push(l) });
  return { code, got: JSON.parse(lines.at(-1)), art };
}

test('the reproduce step\'s test, failing at its own commit, which holds only that test, is red', async () => {
  const dir = project();
  const { code, got } = await step('red', dir, client());
  assert.equal(code, 0);
  assert.equal(got.red, true, got.line);
  assert.equal(got.commit, git(dir, 'rev-parse', 'HEAD'));
  assert.deepEqual(got.check, CHECK);
});

test('a reproduction that isn\'t one is not red', async () => {
  const changed = await step('red', project({ alsoFix: true }), client());
  assert.equal(changed.got.red, false);
  assert.match(changed.got.line, /changes more than its test/);

  const passing = await step('red', project({ reproduce: REPRODUCTION.replace("'1:05'", "'1:5'") }), client());
  assert.equal(passing.got.red, false);
  assert.match(passing.got.line, /passes before any fix/);

  const dirty = project();
  fs.writeFileSync(path.join(dirty, 'loose.js'), 'x\n');
  assert.match((await step('red', dirty, client())).got.line, /isn't committed/);

  assert.match((await step('red', project({ reproduce: null }), client())).got.line, /no commit/);
  assert.match((await step('red', project(), client({ given: null }))).got.line, /gave no reproduction/);
  assert.equal((await step('red', project(), client({ given: { check: CHECK, files: ['test/other.test.js'] } }))).got.red, false, 'its commit holds a file it didn\'t list');
});

test('the gate finds a reproduction an earlier run kept, only while its commit is in this branch', async () => {
  const dir = project();
  const commit = git(dir, 'rev-parse', 'HEAD');
  assert.deepEqual((await step('gate', dir, client())).got, { reproduced: false });
  assert.deepEqual((await step('gate', dir, client({ kept: { ...GIVEN, commit } }))).got, { reproduced: true });
  assert.deepEqual((await step('gate', dir, client({ kept: { ...GIVEN, commit: 'f'.repeat(40) } }))).got, { reproduced: false });
  // The red step then gives the kept one, unrun.
  const red = await step('red', dir, client({ kept: { ...GIVEN, commit } }));
  assert.deepEqual([red.got.red, red.got.commit, red.got.check], [true, commit, CHECK]);
});

test('the keep step has the helper keep it, and writes the order copy again with it', async () => {
  const dir = project();
  const c = client({ kept: { ...GIVEN, commit: 'c'.repeat(40) } });
  const { code, got, art } = await step('keep', dir, c);
  assert.equal(code, 0);
  assert.equal(got.kept, true);
  assert.equal(c.calls.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(art, 'order.json'), 'utf8')).done.at(-1), CHECK);
  const refused = await step('keep', dir, client({ keep: { ok: false, refused: 'no' } }));
  assert.deepEqual([refused.code, refused.got.kept], [0, false]);
});

test('the wrong usage is said', async () => {
  const lines = [];
  assert.equal(await main(['--run', 'run-1'], { client: client(), cwd: '/', out: (l) => lines.push(l) }), 2);
  assert.match(lines[0], /usage/);
});
