// tests/scripts/feature/status.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { featurePaths, readStatus } from '../../../scripts/feature/files.js';
import { buildStatus, captureRulings, gitHead } from '../../../scripts/feature/status.js';
import { decide, THROTTLE_MS } from '../../../scripts/hooks/feature-status.js';
import { hookMain } from '../../../scripts/hooks/kit.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { tempFolder } from '../../helpers/homes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'feature-status.js');
const NOW = new Date('2026-10-18T05:00:00.000Z');
const at = (ms) => () => new Date(NOW.getTime() + ms);
const PLAN = 'docs/plans/login.md';
const none = () => new Set();

const real = (dir) => fs.realpathSync.native(dir);
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;

const briefFields = (extra = {}) => ({
  v: 1,
  work: 'login-page',
  lane: 'feature',
  version: 1,
  goal: 'Let people sign in',
  done: ['Sign in works'],
  appetite: { sessions: 2, tokens: 400000 },
  rulings: [],
  routing: {},
  shownFirst: true,
  ...extra,
});

const planText = (m) => `# Plan\n\n${Array.from({ length: m }, (_, i) => `### Task ${i + 1}: Step ${i + 1}\n\nWork.\n`).join('\n')}`;

// A feature worktree made by hand: the brief, and the plan when the brief names one.
// A new folder gets an empty .git folder, so the hook finds its root.
function feature({ plan = PLAN, tasks = 5, dir } = {}) {
  const tree = dir ?? real(tempFolder('wh-status-'));
  if (!fs.existsSync(path.join(tree, '.git'))) fs.mkdirSync(path.join(tree, '.git'));
  write(featurePaths(tree).brief, `${fence(briefFields(plan ? { plan } : {}))}\nThe brief.\n`);
  if (plan) write(path.join(tree, ...plan.split('/')), planText(tasks));
  return tree;
}

// A ledger at .superpowers/sdd/<name>/progress.md whose first line names `plan`.
function ledger(tree, name, lines, { plan = PLAN, mtime } = {}) {
  const file = path.join(tree, '.superpowers', 'sdd', name, 'progress.md');
  write(file, [`# SDD ledger — plan: ${plan}`, '', ...lines, ''].join('\n'));
  if (mtime) fs.utimesSync(file, mtime, mtime);
  return file;
}

const question = (n, extra = {}) => ({
  id: `q-login-page-${n}`,
  kind: 'question',
  what: 'Which provider?',
  why: 'It decides what users see',
  options: [{ label: 'A', says: 'Use A' }, { label: 'B', says: 'Use B' }],
  recommendation: 'A',
  level: 3,
  ...extra,
});

const reportText = () => `${fence({ v: 1, work: 'login-page', status: 'done', tests: '10 pass', assumptions: [], concerns: [], rulings: [] })}\nShipped.\n`;

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: gitEnv }).toString().trim();

// A repository with one commit, and a linked worktree on feature/login-page.
function makeRepo() {
  const base = real(tempFolder('wh-status-repo-'));
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(main, 'a.txt'), 'a');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'first');
  const tree = path.join(base, 'tree');
  git(main, 'worktree', 'add', '-q', tree, '-b', 'feature/login-page');
  return { base, main, tree };
}

const status = (tree, extra = {}) => buildStatus({ worktree: tree, now: () => NOW, answered: none, ...extra });

test('featurePaths names the session and pull request files beside the other four', () => {
  const p = featurePaths('/w/tree');
  assert.equal(p.session, path.join('/w/tree', '.wheelhouse', 'feature', 'session.json'));
  assert.equal(p.pr, path.join('/w/tree', '.wheelhouse', 'feature', 'pr.json'));
  assert.equal(p.rulings, path.join('/w/tree', '.wheelhouse', 'feature', 'rulings.jsonl'));
});

