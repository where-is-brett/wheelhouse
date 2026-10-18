// tests/scripts/feature/status.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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
const STATUS = path.join(ROOT, 'scripts', 'feature', 'status.js');
const NOW = new Date('2026-10-18T05:00:00.000Z');
const at = (ms) => () => new Date(NOW.getTime() + ms);
const PLAN = 'docs/plans/login.md';
const none = () => new Set();
const noSlice = () => null;
const unix = process.platform !== 'win32';

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

// A feature worktree made by hand: the brief, and the plan when the brief names
// one. A new folder gets a .git folder on feature/login-page, so the hook takes it
// for the feature its brief names.
function feature({ plan = PLAN, tasks = 5, dir, work } = {}) {
  const tree = dir ?? real(tempFolder('wh-status-'));
  if (!fs.existsSync(path.join(tree, '.git'))) write(path.join(tree, '.git', 'HEAD'), 'ref: refs/heads/feature/login-page\n');
  write(featurePaths(tree).brief, `${fence(briefFields({ ...(plan ? { plan } : {}), ...(work ? { work } : {}) }))}\nThe brief.\n`);
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

// Runs `fn` with WHEELHOUSE_HOME set to a new home, putting the old value back afterwards.
async function withHome(fn) {
  const home = real(tempFolder('wh-status-home-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    return await fn(home);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
  }
}

const register = (main) => writeProject('owner__name', { folder: main, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });

const status = (tree, extra = {}) => buildStatus({ worktree: tree, now: () => NOW, answered: none, slice: noSlice, ...extra });

// Every file under `dir`, as paths relative to it.
const filesUnder = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).sort() : []);

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
  ledger(tree, 'other', ['Task 1: complete', 'Task 2: complete', 'Task 3: complete', 'Task 4: complete'], { plan: 'docs/plans/other.md', mtime: NOW });
  ledger(tree, 'this', [
    'Task 1: complete (commits a1b2c3d..d4e5f6a, review clean)',
    'Task 2: implementer done',
    'Task 2: complete (commits d4e5f6a..b7c8d9e, review clean)',
    'Task 2: complete (counted once)',
    'Task 3: implementer dispatched',
    'Task 9: complete (not in the plan)',
  ], { mtime: new Date('2026-10-18T04:00:00Z') });
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

  // Before any task is complete it is 0 of m.
  ledger(tree, 'this', ['Task 1: implementer dispatched'], { mtime: new Date('2026-10-18T04:30:00Z') });
  s = status(tree);
  assert.deepEqual(s.task, { n: 0, m: 5 });
  assert.equal(s.phase, 'building');

  // A brief with no plan has no tasks, whatever ledgers lie about.
  const bare = feature({ plan: null });
  ledger(bare, 'this', ['Task 1: complete']);
  s = status(bare);
  assert.equal(s.phase, 'planning');
  assert.equal(s.task, null);
});

test('only the plan\'s own headings count, not those in a code block', () => {
  const tree = feature();
  write(path.join(tree, ...PLAN.split('/')), [
    '# Plan', '', '### Task 1: One', '', '```markdown', '### Task 2: An example', '```', '',
    '~~~', '### Task 3: Another example', '```', '### Task 4: still inside the tilde block', '~~~', '', '### Task 5: Five', '',
  ].join('\n'));
  ledger(tree, 'this', ['Task 1: complete', 'Task 2: complete', 'Task 3: complete', 'Task 5: complete']);
  assert.deepEqual(status(tree).task, { n: 2, m: 2 });
});

