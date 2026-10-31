// tests/scripts/checks/folder.test.js
// The check folder: a copy of exactly one commit, with no link back, that nothing a test leaves can steer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkPaths, prepareFolder } from '../../../scripts/checks/folder.js';
import { makeBareRemote, g } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';
import { run } from '../../../scripts/lib/run.js';
import { engineDir } from '../../../scripts/lib/paths.js';

const unix = { skip: process.platform === 'win32' };

async function withHome(fn) {
  const home = path.join(tempFolder('wh-folder-'), 'home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

// A bare source with two commits on main, the helper's mirror or the home in small.
async function source() {
  const remote = await makeBareRemote();
  const work = path.join(remote.root, 'work');
  await g(remote.root, 'clone', '-q', remote.url, work);
  await g(work, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, '.gitignore'), 'out/\n');
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\n');
  await g(work, 'add', '-A');
  await g(work, 'commit', '-qm', 'one');
  const first = await g(work, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(work, 'a.txt'), 'two\n');
  await g(work, 'commit', '-qam', 'two');
  const second = await g(work, 'rev-parse', 'HEAD');
  await g(work, 'push', '-q', 'origin', 'main');
  await g(remote.url, 'config', '--unset', 'receive.autogc');
  return { url: remote.url, first, second };
}
const read = (p, name) => fs.readFileSync(path.join(p.tree, name), 'utf8');

test('checkPaths names the folders under the engine', async () => {
  await withHome(() => {
    const p = checkPaths('p');
    assert.equal(p.root, path.join(engineDir(), 'checks', 'p'));
    assert.deepEqual([p.tree, p.gitDir, p.home, p.mainHome].map((x) => path.basename(x)), ['tree', 'tree.git', 'home', 'main-home']);
  });
});

test('a commit is fetched and nothing links back to the source', unix, async () => {
  await withHome(async () => {
    const s = await source();
    const p = await prepareFolder({ project: 'p', commit: s.first, main: false, source: s.url });
    assert.equal(read(p, 'a.txt'), 'one\n');
    assert.equal(fs.existsSync(path.join(p.gitDir, 'objects', 'info', 'alternates')), false);
    const config = fs.readFileSync(path.join(p.gitDir, 'config'), 'utf8');
    assert.doesNotMatch(config, /\[remote/);
    assert.ok(!config.includes(s.url));
  });
});

test('a commit that isn\'t the tip of any branch is fetched too', unix, async () => {
  await withHome(async () => {
    const s = await source();
    const p = await prepareFolder({ project: 'p', commit: s.first, main: false, source: s.url });
    assert.equal((await g(p.tree, '--git-dir', p.gitDir, 'rev-parse', 'HEAD')), s.first);
  });
});

test('no ref is left behind in the source', unix, async () => {
  await withHome(async () => {
    const s = await source();
    await prepareFolder({ project: 'p', commit: s.first, main: false, source: s.url });
    assert.doesNotMatch(await g(s.url, 'for-each-ref'), /wheelhouse/);
  });
});

test('the tree\'s .git points at tree.git, beside it', unix, async () => {
  await withHome(async () => {
    const s = await source();
    const p = await prepareFolder({ project: 'p', commit: s.first, main: false, source: s.url });
    assert.ok(fs.statSync(path.join(p.tree, '.git')).isFile());
    assert.ok(fs.statSync(path.join(p.gitDir, 'HEAD')).isFile());
  });
});

test('a head keeps ignored build output', unix, async () => {
  await withHome(async () => {
    const s = await source();
    const p = await prepareFolder({ project: 'p', commit: s.first, main: false, source: s.url });
    fs.mkdirSync(path.join(p.tree, 'out'));
    fs.writeFileSync(path.join(p.tree, 'out', 'kept'), 'built');
    fs.writeFileSync(path.join(p.tree, 'stray'), 'left by a test');
    fs.writeFileSync(path.join(p.tree, 'a.txt'), 'changed by a test');
    await prepareFolder({ project: 'p', commit: s.second, main: false, source: s.url });
    assert.equal(read(p, 'out/kept'), 'built');
    assert.equal(fs.existsSync(path.join(p.tree, 'stray')), false);
    assert.equal(read(p, 'a.txt'), 'two\n');
  });
});

test('a main-line check starts from an empty tree', unix, async () => {
  await withHome(async () => {
    const s = await source();
    const p = await prepareFolder({ project: 'p', commit: s.first, main: false, source: s.url });
    fs.mkdirSync(path.join(p.tree, 'out'));
    fs.writeFileSync(path.join(p.tree, 'out', 'kept'), 'built by a head');
    await prepareFolder({ project: 'p', commit: s.second, main: true, source: s.url });
    assert.equal(fs.existsSync(path.join(p.tree, 'out')), false);
    assert.equal(read(p, 'a.txt'), 'two\n');
  });
});

test('a commit the source doesn\'t hold is refused', unix, async () => {
  await withHome(async () => {
    const s = await source();
    await assert.rejects(prepareFolder({ project: 'p', commit: 'f'.repeat(40), main: false, source: s.url }), /could not/);
  });
});

test('a project name with a path in it is refused', async () => {
  await withHome(() => {
    assert.throws(() => checkPaths('../x'), /project/);
  });
});

// Review Focus 3. The planted files are what a test could leave; the proof is written only if git runs them.
test('a hook and core.fsmonitor planted in the tree never run on the next prepareFolder', unix, async () => {
  await withHome(async () => {
    const s = await source();
    const p = await prepareFolder({ project: 'p', commit: s.first, main: false, source: s.url });
    const proof = path.join(p.root, 'proof');
    const script = `#!/bin/sh\necho ran > '${proof}'\n`;
    // A test can't write tree.git, so what it can reach is the tree: its `.git` file swapped for a folder of its own.
    fs.rmSync(path.join(p.tree, '.git'));
    const planted = path.join(p.tree, '.git');
    await run('git', ['init', '-q', p.tree], { env: { GIT_DIR: planted } });
    fs.mkdirSync(path.join(planted, 'hooks'), { recursive: true });
    for (const hook of ['post-checkout', 'post-merge', 'reference-transaction', 'fsmonitor']) fs.writeFileSync(path.join(planted, 'hooks', hook), script, { mode: 0o755 });
    fs.appendFileSync(path.join(planted, 'config'), `[core]\n\tfsmonitor = ${path.join(planted, 'hooks', 'fsmonitor')}\n\thooksPath = ${path.join(planted, 'hooks')}\n`);
    await prepareFolder({ project: 'p', commit: s.second, main: false, source: s.url });
    assert.equal(fs.existsSync(proof), false);
    assert.equal(read(p, 'a.txt'), 'two\n');
    assert.ok(fs.statSync(path.join(p.tree, '.git')).isFile());
  });
});

test('a head check puts a real folder back where a test left a link, and the link\'s target is untouched', unix, async () => {
  await withHome(async () => {
    const s = await source();
    const first = await prepareFolder({ project: 'p', commit: s.first, main: false, source: s.url });
    const target = tempFolder('wh-swap-');
    fs.writeFileSync(path.join(target, 'keep.txt'), 'keep');
    for (const folder of [first.tree, first.home, first.mainHome]) {
      fs.rmSync(folder, { recursive: true });
      fs.symlinkSync(target, folder);
    }
    const next = await prepareFolder({ project: 'p', commit: s.first, main: false, source: s.url });
    for (const folder of [next.tree, next.home, next.mainHome]) assert.equal(fs.lstatSync(folder).isDirectory(), true);
    assert.deepEqual(fs.readdirSync(target), ['keep.txt']);
  });
});

test('a link a leftover job puts where the .git file goes is never written through', unix, async (t) => {
  await withHome(async () => {
    const s = await source();
    const first = await prepareFolder({ project: 'p', commit: s.first, main: false, source: s.url });
    const target = path.join(tempFolder('wh-race-'), 'keep.txt');
    fs.writeFileSync(target, 'keep');
    const mark = path.join(first.tree, '.git');
    const remove = fs.rmSync;
    t.mock.method(fs, 'rmSync', (file, options) => {
      remove(file, options);
      if (file === mark) fs.symlinkSync(target, mark);
    });
    await assert.rejects(prepareFolder({ project: 'p', commit: s.first, main: false, source: s.url }));
    assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
  });
});

test('a link left in the tree isn\'t followed out of it', unix, async () => {
  await withHome(async () => {
    const s = await source();
    const p = await prepareFolder({ project: 'p', commit: s.first, main: false, source: s.url });
    const outside = path.join(p.root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), 'keep');
    fs.symlinkSync(outside, path.join(p.tree, 'out'));
    await prepareFolder({ project: 'p', commit: s.second, main: true, source: s.url });
    assert.equal(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'keep');
  });
});
