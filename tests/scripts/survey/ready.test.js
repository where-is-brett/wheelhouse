// tests/scripts/survey/ready.test.js
// Ready-made changes: a request carried on, fetched by the host's own ref for it into the work's
// ref in the project's folder; another setup's instructions archived, and put back, by a commit
// built with git's plumbing on the default branch as it is now. Nothing else in the folder moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { carryOn, archiveCommit, restoreCommit, fetchInto, freeWork, folderGit, ReadyRefusal } from '../../../scripts/survey/ready.js';
import { archiveAt } from '../../../scripts/setup/uninstall.js';
import { reaching } from '../../../scripts/setup/git.js';
import { run } from '../../../scripts/lib/run.js';
import { makeBareRemote, g } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';

const AUTHOR = { name: 'Dana Director', email: '1+dana@users.noreply.github.com' };
const SECRET = ['gh', 'p_', 'a1B2'.repeat(10)].join('');

// A project on a bare remote with a few files on main, and the director's folder: a clone of it,
// with a change of their own in the working copy and one staged, which nothing here may touch.
async function projectWith(files) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const seed = tempFolder('wh-ready-seed-');
  await g(seed, 'init', '-q', '-b', 'main');
  const links = [];
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(seed, name)), { recursive: true });
    if (typeof text === 'string') fs.writeFileSync(path.join(seed, name), text);
    else links.push([name, text.link]);
  }
  await g(seed, 'add', '-A');
  // A link, made in git's own index, so it is one on any system.
  for (const [name, target] of links) {
    const blob = (await run('git', ['hash-object', '-w', '--stdin'], { cwd: seed, input: target })).stdout.trim();
    await g(seed, 'update-index', '--add', '--cacheinfo', `120000,${blob},${name}`);
  }
  await g(seed, 'commit', '-q', '-m', 'Start');
  await g(seed, 'push', '-q', remote.url, 'main');
  const folder = tempFolder('wh-ready-folder-');
  await g(folder, 'clone', '-q', remote.url, '.');
  fs.writeFileSync(path.join(folder, 'README.md'), 'Edited, not staged\n');
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'Staged\n');
  await g(folder, 'add', 'notes.txt');
  const git = folderGit({ run, folder, env: reaching({ GIT_NO_REPLACE_OBJECTS: '1' }, remote.url) });
  return { remote, seed, folder, git, cleanup: () => { remote.cleanup(); fs.rmSync(seed, { recursive: true, force: true }); fs.rmSync(folder, { recursive: true, force: true }); } };
}

// What the director's own folder holds: its refs but the work's, its index and its working copy.
async function folderNow(folder, work) {
  const refs = (await g(folder, 'for-each-ref', '--format=%(refname) %(objectname)')).split('\n').filter((l) => !l.startsWith(`refs/wheelhouse/from/${work} `));
  return {
    refs, head: await g(folder, 'symbolic-ref', 'HEAD'), status: await g(folder, 'status', '--porcelain'),
    index: fs.readFileSync(path.join(folder, '.git', 'index')).toString('base64'),
  };
}

// A commit on the remote, at `ref` only (a fork's request: on no branch of the project's own).
async function commitAt(p, ref, file, text) {
  await g(p.seed, 'switch', '-q', '--detach', 'main');
  fs.writeFileSync(path.join(p.seed, file), text);
  await g(p.seed, 'add', file);
  await g(p.seed, 'commit', '-q', '-m', `Change ${file}`);
  const sha = await g(p.seed, 'rev-parse', 'HEAD');
  await g(p.seed, 'push', '-q', '-f', p.remote.url, `HEAD:${ref}`);
  await g(p.seed, 'switch', '-q', 'main');
  return sha;
}

function adapterFor(requests, { details = { files: [{ path: 'prices.txt', additions: 1, deletions: 0 }], commits: ['Change prices.txt'] }, ref = (n) => `refs/pull/${n}/head` } = {}) {
  const asked = [];
  return {
    asked,
    openRequests: async () => { asked.push('openRequests'); return requests; },
    requestDetails: async (n) => { asked.push(`requestDetails ${n}`); return details; },
    pullRef: (n) => ref(n),
  };
}

const treeOf = async (dir, rev) => (await g(dir, 'ls-tree', '-r', '--full-tree', rev)).split('\n').filter(Boolean).sort();

