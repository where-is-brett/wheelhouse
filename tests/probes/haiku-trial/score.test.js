// tests/probes/haiku-trial/score.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { centsOf, reconcile } from '../../../probes/haiku-trial/score/reconcile.js';
import { ownTests, biteScore, flipRefundSign, changeOneCategory } from '../../../probes/haiku-trial/score/own-tests.js';
import { a11y, makeBrowse, PLAYWRIGHT_CORE, AXE_CORE } from '../../../probes/haiku-trial/score/a11y.js';
import { health } from '../../../probes/haiku-trial/score/health.js';
import { passBar, scoreAll } from '../../../probes/haiku-trial/score/total.js';
import { makeStatement, HELD_BACK } from '../../../probes/haiku-trial/statement.js';
import { defaultRun } from '../../../probes/haiku-trial/score/run.js';
import { REFERENCE, variant } from './variants.js';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `haiku-score-${name}-`));

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

function git(dir, ...args) {
  const out = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', ...args], { cwd: dir, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim();
}

const PACKAGE = JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module', scripts: { start: 'node src/server.js', test: 'node --test' } });
const MONEY = 'export function parseAmount(text) {\n  const t = String(text).trim();\n  const cents = Math.round(Math.abs(parseFloat(t.replace(/[()-]/g, ""))) * 100);\n  return /^[(-]/.test(t) ? -cents : cents;\n}\n';

// The statement's own totals, written as the product's pages would show them.
function fakeProduct(statement, { slip = {} } = {}) {
  const pages = {};
  for (const [month, want] of Object.entries(statement.expected)) {
    const cell = (key, cents) => `<td data-category="${key}" data-total="${(cents / 100).toFixed(2)}">x</td>`;
    pages[month] = Object.entries(want.byCategory).map(([k, c]) => cell(k, c + (slip[`${month}:${k}`] ?? 0))).join('') + cell('all', want.total) + '<a href="/edit?id=7">x</a>';
  }
  const calls = [];
  return {
    calls,
    start: async () => ({ url: 'http://fake', stop: async () => calls.push('stop') }),
    get: async (url, options) => {
      calls.push(url);
      const month = /\/month\?m=(.+)$/.exec(url)?.[1];
      if (month) return { status: 200, headers: {}, text: pages[month] ?? '' };
      return { status: 200, headers: {}, text: options?.file ? 'Added 1, skipped 0' : '<a href="/edit?id=7">x</a>' };
    },
  };
}

test('centsOf reads plain decimals exactly', () => {
  assert.equal(centsOf('12.3'), 1230);
  assert.equal(centsOf('12.30'), 1230);
  assert.equal(centsOf('-0.10'), -10);
  assert.equal(centsOf('0.29'), 29);
  assert.equal(centsOf(' 7 '), 700);
  assert.equal(centsOf('12.301'), null);
  assert.equal(centsOf('$12'), null);
  assert.equal(centsOf('1e3'), null);
  assert.equal(centsOf(''), null);
});

test('reconcile gives 15 when every total matches and imports the held-back statement first', async () => {
  const statement = makeStatement(HELD_BACK);
  const fake = fakeProduct(statement);
  const result = await reconcile({ dir: 'unused', start: fake.start, get: fake.get });
  assert.deepEqual(result, { points: 15, mismatches: [] });
  assert.ok(fake.calls[0].endsWith('/import'));
  assert.equal(fake.calls.at(-1), 'stop');
});

test('reconcile gives 0 and names the cell when one total is a cent out', async () => {
  const statement = makeStatement(HELD_BACK);
  const fake = fakeProduct(statement, { slip: { '2026-06:shopping': 1 } });
  const result = await reconcile({ dir: 'unused', start: fake.start, get: fake.get });
  assert.equal(result.points, 0);
  assert.equal(result.mismatches.length, 1);
  const [miss] = result.mismatches;
  assert.equal(miss.month, '2026-06');
  assert.equal(miss.key, 'shopping');
  assert.equal(miss.got, miss.want + 1);
});

test('reconcile gives 0 with a reason when the product does not start', async () => {
  const result = await reconcile({ dir: 'unused', start: async () => { throw new Error('product did not start'); } });
  assert.equal(result.points, 0);
  assert.match(result.mismatches[0].got, /did not start/);
});

