// tests/scripts/addon/hash.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { vsixHash, recordedHash, checkHash, writeHash, HASH_FILE } from '../../../scripts/addon/hash.js';
import { closureOf, ENTRIES } from '../../../scripts/addon/pack.js';
import { tempFolder } from '../../helpers/homes.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// A copy of what the pack reads, in a temporary folder, so a test can change one packed file.
function copyOfRoot(extra = []) {
  const dir = tempFolder('wh-hash-');
  const copy = (rel) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
  };
  copy(path.join('.claude-plugin', 'plugin.json'));
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const next = path.join(rel, e.name);
      if (e.isDirectory()) walk(next); else copy(next);
    }
  };
  walk('vscode');
  for (const rel of closureOf({ root: ROOT, entries: [...ENTRIES, ...extra] })) copy(rel);
  // The copy starts with no recorded hash.
  fs.rmSync(path.join(dir, 'vscode', 'vsix.sha256'), { force: true });
  return dir;
}

test('two packs hash the same', () => {
  const a = vsixHash({ root: ROOT });
  const b = vsixHash({ root: ROOT });
  assert.equal(a.hash, b.hash);
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.match(a.name, /^wheelhouse-.*\.vsix$/);
});

test('the recorded hash is not itself packed, so writing it changes nothing', () => {
  const root = copyOfRoot();
  const before = vsixHash({ root }).hash;
  fs.writeFileSync(path.join(root, 'vscode', 'vsix.sha256'), `${'a'.repeat(64)}  x.vsix\n`);
  assert.equal(vsixHash({ root }).hash, before);
});

test('the recorded hash is read as shasum prints it, and a bad file reads as none', () => {
  const root = tempFolder('wh-hash-');
  assert.equal(recordedHash({ root }), null);
  fs.mkdirSync(path.join(root, 'vscode'));
  const file = path.join(root, 'vscode', 'vsix.sha256');
  fs.writeFileSync(file, `${'ab'.repeat(32)}  wheelhouse-1.2.3.vsix\n`);
  assert.deepEqual(recordedHash({ root }), { hash: 'ab'.repeat(32), name: 'wheelhouse-1.2.3.vsix' });
  fs.writeFileSync(file, '{');
  assert.equal(recordedHash({ root }), null);
  fs.writeFileSync(file, `${'zz'.repeat(32)}  x.vsix\n`);
  assert.equal(recordedHash({ root }), null);
});

test('check passes on the recorded hash and fails on another', () => {
  const root = copyOfRoot();
  writeHash({ root });
  assert.equal(checkHash({ root }).ok, true);
  const recorded = recordedHash({ root });
  fs.appendFileSync(path.join(root, 'vscode', 'nonce.cjs'), '\n// changed\n');
  const bad = checkHash({ root });
  assert.equal(bad.ok, false);
  assert.ok(bad.line.includes(recorded.hash.slice(0, 12)), bad.line);
  assert.ok(bad.line.includes(vsixHash({ root }).hash.slice(0, 12)), bad.line);
});

test('check fails, in words, when no hash is recorded', () => {
  const root = copyOfRoot();
  const got = checkHash({ root });
  assert.equal(got.ok, false);
  assert.match(got.line, /no recorded hash/i);
});

test('check can be given the file that will be installed', () => {
  const root = copyOfRoot();
  writeHash({ root });
  const other = path.join(tempFolder('wh-hash-'), 'other.vsix');
  fs.writeFileSync(other, 'not the add-on');
  assert.equal(checkHash({ root, file: other }).ok, false);
});

test('the recorded hash in the repository matches a fresh pack', () => {
  assert.equal(HASH_FILE, path.join('vscode', 'vsix.sha256'));
  const got = checkHash({ root: ROOT });
  assert.equal(got.ok, true, `${got.line}\nRun node scripts/addon/hash.js --write and commit the result.`);
});

test('--check exits 1 with the line on a mismatch, and --write then --check exits 0', () => {
  const root = copyOfRoot(['scripts/addon/hash.js']);
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(root, 'package.json'));
  const script = path.join(root, 'scripts', 'addon', 'hash.js');
  const run = (flag) => spawnSync(process.execPath, [script, flag], { encoding: 'utf8' });
  const bad = run('--check');
  assert.equal(bad.status, 1);
  assert.match(bad.stdout + bad.stderr, /no recorded hash/i);
  assert.equal(run('--write').status, 0);
  assert.equal(run('--check').status, 0);
});