test('a request from someone\'s own copy is fetched by the host\'s pull ref into the work\'s ref, and nothing else moves', async () => {
  const p = await projectWith({ 'README.md': 'Start\n' });
  try {
    const head = await commitAt(p, 'refs/pull/7/head', 'prices.txt', 'Prices\n');
    const adapter = adapterFor([{ number: 7, title: 'Prices page', body: 'Adds prices.', branch: 'their-line', head, draft: false, fork: true }]);
    const before = await folderNow(p.folder, 'carry-on-7');
    const made = await carryOn({ git: p.git, adapter, remoteUrl: p.remote.url, number: 7, work: 'carry-on-7' });
    assert.deepEqual(made, {
      sha: head, ref: 'refs/wheelhouse/from/carry-on-7', request: 7, branch: 'their-line', fork: true,
      title: 'Prices page', body: 'Adds prices.', bodyWithheld: false,
      files: [{ path: 'prices.txt', additions: 1, deletions: 0 }], commits: ['Change prices.txt'],
    });
    assert.equal(await g(p.folder, 'rev-parse', 'refs/wheelhouse/from/carry-on-7'), head);
    assert.deepEqual(await folderNow(p.folder, 'carry-on-7'), before, 'the folder\'s own refs, index and working copy are as they were');
    // GitLab's merge request ref, the same way.
    const mr = await commitAt(p, 'refs/merge-requests/9/head', 'stock.txt', 'Stock\n');
    const gitlab = adapterFor([{ number: 9, title: 'Stock', body: '', branch: 'stock', head: mr, draft: true, fork: false }], { ref: (n) => `refs/merge-requests/${n}/head` });
    assert.equal((await carryOn({ git: p.git, adapter: gitlab, remoteUrl: p.remote.url, number: 9, work: 'carry-on-9' })).sha, mr);
  } finally { p.cleanup(); }
});

test('a request whose head moved since the host listed it is refused, and its ref taken out again', async () => {
  const p = await projectWith({ 'README.md': 'Start\n' });
  try {
    const listed = await commitAt(p, 'refs/pull/7/head', 'prices.txt', 'Prices\n');
    await commitAt(p, 'refs/pull/7/head', 'prices.txt', 'Prices, again\n');
    const adapter = adapterFor([{ number: 7, title: 'Prices', body: '', branch: 'their-line', head: listed, draft: false, fork: false }]);
    await assert.rejects(carryOn({ git: p.git, adapter, remoteUrl: p.remote.url, number: 7, work: 'carry-on-7' }), (e) => e instanceof ReadyRefusal && /moved on/.test(e.message));
    assert.equal((await run('git', ['rev-parse', '--verify', '--quiet', 'refs/wheelhouse/from/carry-on-7'], { cwd: p.folder })).code, 1);
  } finally { p.cleanup(); }
});