test('reconcile gives 15 on the reference app and 0 on a one-cent slip', async () => {
  assert.deepEqual(await reconcile({ dir: REFERENCE }), { points: 15, mismatches: [] });
  const slipped = await reconcile({ dir: variant('rounding') });
  assert.equal(slipped.points, 0);
  assert.equal(slipped.mismatches.length, 1);
  assert.equal(slipped.mismatches[0].key, 'shopping');
});

function fixtureRepo({ deleted = true, skipped = true } = {}) {
  const dir = tmp('repo');
  git(dir, 'init', '--quiet', '-b', 'main');
  write(dir, { 'package.json': PACKAGE, 'src/lib/money.js': MONEY, 'tests/old.test.js': "import { test } from 'node:test';\ntest('old', () => {});\n" });
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', 'base');
  const baseSha = git(dir, 'rev-parse', 'HEAD');
  if (deleted) git(dir, 'rm', '--quiet', 'tests/old.test.js');
  write(dir, {
    'tests/money.test.js': `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { parseAmount } from '../src/lib/money.js';\ntest('reads cents', () => assert.equal(parseAmount('1.00'), 100));\n${skipped ? "test.skip('later', () => {});\n" : ''}test('more', () => assert.equal(parseAmount('-1.00'), -100));\n`,
  });
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', 'work');
  return { dir, baseSha };
}

const greenGh = async (args) => (args[0] === 'run' ? JSON.stringify([{ conclusion: 'success' }]) : JSON.stringify([]));

test('ownTests scores the parts from a fixture repository', async () => {
  const { dir, baseSha } = fixtureRepo();
  const result = await ownTests({ dir, baseSha, gh: greenGh });
  assert.equal(result.of, 15);
  assert.ok(result.parts.written >= 1);
  assert.ok(result.parts.kept <= 2);
  assert.equal(result.parts.green, 3);
  assert.ok(result.notes.some((n) => /deleted/.test(n)));
  assert.ok(result.notes.some((n) => /skipped or todo/.test(n)));
  assert.equal(result.points, result.parts.written + result.parts.green + result.parts.kept + result.parts.bite);
});

test('ownTests keeps all four kept points when nothing is deleted, skipped or lost', async () => {
  const { dir, baseSha } = fixtureRepo({ deleted: false, skipped: false });
  const result = await ownTests({ dir, baseSha, gh: greenGh });
  assert.equal(result.parts.kept, 4);
});

test('ownTests gives no green point for a failed run and reads source-and-test pairing from the pull requests', async () => {
  const { dir, baseSha } = fixtureRepo({ deleted: false, skipped: false });
  write(dir, { 'src/lib/more.js': 'export const a = 1;\n' });
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', 'more');
  const prs = (files) => JSON.stringify([{ number: 1, files: files.map((path) => ({ path })) }]);
  const gh = (files, conclusion) => async (args) => (args[0] === 'run' ? JSON.stringify([{ conclusion }]) : prs(files));
  const without = await ownTests({ dir, baseSha, gh: gh(['src/lib/more.js', 'src/lib/money.js'], 'failure') });
  assert.equal(without.parts.green, 0);
  assert.ok(without.notes.some((n) => /no test changed alongside/.test(n)));
  const paired = await ownTests({ dir, baseSha, gh: gh(['src/lib/more.js', 'tests/money.test.js'], 'success') });
  assert.equal(paired.notes.some((n) => /no test changed alongside/.test(n)), false);
  assert.equal(paired.parts.written, 5 - (paired.notes.filter((n) => n.startsWith('written:')).length));
});

test('the two mutations break the reference app unit tests', () => {
  for (const [mutate, file] of [[flipRefundSign, 'parse-amount-test.js'], [changeOneCategory, 'categorise-test.js']]) {
    const copy = path.join(tmp('mutate'), 'app');
    fs.cpSync(REFERENCE, copy, { recursive: true });
    assert.equal(defaultRun(process.execPath, ['--test', `tests/${file}`], { cwd: copy }).status, 0);
    assert.equal(mutate(copy), true);
    assert.notEqual(defaultRun(process.execPath, ['--test', `tests/${file}`], { cwd: copy }).status, 0);
  }
});

test('bite needs both mutations to fail the tests', () => {
  const hollow = tmp('hollow');
  write(hollow, {
    'package.json': PACKAGE,
    'src/lib/money.js': MONEY,
    'src/lib/categories.js': "export function categorise(d) { return d.includes('Greenbarrow Fresh') ? 'groceries' : 'other'; }\n",
    'tests/nothing.test.js': "import { test } from 'node:test';\nimport '../src/lib/money.js';\ntest('runs', () => {});\n",
  });
  assert.equal(biteScore({ dir: hollow }), 0);
  assert.equal(biteScore({ dir: REFERENCE }), 3);
});

