// tests/scripts/health/own-files.test.js
// A look at Wheelhouse's and Copilot's own files (Task B3): a baseline of their hashes, the names of what changed, and
// the weekly check that makes a baseline afresh after setup and each update, and never reads a sign-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  ownFilesBaseline, ownFilesChanged, checkOwnFiles, ownFilesLine, readOwnFilesState, pluginFoldersInUse, recordUpdate, changedForProject, fileHash,
} from '../../../scripts/health/own-files.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { g } from '../../helpers/git-fixture.js';
import { as, tempFolder } from '../../helpers/homes.js';

// A person's home with Copilot's own folder, a plugin root, an engine with the clean home, and an add-on.
function layout() {
  const base = tempFolder('wh-own-');
  const home = path.join(base, 'user');
  const root = path.join(base, 'plugin');
  const engine = path.join(base, 'engine');
  const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
  const files = {
    hook: put(path.join(home, '.copilot', 'hooks', 'wheelhouse.json'), '{"hooks":1}\n'),
    agent: put(path.join(home, '.copilot', 'agents', 'lookout.md'), 'lookout\n'),
    settings: put(path.join(home, '.copilot', 'settings.json'), '{"a":1}\n'),
    signIn: put(path.join(home, '.copilot', 'config.json'), '{"token":"SECRET-SIGN-IN"}\n'),
    cleanHook: put(path.join(engine, 'copilot', 'home', 'hooks', 'wheelhouse.json'), '{"clean":1}\n'),
    cleanSettings: put(path.join(engine, 'copilot', 'home', 'settings.json'), '{"c":1}\n'),
    cleanSignIn: put(path.join(engine, 'copilot', 'home', 'config.json'), '{"token":"SECRET-CLEAN"}\n'),
    addon: put(path.join(home, '.vscode', 'extensions', 'wheelhouse.wheelhouse-0.2.0', 'extension.js'), 'addon\n'),
    script: put(path.join(root, 'scripts', 'x.js'), 'x\n'),
    manifest: put(path.join(root, '.claude-plugin', 'plugin.json'), '{"version":"0.2.0"}\n'),
    login: put(path.join(home, 'Library', 'LaunchAgents', 'dev.wheelhouse.helper.plist'), '<plist/>\n'),
    other: put(path.join(home, '.copilot', 'session-state', 'chat.json'), 'not ours\n'),
  };
  return { home, root, engine, files, loginFile: files.login, claudeHome: path.join(base, 'claude') };
}

test('a changed hook file is named, and so is one added or removed', () => {
  const l = layout();
  const before = ownFilesBaseline(l);
  assert.deepEqual(ownFilesChanged(before, ownFilesBaseline(l)), []);
  fs.writeFileSync(l.files.hook, '{"hooks":2}\n');
  assert.deepEqual(ownFilesChanged(before, ownFilesBaseline(l)), [l.files.hook]);
  fs.writeFileSync(path.join(l.home, '.copilot', 'hooks', 'extra.json'), '{}\n');
  fs.rmSync(l.files.agent);
  fs.writeFileSync(l.files.cleanSettings, '{"c":2}\n');
  fs.writeFileSync(l.files.addon, 'changed\n');
  assert.deepEqual(ownFilesChanged(before, ownFilesBaseline(l)).sort(), [l.files.hook, path.join(l.home, '.copilot', 'hooks', 'extra.json'), l.files.agent, l.files.cleanSettings, l.files.addon].sort());
});

test('what isn\'t Wheelhouse\'s or Copilot\'s own settings is not in the baseline', () => {
  const l = layout();
  const names = [...ownFilesBaseline(l).keys()];
  assert.ok(names.includes(l.files.script) && names.includes(l.files.login) && names.includes(l.files.cleanHook));
  assert.equal(names.includes(l.files.other), false, 'a chat\'s state');
});

test('the sign-in is never read', () => {
  const l = layout();
  const reads = [];
  const read = (file) => { reads.push(file); return fs.readFileSync(file); };
  const baseline = ownFilesBaseline({ ...l, read });
  assert.ok(reads.length > 0);
  for (const secret of [l.files.signIn, l.files.cleanSignIn]) {
    assert.equal(reads.includes(secret), false, `${secret} was read`);
    assert.equal(baseline.has(secret), false);
  }
  fs.writeFileSync(l.files.signIn, '{"token":"ROTATED"}\n');
  assert.deepEqual(ownFilesChanged(baseline, ownFilesBaseline(l)), [], 'a new sign-in is no change');
});