test('task n of m comes from the plan and the ledger', () => {
  const tree = feature({ tasks: 5 });
  // Without a ledger the plan is ready to build, with no tasks counted.
  let s = status(tree);
  assert.equal(s.phase, 'ready-to-build');
  assert.equal(s.task, null);

  // An older ledger for the same plan, and a newer one for another plan, are both passed over.
  ledger(tree, 'old', ['Task 1: complete (commits a..b, review clean)'], { mtime: new Date('2026-10-01T00:00:00Z') });
  ledger(tree, 'other', ['Task 1: complete', 'Task 2: complete', 'Task 3: complete', 'Task 4: complete'], { plan: 'docs/plans/other.md' });
  ledger(tree, 'this', [
    'Task 1: complete (commits a1b2c3d..d4e5f6a, review clean)',
    'Task 2: implementer done',
    'Task 2: complete (commits d4e5f6a..b7c8d9e, review clean)',
    'Task 2: complete (counted once)',
    'Task 3: implementer dispatched',
    'Task 9: complete (not in the plan)',
  ], { mtime: new Date('2026-10-18T04:00:00Z') });
  fs.utimesSync(path.join(tree, '.superpowers', 'sdd', 'other', 'progress.md'), NOW, NOW);
  s = status(tree);
  assert.deepEqual(s.task, { n: 2, m: 5 });
  assert.equal(s.phase, 'building');
  assert.equal(s.waitingOn, null);
  assert.equal(s.fixRound, null);
  assert.equal(s.work, 'login-page');
  assert.equal(s.lane, 'feature');
  assert.equal(s.tokens, null);
  assert.equal(s.slice, null);
  assert.equal(s.updatedAt, NOW.toISOString());

  // Before any task is complete the Status shape has no n of m to give.
  ledger(tree, 'this', ['Task 1: implementer dispatched'], { mtime: new Date('2026-10-18T04:30:00Z') });
  s = status(tree);
  assert.equal(s.task, null);
  assert.equal(s.phase, 'building');

  // A brief with no plan has no tasks, whatever ledgers lie about.
  const bare = feature({ plan: null });
  ledger(bare, 'this', ['Task 1: complete']);
  s = status(bare);
  assert.equal(s.phase, 'planning');
  assert.equal(s.task, null);
});

test('a fix round in progress is read from the ledger', () => {
  const tree = feature({ tasks: 4 });
  const file = ledger(tree, 'this', [
    'Task 1: fix round 1/5 (1 addressed, 0 open)',
    'Task 1: complete (commits a..b, review clean)',
    'Task 2: fix round 1/5 (2 addressed, 1 open)',
    'Task 2: re-review 1: one open',
    'Task 2: fix round 2/5 (3 addressed, 0 open)',
  ]);
  let s = status(tree);
  assert.equal(s.fixRound, 2);
  assert.deepEqual(s.task, { n: 1, m: 4 });

  fs.appendFileSync(file, 'Task 2: complete (commits b..c, review clean)\n');
  s = status(tree);
  assert.equal(s.fixRound, null);
  assert.deepEqual(s.task, { n: 2, m: 4 });
});

