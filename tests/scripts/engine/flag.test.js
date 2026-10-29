// tests/scripts/engine/flag.test.js
// A feature's switch (scripts/engine/flag.js and order-copy's --feature-flags): a slice leaves its switch off; the
// feature's own run switches it on in its file and commits that, or leaves a switch set the project's own way to its
// step; and the first step says which approval the run ends on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main as flag } from '../../../scripts/engine/flag.js';
import { main as copy } from '../../../scripts/engine/order-copy.js';
import { DEFAULT_FLAG_FILE } from '../../../scripts/engine/order.js';
import { tempFolder } from '../../helpers/homes.js';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe' }).toString();
const FILE_FLAG = { name: 'order-history', file: DEFAULT_FLAG_FILE };
const clientFor = (order) => ({ engine: { order: async () => ({ ok: true, order }) } });

function repo(flags) {
  const dir = tempFolder('wh-flag-');
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  if (flags !== undefined) {
    fs.mkdirSync(path.join(dir, 'config'));
    fs.writeFileSync(path.join(dir, DEFAULT_FLAG_FILE), typeof flags === 'string' ? flags : JSON.stringify(flags));
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}
async function play(argv, { order, cwd }) {
  const lines = [];
  const code = await flag(argv, { client: clientFor(order), cwd, out: (l) => lines.push(l) });
  return { code, got: lines.length ? JSON.parse(lines.at(-1)) : null };
}

test('a slice that leaves its switch off, or hasn\'t written it yet, is clean', async () => {
  for (const flags of [undefined, {}, { 'order-history': false }]) {
    const { code, got } = await play(['--check-off', '--run', 'r1'], { order: { lane: 'slice', flag: FILE_FLAG }, cwd: repo(flags) });
    assert.equal(code, 0);
    assert.deepEqual(got, { clean: true }, JSON.stringify(flags));
  }
});

test('a slice that switches its own flag on, or breaks the flags file, isn\'t clean', async () => {
  for (const flags of [{ 'order-history': true }, '{ broken']) {
    const { got } = await play(['--check-off', '--run', 'r1'], { order: { lane: 'slice', flag: FILE_FLAG }, cwd: repo(flags) });
    assert.equal(got.clean, false, JSON.stringify(flags));
    assert.equal(typeof got.why, 'string');
  }
});

test('a switch set the project\'s own way is the reviewers\' to check, so the check passes it', async () => {
  const { got } = await play(['--check-off', '--run', 'r1'], { order: { lane: 'slice', flag: { name: 'order-history', how: 'Set ORDERS=1' } }, cwd: repo() });
  assert.deepEqual(got, { clean: true });
});

test('the feature\'s own run switches the flag on in its file and commits it, once', async () => {
  const dir = repo({ other: false, 'order-history': false });
  const { code, got } = await play(['--on', '--run', 'r1'], { order: { lane: 'feature', flag: FILE_FLAG }, cwd: dir });
  assert.equal(code, 0);
  assert.deepEqual(got, { switched: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, DEFAULT_FLAG_FILE), 'utf8')), { other: false, 'order-history': true });
  assert.equal(git(dir, 'log', '-1', '--format=%s').trim(), 'Switch on order-history');
  assert.equal(git(dir, 'status', '--porcelain').trim(), '');
  const commits = git(dir, 'rev-list', '--count', 'HEAD').trim();
  await play(['--on', '--run', 'r1'], { order: { lane: 'feature', flag: FILE_FLAG }, cwd: dir });
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD').trim(), commits, 'a rerun adds no commit');
});

test('a flags file that isn\'t there yet is made; a switch set the project\'s own way is left to its step', async () => {
  const dir = repo();
  assert.deepEqual((await play(['--on', '--run', 'r1'], { order: { lane: 'feature', flag: FILE_FLAG }, cwd: dir })).got, { switched: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, DEFAULT_FLAG_FILE), 'utf8')), { 'order-history': true });
  const own = repo();
  assert.deepEqual((await play(['--on', '--run', 'r1'], { order: { lane: 'feature', flag: { name: 'order-history', how: 'Set ORDERS=1' } }, cwd: own })).got, { switched: false });
});

test('the first step says which approval a run ends on, and whether its switch is a file', async () => {
  const flags = async (order) => {
    const lines = [];
    await copy(['--run', 'r1', '--out', tempFolder('wh-art-'), '--feature-flags'], { client: clientFor(order), out: (l) => lines.push(l) });
    return JSON.parse(lines[0]);
  };
  const feature = await flags({ lane: 'feature', preview: null, showFirst: true, flag: FILE_FLAG, done: [] });
  assert.equal(feature.topic, 'switch-on');
  assert.equal(feature.flagFile, true);
  assert.equal(feature.showFirst, true);
  assert.match(feature.words, /switch/i);
  const demo = await flags({ lane: 'slice', preview: { pages: [] }, showFirst: true, demo: true, flag: { name: 'x', how: 'y' }, done: [] });
  assert.deepEqual([demo.topic, demo.demo, demo.flagFile, demo.visible], ['midpoint-demo', true, false, true]);
  const plain = await flags({ lane: 'slice', preview: null, showFirst: false, demo: false, flag: FILE_FLAG, done: [] });
  assert.equal(plain.topic, 'shown-first');
});
