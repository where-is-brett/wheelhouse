// probes/89-off-path/run.js
// Check 89 (D5): on a sample change, do the off-path checks catch a reused switch and a changed off path? No engine and
// no model: a scratch repository with a flags file, and four slices, each tried against the checks the design's guardrail 3
// names for switch undo:
//   0. the switch is kept in a file (a switch given in words has none, so the undo kind isn't available);
//   1. the flags file reads off (the real scripts/engine/flag.js --check-off, with a stand-in for the helper's order);
//   2. the switch's name is new: it appears nowhere in the main line's history (here read with `git log -S`; the plan
//      has the helper record the name when the feature begins);
//   3. with the switch off, the project's tests pass;
//   4. no test file changed.
// The pages comparison (screenshots with the switch off) needs a browser and is not trialled here.
//
//   node probes/89-off-path/run.js
//
// The slices: a reused name; a change to the off path that a test sees; one that no test sees; a switch given in words.
// Nothing runs at import.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run as runCommand } from '../../scripts/lib/run.js';
import { main as flagMain } from '../../scripts/engine/flag.js';
import { assertUnderTmp } from '../lib/scratch.js';

const FLAGS = 'config/feature-flags.json';
const write = (dir, file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };

async function git(dir, ...args) {
  const r = await runCommand('/usr/bin/git', ['-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd: dir });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const APP = `import fs from 'node:fs';
const flags = () => JSON.parse(fs.readFileSync(new URL('./config/feature-flags.json', import.meta.url), 'utf8'));
export const greeting = () => (flags()['new-greeting'] ? 'Welcome back' : 'Hello');
export const price = (n) => n * 100;
export const shipping = (n) => (n > 50 ? 0 : 5);
`;
const TEST = `import test from 'node:test';
import assert from 'node:assert/strict';
import { greeting, price } from '../app.js';
test('greeting', () => assert.equal(greeting(), 'Hello'));
test('price', () => assert.equal(price(2), 200));
`;

// The main line: a flag called old-banner was added and removed long ago, so its name is in the history.
export async function sampleRepo(root) {
  assertUnderTmp(root);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  await git(root, 'init', '-q');
  write(root, 'package.json', '{ "type": "module" }\n');
  write(root, 'app.js', APP);
  write(root, 'test/app.test.js', TEST);
  write(root, FLAGS, '{\n  "old-banner": false\n}\n');
  await git(root, 'add', '-A'); await git(root, 'commit', '-q', '-m', 'Base with an old switch');
  write(root, FLAGS, '{}\n');
  await git(root, 'add', '-A'); await git(root, 'commit', '-q', '-m', 'Remove the old switch');
  return root;
}

// Each slice: the flag it uses and what it changes on its branch. `off` names are the switch left off.
const SLICES = [
  { id: 'reused-name', flag: { name: 'old-banner', file: FLAGS }, change: (dir) => { write(dir, FLAGS, '{\n  "old-banner": false\n}\n'); write(dir, 'banner.js', "export const banner = (on) => (on ? 'Sale' : '');\n"); } },
  { id: 'off-path-changed-test-sees', flag: { name: 'new-greeting', file: FLAGS }, change: (dir) => { write(dir, FLAGS, '{\n  "new-greeting": false\n}\n'); write(dir, 'app.js', APP.replace("'Hello'", "'Hi'")); } },
  { id: 'off-path-changed-test-edited', flag: { name: 'new-greeting', file: FLAGS }, change: (dir) => { write(dir, FLAGS, '{\n  "new-greeting": false\n}\n'); write(dir, 'app.js', APP.replace("'Hello'", "'Hi'")); write(dir, 'test/app.test.js', TEST.replace("'Hello'", "'Hi'")); } },
  { id: 'off-path-changed-no-test-sees', flag: { name: 'new-greeting', file: FLAGS }, change: (dir) => { write(dir, FLAGS, '{\n  "new-greeting": false\n}\n'); write(dir, 'app.js', APP.replace('n > 50 ? 0 : 5', 'n > 50 ? 0 : 9')); } },
  { id: 'switch-in-words', flag: { name: 'new-greeting', how: 'set the environment variable NEW_GREETING' }, change: (dir) => { write(dir, 'app.js', APP.replace("'Hello'", "'Hi'")); write(dir, 'test/app.test.js', TEST.replace("'Hello'", "'Hi'")); } },
];

async function flagOffCheck(dir, flag) {
  const lines = [];
  await flagMain(['--check-off', '--run', 'trial'], { client: { engine: { order: async () => ({ ok: true, order: { lane: 'slice', flag } }) } }, cwd: dir, out: (l) => lines.push(l) });
  return JSON.parse(lines.at(-1));
}

export async function trial(slice, repo) {
  const dir = `${repo}-${slice.id}`;
  fs.rmSync(dir, { recursive: true, force: true });
  await git(repo, 'worktree', 'prune');
  await runCommand('/usr/bin/git', ['clone', '-q', repo, dir]);
  await git(dir, 'checkout', '-q', '-b', slice.id);
  slice.change(dir);
  await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', `Slice ${slice.id}`);
  const off = await flagOffCheck(dir, slice.flag);
  const name = slice.flag.name;
  const history = await git(dir, 'log', 'main', '--format=%H', `-S"${name}"`);
  const tests = await runCommand(process.execPath, ['--test'], { cwd: dir });
  const changedTests = (await git(dir, 'diff', '--name-only', 'main', slice.id, '--', 'test/')).split('\n').filter(Boolean);
  return {
    slice: slice.id,
    switchInFile: typeof slice.flag.file === 'string',
    flagsFileReadsOff: off.clean === true,
    flagsFileWhy: off.why ?? null,
    nameIsNew: history === '',
    testsPassOff: tests.code === 0,
    noTestChanged: changedTests.length === 0,
    caughtBy: [
      ...(typeof slice.flag.file === 'string' ? [] : ['switch not in a file']),
      ...(off.clean === true ? [] : ['flags file']),
      ...(history === '' ? [] : ['name not new']),
      ...(tests.code === 0 ? [] : ['tests fail off']),
      ...(changedTests.length === 0 ? [] : ['a test changed']),
    ],
  };
}

async function main() {
  const root = path.join(os.tmpdir(), 'wheelhouse-probe-89', 'main-line');
  const repo = await sampleRepo(root);
  const rows = [];
  for (const slice of SLICES) rows.push(await trial(slice, repo));
  console.log(JSON.stringify(rows, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
