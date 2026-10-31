// tests/scripts/delegation/facts.test.js
// What a change's own commits show, read from a scratch repository through the one git route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeGit } from '../../../scripts/lib/safe-git.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { changeFacts, cardFacts, UNREAD_FACTS } from '../../../scripts/delegation/facts.js';

const EMPTY = readConfig(null);

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-facts-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'readme.md'), 'hello\n');
  git('add', '.');
  git('commit', '-qm', 'first');
  git('checkout', '-qb', 'work');
  const put = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
    git('add', '.');
    git('commit', '-qm', `add ${file}`);
    return git('rev-parse', 'HEAD');
  };
  return { dir, git, put, route: safeGit({ cwd: dir, look: 'never' }) };
}
const facts = (r, head, config = EMPTY) => changeFacts({ git: r.route, base: 'main', head, config });

test('a change\'s paths and size are read from its commits', async () => {
  const r = repo();
  const head = r.put('src/a.js', 'one\ntwo\n');
  const got = await facts(r, head);
  assert.equal(got.readable, true);
  assert.equal(got.head, head);
  assert.deepEqual(got.paths, ['src/a.js']);
  assert.equal(got.lines, 2);
  assert.equal(got.testsChanged, false);
  assert.equal(got.depsChanged, false);
  assert.equal(got.schemaChanged, false);
  assert.equal(got.guardrail, false);
  assert.equal(got.secrets, false);
  assert.equal(got.critical, false);
});

test('a test file, a dependency list and a migration each show', async () => {
  const r = repo();
  r.put('tests/a.test.js', 'x\n');
  r.put('package.json', '{}\n');
  const head = r.put('db/migrations/001_add.sql', 'x\n');
  const got = await facts(r, head);
  assert.equal(got.testsChanged, true);
  assert.equal(got.depsChanged, true);
  assert.equal(got.schemaChanged, true);
});

test('a guardrail path is the permit\'s own reading, and a critical area the project\'s', async () => {
  const r = repo();
  const head = r.put('.claude/settings.json', '{}\n');
  assert.equal((await facts(r, head)).guardrail, true);
  const config = { ...EMPTY, criticalAreas: [{ name: 'pay', paths: ['.claude/**'], checks: [] }] };
  assert.equal((await facts(r, head, config)).critical, true);
});

test('a secret in an added line shows, and its text is kept nowhere', async () => {
  const r = repo();
  const key = `AKIA${'A'.repeat(16)}`;
  const head = r.put('src/key.js', `const k = '${key}';\n`);
  const got = await facts(r, head);
  assert.equal(got.secrets, true);
  assert.ok(!JSON.stringify(got).includes(key));
});

test('a secret the change removes doesn\'t count', async () => {
  const r = repo();
  r.put('src/key.js', `const k = 'AKIA${'A'.repeat(16)}';\n`);
  const from = r.git('rev-parse', 'HEAD');
  const head = r.put('src/key.js', 'const k = null;\n');
  const got = await changeFacts({ git: r.route, base: from, head, config: EMPTY });
  assert.equal(got.secrets, false);
});

test('a head git can\'t find reads as unreadable', async () => {
  const r = repo();
  assert.deepEqual(await facts(r, 'c'.repeat(40)), UNREAD_FACTS);
});

test('no configuration to judge by reads as unreadable', async () => {
  const r = repo();
  assert.deepEqual(await facts(r, r.put('src/a.js', 'x\n'), null), UNREAD_FACTS);
});

test('git refusing reads as unreadable, not as a failure', async () => {
  const got = await changeFacts({ git: async () => { throw new Error('refused'); }, base: 'main', head: 'x', config: EMPTY });
  assert.deepEqual(got, UNREAD_FACTS);
});

// The route the helper hands in: git(folder) -> { call }.
const routed = (dir) => () => ({ call: safeGit({ cwd: dir, look: 'never' }) });

test('a card\'s change is read from its branch in its folder, judged by the default branch\'s configuration', async () => {
  const r = repo();
  r.git('update-ref', 'refs/remotes/origin/main', 'main');
  r.put('.claude/wheelhouse.json', JSON.stringify({ v: 1, criticalAreas: [{ name: 'pay', paths: ['src/**'], checks: [] }], ciFiles: [], mcpServers: [], webDomains: [] }));
  const head = r.put('src/a.js', 'x\n');
  const got = await cardFacts({ card: { branch: 'work', folder: r.dir }, git: routed(r.dir), defaultBranch: 'main' });
  assert.equal(got.head, head);
  assert.equal(got.critical, false);
  assert.equal(got.guardrail, true);
  assert.deepEqual(got.paths, ['.claude/wheelhouse.json', 'src/a.js']);
});

test('a plugin\'s parts are guardrails where the default branch is a plugin', async () => {
  const r = repo();
  r.git('checkout', '-q', 'main');
  fs.mkdirSync(path.join(r.dir, '.claude-plugin'));
  fs.writeFileSync(path.join(r.dir, '.claude-plugin/plugin.json'), '{}\n');
  r.git('add', '.');
  r.git('commit', '-qm', 'plugin');
  r.git('checkout', '-q', 'work');
  r.git('merge', '-q', 'main');
  const head = r.put('skills/a.md', 'x\n');
  const got = await cardFacts({ card: { branch: 'work', folder: r.dir }, git: routed(r.dir), defaultBranch: 'main' });
  assert.equal(got.head, head);
  assert.equal(got.guardrail, true);
});

test('a card with no branch or no folder is unreadable, and so is a folder that has gone', async () => {
  const r = repo();
  assert.deepEqual(await cardFacts({ card: { branch: null, folder: r.dir }, git: routed(r.dir), defaultBranch: 'main' }), UNREAD_FACTS);
  assert.deepEqual(await cardFacts({ card: { branch: 'work' }, git: routed(r.dir), defaultBranch: 'main' }), UNREAD_FACTS);
  assert.deepEqual(await cardFacts({ card: { branch: 'work', folder: path.join(r.dir, 'gone') }, git: routed(path.join(r.dir, 'gone')), defaultBranch: 'main' }), UNREAD_FACTS);
  assert.deepEqual(await cardFacts({ card: { branch: '-x', folder: r.dir }, git: routed(r.dir), defaultBranch: 'main' }), UNREAD_FACTS);
});