test('no baseline yet says nothing, and makes one', async () => {
  const l = layout();
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), async () => {
    const first = await checkOwnFiles({ ...l, now: () => new Date('2026-11-02T00:00:00.000Z') });
    assert.deepEqual(first.changed, []);
    assert.notEqual(readOwnFilesState(), null, 'a baseline is kept');
    fs.writeFileSync(l.files.hook, '{"hooks":2}\n');
    // Checked again within the day: the answer from the day is kept, so the board never waits on a walk of the files.
    assert.deepEqual((await checkOwnFiles({ ...l, now: () => new Date('2026-11-02T06:00:00.000Z') })).changed, []);
    assert.deepEqual((await checkOwnFiles({ ...l, now: () => new Date('2026-11-03T06:00:00.000Z') })).changed, [l.files.hook]);
    assert.deepEqual((await checkOwnFiles({ ...l, now: () => new Date('2026-11-05T06:00:00.000Z') })).changed, [l.files.hook], 'still named until the files are accepted');
  });
});

// --- Plugin folders in use, the skip list, and a moved version checked against its tag ---

const blob = (text) => crypto.createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
const release = (version) => ({
  '.claude-plugin/plugin.json': `{"version":"${version}"}\n`,
  'scripts/x.js': `x for ${version}\n`,
});
const treeOf = (files) => new Map(Object.entries(files).map(([rel, text]) => [rel, blob(text)]));
const day = (n) => () => new Date(Date.UTC(2026, 10, n, 3));

// A Claude folder whose installed_plugins.json lists the Wheelhouse installs given: { version, scope, project }.
function claudeWith(installs) {
  const base = tempFolder('wh-own-claude-');
  const claudeHome = path.join(base, 'claude');
  const folderOf = (version) => path.join(claudeHome, 'plugins', 'cache', 'wheelhouse', 'wheelhouse', version);
  const relist = (next) => {
    const list = next.map(({ version, scope, project }) => {
      const folder = folderOf(version);
      if (!fs.existsSync(folder)) {
        for (const [rel, text] of Object.entries(release(version))) {
          fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
          fs.writeFileSync(path.join(folder, rel), text);
        }
      }
      return { scope, ...(project ? { projectPath: project } : {}), installPath: folder, version };
    });
    fs.mkdirSync(path.join(claudeHome, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(claudeHome, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'wheelhouse@wheelhouse': list } }));
  };
  relist(installs);
  return { claudeHome, folderOf, relist };
}

// The look with nothing else to see: Copilot's and the add-on's places are empty folders in a fresh home.
const bare = () => {
  const base = tempFolder('wh-own-bare-');
  return { home: path.join(base, 'user'), engine: path.join(base, 'engine'), loginFile: null };
};

test('own-files: Claude Code\'s bookkeeping makes no line', async () => {
  const c = claudeWith([{ version: '0.2.6', scope: 'user' }]);
  const folder = c.folderOf('0.2.6');
  const where = { ...bare(), claudeHome: c.claudeHome, treeFor: async () => null };
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), async () => {
    fs.mkdirSync(path.join(folder, '.in_use'));
    fs.writeFileSync(path.join(folder, '.in_use', '111'), '');
    fs.writeFileSync(path.join(folder, '.orphaned_at'), '1700000000');
    assert.deepEqual((await checkOwnFiles({ ...where, now: day(2) })).changed, []);
    const kept = readOwnFilesState().folders[folder].files;
    assert.deepEqual(Object.keys(kept).filter((f) => /\.in_use|\.orphaned_at/.test(f)), [], 'neither is hashed');
    fs.writeFileSync(path.join(folder, '.in_use', '222'), '');
    fs.rmSync(path.join(folder, '.in_use', '111'));
    fs.writeFileSync(path.join(folder, '.orphaned_at'), '1700009999');
    assert.deepEqual((await checkOwnFiles({ ...where, now: day(4) })).changed, [], 'changed between two looks');
    // Only at the top, and only by those names.
    fs.mkdirSync(path.join(folder, 'scripts', '.in_use'));
    fs.writeFileSync(path.join(folder, 'scripts', '.in_use', '1'), 'deeper');
    assert.deepEqual((await checkOwnFiles({ ...where, now: day(6) })).changed, [path.join(folder, 'scripts', '.in_use', '1')]);
  });
});

