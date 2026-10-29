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

test('after a fix, security and design run again only where they held (small lane, ruling 5)', async () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, 'src', 'auth'));
  fs.writeFileSync(path.join(dir, 'src', 'auth', 'login.js'), 'export const ok = true;\n');
  const visible = { pages: ['/'], styleGuide: null };
  const held = async (list) => {
    const lines = [];
    await main(['--run', 'run-1', '--base', 'main', '--held', list], { client: client(visible), cwd: dir, out: (l) => lines.push(l) });
    return JSON.parse(lines[0]);
  };
  assert.deepEqual([(await held('standards,spec')).security, (await held('standards,spec')).design], [false, false]);
  assert.deepEqual([(await held('security')).security, (await held('security')).design], [true, false]);
  assert.equal((await held('design')).design, true);
  const first = await held('');
  assert.deepEqual([first.security, first.design], [true, true], 'the first round runs every lens that applies');
  const plain = repo();
  fs.writeFileSync(path.join(plain, 'src', 'price.js'), 'export const price = () => 13;\n');
  const lines = [];
  await main(['--run', 'run-1', '--base', 'main', '--held', 'security'], { client: client(null), cwd: plain, out: (l) => lines.push(l) });
  assert.equal(JSON.parse(lines[0]).security, false, 'a lens that held but no longer applies doesn\'t run');
});
