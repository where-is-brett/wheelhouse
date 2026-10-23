// tests/scripts/windows/guarded-links.test.js
// Guarded on Copilot (design section 6.4): before and after each build command the runner removes
// the links in the worktree that lead out of it, and its self-test also tries a write to
// `.github/hooks/x.json` and a write through a link out of the scratch folder, both of which must be
// refused. These tests run on every system, Windows included: folder links are made as junctions,
// which need no privilege there. Only the self-test's refusals, stood in for by file modes, need a
// Unix-like system, and that test is skipped elsewhere; Windows' own labels are tried in sitting S2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { tempFolder } from '../../helpers/homes.js';
import {
  guarded, removeLinksOut, insideFolder, samePath, labelledWorktree, linkOutHeld, LINK_REMOVED, linksUnchecked, LINK_WALK_LIMIT, EXIT, KEPT_NORMAL,
} from '../../../scripts/windows/guarded.js';

const unix = process.platform !== 'win32';
const modesHold = unix && process.getuid?.() !== 0;

// What `whoami /groups` prints for a low token, as far as the runner reads it.
const LOW = 'Mandatory Label\\Low Mandatory Level Label            S-1-16-4096\r\n';
const WIN_ENV = { PATH: '/bin', SystemRoot: 'C:\\Windows' };

// A worktree with its .git file, and a folder outside it.
function places() {
  const worktree = fs.realpathSync(tempFolder('wh-links-wt-'));
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: elsewhere\n');
  const outside = fs.realpathSync(tempFolder('wh-links-out-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside\n');
  return { worktree, outside };
}

// A folder link (a junction on Windows) at `at`, leading to `target`.
const folderLink = (target, at) => fs.symlinkSync(target, at, 'junction');

test('a link out is removed and named', async () => {
  const { worktree, outside } = places();
  fs.mkdirSync(path.join(worktree, 'src', 'deep'), { recursive: true });
  folderLink(outside, path.join(worktree, 'out'));
  folderLink(outside, path.join(worktree, 'src', 'deep', 'out'));
  // A dangling link is removed too: where it leads can't be known to be inside.
  const gone = path.join(outside, 'gone');
  fs.mkdirSync(gone);
  folderLink(gone, path.join(worktree, 'dangling'));
  fs.rmdirSync(gone);
  const removed = removeLinksOut(worktree).sort();
  assert.deepEqual(removed, [path.join(worktree, 'dangling'), path.join(worktree, 'out'), path.join(worktree, 'src', 'deep', 'out')].sort());
  for (const p of removed) assert.equal(fs.lstatSync(p, { throwIfNoEntry: false }), undefined, `${p} is gone`);
  // Never followed: what the link led to is untouched.
  assert.deepEqual(fs.readdirSync(outside), ['secret.txt']);
  assert.equal(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'outside\n');
  assert.ok(fs.statSync(path.join(worktree, 'src', 'deep')).isDirectory());
  assert.deepEqual(removeLinksOut(worktree), [], 'nothing left to remove');

  if (unix) {
    // A file link out, and a link to the folder above the worktree, are links out too.
    folderLink(path.dirname(worktree), path.join(worktree, 'up'));
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(worktree, 'src', 'secret.txt'));
    assert.deepEqual(removeLinksOut(worktree).sort(), [path.join(worktree, 'src', 'secret.txt'), path.join(worktree, 'up')].sort());
  }

  // The runner removes them before the command starts (what a run ended part-way left) and after
  // it ends (what the command made), and names each on the session's stderr.
  const leftOver = path.join(worktree, 'left-by-a-run-ended-part-way');
  const made = path.join(worktree, 'made-by-the-build');
  folderLink(outside, leftOver);
  const said = [];
  let goneAtStart = null;
  const start = () => {
    goneAtStart = fs.lstatSync(leftOver, { throwIfNoEntry: false }) === undefined;
    folderLink(outside, made);
    const child = new EventEmitter();
    child.pid = 4100;
    setImmediate(() => child.emit('exit', 0, null));
    return child;
  };
  const run = async () => ({ code: 0, stdout: LOW, stderr: '' });
  const code = await guarded(['npm', 'test'], { run, start, cwd: path.join(worktree, 'src'), env: WIN_ENV, platform: 'darwin', say: (line) => said.push(line) });
  assert.equal(code, 0, 'the command\'s own code');
  assert.equal(goneAtStart, true, 'removed before the command started');
  assert.deepEqual(said, [`${LINK_REMOVED} \`${leftOver}\``, `${LINK_REMOVED} \`${made}\``]);
  assert.equal(fs.lstatSync(made, { throwIfNoEntry: false }), undefined);
  assert.equal(LINK_REMOVED, 'Removed a link that led out of the worktree:');
});

