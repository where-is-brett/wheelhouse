// tests/scripts/lean/store.test.js
// A Lean project's git store outside the project (Part 5 Task 5, rulings P5-24 to P5-27): the folder left as a
// worktree of a bare store with main checked out nowhere; merges only of an approved commit whose tests passed,
// with no hook run; undo by a new commit; the copy holding the main version and the state's branch; one merge at a
// time; and a main version moved outside the helper caught and decided by the director. Every repository here is
// a temporary one under a temporary home.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun, standInTools } from '../../helpers/host-stand-ins.js';
import { shortHome } from '../../helpers/homes.js';
import { run, withoutGitVars } from '../../../scripts/lib/run.js';
import { NULL_FILE, lookRefusalLine, safeKeyName } from '../../../scripts/lib/safe-git.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { listEvents, makeEvent, writeEvent, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled, verify } from '../../../scripts/state/signing.js';
import { projectOf } from '../../../scripts/hooks/kit.js';
import { registerLean, readLean, updateLean, leanState } from '../../../scripts/lean/project.js';
import {
  storeDir, adoptProject, mergeApproved, undoMerge, copyNow, keepMain, leanStatus, withLocalLock, testEnv,
  LeanRefusal, OTHER_WINDOW, MAIN_CHECKED_OUT, MAIN_MOVED, NOT_IN_STORE, STOPPED, leanApprovalLine, mainMovedLine,
  undoLine, undoCard, mainMovedCard,
} from '../../../scripts/lean/store.js';

// No real gh, glab, copilot or curl runs (P5-44): the PATH finds the stand-ins first, and the store's own runs go
// through a guard whose log stays empty.
const shims = standInTools();
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
afterEach(() => {
  assert.deepEqual(hostLog, [], 'no host tool ran through the store');
  assert.deepEqual(shims.calls(), [], 'no host tool ran from the PATH');
});
after(() => shims.restore());

const PROJECT = 'shop';
const T0 = Date.parse('2026-10-23T01:00:00.000Z');
const unix = process.platform !== 'win32';
const FULL = /^[0-9a-f]{40}$/;

