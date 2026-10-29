// tests/scripts/engine/lenses.test.js
// Which review lenses beyond standards and spec apply to a run (Archon design, section 11): security on changes that
// touch sign-in, permissions, stored data, payments or secrets, by path or diff; design on visible work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main, securityTouched } from '../../../scripts/engine/lenses.js';
import { tempFolder } from '../../helpers/homes.js';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe' }).toString();

function repo() {
  const dir = tempFolder('wh-lens-');
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'price.js'), 'export const price = () => 12;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'wh/card-1');
  return dir;
}
const client = (preview) => ({ engine: { order: async () => ({ ok: true, order: { preview } }) } });

async function lenses(dir, preview = null) {
  const lines = [];
  assert.equal(await main(['--run', 'run-1', '--base', 'main'], { client: client(preview), cwd: dir, out: (l) => lines.push(l) }), 0);
  return JSON.parse(lines[0]);
}

test('a plain change needs neither lens', async () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'src', 'price.js'), 'export const price = () => 13;\n');
  const got = await lenses(dir);
  assert.deepEqual([got.security, got.design], [false, false]);
});

test('a change to a sign-in path or one naming a secret needs the security lens', async () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, 'src', 'auth'));
  fs.writeFileSync(path.join(dir, 'src', 'auth', 'login.js'), 'export const ok = true;\n');
  assert.equal((await lenses(dir)).security, true);
  const other = repo();
  fs.writeFileSync(path.join(other, 'src', 'price.js'), 'export const price = () => process.env.STRIPE_SECRET_KEY;\n');
  assert.equal((await lenses(other)).security, true);
  assert.equal(securityTouched([{ path: 'docs/passwords.md' }], ''), true);
  assert.equal(securityTouched([{ path: 'src/tokenizer.js' }], ''), false, 'a word inside another word is not one');
});

test('visible work needs the design lens', async () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'src', 'price.js'), 'export const price = () => 13;\n');
  assert.equal((await lenses(dir, { pages: ['/'], styleGuide: null })).design, true);
});

test('no order means every lens runs', async () => {
  const dir = repo();
  const lines = [];
  const none = { engine: { order: async () => ({ ok: false, refused: 'no order' }) } };
  assert.equal(await main(['--run', 'run-1', '--base', 'main'], { client: none, cwd: dir, out: (l) => lines.push(l) }), 0);
  const got = JSON.parse(lines[0]);
  assert.deepEqual([got.security, got.design], [true, true]);
});

test('the lenses step records the commit the reviews read, and whether the worktree holds only it', async () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'src', 'price.js'), 'export const price = () => 13;\n');
  git(dir, 'commit', '-qam', 'change');
  const head = git(dir, 'rev-parse', 'HEAD').trim();
  assert.deepEqual(await lenses(dir), { security: false, design: false, head, clean: true });
  fs.writeFileSync(path.join(dir, 'src', 'price.js'), 'export const price = () => 14;\n');
  assert.equal((await lenses(dir)).clean, false, 'an uncommitted change isn\'t what the pull request will hold');
  const bare = tempFolder('wh-lens-none-');
  const lines = [];
  await main(['--run', 'run-1', '--base', 'main'], { client: client(null), cwd: bare, out: (l) => lines.push(l) });
  assert.deepEqual([JSON.parse(lines[0]).head, JSON.parse(lines[0]).clean], ['', false], 'no commit to name');
});

test('after a fix, security and design run again where they held, or where they apply and haven\'t run yet', async () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, 'src', 'auth'));
  fs.writeFileSync(path.join(dir, 'src', 'auth', 'login.js'), 'export const ok = true;\n');
  const visible = { pages: ['/'], styleGuide: null };
  const all = 'standards,spec,security,design';
  const lenses = async (held, ran = all, { cwd = dir, preview = visible } = {}) => {
    const lines = [];
    await main(['--run', 'run-1', '--base', 'main', '--held', held, '--ran', ran], { client: client(preview), cwd, out: (l) => lines.push(l) });
    const got = JSON.parse(lines[0]);
    return [got.security, got.design];
  };
  assert.deepEqual(await lenses('standards,spec'), [false, false], 'both ran and neither held');
  assert.deepEqual(await lenses('security'), [true, false]);
  assert.deepEqual(await lenses('design'), [false, true]);
  assert.deepEqual(await lenses('standards', 'standards,spec'), [true, true], 'a fix that brings a lens in has it run');
  assert.deepEqual(await lenses(''), [true, true], 'the first round runs every lens that applies');
  assert.deepEqual(await lenses('none'), [true, true], 'a list with no lens in it runs every lens that applies');
  assert.deepEqual(await lenses('$LOOP_PREV.verdict.output.held', '$LOOP_PREV.verdict.output.ran'), [true, true]);
  const plain = repo();
  fs.writeFileSync(path.join(plain, 'src', 'price.js'), 'export const price = () => 13;\n');
  assert.equal((await lenses('security', all, { cwd: plain, preview: null }))[0], false, 'a lens that held but no longer applies doesn\'t run');
});