test('the ledger\'s first line must name the plan exactly', () => {
  const plan = 'plans/a.md';
  const tree = feature({ plan });
  for (const named of ['other/plans/a.md', 'plans/a.md.bak', 'plans/a.m', 'xplans/a.md']) {
    ledger(tree, 'this', ['Task 1: complete'], { plan: named });
    assert.equal(status(tree).phase, 'ready-to-build', named);
  }
  for (const named of [plan, `./${plan}`, `\`${plan}\``, path.join(tree, plan)]) {
    ledger(tree, 'this', ['Task 1: complete'], { plan: named });
    assert.deepEqual(status(tree).task, { n: 1, m: 5 }, named);
  }
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
  await withHome(async (home) => {
    const { main, tree: wt } = makeRepo();
    register(main);
    feature({ dir: wt });
    write(featurePaths(wt).questions, `${JSON.stringify(question(1))}\n`);
    const view = path.join(home, 'projects', 'owner__name', 'views', 'questions.json');
    write(view, JSON.stringify({ 'q-login-page-1': { question: { key: 'q-login-page-1' }, answer: null } }));
    assert.equal(buildStatus({ worktree: wt, now: () => NOW }).waitingOn, 'question');
    write(view, JSON.stringify({ 'q-login-page-1': { question: { key: 'q-login-page-1' }, answer: { label: 'A', at: NOW.toISOString() } } }));
    assert.equal(buildStatus({ worktree: wt, now: () => NOW }).waitingOn, null);
  });
});

test('the slice comes from the feature event in the features view', async () => {
  await withHome(async (home) => {
    const { main, tree } = makeRepo();
    feature({ dir: tree });
    // No project registered: no slice.
    assert.equal(buildStatus({ worktree: tree, now: () => NOW }).slice, null);
    register(main);
    const view = path.join(home, 'projects', 'owner__name', 'views', 'features.json');
    const entry = (data) => JSON.stringify({ 'login-page': { key: 'login-page', id: 'e1', at: NOW.toISOString(), data: { work: 'login-page', step: 'building', ...data } } });
    assert.equal(buildStatus({ worktree: tree, now: () => NOW }).slice, null);
    write(view, entry({ slice: { n: 2, m: 3 } }));
    assert.deepEqual(buildStatus({ worktree: tree, now: () => NOW }).slice, { n: 2, m: 3 });
    for (const bad of [{}, { slice: { n: 0, m: 3 } }, { slice: { n: 4, m: 3 } }, { slice: { n: 1, m: 2, x: 1 } }, { slice: [1, 2] }, { slice: { n: '1', m: 2 } }]) {
      write(view, entry(bad));
      assert.equal(buildStatus({ worktree: tree, now: () => NOW }).slice, null, JSON.stringify(bad));
    }
    // Another work's slice is not this one's.
    write(view, JSON.stringify({ other: { data: { work: 'other', slice: { n: 1, m: 2 } } } }));
    assert.equal(buildStatus({ worktree: tree, now: () => NOW }).slice, null);
    write(view, 'not json');
    assert.equal(buildStatus({ worktree: tree, now: () => NOW }).slice, null);
  });
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

test('a FIFO in place of a feature file is refused, not waited on', { skip: !unix }, () => {
  const tree = feature();
  ledger(tree, 'this', ['Task 1: complete']);
  const p = featurePaths(tree);
  for (const file of [p.questions, p.pr, p.report, p.status]) execFileSync('mkfifo', [file]);
  const s = status(tree);
  assert.equal(s.phase, 'building');
  assert.equal(s.pr, null);
  assert.equal(readStatus(p.status), null);
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
  // CRLF line endings in the .git file, HEAD and commondir, and a commondir given in full.
  write(path.join(tree, '.git'), `gitdir: ${admin}\r\n`);
  write(path.join(admin, 'HEAD'), 'ref: refs/heads/feature/login-page\r\n');
  write(path.join(admin, 'commondir'), `${common}\r\n`);
  assert.equal(gitHead(tree), c);
  write(path.join(admin, 'HEAD'), `${a}\r\n`);
  assert.equal(gitHead(tree), a);
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
    deps: { answered: none, slice: noSlice, ...deps },
  });
  return out.join('');
}

const hookInput = (cwd, event = 'Stop', extra = {}) => ({ cwd, session_id: 'sess-1', hook_event_name: event, ...extra });

test('the hook never runs git and does nothing outside a feature worktree', async () => {
  const { base, tree } = makeRepo();

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

  // A brief that cannot be read is no feature: the old status is left alone.
  write(p.brief, 'no JSON block\n');
  assert.equal(await runHook(hookInput(tree, 'Stop'), { now: at(60000) }), '');
  assert.deepEqual(readStatus(p.status), s);

  // With only a fake git on the PATH (and node's own folder after it), the script
  // runs and never calls it.
  feature({ dir: tree });
  ledger(tree, 'this', ['Task 1: complete', 'Ruling: Keep it small — less to review — nothing']);
  const bin = path.join(base, 'fake-bin');
  const marker = path.join(base, 'git-ran');
  write(path.join(bin, 'git'), `#!/bin/sh\necho ran > "${marker}"\nexit 1\n`);
  write(path.join(bin, 'git.cmd'), `@echo ran > "${marker}"\r\n@exit /b 1\r\n`);
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  const home = real(tempFolder('wh-status-home-'));
  for (const event of ['PostToolUse', 'SubagentStop', 'Stop']) {
    const run = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify(hookInput(path.join(tree, 'sub'), event)),
      env: { ...process.env, WHEELHOUSE_HOME: home, PATH: [bin, path.dirname(process.execPath)].join(path.delimiter) },
    });
    assert.equal(run.status, 0);
    assert.equal(run.stdout.toString(), '');
  }
  assert.equal(readStatus(p.status).phase, 'building');
  assert.equal(fs.existsSync(marker), false);

  // Neither file can start a process.
  for (const file of [HOOK, STATUS]) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /child_process/, file);
  }
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

