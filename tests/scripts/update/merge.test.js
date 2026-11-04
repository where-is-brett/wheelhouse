// tests/scripts/update/merge.test.js
// The update merges its own change (update design, section 21): the check made right before the merge, the folder taking the
// change beside the director's own uncommitted work (real git, in folders of the test's own), and the `merged` step asking
// the helper in the same run. The host, the helper and the director's click are stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MISMATCH_LINE, decideMerge, exactChange, releasePushRefusal } from '../../../scripts/update/merge.js';
import { changeSteps } from '../../../scripts/update/change.js';
import { openJournal } from '../../../scripts/update/journal.js';
import { runJob } from '../../../scripts/update/job.js';
import { gitRoute } from '../../../scripts/host/local/home.js';
import { bringFolderUpBesideOwn, folderTakes } from '../../../scripts/host/local/folder.js';
import { SETTINGS_FILE, releaseBranch, releaseChange, settingsText, undoBranch } from '../../../scripts/lineage/release.js';
import { projectSettings } from '../../../scripts/protection/settings.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';

const NEW = 'c'.repeat(40);
const OLD = 'd'.repeat(40);
const settingsAt = (ref) => projectSettings(readConfig(null), { release: { ref } });
const baseText = settingsText(settingsAt('v0.2.6'));
const goodHead = settingsText(releaseChange(settingsAt('v0.2.6'), { ref: 'v0.2.7', sha: NEW }));
const sides = (over = {}) => ({ base: baseText, head: goodHead, headMode: '100644', ...over });

// Everything decideMerge reads, as it is for the update's own change, and changed one thing at a time.
const world = (over = {}) => ({
  stored: { plan: { from: 'v0.2.6', to: 'v0.2.7', sha: NEW, put: 'release' } },
  clicked: true,
  journal: { steps: { checks: { state: 'done', data: { tag: 'v0.2.7', sha: NEW, from: 'v0.2.6' } }, change: { state: 'done', data: { pr: 12 } } } },
  number: 12,
  put: 'release',
  release: 'v0.2.7',
  commit: NEW,
  pr: { state: 'open', headRef: releaseBranch(NEW), baseRef: 'main' },
  defaultBranch: 'main',
  changes: { paths: [SETTINGS_FILE], files: { [SETTINGS_FILE]: sides() }, shape: { parents: ['e'.repeat(40)], onMain: true } },
  update: { matched: true, ok: true, release: 'v0.2.7', commit: NEW, approved: true },
  pinsOnly: false,
  ...over,
});

test('the update\'s own edit of the settings file, and nothing else, is the change that may be merged', () => {
  assert.deepEqual(decideMerge(world()), { ok: true });
  assert.deepEqual(decideMerge(world({ pinsOnly: true, update: { matched: true, ok: true, release: 'v0.2.7', commit: NEW, approved: true } })), { ok: true });
  assert.deepEqual(exactChange({ paths: [SETTINGS_FILE], sides: sides(), release: 'v0.2.7', commit: NEW }), { ok: true });
});