test('only an open request is carried on, by a host ref of its own, and the body is left out when it holds a secret', async () => {
  const p = await projectWith({ 'README.md': 'Start\n' });
  try {
    const head = await commitAt(p, 'refs/pull/7/head', 'prices.txt', 'Prices\n');
    const open = [{ number: 7, title: 'Prices', body: `Token ${SECRET} for the shop`, branch: 'their-line', head, draft: false, fork: false }];
    await assert.rejects(carryOn({ git: p.git, adapter: adapterFor(open), remoteUrl: p.remote.url, number: 8, work: 'carry-on-8' }), /isn't open/);
    // A ref the host adapter names for another request, or of another shape, is never fetched.
    for (const ref of [() => 'refs/pull/8/head', () => 'refs/heads/main', () => 'refs/pull/7/head:refs/heads/x']) {
      await assert.rejects(carryOn({ git: p.git, adapter: adapterFor(open, { ref }), remoteUrl: p.remote.url, number: 7, work: 'carry-on-7' }), ReadyRefusal);
    }
    await assert.rejects(carryOn({ git: p.git, adapter: adapterFor(open), remoteUrl: '--upload-pack=x', number: 7, work: 'carry-on-7' }), ReadyRefusal);
    assert.equal((await run('git', ['for-each-ref', 'refs/wheelhouse/'], { cwd: p.folder })).stdout, '', 'nothing fetched');
    const made = await carryOn({ git: p.git, adapter: adapterFor(open), remoteUrl: p.remote.url, number: 7, work: 'carry-on-7' });
    assert.deepEqual([made.body, made.bodyWithheld, made.title], ['', true, 'Prices']);
    assert.equal(JSON.stringify(made).includes(SECRET), false);
  } finally { p.cleanup(); }
});

test('a free work id is one whose line is on no request, not on the host and not already used', async () => {
  const p = await projectWith({ 'README.md': 'Start\n' });
  try {
    assert.equal(await freeWork({ git: p.git, remoteUrl: p.remote.url, base: 'carry-on-7' }), 'carry-on-7');
    assert.equal(await freeWork({ git: p.git, remoteUrl: p.remote.url, base: 'carry-on-7', lines: ['feature/carry-on-7'] }), 'carry-on-7-2');
    assert.equal(await freeWork({ git: p.git, remoteUrl: p.remote.url, base: 'carry-on-7', used: (id) => id === 'carry-on-7' }), 'carry-on-7-2');
    await g(p.seed, 'push', '-q', p.remote.url, 'main:refs/heads/feature/carry-on-7');
    await g(p.folder, 'update-ref', 'refs/heads/feature/carry-on-7-2', 'HEAD');
    await g(p.folder, 'update-ref', 'refs/remotes/origin/feature/carry-on-7-3', 'HEAD');
    await g(p.folder, 'update-ref', 'refs/wheelhouse/from/carry-on-7-4', 'HEAD');
    assert.equal(await freeWork({ git: p.git, remoteUrl: p.remote.url, base: 'carry-on-7' }), 'carry-on-7-5');
  } finally { p.cleanup(); }
});

const OTHERS = {
  'README.md': 'Start\n', 'AGENTS.md': 'Agents, as surveyed\n', '.cursorrules': 'Cursor\n',
  '.claude/skills/tidy/SKILL.md': 'Tidy\n', '.windsurfrules': { link: 'README.md' }, 'src/app.js': 'app\n',
};

// The default branch fetched into the work's ref, as the helper's route does first.
async function fetchedDefault(p, work) {
  return fetchInto({ git: p.git, remoteUrl: p.remote.url, source: 'refs/heads/main', work });
}

test('the archive commit moves exactly the instruction files on the default branch as it is now, with the manifest and README, touching no working copy', async () => {
  const p = await projectWith(OTHERS);
  try {
    // Changed on the default branch since the survey; .cursorrules gone from it since.
    fs.writeFileSync(path.join(p.seed, 'AGENTS.md'), 'Agents, as they are now\n');
    await g(p.seed, 'rm', '-q', '.cursorrules');
    await g(p.seed, 'add', 'AGENTS.md');
    await g(p.seed, 'commit', '-q', '-m', 'Since the survey');
    await g(p.seed, 'push', '-q', p.remote.url, 'main');
    const tip = await g(p.seed, 'rev-parse', 'HEAD');
    const before = await folderNow(p.folder, 'archive-instructions');
    const base = await fetchedDefault(p, 'archive-instructions');
    assert.equal(base, tip);
    const surveyed = ['.claude/skills/tidy/SKILL.md', '.cursorrules', '.windsurfrules', 'AGENTS.md', 'README.md', '../outside', '.wheelhouse-archive/AGENTS.md'];
    const made = await archiveCommit({ git: p.git, defaultRef: 'refs/wheelhouse/from/archive-instructions', files: surveyed, work: 'archive-instructions', author: AUTHOR });
    assert.deepEqual(made.moved, ['.claude/skills/tidy/SKILL.md', 'AGENTS.md'], 'only plain instruction files there now; the link, the gone file and the rest left out');
    assert.equal(made.ref, 'refs/wheelhouse/from/archive-instructions');
    assert.equal(await g(p.folder, 'rev-parse', made.ref), made.sha);
    assert.equal(await g(p.folder, 'rev-parse', `${made.sha}^`), tip, 'built on the default branch as it is now');
    assert.equal(await g(p.folder, 'show', `${made.sha}:.wheelhouse-archive/AGENTS.md`), 'Agents, as they are now');
    assert.equal(await g(p.folder, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', made.sha), `${AUTHOR.name} <${AUTHOR.email}>|${AUTHOR.name} <${AUTHOR.email}>`);
    const files = (await g(p.folder, 'ls-tree', '-r', '--name-only', '--full-tree', made.sha)).split('\n').sort();
    assert.deepEqual(files, [
      '.wheelhouse-archive/.claude/skills/tidy/SKILL.md', '.wheelhouse-archive/AGENTS.md', '.wheelhouse-archive/README.md',
      '.wheelhouse-archive/archived.json', '.windsurfrules', 'README.md', 'src/app.js',
    ]);
    assert.deepEqual(JSON.parse(await g(p.folder, 'show', `${made.sha}:.wheelhouse-archive/archived.json`)), {
      v: 1, moved: [{ from: '.claude/skills/tidy/SKILL.md', to: '.wheelhouse-archive/.claude/skills/tidy/SKILL.md' }, { from: 'AGENTS.md', to: '.wheelhouse-archive/AGENTS.md' }],
    });
    // Uninstall takes it as it is: every move put back.
    const back = await archiveAt((args) => run('git', args, { cwd: p.folder }), made.sha);
    assert.deepEqual(back.view.moves.map((m) => m.from), made.moved);
    assert.deepEqual(await folderNow(p.folder, 'archive-instructions'), before, 'the director\'s refs, index and working copy are as they were');
  } finally { p.cleanup(); }
});

test('the archive is refused when nothing on the default branch is left to move, or an archive is there already', async () => {
  const p = await projectWith(OTHERS);
  try {
    await fetchedDefault(p, 'archive-instructions');
    await assert.rejects(archiveCommit({ git: p.git, defaultRef: 'refs/wheelhouse/from/archive-instructions', files: ['.cursorrules-gone', 'README.md'], work: 'archive-instructions', author: AUTHOR }), ReadyRefusal);
    const made = await archiveCommit({ git: p.git, defaultRef: 'refs/wheelhouse/from/archive-instructions', files: ['AGENTS.md'], work: 'archive-instructions', author: AUTHOR });
    await g(p.folder, 'update-ref', 'refs/heads/archived', made.sha);
    await assert.rejects(archiveCommit({ git: p.git, defaultRef: 'refs/heads/archived', files: ['.cursorrules'], work: 'archive-again', author: AUTHOR }), /archive/);
  } finally { p.cleanup(); }
});

test('restoring reverses the archive, and the manifest and README go once everything is back', async () => {
  const p = await projectWith(OTHERS);
  try {
    await fetchedDefault(p, 'archive-instructions');
    const archived = await archiveCommit({ git: p.git, defaultRef: 'refs/wheelhouse/from/archive-instructions', files: ['AGENTS.md', '.cursorrules', '.claude/skills/tidy/SKILL.md'], work: 'archive-instructions', author: AUTHOR });
    await g(p.folder, 'update-ref', 'refs/heads/archived', archived.sha);
    const before = await folderNow(p.folder, 'restore-instructions');
    const restored = await restoreCommit({ git: p.git, defaultRef: 'refs/heads/archived', work: 'restore-instructions', author: AUTHOR });
    assert.deepEqual(restored.moved, ['.claude/skills/tidy/SKILL.md', '.cursorrules', 'AGENTS.md']);
    assert.equal(await g(p.folder, 'rev-parse', 'refs/wheelhouse/from/restore-instructions'), restored.sha);
    assert.deepEqual(await treeOf(p.folder, restored.sha), await treeOf(p.folder, 'origin/main'), 'the tree as it was before the archive');
    assert.deepEqual(await folderNow(p.folder, 'restore-instructions'), { ...before, refs: [...before.refs] });

    // A place taken since: that file stays in the archive, which keeps its list of it alone.
    await g(p.folder, 'push', '-q', p.remote.url, `${archived.sha}:refs/heads/archived`);
    await g(p.seed, 'fetch', '-q', p.remote.url, 'archived');
    await g(p.seed, 'reset', '-q', '--hard', archived.sha);
    fs.writeFileSync(path.join(p.seed, 'AGENTS.md'), 'A new one\n');
    await g(p.seed, 'add', 'AGENTS.md');
    await g(p.seed, 'commit', '-q', '-m', 'A new AGENTS.md');
    await g(p.seed, 'push', '-q', '-f', p.remote.url, 'HEAD:refs/heads/taken');
    await g(p.folder, 'fetch', '-q', 'origin', 'taken:refs/heads/taken');
    const partly = await restoreCommit({ git: p.git, defaultRef: 'refs/heads/taken', work: 'restore-again', author: AUTHOR });
    assert.deepEqual(partly.moved, ['.claude/skills/tidy/SKILL.md', '.cursorrules']);
    assert.deepEqual(JSON.parse(await g(p.folder, 'show', `${partly.sha}:.wheelhouse-archive/archived.json`)), { v: 1, moved: [{ from: 'AGENTS.md', to: '.wheelhouse-archive/AGENTS.md' }] });
    assert.equal(await g(p.folder, 'show', `${partly.sha}:AGENTS.md`), 'A new one');
    assert.equal(await g(p.folder, 'show', `${partly.sha}:.wheelhouse-archive/README.md`) !== '', true);

    // No archive: nothing to put back.
    await assert.rejects(restoreCommit({ git: p.git, defaultRef: 'origin/main', work: 'restore-none', author: AUTHOR }), ReadyRefusal);
  } finally { p.cleanup(); }
});
