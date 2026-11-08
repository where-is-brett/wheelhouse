// tests/scripts/hooks/aside-overlap.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { decide, asideFiles, mainBranchOf, overlapWords, warnedFile, FILES_CAP } from '../../../scripts/hooks/aside-overlap.js';

const temp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-aside-overlap-')));
after(() => fs.rmSync(temp, { recursive: true, force: true }));

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: ENV, encoding: 'utf8' });
const put = (root, file, text = 'x') => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};

let n = 0;
// A repository with `main` (holding `tracked`) and a linked worktree on `side`. Returns the worktree's folder.
function makeAside({ tracked = [] } = {}) {
  const base = path.join(temp, `case-${++n}`);
  const main = path.join(base, 'main');
  fs.mkdirSync(main, { recursive: true });
  git(main, 'init', '-q', '-b', 'main');
  put(main, 'README.md', 'a');
  for (const f of tracked) put(main, f, 'a');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'first');
  const side = path.join(base, 'side');
  git(main, 'worktree', 'add', '-q', '-b', 'side', side);
  return { main, side };
}

const WORK_AT = '2026-11-08T09:00:00.000Z';
const piece = (id, files) => [id, {
  work: { id: `w-${id}`, at: WORK_AT, data: { id, title: id, lane: 'quick', visible: false, dependsOn: [] } }, approved: true, since: WORK_AT, files,
}];
const started = (id, state = 'started') => [id, [{ at: '2026-11-08T10:00:00.000Z', data: { work: id, runId: `run-${id}`, lane: 'quick', engine: 'wheelhouse', state } }]];

// The desk's waiting view, and a record of what was written through it.
function deskWith({ pieces = {}, ended = [], reports = {}, settings = { baseBranch: { value: 'main' } }, away = false } = {}) {
  const writes = [];
  const entries = Object.entries(pieces);
  const views = {
    work: Object.fromEntries(entries.map(([id, files]) => piece(id, files))),
    runs: Object.fromEntries(entries.map(([id]) => started(id, ended.includes(id) ? 'ended' : 'started'))),
    reports: { ...Object.fromEntries(ended.map((id) => [id, { at: '2026-11-08T10:30:00.000Z', data: { work: id, outcome: 'merged' } }])), ...reports }, features: {}, settings, waiting: [], questions: {},
  };
  const desk = {
    writes,
    views,
    read: async () => (away ? { ok: false, refused: 'Wheelhouse\'s helper could not be reached' } : { ok: true, data: { views } }),
    write: async (kind, data) => { writes.push({ kind, data }); return { ok: true }; },
  };
  return desk;
}

const aside = { role: () => 'aside', kind: () => 'worktree' };
const NOW = () => new Date('2026-11-08T11:00:00.000Z');
const stop = (cwd, extra = {}) => ({ hook_event_name: 'Stop', session_id: 's1', cwd, ...extra });
const run = (cwd, desk, extra = {}) => decide(stop(cwd), { env: {}, desk, now: NOW, ...aside, ...extra });

test('a committed shared file warns once and writes the record', async () => {
  const { side } = makeAside();
  put(side, 'src/login.ts');
  git(side, 'add', '.');
  git(side, 'commit', '-q', '-m', 'login');
  const desk = deskWith({ pieces: { 'login-retry': ['src/login.ts'] } });
  const got = await run(side, desk);
  assert.equal(got.decision, 'block');
  for (const text of [got.systemMessage, got.reason]) {
    assert.match(text, /src\/login\.ts/);
    assert.match(text, /login-retry/);
  }
  assert.equal(got.systemMessage, got.reason);
  assert.match(got.systemMessage, /^Heads up: this branch changes `src\/login\.ts`, which the crew piece login-retry is also changing\. Merging both will conflict\./);
  assert.equal(desk.writes.length, 1);
  assert.equal(desk.writes[0].kind, 'aside-overlap');
  assert.equal(desk.writes[0].data.branch, 'side');
  assert.deepEqual(desk.writes[0].data.pieces, ['login-retry']);
  assert.deepEqual(desk.writes[0].data.files, ['src/login.ts']);
  assert.equal(desk.writes[0].data.at, '2026-11-08T11:00:00.000Z');
  assert.deepEqual(JSON.parse(fs.readFileSync(warnedFile(side), 'utf8')), [{ work: 'login-retry', file: 'src/login.ts' }]);
});