// A linked worktree as git makes one: its .git file points to an admin folder in the project's
// .git/worktrees, whose gitdir file points back at it.
function linkedWorktree() {
  const root = fs.realpathSync(tempFolder('wh-links-project-'));
  const admin = path.join(root, 'project', '.git', 'worktrees', 'feature');
  fs.mkdirSync(admin, { recursive: true });
  const worktree = path.join(root, 'project', '.claude', 'worktrees', 'feature');
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${admin}\n`);
  fs.writeFileSync(path.join(admin, 'gitdir'), `${path.join(worktree, '.git')}\n`);
  const outside = fs.realpathSync(tempFolder('wh-links-out-'));
  return { worktree, admin, outside };
}

test('the sweep covers the labelled worktree, whatever .git a build plants below it', async () => {
  const { worktree, admin, outside } = linkedWorktree();
  // A .git file pointing at the worktree's own admin folder, a submodule's, and one with an admin
  // folder of its own, made in the worktree, which points back at it.
  const planted = path.join(worktree, 'packages', 'x');
  const submodule = path.join(worktree, 'vendor', 'lib');
  const forged = path.join(worktree, 'packages', 'y');
  for (const dir of [planted, submodule, forged]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(planted, '.git'), `gitdir: ${admin}\n`);
  fs.writeFileSync(path.join(submodule, '.git'), `gitdir: ${path.join(path.dirname(path.dirname(admin)), 'modules', 'lib')}\n`);
  const forgedAdmin = path.join(forged, 'admin', 'worktrees', 'y');
  fs.mkdirSync(forgedAdmin, { recursive: true });
  fs.writeFileSync(path.join(forged, '.git'), `gitdir: ${forgedAdmin}\n`);
  fs.writeFileSync(path.join(forgedAdmin, 'gitdir'), `${path.join(forged, '.git')}\n`);
  for (const dir of [worktree, planted, submodule, forged, path.join(worktree, 'packages')]) assert.equal(labelledWorktree(dir), worktree, dir);

  // A run from below a planted .git still removes a link out at the worktree's top.
  folderLink(outside, path.join(worktree, 'out'));
  const said = [];
  const start = () => {
    const child = new EventEmitter();
    child.pid = 4100;
    setImmediate(() => child.emit('exit', 0, null));
    return child;
  };
  const run = async () => ({ code: 0, stdout: LOW, stderr: '' });
  assert.equal(await guarded(['npm', 'test'], { run, start, cwd: planted, env: WIN_ENV, platform: 'darwin', say: (line) => said.push(line) }), 0);
  assert.deepEqual(said, [`${LINK_REMOVED} \`${path.join(worktree, 'out')}\``]);
  // The planted .git files are walked like anything else; only the top's own .git is skipped.
  assert.ok(fs.existsSync(path.join(planted, '.git')));

  // Outside a linked worktree: the nearest folder holding a .git, or the folder itself.
  const plain = fs.realpathSync(tempFolder('wh-links-plain-'));
  fs.mkdirSync(path.join(plain, 'a', 'b'), { recursive: true });
  assert.equal(labelledWorktree(path.join(plain, 'a', 'b')), path.join(plain, 'a', 'b'));
  fs.writeFileSync(path.join(plain, 'a', '.git'), 'gitdir: elsewhere\n');
  assert.equal(labelledWorktree(path.join(plain, 'a', 'b')), path.join(plain, 'a'));
});