test('a brief whose work is not the branch\'s feature does nothing', async () => {
  const tree = feature({ work: 'other-work' });
  ledger(tree, 'this', ['Ruling: Keep it small — less to review — nothing']);
  const before = filesUnder(featurePaths(tree).dir);
  await runHook(hookInput(tree, 'Stop'), { now: () => NOW });
  assert.deepEqual(filesUnder(featurePaths(tree).dir), before);
  // Nor does a branch that is not a feature branch.
  const plain = feature();
  write(path.join(plain, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await runHook(hookInput(plain, 'Stop'), { now: () => NOW });
  assert.deepEqual(filesUnder(featurePaths(plain).dir), ['brief.md']);
});

test('a symlinked rulings.jsonl or status.json is refused, and its target left alone', { skip: !unix }, async () => {
  const tree = feature();
  ledger(tree, 'this', ['Task 1: complete', 'Ruling: $(touch pwned) — evil — all of it']);
  const p = featurePaths(tree);
  const outside = real(tempFolder('wh-status-outside-'));
  const target = path.join(outside, 'profile');
  const statusTarget = path.join(outside, 'status');
  fs.writeFileSync(target, 'export A=1\n');
  fs.writeFileSync(statusTarget, 'keep\n');
  fs.symlinkSync(target, p.rulings);
  fs.symlinkSync(statusTarget, p.status);
  assert.deepEqual(captureRulings({ worktree: tree }), []);
  await runHook(hookInput(tree, 'Stop'), { now: () => NOW });
  assert.equal(fs.readFileSync(target, 'utf8'), 'export A=1\n');
  assert.equal(fs.readFileSync(statusTarget, 'utf8'), 'keep\n');
  assert.equal(fs.lstatSync(p.rulings).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(p.status).isSymbolicLink(), true);
  // The session file is still a plain file of its own.
  assert.deepEqual(JSON.parse(fs.readFileSync(p.session, 'utf8')), { sessionId: 'sess-1' });

  // A symlinked session.json or checked.json is refused too.
  const other = feature();
  const op = featurePaths(other);
  const sessionTarget = path.join(outside, 'session');
  const checkedTarget = path.join(outside, 'checked');
  fs.writeFileSync(sessionTarget, 'keep\n');
  fs.writeFileSync(checkedTarget, 'keep\n');
  fs.symlinkSync(sessionTarget, op.session);
  fs.symlinkSync(checkedTarget, path.join(op.dir, 'checked.json'));
  await runHook(hookInput(other, 'PostToolUse'), { now: () => NOW });
  assert.equal(fs.readFileSync(sessionTarget, 'utf8'), 'keep\n');
  assert.equal(fs.readFileSync(checkedTarget, 'utf8'), 'keep\n');
  assert.equal(readStatus(op.status).phase, 'ready-to-build');
});

test('a symlinked .wheelhouse/feature or .wheelhouse is refused, with nothing written to its target', { skip: !unix }, async () => {
  for (const linked of ['feature', 'wheelhouse']) {
    const tree = feature();
    ledger(tree, 'this', ['Task 1: complete', 'Ruling: Keep it small — less to review — nothing']);
    const outside = real(tempFolder('wh-status-outside-'));
    // The real folder moves outside, and a symlink takes its place.
    const from = linked === 'feature' ? featurePaths(tree).dir : path.join(tree, '.wheelhouse');
    const to = path.join(outside, path.basename(from));
    fs.renameSync(from, to);
    fs.symlinkSync(to, from);
    const before = filesUnder(outside);
    for (const event of ['PostToolUse', 'SubagentStop', 'Stop']) await runHook(hookInput(tree, event), { now: () => NOW });
    assert.deepEqual(filesUnder(outside), before, linked);
    assert.deepEqual(captureRulings({ worktree: tree }), [], linked);
    assert.deepEqual(filesUnder(outside), before, linked);
  }
});

// Starts the hook script as its own process; resolves with its exit code.
function startHook(input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], { env, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('exit', resolve);
    child.stdin.end(JSON.stringify(input));
  });
}