test('the next turn with nothing new says nothing', async () => {
  const { side } = makeAside();
  put(side, 'src/login.ts');
  git(side, 'add', '.');
  git(side, 'commit', '-q', '-m', 'login');
  const desk = deskWith({ pieces: { 'login-retry': ['src/login.ts'] } });
  assert.ok(await run(side, desk));
  assert.equal(await run(side, desk), undefined);
  assert.equal(desk.writes.length, 1);
});

test('an uncommitted file warns', async () => {
  const { side } = makeAside({ tracked: ['src/login.ts'] });
  put(side, 'src/login.ts', 'changed');
  const desk = deskWith({ pieces: { 'login-retry': ['src/login.ts'] } });
  const got = await run(side, desk);
  assert.match(got.reason, /src\/login\.ts/);
});

test('an untracked file warns', async () => {
  const { side } = makeAside();
  put(side, 'src/new/login.ts');
  const desk = deskWith({ pieces: { 'login-retry': ['src/new/login.ts'] } });
  const got = await run(side, desk);
  assert.match(got.reason, /src\/new\/login\.ts/);
  assert.deepEqual(desk.writes[0].data.files, ['src/new/login.ts']);
});

test('a hotFiles match warns', async () => {
  const { side } = makeAside();
  put(side, 'migrations/002.sql');
  const settings = { baseBranch: { value: 'main' }, hotFiles: { value: ['migrations/*'] } };
  const desk = deskWith({ pieces: { 'add-orders': ['migrations/003.sql'] }, settings });
  const got = await run(side, desk);
  assert.match(got.reason, /migrations\/002\.sql/);
  assert.match(got.reason, /add-orders/);
  // Without the pattern, two different files don't clash.
  const plain = deskWith({ pieces: { 'add-orders': ['migrations/003.sql'] } });
  const { side: other } = makeAside();
  put(other, 'migrations/002.sql');
  assert.equal(await run(other, plain), undefined);
});

test('no clash says nothing', async () => {
  const { side } = makeAside();
  put(side, 'src/a.ts');
  const desk = deskWith({ pieces: { 'login-retry': ['src/login.ts'] } });
  assert.equal(await run(side, desk), undefined);
  assert.equal(desk.writes.length, 0);
});

test('an ended piece drops out', async () => {
  const { side } = makeAside();
  put(side, 'src/login.ts');
  const desk = deskWith({ pieces: { 'login-retry': ['src/login.ts'] }, ended: ['login-retry'] });
  assert.equal(await run(side, desk), undefined);
  assert.equal(desk.writes.length, 0);
});

test('a piece that ends and comes back warns again', async () => {
  const { side } = makeAside();
  put(side, 'src/login.ts');
  const live = deskWith({ pieces: { 'login-retry': ['src/login.ts'] } });
  assert.ok(await run(side, live));
  const gone = deskWith({ pieces: { 'login-retry': ['src/login.ts'] }, ended: ['login-retry'] });
  assert.equal(await run(side, gone), undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(warnedFile(side), 'utf8')), []);
  assert.ok(await run(side, live));
});

test('a new piece warns at the next Stop', async () => {
  const { side } = makeAside();
  put(side, 'src/login.ts');
  assert.ok(await run(side, deskWith({ pieces: { 'login-retry': ['src/login.ts'] } })));
  const desk = deskWith({ pieces: { 'login-retry': ['src/login.ts'], 'login-audit': ['src/login.ts'] } });
  const got = await run(side, desk);
  assert.match(got.reason, /login-audit/);
  assert.doesNotMatch(got.reason, /login-retry/);
  assert.deepEqual(desk.writes[0].data.pieces, ['login-audit']);
});

test('a desk that can\'t be read says nothing', async () => {
  const { side } = makeAside();
  put(side, 'src/login.ts');
  const desk = deskWith({ pieces: { 'login-retry': ['src/login.ts'] }, away: true });
  assert.equal(await run(side, desk), undefined);
  assert.equal(desk.writes.length, 0);
  const broken = { read: async () => { throw new Error('boom'); }, write: async () => ({ ok: true }) };
  assert.equal(await run(side, broken), undefined);
});