test('a folder whose real path isn\'t where it stands is a link: removed if it leads out, never walked', () => {
  const { worktree, outside } = places();
  // Stand-ins for a junction to a volume's path, which lstat shows as a plain folder on Windows.
  const out = path.join(worktree, 'volume-out');
  const inside = path.join(worktree, 'volume-in');
  fs.mkdirSync(out);
  fs.mkdirSync(path.join(inside, 'deeper'), { recursive: true });
  folderLink(outside, path.join(inside, 'deeper', 'out'));
  const realpath = (p) => {
    if (p === out) return outside;
    if (p === inside) return path.join(worktree, 'elsewhere-inside');
    return fs.realpathSync.native(p);
  };
  assert.deepEqual(removeLinksOut(worktree, { realpath }), [out]);
  assert.equal(fs.lstatSync(out, { throwIfNoEntry: false }), undefined, 'removed');
  assert.deepEqual(fs.readdirSync(outside), ['secret.txt'], 'never walked into');
  // One that leads inside the worktree stays, and isn't walked: the link below it is left to the
  // tool guard's real-path check.
  assert.ok(fs.lstatSync(path.join(inside, 'deeper', 'out')).isSymbolicLink());
  // A folder whose real path can't be found isn't walked either.
  const unknown = path.join(worktree, 'unknown');
  fs.mkdirSync(path.join(unknown, 'full'), { recursive: true });
  assert.deepEqual(removeLinksOut(worktree, { realpath: (p) => { if (p === unknown) throw new Error('no'); return realpath(p); } }), []);
  assert.ok(fs.existsSync(path.join(unknown, 'full')), 'a folder with something in it is never removed');

  assert.equal(samePath('C:\\Work\\WT', 'c:\\work\\wt', 'win32'), true);
  assert.equal(samePath('/work/WT', '/work/wt', 'linux'), false);
});

test('past its limit the sweep stops, and the runner refuses plainly', async () => {
  const { worktree, outside } = places();
  for (const name of ['a', 'b', 'c', 'd']) fs.mkdirSync(path.join(worktree, name));
  folderLink(outside, path.join(worktree, 'e'));
  assert.throws(() => removeLinksOut(worktree, { limit: 3 }), (error) => error.message === linksUnchecked(3) && Array.isArray(error.removed));
  assert.equal(removeLinksOut(worktree, { limit: 5 }).length, 1, 'within the limit');
  assert.match(linksUnchecked(), new RegExp(`after ${LINK_WALK_LIMIT} entries`));

  // The runner, given a worktree past its limit, runs nothing and says why; one that meets the
  // limit only after the command ends gives the refusal's code, not the command's.
  const started = [];
  const said = [];
  const start = () => {
    started.push(true);
    for (const name of ['f', 'g']) fs.mkdirSync(path.join(worktree, name));
    const child = new EventEmitter();
    child.pid = 4100;
    setImmediate(() => child.emit('exit', 0, null));
    return child;
  };
  const run = async () => ({ code: 0, stdout: LOW, stderr: '' });
  const go = (linkLimit) => guarded(['npm', 'test'], { run, start, cwd: worktree, env: WIN_ENV, platform: 'darwin', linkLimit, say: (line) => said.push(line) });
  assert.equal(await go(3), EXIT.linksUnchecked);
  assert.deepEqual(started, []);
  assert.deepEqual(said, [linksUnchecked(3)]);
  said.length = 0;
  folderLink(outside, path.join(worktree, 'e'));
  // Within the limit before (a b c d e, and .wheelhouse made after the sweep), past it after (f g).
  assert.equal(await go(6), EXIT.linksUnchecked);
  assert.equal(started.length, 1);
  assert.deepEqual(said, [`${LINK_REMOVED} \`${path.join(worktree, 'e')}\``, linksUnchecked(6)]);
});

