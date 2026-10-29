// tests/github/plan.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARTS, TEXT_ONLY, changedPaths, computers, plan, textOnly } from '../../.github/scripts/plan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, '.github', 'scripts', 'plan.js');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

test('only a change wholly inside the design documents and the build plans is text only', () => {
  assert.equal(textOnly(['docs/specs/2026-01-01-x-design.md']), true);
  assert.equal(textOnly(['docs/specs/notes/x.md', 'docs/plans/x-plan.md']), true);
  for (const paths of [
    [],
    ['docs/specs/x.md', 'README.md'],
    ['docs/checks/40-x.md'],
    ['docs/research/x.md'],
    ['docs/superpowers/plans/x.md'],
    ['skills/setup/SKILL.md'],
    ['CLAUDE.md'],
    ['HANDOVER.md'],
    ['docs/specs-old/x.md'],
    ['.github/workflows/ci.yml'],
  ]) {
    assert.equal(textOnly(paths), false, JSON.stringify(paths));
  }
});

test('a text-only pull request skips the tests, and a push to main or a run by hand never does', () => {
  const spec = ['docs/specs/x.md'];
  assert.equal(plan({ event: 'pull_request', paths: spec }).tests, 'skip');
  assert.equal(plan({ event: 'pull_request', paths: ['scripts/x.js'] }).tests, 'run');
  assert.equal(plan({ event: 'pull_request', paths: [] }).tests, 'run', 'a change that couldn\'t be read runs the tests');
  assert.equal(plan({ event: 'push', paths: spec }).tests, 'run');
  assert.equal(plan({ event: 'workflow_dispatch', paths: spec }).tests, 'run');
});

test('a skipped pull request keeps every test job, so each check still reports', () => {
  const ran = plan({ event: 'pull_request', paths: ['scripts/x.js'] });
  const skipped = plan({ event: 'pull_request', paths: ['docs/plans/x.md'] });
  assert.deepEqual(skipped.matrix, ran.matrix);
});

test('drafts run on Linux only, Windows only when ticked, and each computer splits into its parts', () => {
  assert.deepEqual(computers({ draft: true }), ['ubuntu-latest']);
  assert.deepEqual(computers({}), ['ubuntu-latest', 'macos-latest']);
  assert.deepEqual(computers({ windows: true }), ['ubuntu-latest', 'windows-latest', 'macos-latest']);
  assert.deepEqual(plan({ event: 'pull_request', paths: ['x.js'] }).matrix, [
    { os: 'ubuntu-latest', part: '1/2' }, { os: 'ubuntu-latest', part: '2/2' },
    { os: 'macos-latest', part: '1/3' }, { os: 'macos-latest', part: '2/3' }, { os: 'macos-latest', part: '3/3' },
  ]);
  assert.deepEqual(plan({ event: 'pull_request', draft: true, paths: ['x.js'] }).matrix.map((m) => m.os), ['ubuntu-latest', 'ubuntu-latest']);
  const byHand = plan({ event: 'workflow_dispatch', windows: true }).matrix;
  assert.deepEqual(byHand.filter((m) => m.os === 'windows-latest'), [{ os: 'windows-latest', part: '1/1' }]);
  assert.equal(byHand.length, PARTS['ubuntu-latest'] + PARTS['windows-latest'] + PARTS['macos-latest']);
});

test('the changed paths are read against the merge\'s first parent, a rename naming both paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-ci-plan-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(dir, 'docs', 'specs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'specs', 'a.md'), 'a\n');
    fs.writeFileSync(path.join(dir, 'README.md'), 'r\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    git(dir, 'checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(dir, 'docs', 'specs', 'a.md'), 'a, changed\n');
    git(dir, 'commit', '-q', '-am', 'spec');
    git(dir, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(dir, 'README.md'), 'r, changed on main\n');
    git(dir, 'commit', '-q', '-am', 'main moves on');
    git(dir, 'merge', '-q', '--no-ff', '--no-edit', 'feature');
    // What main gained meanwhile is not the pull request's.
    assert.deepEqual(changedPaths(dir), ['docs/specs/a.md']);
    assert.equal(textOnly(changedPaths(dir)), true);

    git(dir, 'checkout', '-q', '-b', 'move', 'feature');
    git(dir, 'mv', 'docs/specs/a.md', 'skills-a.md');
    git(dir, 'commit', '-q', '-m', 'move');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'merge', '-q', '--no-ff', '--no-edit', 'move');
    assert.deepEqual(changedPaths(dir).sort(), ['docs/specs/a.md', 'skills-a.md']);
    assert.equal(textOnly(changedPaths(dir)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a folder without the first parent gives no paths, so the tests run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-ci-plan-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'x.md'), 'x\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'only');
    assert.deepEqual(changedPaths(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the script writes the plan to GitHub\'s output from the event', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-ci-plan-'));
  try {
    const output = path.join(dir, 'output');
    const event = path.join(dir, 'event.json');
    fs.writeFileSync(event, JSON.stringify({ inputs: { windows: true } }));
    execFileSync(process.execPath, [SCRIPT], { cwd: dir, env: { ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output }, encoding: 'utf8' });
    const lines = Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    assert.equal(lines.tests, 'run');
    assert.deepEqual(JSON.parse(lines.matrix), plan({ event: 'workflow_dispatch', windows: true }).matrix);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no code names a file in the text-only folders, so a change there can\'t change what a test sees', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
  const texts = tracked.filter((f) => TEXT_ONLY.some((d) => f.startsWith(d)));
  const code = tracked.filter((f) => /\.(c|m)?js$|\.ts$/.test(f) && !f.startsWith('docs/'));
  const named = [];
  for (const file of code) {
    let lines;
    try { lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n'); } catch { continue; }
    for (const line of lines) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      for (const text of texts) if (line.includes(path.posix.basename(text))) named.push(`${file} names ${text}`);
    }
  }
  assert.deepEqual(named, [], 'code reads these; take the folder out of TEXT_ONLY in .github/scripts/plan.js, or stop reading it');
});