test('own-files: the folders in use are listed, one entry each, for registered projects and the account', () => {
  const a = path.join(tempFolder('wh-own-pa-'), 'a');
  const b = path.join(tempFolder('wh-own-pb-'), 'b');
  const c = claudeWith([
    { version: '0.2.6', scope: 'project', project: a },
    { version: '0.2.7', scope: 'project', project: b },
    { version: '0.2.7', scope: 'user' },
    { version: '0.1.2', scope: 'project', project: '/not/registered' },
  ]);
  fs.mkdirSync(c.folderOf('0.0.9'), { recursive: true }); // left behind, no install lists it
  const found = pluginFoldersInUse({ claudeHome: c.claudeHome, projects: [a, b] });
  assert.deepEqual(found.map((f) => [path.basename(f.folder), f.version, f.projects]), [
    ['0.2.6', '0.2.6', [path.resolve(a)]],
    ['0.2.7', '0.2.7', [path.resolve(b)]],
  ]);
  assert.deepEqual(pluginFoldersInUse({ claudeHome: path.join(c.claudeHome, 'none') }), []);
});

test('own-files: two projects on 0.2.6 and 0.2.7 keep their own entries, and a project\'s line names only its own folder', async () => {
  const a = path.join(tempFolder('wh-own-pa-'), 'a');
  const b = path.join(tempFolder('wh-own-pb-'), 'b');
  const c = claudeWith([{ version: '0.2.6', scope: 'project', project: a }, { version: '0.2.7', scope: 'project', project: b }]);
  const where = { ...bare(), claudeHome: c.claudeHome, projects: [a, b], treeFor: async () => null };
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), async () => {
    await checkOwnFiles({ ...where, now: day(2) });
    assert.deepEqual(Object.values(readOwnFilesState().folders).map((f) => f.version).sort(), ['0.2.6', '0.2.7']);
    const touched = path.join(c.folderOf('0.2.7'), 'scripts', 'x.js');
    fs.writeFileSync(touched, 'tampered\n');
    const result = await checkOwnFiles({ ...where, now: day(4) });
    assert.deepEqual(result.changed, [touched]);
    assert.deepEqual(changedForProject(result, b), [touched]);
    assert.deepEqual(changedForProject(result, a), []);
    assert.match(ownFilesLine(changedForProject(result, b), { ...where, folders: result.folders.map((f) => f.folder) }), /Wheelhouse's own files/);
  });
});

test('own-files: a folder no install lists any more drops out', async () => {
  const c = claudeWith([{ version: '0.2.6', scope: 'user' }]);
  const where = { ...bare(), claudeHome: c.claudeHome, treeFor: async (tag) => treeOf(release(tag.slice(1))) };
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), async () => {
    await checkOwnFiles({ ...where, now: day(2) });
    assert.equal(Object.keys(readOwnFilesState().folders).length, 1);
    c.relist([{ version: '0.2.7', scope: 'user' }]);
    await checkOwnFiles({ ...where, now: day(3) });
    assert.deepEqual(Object.values(readOwnFilesState().folders).map((f) => f.version), ['0.2.7'], 'the old folder is gone from the record');
  });
});

test('own-files: a moved version that matches its tag is calm', async () => {
  const c = claudeWith([{ version: '0.2.6', scope: 'user' }]);
  const asked = [];
  const where = { ...bare(), claudeHome: c.claudeHome, treeFor: async (tag) => { asked.push(tag); return treeOf(release(tag.slice(1))); } };
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), async () => {
    await checkOwnFiles({ ...where, now: day(2) });
    c.relist([{ version: '0.2.7', scope: 'user' }]);
    const moved = await checkOwnFiles({ ...where, now: day(3) });
    assert.deepEqual(moved.changed, []);
    assert.equal(moved.calm, 'Wheelhouse moved to v0.2.7 outside the update command');
    assert.deepEqual(asked, ['v0.2.7']);
    assert.equal((await checkOwnFiles({ ...where, now: day(10) })).calm, undefined, 'said once');
  });
});

test('own-files: a moved version with an update record says it was approved', async () => {
  const c = claudeWith([{ version: '0.2.6', scope: 'user' }]);
  const where = { ...bare(), claudeHome: c.claudeHome, treeFor: async (tag) => treeOf(release(tag.slice(1))) };
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), async () => {
    await checkOwnFiles({ ...where, now: day(2) });
    recordUpdate({ from: 'v0.2.6', to: 'v0.2.7', at: '2026-11-04T03:00:00.000Z', answer: 'update', wrote: [] });
    c.relist([{ version: '0.2.7', scope: 'user' }]);
    const moved = await checkOwnFiles({ ...where, now: day(4) });
    assert.deepEqual(moved.changed, []);
    assert.equal(moved.calm, 'Wheelhouse was updated to v0.2.7 on 4 November 2026, approved by you');
    assert.equal(readOwnFilesState().updates.length, 1, 'the record is kept');
  });
});