// The test's own git, outside any route: no config of the person's, and hooks off, so a hook planted for the
// store's calls never runs from here.
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: NULL_FILE, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: NULL_FILE,
  GIT_AUTHOR_NAME: 'Ann', GIT_AUTHOR_EMAIL: 'ann@example.com', GIT_COMMITTER_NAME: 'Ann', GIT_COMMITTER_EMAIL: 'ann@example.com',
};
async function git(cwd, args, { ok = false } = {}) {
  const got = await run('git', args, { cwd, baseEnv: withoutGitVars(), env: GIT_ENV });
  if (ok) return got;
  if (got.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${got.stderr}`);
  return got.stdout.trim();
}

const refusedWith = (pattern) => (error) => error instanceof LeanRefusal && pattern.test(error.message);

// A computer with a home of its own, an enrolled key, and a Lean project whose folder is a git repository on main,
// with a copy folder as the remote wheelhouse-copy; adopted into the store unless `adopt` is false.
async function computer({ test: command = null, realUsers, adopt = true, records = null } = {}) {
  const home = shortHome();
  const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(shortHome(), 'shop-')));
  const copy = path.join(fs.realpathSync.native(shortHome()), 'copy.git');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  await git(folder, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(folder, 'README.md'), 'shop\n');
  fs.writeFileSync(path.join(folder, '.gitignore'), '.wheelhouse/*\n!.wheelhouse/record/\n');
  if (records !== null) {
    fs.mkdirSync(path.join(folder, '.wheelhouse', 'record'), { recursive: true });
    fs.writeFileSync(path.join(folder, '.wheelhouse', 'record', '2026-10-22.jsonl'), records);
  }
  await git(folder, ['add', '-A']);
  await git(folder, ['commit', '-q', '-m', 'Start']);
  await git(copy, ['init', '-q', '--bare', copy]).catch(async () => { fs.mkdirSync(copy); await git(copy, ['init', '-q', '--bare']); });
  await git(folder, ['remote', 'add', 'wheelhouse-copy', copy]);
  registerLean({ project: PROJECT, folder, now: () => new Date(T0) });
  updateLean(PROJECT, { test: command, identity: { name: 'Wheelhouse helper', email: 'helper@example.com' }, ...(realUsers === undefined ? {} : { realUsers }) });
  const own = makeSigningKey();
  enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: new Date(T0).toISOString() });
  let tick = 0;
  const now = () => new Date(T0 + 1000 * (tick += 1));
  if (adopt) await adoptProject({ project: PROJECT, folder, run: hostGuard, now });
  const events = () => listEvents(stateDir(PROJECT), { report: () => {} });
  const put = async (kind, data) => {
    await leanState(PROJECT, { run: hostGuard });
    const event = makeEvent({ kind, data, now });
    await writeEvent({ project: PROJECT, event, push: async () => ({ ok: false }), env: {}, now });
    return event;
  };
  // A feature with one commit holding `files`, made in the project's folder as a builder does; the folder is left
  // detached at the main version again.
  const feature = async (slug, files) => {
    await git(folder, ['switch', '-q', '-c', `feature/${slug}`]);
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
      fs.writeFileSync(path.join(folder, name), text);
    }
    await git(folder, ['add', '-A']);
    await git(folder, ['commit', '-q', '-m', `Build ${slug}`]);
    const head = await git(folder, ['rev-parse', 'HEAD']);
    await git(folder, ['switch', '-q', '--detach', 'main']);
    return head;
  };
  const approve = (slug, commit, proof = 'chat-click') => put('card-answer', {
    question: `merge-${slug}`, label: 'Approve', hash: crypto.createHash('sha256').update(slug).digest('hex'), commit, proof,
  });
  const ask = (extra = {}) => ({ project: PROJECT, run: hostGuard, now, ...extra });
  // The signed record a click on Undo (or Undo it) in the helper's window makes (ruling P5-50).
  const undoClick = (merge) => put('action', { action: 'undo-merge', merge, question: undoCard(merge).question, label: 'Undo', proof: 'window' });
  const undoMainClick = (from, to) => put('action', { action: 'undo-main', from, to, question: mainMovedCard(from, to).question, label: 'Undo it', proof: 'window' });
  return {
    home, folder, copy, now, events, put, feature, approve, ask, undoClick, undoMainClick,
    main: () => git(storeDir(PROJECT), ['rev-parse', 'refs/heads/main']),
    close: () => {
      liftStop();
      if (before === undefined) delete process.env.WHEELHOUSE_HOME;
      else process.env.WHEELHOUSE_HOME = before;
    },
  };
}

test('the project folder\'s .git is a pointer file into the store', async () => {
  const records = `${JSON.stringify({ at: '2026-10-22T03:00:00Z', kind: 'stop', card: null, choice: null, commit: null, proof: 'chat-click', by: 'chat', tier: 'lean' })}\n`;
  const c = await computer({ adopt: false, records });
  try {
    const before = await git(c.folder, ['rev-parse', 'HEAD']);
    // Refused while anything is uncommitted, and while the folder isn't on the main version.
    fs.writeFileSync(path.join(c.folder, 'README.md'), 'changed\n');
    await assert.rejects(adoptProject(c.ask({ folder: c.folder })), refusedWith(/changes that aren't committed/));
    await git(c.folder, ['checkout', '--', 'README.md']);
    await git(c.folder, ['switch', '-q', '-c', 'feature/x']);
    await assert.rejects(adoptProject(c.ask({ folder: c.folder })), refusedWith(/isn't on the main version/));
    await git(c.folder, ['switch', '-q', 'main']);
    assert.ok(fs.statSync(path.join(c.folder, '.git')).isDirectory(), 'nothing moved while refused');

    const got = await adoptProject(c.ask({ folder: c.folder }));
    assert.deepEqual(got, { adopted: true, main: before, imported: 1, problems: 0 });
    const store = storeDir(PROJECT);
    assert.equal(store, path.join(c.home, 'projects', PROJECT, 'git'));
    const pointer = path.join(c.folder, '.git');
    assert.ok(fs.lstatSync(pointer).isFile(), 'the folder\'s .git is a file');
    assert.match(fs.readFileSync(pointer, 'utf8'), /^gitdir: /);
    assert.equal(fs.realpathSync.native(await git(c.folder, ['rev-parse', '--path-format=absolute', '--git-common-dir'])), fs.realpathSync.native(store));
    assert.equal(await git(store, ['rev-parse', '--is-bare-repository']), 'true');
    // Detached at the main version's head, the working files as they were, and main checked out nowhere.
    assert.equal((await git(c.folder, ['symbolic-ref', '-q', 'HEAD'], { ok: true })).code, 1);
    assert.equal(await git(c.folder, ['rev-parse', 'HEAD']), before);
    assert.equal(await git(c.folder, ['status', '--porcelain', '--untracked-files=no']), '');
    assert.equal(fs.readFileSync(path.join(c.folder, 'README.md'), 'utf8'), 'shop\n');
    assert.ok(!(await git(store, ['worktree', 'list', '--porcelain'])).includes('branch refs/heads/main'));
    // The record names the store, the main version and the copy folder.
    const lean = readLean(PROJECT);
    assert.deepEqual([lean.store, lean.main, lean.copy], [store, before, c.copy]);
    // The chat's earlier record became an event once, and its file stays.
    const notes = c.events().filter((e) => e.kind === 'note' && e.data?.lean === 'stop');
    assert.equal(notes.length, 1);
    assert.ok(fs.existsSync(path.join(c.folder, '.wheelhouse', 'record', '2026-10-22.jsonl')));
    // Adopting again changes nothing and imports nothing.
    assert.deepEqual(await adoptProject(c.ask({ folder: c.folder })), { adopted: false, main: before, imported: 0, problems: 0 });
    assert.equal(c.events().filter((e) => e.kind === 'note' && e.data?.lean === 'stop').length, 1);
    // The hooks still place the folder in its project, though its .git points into a bare store.
    assert.equal(projectOf(c.folder)?.project, PROJECT);
    assert.equal(projectOf(c.folder)?.lean, true);
    assert.deepEqual(await leanStatus(c.ask()), { adopted: true, main: before, moved: false, stop: false, copy: c.copy, test: null, realUsers: false });
  } finally {
    c.close();
  }
});

test('a project whose git settings could run a program is not adopted, and the look says why', async () => {
  const c = await computer({ adopt: false });
  try {
    await git(c.folder, ['config', 'filter.lfs.clean', 'git-lfs clean -- %f']);
    await assert.rejects(adoptProject(c.ask({ folder: c.folder })), (error) => error.message === lookRefusalLine('lean', { keys: ['filter.lfs.clean'] }, { what: 'the Lean project\'s folder' }));
    assert.ok(fs.statSync(path.join(c.folder, '.git')).isDirectory(), 'its .git stays where it was');
    assert.equal(fs.existsSync(storeDir(PROJECT)), false);
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/x', commit: 'a'.repeat(40) })), refusedWith(new RegExp(NOT_IN_STORE.replace(/[.*+?^${}()|[\]\\']/g, '.'))));
    assert.deepEqual(await leanStatus(c.ask()), { adopted: false, stop: false, copy: null, test: null, realUsers: false });
  } finally {
    c.close();
  }
});

test('a planted post-merge hook does not run', { skip: !unix && 'the planted hooks are shell scripts' }, async () => {
  const c = await computer();
  try {
    const marks = path.join(c.home, 'hook-ran');
    const hook = `#!/bin/sh\necho "$0" >> "${marks}"\n`;
    const plant = (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      for (const name of ['pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-merge', 'post-commit', 'post-checkout', 'reference-transaction', 'pre-push']) {
        fs.writeFileSync(path.join(dir, name), hook, { mode: 0o755 });
      }
    };
    // One set in the store's own hooks folder, and one in the project's own hooks folder, committed with the work.
    plant(path.join(storeDir(PROJECT), 'hooks'));
    const head = await c.feature('login', { 'login.txt': 'login\n', '.husky/post-merge': hook });
    plant(path.join(c.folder, '.husky'));
    await c.approve('login', head);
    // The store's settings name the project's own hooks folder, as husky's do: the fence points hooks elsewhere.
    await git(storeDir(PROJECT), ['config', 'core.hooksPath', path.join(c.folder, '.husky')]);
    const got = await mergeApproved(c.ask({ branch: 'feature/login', commit: head }));
    assert.equal(await c.main(), got.merge);
    assert.equal(fs.existsSync(marks), false, 'no hook ran');
    // The merge is a merge commit of the approved head onto the old main version, committed as the record names.
    assert.equal(await git(storeDir(PROJECT), ['rev-parse', `${got.merge}^2`]), head);
    assert.equal(await git(storeDir(PROJECT), ['log', '-1', '--format=%an <%ae>', got.merge]), 'Wheelhouse helper <helper@example.com>');
    assert.match(await git(storeDir(PROJECT), ['log', '-1', '--format=%s', got.merge]), new RegExp(`^Add login to the main version \\(approved ${head.slice(0, 12)}\\)$`));
    // No temporary worktree is left behind.
    const trees = (await git(storeDir(PROJECT), ['worktree', 'list', '--porcelain'])).split('\n').filter((l) => l.startsWith('worktree '));
    assert.equal(trees.length, 2, 'the store itself and the project\'s folder');
    assert.deepEqual(fs.readdirSync(path.join(c.home, 'projects', PROJECT)).filter((n) => n.startsWith('work-')), []);
  } finally {
    c.close();
  }
});