test('bite gives nothing when the tests are already failing', () => {
  const broken = tmp('broken');
  write(broken, { 'package.json': PACKAGE, 'src/lib/money.js': MONEY, 'tests/red.test.js': "import { test } from 'node:test';\ntest('red', () => { throw new Error('red'); });\n" });
  const notes = [];
  assert.equal(biteScore({ dir: broken, notes }), 0);
  assert.match(notes[0], /do not pass before/);
});

const axe = (...violations) => ({ violations: violations.map(([id, impact]) => ({ id, impact })) });

test('a11y takes 2 per serious rule and 0 for any critical', async () => {
  const fake = fakeProduct(makeStatement(HELD_BACK));
  const seen = [];
  const browse = (answers) => async (url) => {
    seen.push(url.replace('http://fake', ''));
    return answers[seen.length % answers.length];
  };
  const run = (answers) => a11y({ dir: 'unused', browse: browse(answers), start: fake.start, get: fake.get });

  // The same serious rule on two pages counts once; a second rule makes two.
  const two = await run([axe(['color-contrast', 'serious']), axe(['color-contrast', 'serious'], ['label', 'serious'])]);
  assert.equal(two.points, 6);
  assert.equal(two.of, 10);
  assert.deepEqual(Object.keys(two.pages), ['/', '/import', '/month?m=2026-05', '/edit?id=7']);
  assert.ok(Object.values(two.pages).every((p) => p.critical === 0));

  const critical = await run([axe(['aria-hidden-focus', 'critical'])]);
  assert.equal(critical.points, 0);
  assert.equal(critical.pages['/'].critical, 1);

  const clean = await run([axe(['region', 'moderate'])]);
  assert.equal(clean.points, 10);

  const many = await run([axe(['a', 'serious'], ['b', 'serious'], ['c', 'serious'], ['d', 'serious'], ['e', 'serious'], ['f', 'serious'])]);
  assert.equal(many.points, 0);
});

test('a11y gives 0 with a reason when a page cannot be checked or the product does not start', async () => {
  const fake = fakeProduct(makeStatement(HELD_BACK));
  const result = await a11y({ dir: 'unused', browse: async () => { throw new Error('no browser'); }, start: fake.start, get: fake.get });
  assert.equal(result.points, 0);
  assert.match(result.notes[0], /no browser/);
  const down = await a11y({ dir: 'unused', browse: async () => axe(), start: async () => { throw new Error('did not start'); } });
  assert.equal(down.points, 0);
});

test('makeBrowse installs the pinned tools into toolsDir before opening a page', async () => {
  const calls = [];
  const run = (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: '', stderr: '' }; };
  const browse = makeBrowse({ toolsDir: path.join(tmp('tools'), 'a11y-tools'), run, browserPath: '/nowhere/chrome' });
  assert.equal(calls.length, 0);
  await assert.rejects(browse('http://127.0.0.1:1/'));
  const install = calls[0];
  assert.deepEqual(install.slice(0, 3), ['npm', 'install', '--prefix']);
  assert.ok(install.includes(`playwright-core@${PLAYWRIGHT_CORE}`));
  assert.ok(install.includes(`axe-core@${AXE_CORE}`));
  const noBrowser = makeBrowse({ toolsDir: tmp('tools'), run, browserPath: null });
  await assert.rejects(noBrowser('http://127.0.0.1:1/'), /no Chrome or Edge/);
});

const passingRun = () => ({ status: 0, stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 0, critical: 0 } } }), stderr: '' });
const upProduct = { start: async () => ({ url: 'http://fake', stop: async () => {} }), get: async () => ({ status: 200, headers: {}, text: '' }) };

test('health counts each part', async () => {
  const messy = tmp('messy');
  write(messy, {
    'package.json': PACKAGE,
    'src/server.js': `${'const a = 1;\n'.repeat(300)}// TODO tidy\n`,
  });
  const low = await health({ dir: messy, run: passingRun, ...upProduct });
  assert.ok(low.points <= 3);
  assert.equal(low.parts.size, 0);
  assert.equal(low.parts.markers, 0);

  const reference = await health({ dir: REFERENCE, run: passingRun, ...upProduct });
  assert.deepEqual(reference.notes, []);
  assert.equal(reference.points, 5);
  assert.equal(reference.of, 5);
});