test('own-files: one changed file in a moved version is a watch line', async () => {
  const c = claudeWith([{ version: '0.2.6', scope: 'user' }]);
  const where = { ...bare(), claudeHome: c.claudeHome, treeFor: async (tag) => treeOf(release(tag.slice(1))) };
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), async () => {
    await checkOwnFiles({ ...where, now: day(2) });
    c.relist([{ version: '0.2.7', scope: 'user' }]);
    const bad = path.join(c.folderOf('0.2.7'), 'scripts', 'x.js');
    fs.writeFileSync(bad, 'not the release\n');
    fs.writeFileSync(path.join(c.folderOf('0.2.7'), 'extra.js'), 'added\n');
    const moved = await checkOwnFiles({ ...where, now: day(3) });
    assert.deepEqual(moved.changed, [path.join(c.folderOf('0.2.7'), 'extra.js'), bad].sort());
    assert.equal(moved.calm, undefined);
    assert.match(ownFilesLine(moved.changed, { ...where, folders: moved.folders.map((f) => f.folder) }), /Wheelhouse's own files/);
    // Still named at the next look: nothing was accepted.
    assert.equal((await checkOwnFiles({ ...where, now: day(6) })).changed.length, 2);
  });
});

test('own-files: a file that is a link in a moved version is refused', async () => {
  const c = claudeWith([{ version: '0.2.6', scope: 'user' }]);
  const where = { ...bare(), claudeHome: c.claudeHome, treeFor: async (tag) => treeOf(release(tag.slice(1))) };
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), async () => {
    await checkOwnFiles({ ...where, now: day(2) });
    c.relist([{ version: '0.2.7', scope: 'user' }]);
    const target = path.join(c.folderOf('0.2.7'), 'scripts', 'x.js');
    const elsewhere = path.join(tempFolder('wh-own-elsewhere-'), 'x.js');
    fs.writeFileSync(elsewhere, release('0.2.7')['scripts/x.js']); // the same bytes, behind a link
    fs.rmSync(target);
    try { fs.symlinkSync(elsewhere, target); } catch { return; } // no links on this system
    assert.deepEqual((await checkOwnFiles({ ...where, now: day(3) })).changed, [target]);
  });
});

test('own-files: a version that cannot be checked is not accepted and not named, and is looked at again', async () => {
  const c = claudeWith([{ version: '0.2.6', scope: 'user' }]);
  let reachable = false;
  const where = { ...bare(), claudeHome: c.claudeHome, treeFor: async (tag) => (reachable ? treeOf(release(tag.slice(1))) : null) };
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), async () => {
    await checkOwnFiles({ ...where, now: day(2) });
    c.relist([{ version: '0.2.7', scope: 'user' }]);
    const first = await checkOwnFiles({ ...where, now: day(3) });
    assert.deepEqual(first.changed, []);
    assert.equal(first.calm, undefined);
    assert.deepEqual(readOwnFilesState().folders, {}, 'nothing accepted');
    reachable = true;
    assert.match((await checkOwnFiles({ ...where, now: day(4) })).calm, /moved to v0\.2\.7/);
  });
});

test('own-files: files the update wrote are accepted only at the recorded hashes', async () => {
  const l = layout();
  const where = { ...l, treeFor: async () => null };
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), async () => {
    await checkOwnFiles({ ...where, now: day(2) });
    fs.writeFileSync(l.files.hook, '{"hooks":"from the update"}\n');
    fs.writeFileSync(l.files.addon, 'addon from the update\n');
    recordUpdate({
      from: '0.2.0', to: '0.2.1', at: '2026-11-04T03:00:00.000Z', answer: 'update',
      wrote: [{ file: l.files.hook, hash: fileHash(l.files.hook) }, { file: l.files.addon, hash: fileHash(l.files.addon) }],
    });
    assert.deepEqual((await checkOwnFiles({ ...where, now: day(4) })).changed, [], 'the update\'s own writes');
    fs.writeFileSync(l.files.hook, '{"hooks":"edited later"}\n');
    assert.deepEqual((await checkOwnFiles({ ...where, now: day(6) })).changed, [l.files.hook], 'a later edit is named');
    // A change to a file the update did not write is named too.
    fs.writeFileSync(l.files.agent, 'other\n');
    assert.deepEqual((await checkOwnFiles({ ...where, now: day(8) })).changed.sort(), [l.files.agent, l.files.hook].sort());
  });
});