test('a branch whose head moved since the approval is refused', async () => {
  const c = await computer();
  try {
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    await c.approve('login', head);
    await git(c.folder, ['switch', '-q', 'feature/login']);
    fs.writeFileSync(path.join(c.folder, 'login.txt'), 'login, changed\n');
    await git(c.folder, ['commit', '-q', '-am', 'More']);
    await git(c.folder, ['switch', '-q', '--detach', 'main']);
    const old = await c.main();
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/login', commit: head })), refusedWith(/has moved since it was approved/));
    // The new head has no approval of its own.
    const moved = await git(storeDir(PROJECT), ['rev-parse', 'feature/login']);
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/login', commit: moved })), refusedWith(/no approval of/));
    // An approval of another commit, a Not now, or a click with no commit, approves nothing.
    await c.put('card-answer', { question: 'merge-login', label: 'Not now', hash: 'b'.repeat(64), commit: moved, proof: 'chat-click' });
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/login', commit: moved })), refusedWith(/no approval of/));
    assert.equal(await c.main(), old, 'the main version did not move');
    // Malformed requests.
    await assert.rejects(mergeApproved(c.ask({ branch: 'main', commit: moved })), refusedWith(/feature's own/));
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/login', commit: moved.slice(0, 12) })), refusedWith(/in full/));
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/nothing', commit: moved })), refusedWith(/no feature\/nothing/));
  } finally {
    c.close();
  }
});

test('failing tests at the approved commit refuse the merge', async () => {
  // The tests pass where the commit holds pass.txt.
  const c = await computer({ test: unix ? 'test -f pass.txt' : 'if exist pass.txt (exit 0) else (exit 1)' });
  try {
    const old = await c.main();
    const bad = await c.feature('bad', { 'bad.txt': 'no\n' });
    await c.approve('bad', bad);
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/bad', commit: bad })), refusedWith(/the tests have not passed on/));
    assert.equal(await c.main(), old);
    // Tests that run too long count as failed.
    updateLean(PROJECT, { test: unix ? 'sleep 5; test -f pass.txt' : 'ping -n 6 127.0.0.1 >NUL' });
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/bad', commit: bad, testMs: 300 })), refusedWith(/ran past/));
    updateLean(PROJECT, { test: unix ? 'test -f pass.txt' : 'if exist pass.txt (exit 0) else (exit 1)' });
    const good = await c.feature('good', { 'pass.txt': 'yes\n' });
    await c.approve('good', good);
    const got = await mergeApproved(c.ask({ branch: 'feature/good', commit: good }));
    assert.equal(got.tests, 'passed');
    const merge = c.events().find((e) => e.kind === 'merge');
    assert.deepEqual({ ...merge.data, approval: typeof merge.data.approval }, {
      commit: got.merge, approved: good, branch: 'feature/good', card: 'merge-good', tests: 'passed', proof: 'chat-click', approval: 'string', forUsers: 'good was added to the main version',
    });
    // With no test command the merge goes ahead, and the record says no tests ran.
    updateLean(PROJECT, { test: null });
    await git(c.folder, ['switch', '-q', '--detach', 'main']);
    const plain = await c.feature('plain', { 'plain.txt': 'plain\n' });
    await c.approve('plain', plain);
    const untested = await mergeApproved(c.ask({ branch: 'feature/plain', commit: plain }));
    assert.equal(untested.tests, 'none');
    assert.match(c.events().filter((e) => e.kind === 'merge').at(-1).data.forUsers, /no tests ran/);
  } finally {
    c.close();
  }
});

test('the tests run with Wheelhouse\'s and the code hosts\' variables cleared', () => {
  const kept = testEnv({ PATH: '/bin', HOME: '/h', WHEELHOUSE_HOME: '/w', GH_TOKEN: 't', GITHUB_TOKEN: 't', GITLAB_TOKEN: 't', GLAB_TOKEN: 't', GIT_DIR: '/x', CI_JOB_TOKEN: 't', COPILOT_CLI_BINARY_VERSION: '1', CLAUDE_PROJECT_DIR: '/p' });
  assert.deepEqual(kept, { PATH: '/bin', HOME: '/h' });
});

test('two merges at once run one after the other', async () => {
  const c = await computer();
  try {
    const one = await c.feature('one', { 'one.txt': '1\n' });
    const two = await c.feature('two', { 'two.txt': '2\n' });
    await c.approve('one', one);
    await c.approve('two', two);
    const [a, b] = await Promise.all([
      mergeApproved(c.ask({ branch: 'feature/one', commit: one })),
      mergeApproved(c.ask({ branch: 'feature/two', commit: two })),
    ]);
    // Both went in, one on top of the other, and the record's main version is the last.
    const main = await c.main();
    assert.ok([a.merge, b.merge].includes(main));
    const first = main === b.merge ? a.merge : b.merge;
    assert.equal(await git(storeDir(PROJECT), ['rev-parse', `${main}^1`]), first);
    assert.equal(readLean(PROJECT).main, main);
    assert.equal(fs.existsSync(path.join(c.home, 'projects', PROJECT, 'lean.lock')), false, 'the lock is freed');

    // A lock held by a live process makes the next wait, then refuse with OTHER_WINDOW.
    const lock = path.join(c.home, 'projects', PROJECT, 'lean.lock');
    let release;
    const held = withLocalLock(PROJECT, () => new Promise((resolve) => { release = resolve; }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const inside = JSON.parse(fs.readFileSync(lock, 'utf8'));
    assert.equal(inside.pid, process.pid);
    assert.ok(!Number.isNaN(Date.parse(inside.startedAt)));
    await assert.rejects(withLocalLock(PROJECT, async () => 'never', { waitMs: 200 }), (error) => error.message === OTHER_WINDOW);
    release();
    await held;
    // A lock whose process has gone is taken over.
    const gone = await run(process.execPath, ['-e', 'console.log(process.pid)']);
    fs.writeFileSync(lock, JSON.stringify({ pid: Number(gone.stdout.trim()), startedAt: new Date(T0).toISOString() }));
    assert.equal(await withLocalLock(PROJECT, async () => 'taken', { waitMs: 2000 }), 'taken');
    assert.equal(fs.existsSync(lock), false);
  } finally {
    c.close();
  }
});

test('undo makes a revert commit and later work stays', async () => {
  const c = await computer();
  try {
    const login = await c.feature('login', { 'login.txt': 'login\n' });
    await c.approve('login', login);
    const first = await mergeApproved(c.ask({ branch: 'feature/login', commit: login }));
    const cart = await c.feature('cart', { 'cart.txt': 'cart\n' });
    await c.approve('cart', cart);
    const second = await mergeApproved(c.ask({ branch: 'feature/cart', commit: cart }));
    // No click on Undo in the helper's window naming the merge: nothing happens (ruling P5-50).
    await assert.rejects(undoMerge(c.ask({ merge: first.merge })), refusedWith(/Wheelhouse's own window/));
    await c.undoClick(first.merge);
    // A commit that isn't a merge is not undone this way.
    await assert.rejects(undoMerge(c.ask({ merge: login })), refusedWith(/not a merge/));
    const got = await undoMerge(c.ask({ merge: first.merge }));
    const main = await c.main();
    assert.equal(main, got.undo);
    // A new commit on top: the merge and the later work stay in the history, and the later work stays in the files.
    assert.equal(await git(storeDir(PROJECT), ['rev-parse', `${got.undo}^`]), second.merge);
    const files = (await git(storeDir(PROJECT), ['ls-tree', '--name-only', main])).split('\n');
    assert.ok(files.includes('cart.txt') && !files.includes('login.txt'), files.join(','));
    assert.equal((await git(storeDir(PROJECT), ['merge-base', '--is-ancestor', first.merge, main], { ok: true })).code, 0);
    assert.equal(readLean(PROJECT).main, main);
    const note = c.events().find((e) => e.kind === 'note' && e.data?.lean === 'undo');
    assert.deepEqual([note.data.merge, note.data.commit], [first.merge, got.undo]);
  } finally {
    c.close();
  }
});

test('the copy holds the merge after it', async () => {
  const c = await computer();
  try {
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    await c.approve('login', head);
    const got = await mergeApproved(c.ask({ branch: 'feature/login', commit: head }));
    assert.deepEqual(got.copy, { pushed: true, commit: got.merge });
    assert.equal(await git(c.copy, ['rev-parse', 'refs/heads/main']), got.merge);
    // The copy carries the record: the state's branch, with the merge's event in it.
    const stateHead = await git(c.copy, ['rev-parse', 'refs/heads/wheelhouse-state']);
    const files = (await git(c.copy, ['ls-tree', '-r', '--name-only', stateHead])).split('\n');
    const merge = c.events().find((e) => e.kind === 'merge');
    assert.ok(files.includes(eventPath(merge).split(path.sep).join('/')), 'the merge\'s event is in the copy');
    // A feature's own copy never goes there.
    assert.equal((await git(c.copy, ['rev-parse', '--verify', '-q', 'refs/heads/feature/login'], { ok: true })).code, 1);
    // The copy on its own, and a copy folder that isn't there: recorded as failed, and the work carries on.
    assert.deepEqual(await copyNow(c.ask()), { pushed: true, commit: got.merge });
    fs.rmSync(c.copy, { recursive: true, force: true });
    const failed = await copyNow(c.ask());
    assert.equal(failed.pushed, false);
    assert.equal(c.events().filter((e) => e.kind === 'note' && e.data?.lean === 'copy').at(-1).data.choice, 'failed');
    // A push setting planted in the store is never read: the copy goes by its path.
    fs.mkdirSync(c.copy);
    await git(c.copy, ['init', '-q', '--bare']);
    const elsewhere = path.join(c.home, 'elsewhere.git');
    await git(c.home, ['init', '-q', '--bare', elsewhere]);
    await git(storeDir(PROJECT), ['config', 'remote.wheelhouse-copy.pushurl', elsewhere]);
    assert.equal((await copyNow(c.ask())).pushed, true);
    assert.equal(await git(c.copy, ['rev-parse', 'refs/heads/main']), got.merge);
    assert.equal((await git(elsewhere, ['rev-parse', '--verify', '-q', 'refs/heads/main'], { ok: true })).code, 1);
  } finally {
    c.close();
  }
});

test('STOP, and main checked out in a folder, refuse every change to the main version', async () => {
  const c = await computer();
  try {
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    await c.approve('login', head);
    setStop({ by: 'prompt', now: c.now });
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/login', commit: head })), refusedWith(new RegExp(STOPPED)));
    await assert.rejects(copyNow(c.ask()), refusedWith(new RegExp(STOPPED)));
    liftStop();
    await git(c.folder, ['switch', '-q', 'main']);
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/login', commit: head })), (error) => error.message === MAIN_CHECKED_OUT);
    await git(c.folder, ['switch', '-q', '--detach', 'main']);
    await mergeApproved(c.ask({ branch: 'feature/login', commit: head }));
  } finally {
    c.close();
  }
});

test('a main version moved outside the helper refuses merges and raises one card; Undo it and Keep it decide it', async () => {
  const c = await computer();
  try {
    const recorded = await c.main();
    // A builder's commit on main, made by a command (main is checked out nowhere, so only update-ref moves it).
    await git(c.folder, ['switch', '-q', '-c', 'sneak']);
    fs.writeFileSync(path.join(c.folder, 'sneak.txt'), 'sneak\n');
    await git(c.folder, ['add', '-A']);
    await git(c.folder, ['commit', '-q', '-m', 'Sneak']);
    const sneak = await git(c.folder, ['rev-parse', 'HEAD']);
    await git(c.folder, ['switch', '-q', '--detach', recorded]);
    await git(storeDir(PROJECT), ['update-ref', 'refs/heads/main', sneak]);

    const head = await c.feature('login', { 'login.txt': 'login\n' });
    await c.approve('login', head);
    let card;
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/login', commit: head })), (error) => {
      card = error.extra?.card;
      return error.message === MAIN_MOVED;
    });
    const status = await leanStatus(c.ask());
    assert.deepEqual([status.moved, status.recorded, status.main, status.card], [true, recorded, sneak, card]);
    const cards = c.events().filter((e) => e.kind === 'card' && e.data?.line === mainMovedLine(recorded, sneak));
    assert.equal(cards.length, 1, 'one card, raised once');
    assert.deepEqual(cards[0].data.options, ['Undo it', 'Keep it', 'Not now']);
    assert.equal(cards[0].data.recommend, 'Undo it');

    // Undo it, clicked for the main version as it stands, reverts the unapproved commit.
    await assert.rejects(undoMerge(c.ask({ moved: true })), refusedWith(/Wheelhouse's own window/));
    await c.undoMainClick(recorded, sneak);
    const undone = await undoMerge(c.ask({ moved: true }));
    assert.equal(await git(storeDir(PROJECT), ['rev-parse', `${undone.undo}^`]), sneak);
    assert.ok(!(await git(storeDir(PROJECT), ['ls-tree', '--name-only', undone.undo])).split('\n').includes('sneak.txt'));
    assert.equal(readLean(PROJECT).main, undone.undo);
    await mergeApproved(c.ask({ branch: 'feature/login', commit: head }));

    // Keep it: only for the move the card named, while the record and the store still say so.
    const kept = await c.main();
    await git(storeDir(PROJECT), ['update-ref', 'refs/heads/main', sneak]);
    assert.equal(await keepMain({ project: PROJECT, from: recorded, to: sneak, run: hostGuard }), false);
    assert.equal(await keepMain({ project: PROJECT, from: kept, to: sneak, run: hostGuard }), true);
    assert.equal((await leanStatus(c.ask())).moved, false);
  } finally {
    c.close();
  }
});

test('on a project with real users a chat click is not enough: the merge needs the window\'s signed approval', async () => {
  const c = await computer({ realUsers: true });
  try {
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    await c.approve('login', head);
    let refusal;
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/login', commit: head })), (error) => {
      refusal = error;
      return error instanceof LeanRefusal;
    });
    assert.equal(refusal.extra.needs, 'window');
    // The helper raises the approval card itself, with the line naming the branch and the full commit.
    const card = c.events().find((e) => e.id === refusal.extra.card);
    assert.equal(card.kind, 'card');
    assert.equal(card.data.line, leanApprovalLine('feature/login', head));
    assert.ok(card.data.question.endsWith(leanApprovalLine('feature/login', head)));
    assert.ok(card.data.options.includes('Suggest a change…'));
    // An unsigned record naming the window's proof counts for nothing.
    await c.approve('login', head, 'window');
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/login', commit: head })), (error) => error.extra?.needs === 'window');
    // A signed approval naming the window counts.
    await c.put('approval', { branch: 'feature/login', commit: head, words: 'Approve', question: card.data.question, proof: 'window' });
    const got = await mergeApproved(c.ask({ branch: 'feature/login', commit: head }));
    assert.equal(c.events().find((e) => e.kind === 'merge').data.proof, 'window');
    assert.equal(await c.main(), got.merge);
  } finally {
    c.close();
  }
});

// --- The Task 5 fix round (ruling P5-50) ---

test('the copy is updated by a fetch run in the copy, so no hook of the copy\'s runs', { skip: !unix && 'the planted hooks are shell scripts' }, async () => {
  const c = await computer();
  try {
    const marks = path.join(c.home, 'copy-hook-ran');
    const hook = `#!/bin/sh\necho "$0" >> "${marks}"\n`;
    const plant = (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      for (const name of ['pre-receive', 'update', 'post-receive', 'post-update', 'reference-transaction', 'push-to-checkout', 'post-checkout']) {
        fs.writeFileSync(path.join(dir, name), hook, { mode: 0o755 });
      }
    };
    // The copy sits in the person's folder, out of the guards' reach: its own hooks, and a hooks folder its settings name.
    plant(path.join(c.copy, 'hooks'));
    plant(path.join(c.home, 'copy-hooks'));
    await git(c.copy, ['config', 'core.hooksPath', path.join(c.home, 'copy-hooks')]);
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    await c.approve('login', head);
    const got = await mergeApproved(c.ask({ branch: 'feature/login', commit: head }));
    assert.deepEqual(got.copy, { pushed: true, commit: got.merge });
    assert.equal(await git(c.copy, ['rev-parse', 'refs/heads/main']), got.merge);
    assert.ok(FULL.test(await git(c.copy, ['rev-parse', 'refs/heads/wheelhouse-state'])));
    assert.deepEqual(await copyNow(c.ask()), { pushed: true, commit: got.merge });
    assert.equal(fs.existsSync(marks), false, fs.existsSync(marks) ? fs.readFileSync(marks, 'utf8') : 'no hook ran');
  } finally {
    c.close();
  }
});

test('undo needs the signed record of a click in the helper\'s window, and runs under STOP', async () => {
  const c = await computer();
  try {
    const login = await c.feature('login', { 'login.txt': 'login\n' });
    await c.approve('login', login);
    const merged = await mergeApproved(c.ask({ branch: 'feature/login', commit: login }));
    // A click in the chat, or an unsigned record naming the window, undoes nothing; the refusal names the card the
    // helper raised for the window, once.
    await c.put('card-answer', { question: 'undo-login', label: 'Undo', hash: 'c'.repeat(64), commit: merged.merge, proof: 'chat-click' });
    await c.put('card-answer', { question: 'undo-login', label: 'Undo', hash: 'c'.repeat(64), commit: merged.merge, proof: 'window' });
    let refusal;
    await assert.rejects(undoMerge(c.ask({ merge: merged.merge })), (error) => { refusal = error; return error instanceof LeanRefusal; });
    assert.equal(refusal.extra.needs, 'window');
    const card = c.events().find((e) => e.id === refusal.extra.card);
    assert.deepEqual(card.data, undoCard(merged.merge));
    assert.ok(card.data.question.endsWith(undoLine(merged.merge)));
    await assert.rejects(undoMerge(c.ask({ merge: merged.merge })), (error) => error.extra?.card === card.id);
    // A signed click naming another merge, or the window's record of Undo it, is not this one.
    await c.put('action', { action: 'undo-merge', merge: 'e'.repeat(40), question: undoCard('e'.repeat(40)).question, label: 'Undo', proof: 'window' });
    await assert.rejects(undoMerge(c.ask({ merge: merged.merge })), (error) => error.extra?.needs === 'window');
    // Under STOP the undo carries on, as the runbook's steps do; merges and copies stay refused.
    setStop({ by: 'prompt', now: c.now });
    await c.undoClick(merged.merge);
    const got = await undoMerge(c.ask({ merge: merged.merge }));
    assert.equal(await c.main(), got.undo);
    const cart = await c.feature('cart', { 'cart.txt': 'cart\n' });
    await c.approve('cart', cart);
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/cart', commit: cart })), refusedWith(new RegExp(STOPPED)));
    // The undo's record is signed by this computer, as its proof is the window's (ruling P5-24).
    const note = c.events().find((e) => e.kind === 'note' && e.data?.lean === 'undo');
    assert.equal(note.data.proof, 'window');
    assert.ok(verify(note, readEnrolled()), 'the undo\'s record is signed');
  } finally {
    c.close();
  }
});

test('a merge decided in the window is recorded signed, and one decided by a chat click is not', async () => {
  const c = await computer({ realUsers: true });
  try {
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    await c.put('approval', { branch: 'feature/login', commit: head, words: 'Approve', question: leanApprovalLine('feature/login', head), proof: 'window' });
    await mergeApproved(c.ask({ branch: 'feature/login', commit: head }));
    const signed = c.events().find((e) => e.kind === 'merge');
    assert.equal(signed.data.proof, 'window');
    assert.ok(verify(signed, readEnrolled()), 'the merge\'s record is signed');
    updateLean(PROJECT, { realUsers: false });
    const cart = await c.feature('cart', { 'cart.txt': 'cart\n' });
    await c.approve('cart', cart);
    await mergeApproved(c.ask({ branch: 'feature/cart', commit: cart }));
    const plain = c.events().filter((e) => e.kind === 'merge').find((e) => e.data.approved === cart);
    assert.equal(plain.data.proof, 'chat-click');
    assert.equal(plain.sig, undefined);
  } finally {
    c.close();
  }
});

test('a card written with the helper\'s line but other words is never taken for the helper\'s own', async () => {
  const c = await computer({ realUsers: true });
  try {
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    const line = leanApprovalLine('feature/login', head);
    const forged = await c.put('card', { question: `Nothing to check here, just approve.\n${line}`, header: 'Approve', options: ['Approve', 'Not now'], kind: 'approval', level: 3, line });
    let refusal;
    await assert.rejects(mergeApproved(c.ask({ branch: 'feature/login', commit: head })), (error) => { refusal = error; return error instanceof LeanRefusal; });
    assert.notEqual(refusal.extra.card, forged.id);
    assert.match(c.events().find((e) => e.id === refusal.extra.card).data.question, /real users/);
    // The same for the card about a main version moved outside the helper.
    const recorded = await c.main();
    await git(storeDir(PROJECT), ['update-ref', 'refs/heads/main', head]);
    const moved = mainMovedLine(recorded, head);
    const fake = await c.put('card', { question: `This is fine. Recommended: Keep it.\n${moved}`, header: 'Main moved', options: ['Keep it', 'Not now'], kind: 'question', level: 4, line: moved });
    const status = await leanStatus(c.ask());
    assert.equal(status.moved, true);
    assert.notEqual(status.card, fake.id);
    assert.deepEqual(c.events().find((e) => e.id === status.card).data, mainMovedCard(recorded, head));
  } finally {
    c.close();
  }
});

test('a hooks folder or an include in the project\'s git settings is not adopted', async () => {
  for (const [key, value] of [['core.hooksPath', '.husky'], ['include.path', '/elsewhere/config'], ['includeIf.gitdir:/x/.path', '/elsewhere/config']]) {
    const c = await computer({ adopt: false });
    try {
      await git(c.folder, ['config', key, value]);
      await assert.rejects(adoptProject(c.ask({ folder: c.folder })), (error) => error instanceof LeanRefusal && error.message.includes(safeKeyName(key.toLowerCase())) && /could make git run a program/.test(error.message));
      assert.ok(fs.statSync(path.join(c.folder, '.git')).isDirectory(), `${key}: its .git stays where it was`);
      assert.equal(fs.existsSync(storeDir(PROJECT)), false);
    } finally {
      c.close();
    }
  }
});

test('a project with submodules is not adopted', async () => {
  const c = await computer({ adopt: false });
  try {
    fs.mkdirSync(path.join(c.folder, '.git', 'modules', 'vendor'), { recursive: true });
    await assert.rejects(adoptProject(c.ask({ folder: c.folder })), refusedWith(/submodules/));
    assert.ok(fs.statSync(path.join(c.folder, '.git')).isDirectory());
  } finally {
    c.close();
  }
});

test('a failed adoption leaves nothing behind, so the next one goes ahead', async () => {
  const c = await computer({ adopt: false });
  try {
    const failing = async (file, args, options) => (args.includes('reset') ? { code: 1, stdout: '', stderr: 'no', timedOut: false } : hostGuard(file, args, options));
    await assert.rejects(adoptProject({ project: PROJECT, folder: c.folder, run: failing, now: c.now }), refusedWith(/could not be matched/));
    assert.ok(fs.statSync(path.join(c.folder, '.git')).isDirectory(), 'the .git is back');
    assert.equal(fs.existsSync(path.join(c.folder, '.git', 'worktrees', 'tree')), false, 'no worktree entry is left');
    assert.equal((await adoptProject(c.ask({ folder: c.folder }))).adopted, true);
  } finally {
    c.close();
  }
});

test('the copy is not updated while the main version has moved outside the helper', async () => {
  const c = await computer();
  try {
    const before = await c.main();
    assert.equal((await copyNow(c.ask())).pushed, true);
    const sneak = await c.feature('sneak', { 'sneak.txt': 'sneak\n' });
    await git(storeDir(PROJECT), ['update-ref', 'refs/heads/main', sneak]);
    await assert.rejects(copyNow(c.ask()), (error) => error.message === MAIN_MOVED && typeof error.extra?.card === 'string');
    assert.equal(await git(c.copy, ['rev-parse', 'refs/heads/main']), before);
  } finally {
    c.close();
  }
});

test('a status asked while another window moves the main version raises no card', async () => {
  const c = await computer();
  try {
    const old = await c.main();
    const next = await c.feature('next', { 'next.txt': 'next\n' });
    let raced = false;
    // Another window's merge lands between the status reading the record and reading the store.
    const racing = async (file, args, options) => {
      if (!raced && options?.cwd === storeDir(PROJECT) && args.at(-1) === 'refs/heads/main^{commit}') {
        raced = true;
        await git(storeDir(PROJECT), ['update-ref', 'refs/heads/main', next, old]);
        updateLean(PROJECT, { main: next });
      }
      return hostGuard(file, args, options);
    };
    const status = await leanStatus({ project: PROJECT, run: racing, now: c.now });
    assert.ok(raced);
    assert.deepEqual([status.moved, status.main], [false, next]);
    assert.equal(c.events().filter((e) => e.kind === 'card').length, 0);
  } finally {
    c.close();
  }
});

test('Undo it on a main version moved by a merge reverts the merge only', async () => {
  const c = await computer();
  try {
    const recorded = await c.main();
    await git(c.folder, ['switch', '-q', '-c', 'side']);
    fs.writeFileSync(path.join(c.folder, 'side.txt'), 'side\n');
    await git(c.folder, ['add', '-A']);
    await git(c.folder, ['commit', '-q', '-m', 'Side']);
    await git(c.folder, ['switch', '-q', '--detach', recorded]);
    await git(c.folder, ['merge', '-q', '--no-ff', '-m', 'Sneak a merge', 'side']);
    const merge = await git(c.folder, ['rev-parse', 'HEAD']);
    await git(c.folder, ['switch', '-q', '--detach', recorded]);
    await git(storeDir(PROJECT), ['update-ref', 'refs/heads/main', merge]);
    await c.undoMainClick(recorded, merge);
    const undone = await undoMerge(c.ask({ moved: true }));
    assert.equal(await git(storeDir(PROJECT), ['rev-parse', `${undone.undo}^`]), merge, 'one revert, of the merge');
    assert.ok(!(await git(storeDir(PROJECT), ['ls-tree', '--name-only', undone.undo])).split('\n').includes('side.txt'));
  } finally {
    c.close();
  }
});

test('the tests run with the person\'s SSH agent and password prompt cleared', () => {
  assert.deepEqual(testEnv({ PATH: '/bin', SSH_AUTH_SOCK: '/tmp/agent', SSH_ASKPASS: '/usr/bin/ask' }), { PATH: '/bin' });
});

// --- Fix round 2 (the re-review of ee7c2c7) ---

test('a copy folder that isn\'t a repository is not updated, and nothing lands in a repository above it', async () => {
  const c = await computer();
  try {
    const outer = path.join(c.home, 'outer');
    fs.mkdirSync(outer);
    await git(outer, ['init', '-q', '-b', 'trunk']);
    const copy = path.join(outer, 'copy');
    fs.mkdirSync(copy);
    updateLean(PROJECT, { copy });
    const head = await c.feature('login', { 'login.txt': 'login\n' });
    await c.approve('login', head);
    const got = await mergeApproved(c.ask({ branch: 'feature/login', commit: head }));
    assert.equal(got.copy.pushed, false);
    assert.equal(c.events().filter((e) => e.kind === 'note' && e.data?.lean === 'copy').at(-1).data.choice, 'failed');
    for (const ref of ['refs/heads/main', 'refs/heads/wheelhouse-state']) {
      assert.equal((await git(outer, ['rev-parse', '--verify', '-q', ref], { ok: true })).code, 1, `${ref} stays out of the repository above`);
    }
  } finally {
    c.close();
  }
});

test('a signed click on Undo is used once', async () => {
  const c = await computer();
  try {
    const login = await c.feature('login', { 'login.txt': 'login\n' });
    await c.approve('login', login);
    const merged = await mergeApproved(c.ask({ branch: 'feature/login', commit: login }));
    const click = await c.undoClick(merged.merge);
    const first = await undoMerge(c.ask({ merge: merged.merge }));
    const note = c.events().find((e) => e.kind === 'note' && e.data?.lean === 'undo');
    assert.equal(note.data.click, click.id);
    // The undo undone by hand, so the merge's work is back: the old click undoes nothing again.
    await git(c.folder, ['switch', '-q', '--detach', first.undo]);
    await git(c.folder, ['revert', '--no-edit', first.undo]);
    const back = await git(c.folder, ['rev-parse', 'HEAD']);
    await git(c.folder, ['switch', '-q', '--detach', first.undo]);
    await git(storeDir(PROJECT), ['update-ref', 'refs/heads/main', back]);
    updateLean(PROJECT, { main: back });
    await assert.rejects(undoMerge(c.ask({ merge: merged.merge })), (error) => error.extra?.needs === 'window');
    assert.equal(await c.main(), back);
    // A new click undoes it again.
    await c.undoClick(merged.merge);
    assert.ok(FULL.test((await undoMerge(c.ask({ merge: merged.merge }))).undo));
  } finally {
    c.close();
  }
});

test('the helper\'s card is reused only with its own recommendation, kind and level', async () => {
  const c = await computer();
  try {
    const recorded = await c.main();
    const sneak = await c.feature('sneak', { 'sneak.txt': 'sneak\n' });
    await git(storeDir(PROJECT), ['update-ref', 'refs/heads/main', sneak]);
    const fake = await c.put('card', { ...mainMovedCard(recorded, sneak), recommend: 'Keep it' });
    const status = await leanStatus(c.ask());
    assert.notEqual(status.card, fake.id);
    assert.equal(c.events().find((e) => e.id === status.card).data.recommend, 'Undo it');
  } finally {
    c.close();
  }
});