test('a link within the worktree stays', () => {
  const { worktree, outside } = places();
  fs.mkdirSync(path.join(worktree, 'lib', 'inner'), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'lib', 'inner', 'a.js'), 'a\n');
  folderLink(path.join(worktree, 'lib'), path.join(worktree, 'lib-link'));
  folderLink(worktree, path.join(worktree, 'lib', 'top'));
  if (unix) fs.symlinkSync(path.join('..', 'lib', 'inner', 'a.js'), path.join(worktree, 'lib', 'a-link.js'));
  // A link inside a linked folder is never reached through the link: it is walked once, where it is.
  folderLink(outside, path.join(worktree, 'lib', 'inner', 'out'));
  assert.deepEqual(removeLinksOut(worktree), [path.join(worktree, 'lib', 'inner', 'out')]);
  assert.ok(fs.lstatSync(path.join(worktree, 'lib-link')).isSymbolicLink());
  assert.ok(fs.lstatSync(path.join(worktree, 'lib', 'top')).isSymbolicLink());
  if (unix) assert.ok(fs.lstatSync(path.join(worktree, 'lib', 'a-link.js')).isSymbolicLink());

  // The worktree's own .git file is skipped, whatever it is.
  const linked = places();
  fs.rmSync(path.join(linked.worktree, '.git'));
  folderLink(linked.outside, path.join(linked.worktree, '.git'));
  assert.deepEqual(removeLinksOut(linked.worktree), []);
  assert.ok(fs.lstatSync(path.join(linked.worktree, '.git')).isSymbolicLink());

  // A worktree that can't be read, or isn't there, gives nothing.
  assert.deepEqual(removeLinksOut(path.join(worktree, 'not-there')), []);
});

test('inside the worktree is decided by the real path, ignoring case on Windows', () => {
  assert.equal(insideFolder('C:\\Work\\wt', 'c:\\work\\WT\\src', 'win32'), true);
  assert.equal(insideFolder('C:\\Work\\wt', 'C:\\Work\\wt', 'win32'), true);
  assert.equal(insideFolder('C:\\Work\\wt', 'C:\\Work\\wt-other\\x', 'win32'), false);
  assert.equal(insideFolder('C:\\Work\\wt', 'C:\\Users\\a\\.wheelhouse', 'win32'), false);
  assert.equal(insideFolder('/work/wt', '/work/wt/src', 'darwin'), true);
  assert.equal(insideFolder('/work/wt', '/work/WT/src', 'linux'), false);
  assert.equal(insideFolder('/work/wt', '/work/wt2', 'linux'), false);
  assert.equal(insideFolder('/work/wt', '/work', 'linux'), false);
});

// A scratch folder as the self-test labels one: each entry kept at the normal level, and
// .github/hooks in it.
function scratchFolder() {
  const scratch = fs.realpathSync(tempFolder('wh-links-scratch-'));
  for (const name of KEPT_NORMAL.folders) fs.mkdirSync(path.join(scratch, name));
  for (const name of KEPT_NORMAL.files) fs.writeFileSync(path.join(scratch, name), 'kept\n');
  fs.mkdirSync(path.join(scratch, '.github', 'hooks'));
  return scratch;
}

// The file modes standing in for Windows' labels: the scratch folder and each kept entry in it
// can't be changed, nor can .github/hooks unless `hooksOpen`.
function lockScratch(scratch, { hooksOpen = false } = {}) {
  fs.chmodSync(path.join(scratch, '.github', 'hooks'), hooksOpen ? 0o700 : 0o500);
  for (const name of fs.readdirSync(scratch)) {
    const entry = path.join(scratch, name);
    fs.chmodSync(entry, fs.lstatSync(entry).isDirectory() ? 0o500 : 0o400);
  }
  fs.chmodSync(scratch, 0o500);
}