test('a change that differs from the update\'s edit in any way is a mismatch that merges nothing', () => {
  const refused = (over, why) => {
    const got = decideMerge(world(over));
    assert.equal(got.ok, false);
    assert.equal(got.kind, 'mismatch');
    if (why) assert.match(got.why, why);
  };
  // An extra file beside the settings.
  refused({ changes: { paths: [SETTINGS_FILE, 'package.json'], files: { [SETTINGS_FILE]: sides() } } }, /more than/);
  refused({ changes: { paths: ['package.json'], files: { [SETTINGS_FILE]: sides() } } }, /more than/);
  // Another line changed in the settings file as well as the ref.
  const extra = JSON.parse(goodHead);
  extra.permissions = { allow: ['Bash(*)'] };
  refused({ changes: { paths: [SETTINGS_FILE], files: { [SETTINGS_FILE]: sides({ head: settingsText(extra) }) } } }, /more than|differs/);
  // The ref is not the tag the update is for.
  const wrong = settingsText(releaseChange(settingsAt('v0.2.6'), { ref: 'v0.2.9', sha: NEW }));
  refused({ changes: { paths: [SETTINGS_FILE], files: { [SETTINGS_FILE]: sides({ head: wrong }) } } }, /more than/);
  // Only the spelling of the file differs: not the text the update writes.
  refused({ changes: { paths: [SETTINGS_FILE], files: { [SETTINGS_FILE]: sides({ head: JSON.stringify(JSON.parse(goodHead)) }) } } }, /differs/);
  // The file is not a plain file.
  refused({ changes: { paths: [SETTINGS_FILE], files: { [SETTINGS_FILE]: sides({ headMode: '120000' }) } } }, /plain file/);
  // The branch names another commit, or is the undo's when a release is asked for.
  refused({ pr: { state: 'open', headRef: releaseBranch(OLD), baseRef: 'main' } }, /branch/);
  refused({ pr: { state: 'open', headRef: undoBranch(NEW), baseRef: 'main' } }, /branch/);
  // Not aimed at the main version, or no longer open.
  refused({ pr: { state: 'open', headRef: releaseBranch(NEW), baseRef: 'other' } }, /main version/);
  refused({ pr: { state: 'merged', headRef: releaseBranch(NEW), baseRef: 'main' } }, /not open/);
  // The tag the checks step recorded is another commit; or the plan on record is another release.
  refused({ journal: { steps: { checks: { state: 'done', data: { tag: 'v0.2.7', sha: OLD } }, change: { state: 'done', data: { pr: 12 } } } } }, /checked/);
  refused({ stored: { plan: { to: 'v0.2.8', sha: NEW, put: 'release' } } }, /card showed/);
  refused({ release: 'v0.2.8' }, /card showed/);
  // A criss-cross: the head merges something else in (two parents), or sits on commits that are not on the main version.
  const shaped = (shape) => ({ changes: { paths: [SETTINGS_FILE], files: { [SETTINGS_FILE]: sides() }, shape } });
  refused(shaped({ parents: ['e'.repeat(40), 'f'.repeat(40)], onMain: false }), /one commit directly/);
  refused(shaped({ parents: ['e'.repeat(40)], onMain: false }), /one commit directly/);
  refused({ changes: { paths: [SETTINGS_FILE], files: { [SETTINGS_FILE]: sides() } } }, /one commit directly/);
  // The project's settings name another release than the one the update moves from.
  refused({ journal: { steps: { checks: { state: 'done', data: { tag: 'v0.2.7', sha: NEW, from: 'v0.2.0' } }, change: { state: 'done', data: { pr: 12 } } } } }, /another release/);
  // Another change than the one the update opened.
  refused({ number: 13 }, /opened/);
  // Wheelhouse's repository does not have the tag at that commit, or the state does not record the change as the update's.
  refused({ update: { matched: true, ok: false, why: 'the tag is not at the commit the pull request names' } }, /tag is not at the commit/);
  refused({ update: { matched: false } }, /update's own change/);
  refused({ commit: 'abc' });
});

test('an undo is merged only from the undo branch, for the earlier release the plan names', () => {
  const undo = world({
    stored: { plan: { from: 'v0.2.7', to: 'v0.2.6', sha: OLD, put: 'undo' } },
    journal: { steps: { checks: { state: 'done', data: { tag: 'v0.2.6', sha: OLD, from: 'v0.2.7' } }, change: { state: 'done', data: { pr: 12 } } } },
    put: 'undo',
    release: 'v0.2.6',
    commit: OLD,
    pr: { state: 'open', headRef: undoBranch(OLD), baseRef: 'main' },
    changes: { shape: { parents: ['e'.repeat(40)], onMain: true }, paths: [SETTINGS_FILE], files: { [SETTINGS_FILE]: { base: settingsText(settingsAt('v0.2.7')), head: settingsText(releaseChange(settingsAt('v0.2.7'), { ref: 'v0.2.6', sha: OLD })), headMode: '100644' } } },
    update: { matched: true, ok: true, release: 'v0.2.6', commit: OLD, approved: true },
  });
  assert.deepEqual(decideMerge(undo), { ok: true });
  assert.equal(decideMerge({ ...undo, pr: { state: 'open', headRef: releaseBranch(OLD), baseRef: 'main' } }).kind, 'mismatch');
  assert.equal(decideMerge({ ...undo, put: 'release' }).kind, 'mismatch');
});

test('without the director\'s signed click, or the signed card answer a release needs, nothing is merged', () => {
  // An agent that asks for the merge by itself has neither.
  const noClick = decideMerge(world({ clicked: false }));
  assert.deepEqual([noClick.ok, noClick.kind], [false, 'held']);
  const noCard = decideMerge(world({ update: { matched: true, ok: true, release: 'v0.2.7', commit: NEW, approved: false } }));
  assert.deepEqual([noCard.ok, noCard.kind], [false, 'held']);
  assert.match(noCard.why, /approval/);
  // A forged plan on record, for another release, is not the click's.
  assert.equal(decideMerge(world({ stored: null })).kind, 'mismatch');
  // A pins-only release needs the click and no card.
  assert.equal(decideMerge(world({ pinsOnly: true, update: { matched: true, ok: true, release: 'v0.2.7', commit: NEW, approved: false } })).ok, true);
  assert.equal(decideMerge(world({ pinsOnly: true, clicked: false })).ok, false);
});

// --- the folder, with real git ---

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// A project folder on main with the settings file and an ordinary one, and a stand-in home that is a bare copy of it, holding the
// update's change on its own branch.
function localProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-merge-'));
  const folder = path.join(root, 'folder');
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  git(folder, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(folder, SETTINGS_FILE), baseText);
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'one\n');
  git(folder, 'add', '-A');
  git(folder, 'commit', '-q', '-m', 'start');
  const home = path.join(root, 'home.git');
  git(root, 'clone', '-q', '--bare', folder, home);
  const maker = path.join(root, 'maker');
  git(root, 'clone', '-q', home, maker);
  git(maker, 'checkout', '-q', '-b', releaseBranch(NEW));
  fs.writeFileSync(path.join(maker, SETTINGS_FILE), goodHead);
  git(maker, 'commit', '-q', '-am', 'Move this project to Wheelhouse v0.2.7');
  git(maker, 'push', '-q', 'origin', releaseBranch(NEW));
  // What the helper's merge does on the home: the main version moves to the change.
  const mergeOnHome = () => git(home, 'update-ref', 'refs/heads/main', git(home, 'rev-parse', `refs/heads/${releaseBranch(NEW)}`));
  const take = (over = {}) => bringFolderUpBesideOwn({ project: 'p', folder, branch: 'main', file: SETTINGS_FILE, from: { dir: home, remote: 'wheelhouse' }, ...over });
  return { root, folder, home, mergeOnHome, take, tidy: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const settingsOf = (folder) => fs.readFileSync(path.join(folder, SETTINGS_FILE), 'utf8');

test('the folder takes the change, and the director\'s other uncommitted files stay as they are', async () => {
  const p = localProject();
  try {
    fs.writeFileSync(path.join(p.folder, 'notes.txt'), 'one\nmine, not committed\n');
    fs.writeFileSync(path.join(p.folder, 'scratch.txt'), 'untracked\n');
    fs.writeFileSync(path.join(p.folder, 'staged.txt'), 'staged\n');
    git(p.folder, 'add', 'staged.txt');
    p.mergeOnHome();
    assert.equal(await folderTakes({ folder: p.folder, branch: 'main', file: SETTINGS_FILE }), null);
    assert.deepEqual(await p.take(), { moved: true });
    assert.equal(settingsOf(p.folder), goodHead);
    assert.equal(fs.readFileSync(path.join(p.folder, 'notes.txt'), 'utf8'), 'one\nmine, not committed\n');
    assert.equal(fs.readFileSync(path.join(p.folder, 'scratch.txt'), 'utf8'), 'untracked\n');
    assert.equal(git(p.folder, 'status', '--porcelain'), 'M notes.txt\nA  staged.txt\n?? scratch.txt');
    // Taken once: a second look finds nothing to do.
    assert.equal((await p.take()).moved, false);
  } finally { p.tidy(); }
});

test('a settings file with a change of the director\'s own is refused, whatever the change is, and left as it is', async () => {
  const p = localProject();
  try {
    p.mergeOnHome();
    for (const mine of [(f) => fs.appendFileSync(f, ' '), (f) => { fs.appendFileSync(f, ' '); git(p.folder, 'add', SETTINGS_FILE); }]) {
      mine(path.join(p.folder, SETTINGS_FILE));
      const before = settingsOf(p.folder);
      assert.match(await folderTakes({ folder: p.folder, branch: 'main', file: SETTINGS_FILE }), /changes of its own to the project's Wheelhouse settings/);
      assert.match((await p.take()).line, /settings/);
      assert.equal(settingsOf(p.folder), before);
      git(p.folder, 'reset', '-q', '--hard', 'HEAD');
    }
    // A folder on another branch is not moved either.
    git(p.folder, 'checkout', '-q', '-b', 'mine');
    assert.match((await p.take()).line, /another branch/);
    assert.equal(git(p.folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'mine');
    assert.equal(settingsOf(p.folder), baseText);
  } finally { p.tidy(); }
});

// --- the merged step ---

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-merge-home-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  return Promise.resolve(fn(home)).finally(() => {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  });
}

const target = { tag: 'v0.2.7', sha: NEW };
const opened = async () => ({ ok: true, number: 12 });
const releaseFile = (kind) => async () => ({ code: 0, stdout: JSON.stringify({ kind, lineage: 'passed' }), stderr: '' });

// The steps over a real local project: the helper's merge is a stand-in that moves the home's main version, then the folder.
function steps(p, { kind = 'changes', merge, approved = () => true, prState = async () => ({ state: 'open' }) } = {}) {
  return changeSteps({
    projectDir: p.folder, target, previous: { ref: 'v0.2.6', sha: OLD }, open: opened, raise: async () => {}, run: releaseFile(kind),
    prState, merge, approved, stopped: () => false, features: () => ({}),
  });
}
const helperMerge = (p, calls = []) => async (args) => {
  calls.push(args);
  const why = await folderTakes({ folder: p.folder, branch: 'main', file: SETTINGS_FILE });
  if (why !== null) return { ok: false, kind: 'held', refused: why };
  p.mergeOnHome();
  const up = await p.take();
  return up.line === undefined ? { ok: true, merged: true } : { ok: true, merged: true, folderLine: up.line };
};

test('an approved change is merged in the same run, and the update goes on to the end', () => withHome(async () => {
  const p = localProject();
  try {
    const calls = [];
    const out = await runJob({ project: 'p', target: target.tag, steps: steps(p, { merge: helperMerge(p, calls) }), journal: openJournal('p') });
    assert.equal(out.ok, true, out.line);
    assert.deepEqual(calls, [{ pr: 12 }]);
    assert.equal(settingsOf(p.folder), goodHead);
    const journal = openJournal('p').read();
    assert.deepEqual(journal.steps.merged.data, { merged: true, approved: true });
    assert.equal(journal.steps.idle.state, 'done');
  } finally { p.tidy(); }
}));

test('a pins-only release is merged the same way, with no card in the way', () => withHome(async () => {
  const p = localProject();
  try {
    const calls = [];
    const out = await runJob({ project: 'p', target: target.tag, steps: steps(p, { kind: 'pins-only', merge: helperMerge(p, calls), approved: () => false }), journal: openJournal('p') });
    assert.equal(out.ok, true, out.line);
    assert.equal(calls.length, 1);
    assert.deepEqual(openJournal('p').read().steps.merged.data, { merged: true, approved: false });
  } finally { p.tidy(); }
}));

test('a release that needs the director\'s card is not merged until it is answered', () => withHome(async () => {
  const p = localProject();
  try {
    const calls = [];
    let answered = false;
    const make = () => steps(p, { merge: helperMerge(p, calls), approved: () => answered });
    let out = await runJob({ project: 'p', target: target.tag, steps: make(), journal: openJournal('p') });
    assert.deepEqual([out.ok, out.step, out.waiting], [false, 'merged', true]);
    assert.deepEqual(calls, []);
    assert.equal(settingsOf(p.folder), baseText);
    answered = true;
    out = await runJob({ project: 'p', target: target.tag, steps: make(), journal: openJournal('p') });
    assert.equal(out.ok, true, out.line);
    assert.equal(calls.length, 1);
  } finally { p.tidy(); }
}));

test('a mismatch stops the update with a plain line and merges nothing', () => withHome(async () => {
  const p = localProject();
  try {
    const merge = async () => ({ ok: false, kind: 'mismatch', refused: 'it changes more than .claude/settings.json' });
    const out = await runJob({ project: 'p', target: target.tag, steps: steps(p, { merge }), journal: openJournal('p') });
    assert.deepEqual([out.ok, out.step, out.waiting], [false, 'merged', undefined]);
    assert.ok(out.line.startsWith(MISMATCH_LINE), out.line);
    assert.equal(settingsOf(p.folder), baseText);
    assert.equal(openJournal('p').read().steps.idle.state, 'todo');
  } finally { p.tidy(); }
}));

test('a settings file of the director\'s own with changes waits, and the update carries on once it is committed', () => withHome(async () => {
  const p = localProject();
  try {
    fs.appendFileSync(path.join(p.folder, SETTINGS_FILE), ' ');
    const calls = [];
    let out = await runJob({ project: 'p', target: target.tag, steps: steps(p, { merge: helperMerge(p, calls) }), journal: openJournal('p') });
    assert.deepEqual([out.ok, out.step, out.waiting], [false, 'merged', true]);
    assert.match(out.line, /could not merge the change naming v0\.2\.7 itself \(Your folder has changes of its own to the project's Wheelhouse settings, so the update waits\. Commit them or set them aside\), so it waits/);
    assert.equal(git(p.home, 'rev-parse', 'refs/heads/main'), git(p.folder, 'rev-parse', 'HEAD'));
    git(p.folder, 'checkout', '-q', '--', SETTINGS_FILE);
    out = await runJob({ project: 'p', target: target.tag, steps: steps(p, { merge: helperMerge(p, calls) }), journal: openJournal('p') });
    assert.equal(out.ok, true, out.line);
  } finally { p.tidy(); }
}));

test('a host that refuses the merge leaves the change to wait the usual way, and says why', () => withHome(async () => {
  const p = localProject();
  try {
    const merge = async () => ({ ok: false, kind: 'held', refused: 'Required status checks have not passed' });
    const out = await runJob({ project: 'p', target: target.tag, steps: steps(p, { merge }), journal: openJournal('p') });
    assert.deepEqual([out.ok, out.step, out.waiting], [false, 'merged', true]);
    assert.match(out.line, /could not merge the change naming v0\.2\.7 itself \(Required status checks have not passed\), so it waits to be merged the usual way/);
    // The change then merges the usual way, and the update carries on.
    p.mergeOnHome();
    await p.take();
    const next = await runJob({ project: 'p', target: target.tag, steps: steps(p, { merge, prState: async () => ({ state: 'merged' }) }), journal: openJournal('p') });
    assert.equal(next.ok, true, next.line);
  } finally { p.tidy(); }
}));

test('the helper is asked only for a change that is open, and a helper that cannot merge is never asked', () => withHome(async () => {
  const p = localProject();
  try {
    const calls = [];
    const closed = await runJob({ project: 'p', target: target.tag, steps: steps(p, { merge: helperMerge(p, calls), prState: async () => ({ state: 'closed' }) }), journal: openJournal('p') });
    assert.equal(closed.ok, false);
    assert.match(closed.line, /closed without being merged/);
    assert.deepEqual(calls, []);
  } finally { p.tidy(); }
}));

test('only the update\'s own commit can be pushed to a release\'s branch', async () => {
  const p = localProject();
  try {
    const branch = releaseBranch(OLD);
    const check = () => releasePushRefusal({ git: gitRoute()(p.folder, { reach: 'local', what: 'the project\'s folder' }), branch });
    // The update\'s commit: one commit on main changing the ref and nothing else.
    git(p.folder, 'checkout', '-q', '-b', branch);
    fs.writeFileSync(path.join(p.folder, SETTINGS_FILE), goodHead);
    git(p.folder, 'commit', '-q', '-am', 'Move');
    assert.equal(await check(), null);
    // An agent\'s: a second commit, another file beside it, a different edit, or a merge.
    git(p.folder, 'commit', '-q', '--allow-empty', '-m', 'Extra');
    assert.match(await check(), /written by the update alone/);
    git(p.folder, 'reset', '-q', '--hard', 'HEAD~1');
    fs.writeFileSync(path.join(p.folder, 'notes.txt'), 'two\n');
    git(p.folder, 'commit', '-q', '-am', 'More');
    assert.match(await check(), /written by the update alone/);
    git(p.folder, 'reset', '-q', '--hard', 'HEAD~1');
    const edited = JSON.parse(goodHead);
    edited.permissions = { allow: ['Bash(*)'] };
    fs.writeFileSync(path.join(p.folder, SETTINGS_FILE), settingsText(edited));
    git(p.folder, 'commit', '-q', '-am', 'Edit');
    assert.match(await check(), /written by the update alone/);
    git(p.folder, 'reset', '-q', '--hard', 'HEAD~1');
    git(p.folder, 'checkout', '-q', 'main');
    git(p.folder, 'checkout', '-q', '-b', 'side');
    fs.writeFileSync(path.join(p.folder, 'notes.txt'), 'side\n');
    git(p.folder, 'commit', '-q', '-am', 'Side');
    git(p.folder, 'checkout', '-q', branch);
    git(p.folder, 'merge', '-q', '--no-ff', '-m', 'Merge', 'side');
    assert.match(await check(), /written by the update alone/);
  } finally { p.tidy(); }
});
