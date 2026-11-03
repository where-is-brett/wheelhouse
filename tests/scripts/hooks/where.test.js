// tests/scripts/hooks/where.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { whereDigest, gitLine, noteFile, resetEpisode, WHERE_CHARS, GIT_MS } from '../../../scripts/hooks/where.js';
import { sessionFile } from '../../../scripts/hooks/context-gauge.js';

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-where-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  return Promise.resolve(fn(home)).finally(() => {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  });
}

const cwd = path.resolve('/work/tree');
// A git that answers each question from a table.
const fakeGit = (table) => async (file, args, opts) => {
  fakeGit.calls.push({ file, args, opts });
  const out = table[args.join(' ')];
  return out === undefined ? { code: 1, stdout: '' } : { code: 0, stdout: out };
};
fakeGit.calls = [];
const GOOD = { 'rev-parse --abbrev-ref HEAD': 'feature/x\n', 'log -1 --format=%s': 'Add the thing\n', 'status --porcelain': ' M a.js\n?? b.js\n' };

test('git is asked by the git route, in the folder, within a second', async () => {
  fakeGit.calls.length = 0;
  const line = await gitLine(cwd, { run: fakeGit(GOOD) });
  assert.equal(line, 'Git: branch feature/x; last commit "Add the thing"; 2 uncommitted files');
  assert.equal(fakeGit.calls.length, 3);
  for (const c of fakeGit.calls) {
    assert.equal(c.file, 'git');
    assert.equal(c.opts.cwd, cwd);
    assert.ok(c.opts.timeoutMs > 0 && c.opts.timeoutMs <= GIT_MS);
  }
});

test('a git that fails, or a folder that is not absolute, gives no line; a clean tree says so', async () => {
  assert.equal(await gitLine(cwd, { run: () => { throw new Error('no git'); } }), null);
  assert.equal(await gitLine('relative', { run: fakeGit(GOOD) }), null);
  assert.match(await gitLine(cwd, { run: fakeGit({ ...GOOD, 'status --porcelain': '' }) }), /nothing uncommitted/);
  assert.equal((await gitLine(cwd, { run: fakeGit({ ...GOOD, "status --porcelain": undefined }) })).includes("uncommitted"), false);
});

test('a git that has used the second leaves the rest out', async () => {
  let t = 0;
  const line = await gitLine(cwd, { run: fakeGit(GOOD), now: () => (t += 600) });
  assert.match(line, /^Git: branch/);
  assert.doesNotMatch(line, /uncommitted/);
});

const input = { session_id: 's1', cwd };

test('the digest names the role, git, ledger, goal and cards', () => withHome(async (home) => {
  const views = {
    waiting: [{ id: 'c1', data: { title: 'Mine', session_id: 's1' } }, { id: 'c2', data: { title: 'Theirs', session_id: 's2' } }],
    goals: { g1: { ended: null, hash: 'h', startedAt: 'x', sheet: { until: 'y', title: 'Tidy up' } } },
  };
  const text = await whereDigest({ project: 'p', input, views, feature: 'x', stateRoot: path.join(home, 'state'), run: fakeGit(GOOD), env: {} });
  assert.match(text, /^Where you were, before the compaction \(role: front-desk\):/);
  assert.match(text, /Git: branch feature\/x/);
  assert.ok(text.includes(`Feature ledger: ${path.join(home, 'state', 'features', 'x', 'ledger.md')}`));
  assert.match(text, /Goal running: g1 \(Tidy up\)/);
  assert.match(text, /Your open cards: c1: Mine$/m);
  assert.doesNotMatch(text, /Theirs/);
}));

test('cards that carry no session id fall back to the waiting list', () => withHome(async () => {
  const views = { waiting: [{ id: 'c1', data: { title: 'A' } }, { id: 'c2', data: { title: 'B' } }] };
  const text = await whereDigest({ project: 'p', input, views, run: fakeGit(GOOD), env: {} });
  assert.match(text, /Waiting on the director: c1: A; c2: B/);
}));

test('the session note is read with its age', () => withHome(async () => {
  const file = noteFile('p', 's1');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'task: x\ndone: y\nnext: z\n');
  const mtime = Date.now() - 2 * 3600 * 1000;
  fs.utimesSync(file, mtime / 1000, mtime / 1000);
  const text = await whereDigest({ project: 'p', input, views: {}, run: fakeGit({}), env: {} });
  assert.match(text, /Your session note \(s1\.md, written 2 hours ago\):\ntask: x\ndone: y\nnext: z/);
}));

test('no note, no records and no git give an empty digest; an unsafe id gives no note', () => withHome(async () => {
  assert.equal(await whereDigest({ project: 'p', input, views: null, run: fakeGit({}), env: {} }), '');
  assert.equal(noteFile('p', '../x'), null);
}));

test('the digest never passes 1,500 characters', () => withHome(async () => {
  const file = noteFile('p', 's1');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'n'.repeat(5000));
  const waiting = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, data: { title: 't'.repeat(200) } }));
  const text = await whereDigest({ project: 'p', input, views: { waiting }, run: fakeGit({ ...GOOD, 'log -1 --format=%s': `${'s'.repeat(500)}\n` }), env: {} });
  assert.ok(text.length <= WHERE_CHARS, String(text.length));
  assert.ok(text.length > 1000);
}));

test('a piece that throws is left out and the rest stays', () => withHome(async () => {
  const views = { get waiting() { throw new Error('bad'); } };
  const text = await whereDigest({ project: 'p', input, views, run: fakeGit(GOOD), env: {} });
  assert.match(text, /Git: branch/);
  assert.equal(await whereDigest(undefined), '');
}));

test('the episode reset clears preparedAt and leaves the rest', () => withHome(async () => {
  const file = sessionFile('p', 's1');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ tokens: 5, preparedAt: 'then' }));
  resetEpisode('p', 's1');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { tokens: 5 });
  resetEpisode('p', 'none');
  resetEpisode('p', '../bad');
  assert.equal(fs.existsSync(sessionFile('p', 'none')), false);
}));