function openScratch(scratch) {
  fs.chmodSync(scratch, 0o700);
  for (const name of fs.readdirSync(scratch)) {
    const entry = path.join(scratch, name);
    fs.chmodSync(entry, fs.lstatSync(entry).isDirectory() ? 0o700 : 0o600);
  }
  fs.chmodSync(path.join(scratch, '.github', 'hooks'), 0o700);
}

test('.github is kept at the normal level, for both agents', () => {
  assert.ok(KEPT_NORMAL.folders.includes('.github'));
});

test('the self-test fails if a control file can be written', { skip: !modesHold && 'file modes stand in for Windows\' labels only on Unix-like systems, not as root' }, async () => {
  const home = fs.realpathSync(tempFolder('wh-links-home-'));
  const marker = path.join(home, 'keys', 'marker.txt');
  fs.mkdirSync(path.dirname(marker));
  fs.writeFileSync(marker, 'marker\n');
  const run = async () => ({ code: 0, stdout: LOW, stderr: '' });
  const selfTest = async (scratch) => {
    const lines = [];
    assert.equal(await guarded(['--self-test', home, marker, scratch], { run, env: WIN_ENV, platform: 'darwin', say: () => {}, out: (l) => lines.push(l) }), 0);
    return JSON.parse(lines.at(-1));
  };
  const held = scratchFolder();
  const hooksOpen = scratchFolder();
  const linkOpen = scratchFolder();
  fs.chmodSync(marker, 0o000);
  fs.chmodSync(home, 0o500);
  try {
    // Everything refused: held.
    lockScratch(held);
    assert.deepEqual(await selfTest(held), { low: true, writeHeld: true, readHeld: true, keptHeld: true });

    // .github/hooks/x.json written: the kept entries don't hold.
    lockScratch(hooksOpen, { hooksOpen: true });
    assert.deepEqual(await selfTest(hooksOpen), { low: true, writeHeld: true, readHeld: true, keptHeld: false });
    assert.ok(fs.existsSync(path.join(hooksOpen, '.github', 'hooks', 'x.json')), 'the write got through');

    // A link out of the scratch folder, made where the scratch folder lets it be made: the write
    // is held while the home refuses the write through it. (The kept entries don't hold here, as
    // the open scratch folder lets them be renamed away.)
    lockScratch(linkOpen);
    fs.chmodSync(linkOpen, 0o700);
    assert.deepEqual(await selfTest(linkOpen), { low: true, writeHeld: true, readHeld: true, keptHeld: false });
    assert.ok(!fs.readdirSync(linkOpen).some((n) => n.startsWith('link-out-from-low')), 'the link is removed');

    // The link try on its own: refused where the link can't be made, or the write through it is
    // refused; let through where the folder it leads to can be written.
    const open = fs.realpathSync(tempFolder('wh-links-open-'));
    assert.equal(linkOutHeld(held, open), true, 'the link can\'t be made');
    assert.equal(linkOutHeld(linkOpen, home), true, 'the write through it is refused');
    assert.equal(linkOutHeld(linkOpen, open), false, 'the write through it got through');
    assert.deepEqual(fs.readdirSync(open), [], 'what got through is removed');
    assert.ok(!fs.readdirSync(linkOpen).some((n) => n.startsWith('link-out-from-low')), 'the link is removed');
    // A failure other than a refusal isn't held.
    assert.equal(linkOutHeld(linkOpen, path.join(open, 'not-there')), false);
  } finally {
    fs.chmodSync(home, 0o700);
    fs.chmodSync(marker, 0o600);
    for (const folder of [held, hooksOpen, linkOpen]) openScratch(folder);
  }
});