test('git failing says nothing', async () => {
  const { side } = makeAside();
  put(side, 'src/login.ts');
  const desk = deskWith({ pieces: { 'login-retry': ['src/login.ts'] } });
  const failing = () => { throw new Error('git failed'); };
  assert.equal(await run(side, desk, { run: failing }), undefined);
  assert.equal(desk.writes.length, 0);
});

test('stop_hook_active says nothing', async () => {
  const { side } = makeAside();
  put(side, 'src/login.ts');
  const desk = deskWith({ pieces: { 'login-retry': ['src/login.ts'] } });
  assert.equal(await decide(stop(side, { stop_hook_active: true }), { env: {}, desk, now: NOW, ...aside }), undefined);
  assert.equal(desk.writes.length, 0);
  assert.equal(fs.existsSync(warnedFile(side)), false);
});

test('it does nothing outside a worktree aside', async () => {
  const { side } = makeAside();
  put(side, 'src/login.ts');
  const desk = deskWith({ pieces: { 'login-retry': ['src/login.ts'] } });
  for (const [role, kind] of [['front-desk', 'worktree'], ['aside', 'main'], ['feature', 'worktree'], ['why', 'worktree'], ['foreman', 'worktree']]) {
    assert.equal(await decide(stop(side), { env: {}, desk, now: NOW, role: () => role, kind: () => kind }), undefined, `${role} in ${kind}`);
  }
  assert.equal(desk.writes.length, 0);
});

test('the base branch falls back to origin/HEAD', () => {
  const { main } = makeAside();
  assert.equal(mainBranchOf({ cwd: main, views: { settings: {} } }), null);
  git(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(main, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  assert.equal(mainBranchOf({ cwd: main, views: { settings: {} } }), 'origin/main');
  assert.equal(mainBranchOf({ cwd: main, views: { settings: { baseBranch: { value: 'trunk' } } } }), 'trunk');
});

test('the aside\'s files are the branch\'s changes, uncommitted and untracked files, once each', () => {
  const { side } = makeAside({ tracked: ['src/b.ts'] });
  put(side, 'src/a.ts');
  git(side, 'add', '.');
  git(side, 'commit', '-q', '-m', 'a');
  put(side, 'src/a.ts', 'more');
  put(side, 'src/b.ts', 'changed');
  put(side, 'notes/c.md');
  git(side, 'mv', 'README.md', 'READ.md');
  put(side, '.wheelhouse/aside-overlap.json', '[]');
  assert.deepEqual(asideFiles({ cwd: side, base: 'main' }).sort(), ['READ.md', 'README.md', 'notes/c.md', 'src/a.ts', 'src/b.ts']);
  assert.equal(asideFiles({ cwd: side, base: 'no-such-branch' }), null);
});

test('the files read are capped', () => {
  const { side } = makeAside();
  for (let i = 0; i < FILES_CAP + 20; i += 1) put(side, `many/f${i}.txt`);
  assert.equal(asideFiles({ cwd: side, base: 'main' }).length, FILES_CAP);
});

test('the warning names each piece, and joins two or more files with commas and "and"', () => {
  const words = overlapWords([
    { work: 'login-retry', file: 'a.ts' }, { work: 'login-retry', file: 'b.ts' }, { work: 'login-retry', file: 'c.ts' }, { work: 'billing', file: 'x.ts' },
  ]);
  assert.match(words, /changes `a\.ts`, `b\.ts` and `c\.ts`, which the crew piece login-retry is also changing\./);
  assert.match(words, /changes `x\.ts`, which the crew piece billing is also changing\./);
  assert.match(words, /You could wait for billing to merge and then bring this branch up to date, or ask the First Mate to hold it\.$/);
});

test('the planned files of a feature the foreman is building warn', async () => {
  const { side } = makeAside();
  put(side, 'src/login.ts');
  git(side, 'add', '.');
  git(side, 'commit', '-q', '-m', 'login');
  const desk = deskWith({});
  desk.views.work = { 'login-retry': { work: { id: 'w', at: WORK_AT, data: { id: 'login-retry', title: 'x', lane: 'small', visible: false, dependsOn: [] } }, approved: true, since: WORK_AT } };
  desk.views.features = { 'login-retry': { data: { work: 'login-retry', step: 'building', files: ['src/login.ts'] } } };
  const got = await run(side, desk);
  assert.match(got.reason, /crew piece login-retry/);
  assert.deepEqual(desk.writes[0].data.files, ['src/login.ts']);
});