test('own-files: a file the update wrote, changed to something else before the look, is named', async () => {
  const l = layout();
  const where = { ...l, treeFor: async () => null };
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), async () => {
    await checkOwnFiles({ ...where, now: day(2) });
    recordUpdate({ from: '0.2.0', to: '0.2.1', at: '2026-11-04T03:00:00.000Z', answer: 'update', wrote: [{ file: l.files.hook, hash: fileHash(l.files.hook) }] });
    fs.writeFileSync(l.files.hook, '{"hooks":"someone else"}\n');
    assert.deepEqual((await checkOwnFiles({ ...where, now: day(4) })).changed, [l.files.hook]);
  });
});

test('own-files: an old flat own-files.json is read once and replaced, with no line', async () => {
  const l = layout();
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), async () => {
    const old = { version: '0.2.0', at: 'x', checkedAt: '2026-10-01T00:00:00.000Z', files: { [path.join(l.root, '.in_use', '1')]: 'abc' }, changed: [path.join(l.root, '.in_use', '1')] };
    const file = path.join(process.env.WHEELHOUSE_HOME, 'own-files.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(old));
    const first = await checkOwnFiles({ ...l, treeFor: async () => null, now: day(4) });
    assert.deepEqual(first.changed, []);
    assert.equal('files' in readOwnFilesState(), false);
    assert.equal(Object.keys(readOwnFilesState().folders).length, 1);
  });
});

test('own-files: the move is checked through the mirror, fetching the tag first, against a repository on this computer', async () => {
  const dir = tempFolder('wh-own-repo-');
  const repo = path.join(dir, 'wheelhouse');
  fs.mkdirSync(repo);
  await g(repo, 'init', '-q', '-b', 'main');
  for (const [rel, text] of Object.entries(release('0.2.7'))) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  }
  await g(repo, 'add', '-A');
  await g(repo, 'commit', '-q', '-m', 'v0.2.7');
  await g(repo, 'tag', 'v0.2.7');
  const c = claudeWith([{ version: '0.2.6', scope: 'user' }]);
  const where = { ...bare(), claudeHome: c.claudeHome, run: realRun, mirror: path.join(dir, 'mirror'), url: pathToFileURL(repo).href };
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), async () => {
    await checkOwnFiles({ ...where, now: day(2) });
    c.relist([{ version: '0.2.7', scope: 'user' }]);
    const moved = await checkOwnFiles({ ...where, now: day(3) });
    assert.deepEqual(moved.changed, []);
    assert.match(moved.calm, /moved to v0\.2\.7/);
    fs.writeFileSync(path.join(c.folderOf('0.2.7'), 'scripts', 'x.js'), 'changed\n');
    assert.equal((await checkOwnFiles({ ...where, now: day(5) })).changed.length, 1);
  });
});

test('the line names a change in plain words, and the board says nothing for none', () => {
  const l = layout();
  assert.equal(ownFilesLine([], l), null);
  const line = ownFilesLine([l.files.hook, l.files.cleanSettings, l.files.script], l);
  assert.match(line, /Copilot's guard files/);
  assert.match(line, /build engine's own Copilot folder/);
  assert.match(line, /Wheelhouse's own files/);
  assert.doesNotMatch(line, /\/user\//, 'no path from the person\'s computer');
});

test('the board shows the look, the key and the host approval lines when they apply, and none otherwise', async () => {
  const { healthLines } = await import('../../../scripts/board/health.js');
  const texts = (extra) => healthLines({ record: { connection: {} }, platform: 'linux', ...extra }).map((l) => l.text);
  const quiet = texts({});
  assert.equal(quiet.some((t) => /new signing key|have changed|own approval/.test(t)), false);
  const all = texts({ keyRenewal: { due: true, why: 'a period at Unattended has ended' }, ownFiles: { line: 'Some of the files that guard your project have changed' }, hostApproval: true });
  assert.ok(all.some((t) => /new signing key is due: a period at Unattended has ended/.test(t)));
  assert.ok(all.some((t) => /have changed/.test(t)));
  assert.ok(all.some((t) => /own approval on GitHub/.test(t)));
});