test('health fails an unused dependency, a high audit finding and a fresh clone that breaks', async () => {
  const dir = tmp('deps');
  write(dir, {
    'package.json': JSON.stringify({ name: 'x', type: 'module', dependencies: { express: '^4.0.0', zod: '^3.0.0' }, scripts: { test: 'node --test' } }),
    'src/server.js': "import express from 'express';\nexport default express;\n",
  });
  const calls = [];
  const run = (cmd, args) => {
    calls.push(`${cmd} ${args[0]}`);
    if (args[0] === 'audit') return { status: 1, stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 1, critical: 0 } } }), stderr: '' };
    return { status: args[0] === 'test' ? 1 : 0, stdout: '', stderr: '' };
  };
  const result = await health({ dir, run, ...upProduct });
  assert.deepEqual(result.parts, { size: 1, markers: 1, dependencies: 0, audit: 0, fresh: 0 });
  assert.ok(result.notes.some((n) => /zod/.test(n)));
  assert.ok(calls.includes('npm ci'));
  assert.ok(result.notes.some((n) => /fresh: npm test failed/.test(n)));
});

test('health fails the fresh part when the clone starts but / does not answer', async () => {
  const down = { start: upProduct.start, get: async () => ({ status: 500, headers: {}, text: '' }) };
  const result = await health({ dir: REFERENCE, run: passingRun, ...down });
  assert.equal(result.parts.fresh, 0);
  assert.match(result.notes[0], /answered \/ with 500/);
});

test('passBar', () => {
  const ok = { total: 85, parts: { reconcile: 15 }, heldBackShare: 0.92, critical: false };
  assert.deepEqual(passBar(ok), { pass: true, why: [] });
  const cases = [
    [{ total: 79 }, /79/],
    [{ parts: { reconcile: 0 } }, /reconcile/],
    [{ heldBackShare: 0.89 }, /90%/],
    [{ critical: true }, /critical/],
  ];
  for (const [change, reason] of cases) {
    const result = passBar({ ...ok, ...change });
    assert.equal(result.pass, false);
    assert.equal(result.why.length, 1);
    assert.match(result.why[0], reason);
  }
  assert.equal(passBar({ ...ok, total: 80, heldBackShare: 0.9 }).pass, true);
});

const steps = (log) => ({
  reconcile: async () => { log.push('reconcile'); return { points: 15, mismatches: [] }; },
  ownTests: async () => { log.push('ownTests'); return { points: 12, of: 15 }; },
  runHeldBack: async () => { log.push('heldBack'); return { share: 0.94 }; },
  runAcceptance: async () => { log.push('acceptance'); return { passed: 14 }; },
  a11y: async () => { log.push('a11y'); return { points: 8, pages: { '/': { serious: 1, critical: 0, ids: ['x'] } } }; },
  health: async () => { log.push('health'); return { points: 4 }; },
});

test('smoke scores reconciliation and own tests only', async () => {
  const log = [];
  const result = await scoreAll({ dir: 'd', baseSha: 'b', gh: null, smoke: true, steps: steps(log) });
  assert.deepEqual(log, ['reconcile', 'ownTests']);
  assert.deepEqual(result.parts, { heldBack: null, reconcile: 15, acceptance: null, ownTests: 12, a11y: null, health: null });
  assert.equal(result.total, 27);
  assert.equal(result.pass, null);
});

test('scoreAll adds the six parts, rounds the held-back share and applies the bar', async () => {
  const result = await scoreAll({ dir: 'd', baseSha: 'b', gh: null, steps: steps([]) });
  assert.deepEqual(result.parts, { heldBack: 38, reconcile: 15, acceptance: 14, ownTests: 12, a11y: 8, health: 4 });
  assert.equal(result.total, 91);
  assert.equal(result.pass, true);
  assert.deepEqual(result.why, []);

  const poor = steps([]);
  poor.runHeldBack = async () => ({ share: 0.5 });
  poor.a11y = async () => ({ points: 0, pages: { '/': { serious: 0, critical: 1, ids: ['y'] } } });
  const failed = await scoreAll({ dir: 'd', baseSha: 'b', gh: null, steps: poor });
  assert.equal(failed.pass, false);
  assert.ok(failed.why.length >= 3);
});