test('an unanswered question means waiting on a question', async () => {
  const tree = feature();
  ledger(tree, 'this', ['Task 1: complete']);
  const p = featurePaths(tree);
  write(p.questions, `${JSON.stringify(question(1))}\n${JSON.stringify(question(2, { kind: 'extra-plan', plan: 'docs/plans/more.md' }))}\nnot json\n`);
  let s = status(tree);
  assert.equal(s.phase, 'waiting');
  assert.equal(s.waitingOn, 'question');

  // Answered in the questions view: no longer waiting. An extra plan is queued, never waited on.
  s = status(tree, { answered: () => new Set(['q-login-page-1']) });
  assert.equal(s.phase, 'building');
  assert.equal(s.waitingOn, null);

  // By default the answers come from the project's questions view, read from disk.
  const home = real(tempFolder('wh-status-home-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { main, tree: wt } = makeRepo();
    writeProject('owner__name', { folder: main, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });
    feature({ dir: wt });
    write(featurePaths(wt).questions, `${JSON.stringify(question(1))}\n`);
    const view = path.join(home, 'projects', 'owner__name', 'views', 'questions.json');
    write(view, JSON.stringify({ 'q-login-page-1': { question: { key: 'q-login-page-1' }, answer: null } }));
    assert.equal(buildStatus({ worktree: wt, now: () => NOW }).waitingOn, 'question');
    write(view, JSON.stringify({ 'q-login-page-1': { question: { key: 'q-login-page-1' }, answer: { label: 'A', at: NOW.toISOString() } } }));
    assert.equal(buildStatus({ worktree: wt, now: () => NOW }).waitingOn, null);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
  }
});

test('a kept pull request number means a PR is open, and a report means done', () => {
  const tree = feature();
  ledger(tree, 'this', ['Task 1: complete']);
  const p = featurePaths(tree);
  for (const bad of ['not json', '{"pr":0}', '{"pr":"12"}', '{"pr":1.5}', '[12]']) {
    write(p.pr, bad);
    const s = status(tree);
    assert.equal(s.pr, null, bad);
    assert.equal(s.phase, 'building', bad);
  }
  write(p.pr, JSON.stringify({ pr: 42 }));
  let s = status(tree);
  assert.equal(s.pr, 42);
  assert.equal(s.phase, 'pr-open');

  // A report that cannot be read is not the end.
  write(p.report, 'Shipped, more or less.\n');
  assert.equal(status(tree).phase, 'pr-open');
  write(p.report, reportText());
  s = status(tree);
  assert.equal(s.phase, 'done');
  assert.equal(s.pr, 42);

  // An unanswered question comes before everything else.
  write(p.questions, `${JSON.stringify(question(1))}\n`);
  assert.equal(status(tree).phase, 'waiting');
});

test('the head commit is read from the .git files, loose or packed, from a worktree', () => {
  const { main, tree } = makeRepo();
  fs.writeFileSync(path.join(tree, 'b.txt'), 'b');
  git(tree, 'add', '.');
  git(tree, 'commit', '-q', '-m', 'second');
  const mainHead = git(main, 'rev-parse', 'HEAD');
  const treeHead = git(tree, 'rev-parse', 'HEAD');
  assert.notEqual(mainHead, treeHead);
  assert.equal(gitHead(main), mainHead);
  assert.equal(gitHead(tree), treeHead);

  // Loose refs packed away: the heads are read from packed-refs.
  git(main, 'pack-refs', '--all');
  assert.equal(fs.existsSync(path.join(main, '.git', 'refs', 'heads', 'feature', 'login-page')), false);
  assert.equal(gitHead(main), mainHead);
  assert.equal(gitHead(tree), treeHead);

  // The head reaches the status too.
  feature({ dir: tree });
  assert.equal(status(tree).head, treeHead);

  // A folder with no repository has no head.
  assert.equal(gitHead(real(tempFolder('wh-status-none-'))), null);
});

test('a detached head is read as the commit HEAD names', () => {
  const { main, tree } = makeRepo();
  const first = git(main, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(tree, 'b.txt'), 'b');
  git(tree, 'add', '.');
  git(tree, 'commit', '-q', '-m', 'second');
  git(tree, 'checkout', '-q', '--detach', first);
  assert.equal(gitHead(tree), first);
  git(main, 'checkout', '-q', '--detach');
  assert.equal(gitHead(main), first);
});

test('a worktree\'s .git file is followed to its own HEAD and the shared refs', () => {
  // Laid out by hand the way git lays out a worktree, so nothing but the files counts.
  const base = real(tempFolder('wh-status-hand-'));
  const common = path.join(base, 'main', '.git');
  const admin = path.join(common, 'worktrees', 'tree');
  const tree = path.join(base, 'tree');
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  write(path.join(common, 'HEAD'), 'ref: refs/heads/main\n');
  write(path.join(common, 'refs', 'heads', 'main'), `${a}\n`);
  write(path.join(common, 'packed-refs'), `# pack-refs with: peeled fully-peeled sorted\n${a} refs/heads/main\n${b} refs/heads/feature/login-page\n^${a}\n`);
  write(path.join(admin, 'HEAD'), 'ref: refs/heads/feature/login-page\n');
  write(path.join(admin, 'commondir'), '../..\n');
  write(path.join(tree, '.git'), `gitdir: ${admin}\n`);
  assert.equal(gitHead(tree), b);
  // A loose ref beats the packed one.
  const c = 'c'.repeat(40);
  write(path.join(common, 'refs', 'heads', 'feature', 'login-page'), `${c}\n`);
  assert.equal(gitHead(tree), c);
  // A relative gitdir is taken from the worktree's folder.
  write(path.join(tree, '.git'), `gitdir: ${path.relative(tree, admin)}\n`);
  assert.equal(gitHead(tree), c);
  // A ref name that climbs out of the git folder is refused.
  write(path.join(admin, 'HEAD'), 'ref: refs/heads/../../../../outside\n');
  write(path.join(base, 'outside'), `${a}\n`);
  assert.equal(gitHead(tree), null);
  // A branch with no commit yet has no head.
  write(path.join(admin, 'HEAD'), 'ref: refs/heads/unborn\n');
  assert.equal(gitHead(tree), null);
});

test('rulings are kept after the ledger is deleted', () => {
  const tree = feature();
  const file = ledger(tree, 'this', [
    'Task 1: complete',
    'Ruling: Use the session store — it exists — a day if wrong',
    '  Ruling: Use the session store — it exists — a day if wrong  ',
    'Task 2: Ruling: Keep the old copy — the director asked — nothing',
    'Ruling R1: an older style with no plain marker',
  ]);
  const p = featurePaths(tree);
  assert.deepEqual(captureRulings({ worktree: tree }), [
    'Ruling: Use the session store — it exists — a day if wrong',
    'Task 2: Ruling: Keep the old copy — the director asked — nothing',
  ]);
  assert.deepEqual(captureRulings({ worktree: tree }), []);

  fs.appendFileSync(file, 'Ruling: Ship it behind a flag — safer — a flag to remove\n');
  assert.deepEqual(captureRulings({ worktree: tree }), ['Ruling: Ship it behind a flag — safer — a flag to remove']);

  fs.rmSync(path.join(tree, '.superpowers'), { recursive: true });
  assert.deepEqual(captureRulings({ worktree: tree }), []);
  const kept = fs.readFileSync(p.rulings, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(kept, [
    'Ruling: Use the session store — it exists — a day if wrong',
    'Task 2: Ruling: Keep the old copy — the director asked — nothing',
    'Ruling: Ship it behind a flag — safer — a flag to remove',
  ]);
});

// Runs the hook through the kit as Claude Code would, with no project registered.
async function runHook(input, deps = {}) {
  const out = [];
  await hookMain(decide, { failClosed: false, event: null }, {
    stdin: Readable.from([typeof input === 'string' ? input : JSON.stringify(input)]),
    write: (text) => out.push(text),
    dir: real(tempFolder('wh-status-managed-')),
    projectOf: () => null,
    deps: { answered: none, ...deps },
  });
  return out.join('');
}

const hookInput = (cwd, event = 'Stop', extra = {}) => ({ cwd, session_id: 'sess-1', hook_event_name: event, ...extra });

test('the hook never runs git and does nothing outside a feature worktree', async () => {
  const { base, main, tree } = makeRepo();
  const marker = path.join(base, 'marker');
  const script = path.join(base, 'mark.js');
  fs.writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  git(main, 'config', 'core.fsmonitor', `node "${script}"`);
  git(main, 'config', 'core.hooksPath', path.join(base, 'no-hooks'));

  // No brief: nothing is written, not even the feature folder.
  for (const event of ['PostToolUse', 'SubagentStop', 'Stop']) {
    assert.equal(await runHook(hookInput(tree, event), { now: () => NOW }), '');
  }
  assert.equal(fs.existsSync(path.join(tree, '.wheelhouse')), false);
  assert.equal(await runHook(hookInput(path.join(base, 'nowhere')), { now: () => NOW }), '');
  assert.equal(await runHook('not json'), '');

  // With a brief, from a folder inside the worktree: the status and the session are written.
  feature({ dir: tree });
  fs.mkdirSync(path.join(tree, 'sub'));
  assert.equal(await runHook(hookInput(path.join(tree, 'sub'), 'Stop'), { now: () => NOW }), '');
  const p = featurePaths(tree);
  const s = readStatus(p.status);
  assert.equal(s.phase, 'ready-to-build');
  assert.equal(s.head, git(tree, 'rev-parse', 'HEAD'));
  assert.deepEqual(JSON.parse(fs.readFileSync(p.session, 'utf8')), { sessionId: 'sess-1' });
  assert.equal(fs.existsSync(marker), false);

  // A failure inside says nothing: a brief that cannot be read leaves the old status alone.
  write(p.brief, 'no JSON block\n');
  assert.equal(await runHook(hookInput(tree, 'Stop'), { now: at(60000) }), '');
  assert.deepEqual(readStatus(p.status), s);
});

test('the hook script prints nothing and exits 0, whatever its input', () => {
  const home = real(tempFolder('wh-status-home-'));
  const tree = feature();
  for (const stdin of ['not json', JSON.stringify(hookInput(real(tempFolder('wh-status-none-')))), JSON.stringify(hookInput(tree))]) {
    const run = spawnSync(process.execPath, [HOOK], { input: stdin, env: { ...process.env, WHEELHOUSE_HOME: home } });
    assert.equal(run.status, 0);
    assert.equal(run.stdout.toString(), '');
  }
  assert.equal(readStatus(featurePaths(tree).status).phase, 'ready-to-build');
});

test('the hook keeps the session id for open-pr, even within the five seconds', async () => {
  const tree = feature();
  const p = featurePaths(tree);
  await runHook(hookInput(tree, 'Stop'), { now: () => NOW });
  assert.deepEqual(JSON.parse(fs.readFileSync(p.session, 'utf8')), { sessionId: 'sess-1' });
  await runHook(hookInput(tree, 'PostToolUse', { session_id: 'sess-2' }), { now: at(1000) });
  assert.deepEqual(JSON.parse(fs.readFileSync(p.session, 'utf8')), { sessionId: 'sess-2' });
  // An odd id is not written.
  await runHook(hookInput(tree, 'Stop', { session_id: '../../x' }), { now: at(2000) });
  assert.deepEqual(JSON.parse(fs.readFileSync(p.session, 'utf8')), { sessionId: 'sess-2' });
});

test('on PostToolUse the status is built at most once every five seconds', async () => {
  assert.equal(THROTTLE_MS, 5000);
  const tree = feature();
  const p = featurePaths(tree);
  await runHook(hookInput(tree, 'PostToolUse'), { now: () => NOW });
  assert.equal(readStatus(p.status).phase, 'ready-to-build');

  const file = ledger(tree, 'this', ['Task 1: complete', 'Ruling: Keep it small — less to review — nothing']);
  await runHook(hookInput(tree, 'PostToolUse'), { now: at(4999) });
  assert.equal(readStatus(p.status).phase, 'ready-to-build');
  assert.equal(fs.existsSync(p.rulings), false);

  // SubagentStop and Stop are never held back.
  await runHook(hookInput(tree, 'SubagentStop'), { now: at(4999) });
  assert.equal(readStatus(p.status).phase, 'building');
  assert.equal(fs.readFileSync(p.rulings, 'utf8'), `${JSON.stringify('Ruling: Keep it small — less to review — nothing')}\n`);

  fs.appendFileSync(file, 'Task 2: complete\n');
  await runHook(hookInput(tree, 'PostToolUse'), { now: at(5000) });
  assert.deepEqual(readStatus(p.status).task, { n: 2, m: 5 });

  // A clock that went backwards does not hold the hook back for ever.
  fs.appendFileSync(file, 'Task 3: complete\n');
  await runHook(hookInput(tree, 'PostToolUse'), { now: at(-60000) });
  assert.deepEqual(readStatus(p.status).task, { n: 3, m: 5 });
});

test('the status is written only when it changed', async () => {
  const tree = feature();
  const p = featurePaths(tree);
  await runHook(hookInput(tree, 'Stop'), { now: () => NOW });
  const first = readStatus(p.status);
  await runHook(hookInput(tree, 'Stop'), { now: at(60000) });
  assert.deepEqual(readStatus(p.status), first);
  ledger(tree, 'this', ['Task 1: complete']);
  await runHook(hookInput(tree, 'Stop'), { now: at(120000) });
  const next = readStatus(p.status);
  assert.equal(next.phase, 'building');
  assert.equal(next.updatedAt, new Date(NOW.getTime() + 120000).toISOString());
});