test('hooks running at the same moment never repeat a ruling', async () => {
  const env = { ...process.env, WHEELHOUSE_HOME: real(tempFolder('wh-status-home-')) };
  for (let round = 0; round < 3; round += 1) {
    const tree = feature();
    const rulings = Array.from({ length: 20 }, (_, i) => `Ruling: Choice ${i} — reason — cost`);
    ledger(tree, 'this', ['Task 1: complete', ...rulings]);
    const runs = Array.from({ length: 8 }, (_, i) => startHook(hookInput(tree, i % 2 ? 'SubagentStop' : 'PostToolUse'), env));
    assert.deepEqual(await Promise.all(runs), Array(8).fill(0));
    const kept = fs.readFileSync(featurePaths(tree).rulings, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.deepEqual(kept, rulings);
  }
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

test('on PostToolUse the status is built at most once every five seconds; rulings whenever the ledger moves', async () => {
  assert.equal(THROTTLE_MS, 5000);
  const tree = feature();
  const p = featurePaths(tree);
  await runHook(hookInput(tree, 'PostToolUse'), { now: () => NOW });
  assert.equal(readStatus(p.status).phase, 'ready-to-build');

  // Within the five seconds the status waits, but the ledger's new ruling is kept at once.
  const file = ledger(tree, 'this', ['Task 1: complete', 'Ruling: Keep it small — less to review — nothing']);
  await runHook(hookInput(tree, 'PostToolUse'), { now: at(4999) });
  assert.equal(readStatus(p.status).phase, 'ready-to-build');
  assert.equal(fs.readFileSync(p.rulings, 'utf8'), `${JSON.stringify('Ruling: Keep it small — less to review — nothing')}\n`);

  // The rulings file is left alone while the ledger stays as it was.
  fs.writeFileSync(p.rulings, '');
  await runHook(hookInput(tree, 'PostToolUse'), { now: at(4999) });
  assert.equal(fs.readFileSync(p.rulings, 'utf8'), '');
  fs.appendFileSync(file, 'Ruling: Ship it — safer — nothing\n');
  await runHook(hookInput(tree, 'PostToolUse'), { now: at(4999) });
  assert.equal(fs.readFileSync(p.rulings, 'utf8').split('\n').filter(Boolean).length, 2);

  // SubagentStop and Stop are never held back.
  await runHook(hookInput(tree, 'SubagentStop'), { now: at(4999) });
  assert.equal(readStatus(p.status).phase, 'building');

  fs.appendFileSync(file, 'Task 2: complete\n');
  await runHook(hookInput(tree, 'PostToolUse'), { now: at(5000) });
  assert.deepEqual(readStatus(p.status).task, { n: 1, m: 5 });
  await runHook(hookInput(tree, 'PostToolUse'), { now: at(9999) });
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
