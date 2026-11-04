// tests/scripts/update/change.test.js
// The update's reviewed change and its waits. No network, no host and no Claude: the opening of the change, the card and the
// host's state are stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { approvalCard, changeSteps, namedRef, openChange, releaseKind, updateMirror, waitIdle, waitMerged } from '../../../scripts/update/change.js';
import { openJournal } from '../../../scripts/update/journal.js';
import { runJob } from '../../../scripts/update/job.js';
import { SETTINGS_FILE, releaseBranch, releaseChange, settingsText, undoBranch } from '../../../scripts/lineage/release.js';
import { projectSettings } from '../../../scripts/protection/settings.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { RELEASE_LINE, setLineOf } from '../../../scripts/state/card-lines.js';

const NEW = 'c'.repeat(40);
const OLD = 'd'.repeat(40);
const settingsAt = (ref) => projectSettings(readConfig(null), { release: { ref } });

function folder(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-change-'));
  if (settings !== undefined) {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, SETTINGS_FILE), typeof settings === 'string' ? settings : settingsText(settings));
  }
  return dir;
}
const tidy = (dir) => fs.rmSync(dir, { recursive: true, force: true });

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-change-home-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  return Promise.resolve(fn(home)).finally(() => {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  });
}

const target = { tag: 'v0.2.7', sha: NEW };

// A way to open the change that records what it was asked and answers as the helper does.
function opener(answer = { ok: true, number: 12 }) {
  const calls = [];
  return { calls, open: async (args) => { calls.push(args); return answer; } };
}

test('a pins-only release opens its change on the release branch and raises no card', async () => {
  const dir = folder(settingsAt('v0.2.6'));
  const cards = [];
  const { open, calls } = opener();
  try {
    const before = fs.readFileSync(path.join(dir, SETTINGS_FILE), 'utf8');
    const got = await openChange({ project: 'p', target, previous: { ref: 'v0.2.6', sha: OLD }, projectDir: dir, open, raise: async (c) => cards.push(c), kind: 'pins-only' });
    assert.deepEqual({ ok: got.ok, pr: got.pr, approval: got.approval }, { ok: true, pr: 12, approval: 'review' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].branch, releaseBranch(NEW));
    assert.equal(calls[0].file, SETTINGS_FILE);
    assert.equal(calls[0].text, settingsText(releaseChange(settingsAt('v0.2.6'), { ref: 'v0.2.7', sha: NEW })));
    assert.deepEqual([calls[0].release, calls[0].commit], ['v0.2.7', NEW]);
    assert.deepEqual(cards, []);
    // The main checkout's settings are never written.
    assert.equal(fs.readFileSync(path.join(dir, SETTINGS_FILE), 'utf8'), before);
  } finally { tidy(dir); }
});

test('a release that is not pins-only raises the card named for its commit, with Approve and Not now', async () => {
  const dir = folder(settingsAt('v0.2.6'));
  const cards = [];
  try {
    const got = await openChange({ project: 'p', target, previous: { ref: 'v0.2.6', sha: OLD }, projectDir: dir, ...opener(), raise: async (c) => cards.push(c), kind: 'changes' });
    assert.equal(got.approval, 'card');
    assert.equal(cards.length, 1);
    assert.equal(cards[0].id, `release-${NEW}`);
    assert.deepEqual(cards[0].options, ['Approve', 'Not now']);
    // The question's one set line names the tag and the commit in full, so a click stands for that release and no other.
    assert.deepEqual(RELEASE_LINE.exec(setLineOf(cards[0].question)).slice(1), ['v0.2.6', 'v0.2.7', NEW]);
    assert.deepEqual(approvalCard({ previous: 'v0.2.6', release: 'v0.2.7', commit: NEW }), cards[0]);
    // The job records the card it raised, which is what lets a click on it be signed.
    assert.deepEqual(got.card, { previous: 'v0.2.6', release: 'v0.2.7', commit: NEW });
  } finally { tidy(dir); }
});

test('an undo opens its change on the undo branch for the earlier release', async () => {
  const dir = folder(settingsAt('v0.2.7'));
  const { open, calls } = opener();
  try {
    const got = await openChange({ project: 'p', target, previous: { ref: 'v0.2.6', sha: OLD }, put: 'undo', projectDir: dir, open, kind: 'pins-only' });
    assert.equal(got.ok, true);
    assert.equal(calls[0].branch, undoBranch(OLD));
    assert.deepEqual([calls[0].release, calls[0].commit], ['v0.2.6', OLD]);
  } finally { tidy(dir); }
});

test('a project before setup\'s step 7 skips the change, and one already merged on another computer skips it too', async () => {
  const noMarketplace = folder({ permissions: { allow: [] } });
  const noFile = folder();
  const merged = folder(settingsAt('v0.2.7'));
  try {
    for (const [dir, skipped] of [[noMarketplace, 'before-step-7'], [noFile, 'before-step-7'], [merged, 'merged']]) {
      const { open, calls } = opener();
      const got = await openChange({ project: 'p', target, previous: { ref: 'v0.2.6', sha: OLD }, projectDir: dir, open, kind: 'changes' });
      assert.deepEqual({ ok: got.ok, skipped: got.skipped }, { ok: true, skipped });
      assert.deepEqual(calls, []);
    }
  } finally { [noMarketplace, noFile, merged].forEach(tidy); }
});

test('a change that could not be opened says why and the job stops', async () => {
  const dir = folder(settingsAt('v0.2.6'));
  try {
    const got = await openChange({ project: 'p', target, previous: { ref: 'v0.2.6', sha: OLD }, projectDir: dir, ...opener({ ok: false, refused: 'All stop is on' }), kind: 'changes' });
    assert.equal(got.ok, false);
    assert.match(got.line, /could not be opened: All stop is on/);
    const short = await openChange({ project: 'p', target: { tag: 'v0.2.7', sha: 'abc' }, previous: null, projectDir: dir, ...opener(), kind: 'changes' });
    assert.equal(short.ok, false);
  } finally { tidy(dir); }
});

test('the wait for the merge reads the main checkout, and a closed change ends it', async () => {
  const waiting = folder(settingsAt('v0.2.6'));
  const named = folder(settingsAt('v0.2.7'));
  try {
    assert.deepEqual(await waitMerged({ target, projectDir: named }), { merged: true });
    assert.match((await waitMerged({ target, projectDir: waiting, pr: 12, prState: async () => ({ state: 'open' }) })).waiting, /Waiting for the change naming v0\.2\.7 to be merged/);
    // Merged on the host but not yet in the folder: the install still waits.
    assert.match((await waitMerged({ target, projectDir: waiting, pr: 12, prState: async () => ({ state: 'merged' }) })).waiting, /merged\. Waiting for it to reach your project's folder/);
    assert.match((await waitMerged({ target, projectDir: waiting, pr: 12, prState: async () => ({ state: 'closed' }) })).closed, /closed without being merged, so nothing was installed/);
    // The host can't be asked: the wait goes on.
    assert.ok((await waitMerged({ target, projectDir: waiting, pr: 12, prState: async () => { throw new Error('offline'); } })).waiting);
    assert.ok((await waitMerged({ target, projectDir: waiting })).waiting);
  } finally { [waiting, named].forEach(tidy); }
});

test('wait: All stop during the wait holds the install', async () => {
  let stop = true;
  const features = { 'sign-in': { data: { step: 'started' } } };
  const held = await waitIdle({ stopped: () => stop, features });
  assert.match(held.waiting, /^All stop is on, so nothing is installed/);
  assert.equal(held.idle, undefined);
  // Whatever the features say, All stop holds; and a stop that can't be read holds too.
  assert.ok((await waitIdle({ stopped: () => stop, features: {} })).waiting);
  assert.ok((await waitIdle({ features: {} })).waiting);
  assert.ok((await waitIdle({ stopped: () => undefined, features: {} })).waiting);
  // It carries on only after it lifts.
  stop = false;
  assert.deepEqual(await waitIdle({ stopped: () => stop, features: {} }), { idle: true });
});

test('the install waits for work in progress, and carries on when no feature is past started', async () => {
  const busy = { 'sign-in': { data: { step: 'building' } } };
  assert.match((await waitIdle({ stopped: () => false, features: busy })).waiting, /the feature sign-in is building/);
  assert.deepEqual(await waitIdle({ stopped: () => false, features: { a: { data: { step: 'closed' } } } }), { idle: true });
  // A features view that can't be read holds it.
  assert.ok((await waitIdle({ stopped: () => false, features: null })).waiting);
});

test('a pins-only release file is read from the fetched tag, and anything unreadable counts as changes', async () => {
  const answers = { ok: '{"kind":"pins-only","lineage":"passed"}', failed: '{"kind":"pins-only","lineage":"failed"}', other: '{"kind":"changes","lineage":"passed"}', junk: 'x' };
  for (const [name, text] of Object.entries(answers)) {
    const run = async () => ({ code: 0, stdout: text, stderr: '' });
    assert.equal(await releaseKind({ tag: 'v0.2.7', run, mirror: os.tmpdir() }), name === 'ok' ? 'pins-only' : 'changes');
  }
  assert.equal(await releaseKind({ tag: 'v0.2.7', run: async () => ({ code: 128, stdout: '', stderr: '' }), mirror: os.tmpdir() }), 'changes');
});

test('the release file is read from the mirror under the Wheelhouse home, never from a temporary folder', () => withHome(async (home) => {
  const seen = [];
  const run = async (file, args, options) => { seen.push(options?.cwd); return { code: 0, stdout: '{"kind":"pins-only","lineage":"passed"}', stderr: '' }; };
  assert.equal(await releaseKind({ tag: 'v0.2.7', run }), 'pins-only');
  assert.equal(updateMirror(), path.join(home, 'update', 'mirror'));
  assert.deepEqual(seen.map((cwd) => fs.realpathSync(path.dirname(path.dirname(cwd)))), [fs.realpathSync(home)]);
  assert.equal(path.basename(seen[0]), 'mirror');
}));

test('the change and the waits run as the job\'s steps, and a wait is carried on by the next apply', () => withHome(async () => {
  const dir = folder(settingsAt('v0.2.6'));
  try {
    const { open, calls } = opener();
    const world = { state: 'open', stop: true, features: { f: { data: { step: 'started' } } } };
    const git = async () => ({ code: 0, stdout: '{"kind":"pins-only","lineage":"passed"}', stderr: '' });
    const make = () => changeSteps({
      projectDir: dir, target, previous: { ref: 'v0.2.6', sha: OLD }, open, run: git,
      prState: async () => ({ state: world.state }), stopped: () => world.stop, features: () => world.features,
    });
    const journal = openJournal('p');
    // The change opens, and the merge is waited for.
    let out = await runJob({ project: 'p', target: target.tag, steps: make(), journal });
    assert.deepEqual([out.ok, out.step], [false, 'merged']);
    assert.match(out.line, /Waiting for the change naming v0\.2\.7 to be merged/);
    assert.equal(journal.read().steps.change.state, 'done');
    // It merged and the folder has it: the wait for work holds while All stop is on.
    fs.writeFileSync(path.join(dir, SETTINGS_FILE), settingsText(settingsAt('v0.2.7')));
    out = await runJob({ project: 'p', target: target.tag, steps: make(), journal: openJournal('p') });
    assert.deepEqual([out.ok, out.step], [false, 'idle']);
    assert.match(out.line, /^All stop is on/);
    assert.equal(openJournal('p').read().steps.merged.state, 'done');
    // Lifted: it carries on, and the change is never opened twice.
    world.stop = false;
    world.features = { f: { data: { step: 'building' } } };
    out = await runJob({ project: 'p', target: target.tag, steps: make(), journal: openJournal('p') });
    assert.deepEqual([out.ok, out.step], [false, 'idle']);
    assert.match(out.line, /the feature f is building/);
    world.features = {};
    out = await runJob({ project: 'p', target: target.tag, steps: make(), journal: openJournal('p') });
    assert.equal(out.ok, true);
    assert.equal(calls.length, 1);
  } finally { tidy(dir); }
}));

test('a closed change ends the job with nothing installed', () => withHome(async () => {
  const dir = folder(settingsAt('v0.2.6'));
  try {
    const git = async () => ({ code: 0, stdout: '{"kind":"changes","lineage":"passed"}', stderr: '' });
    const cards = [];
    const steps = changeSteps({
      projectDir: dir, target, previous: { ref: 'v0.2.6', sha: OLD }, ...opener(), run: git, raise: async (c) => cards.push(c),
      prState: async () => ({ state: 'closed' }), stopped: () => false, features: () => ({}),
    });
    const out = await runJob({ project: 'p', target: target.tag, steps, journal: openJournal('p') });
    assert.deepEqual([out.ok, out.step], [false, 'merged']);
    assert.match(out.line, /closed without being merged, so nothing was installed/);
    assert.equal(cards.length, 1);
    const journal = openJournal('p').read();
    assert.equal(journal.steps.idle.state, 'todo');
    assert.equal(journal.steps.backup.state, 'todo');
  } finally { tidy(dir); }
}));

test('a project before step 7 passes the merge wait', () => withHome(async () => {
  const dir = folder({ permissions: {} });
  try {
    const { open, calls } = opener();
    const steps = changeSteps({ projectDir: dir, target, previous: null, open, run: async () => ({ code: 1, stdout: '', stderr: '' }), stopped: () => false, features: () => ({}) });
    const out = await runJob({ project: 'p', target: target.tag, steps, journal: openJournal('p') });
    assert.equal(out.ok, true);
    assert.deepEqual(calls, []);
  } finally { tidy(dir); }
}));

test('the ref a project names is read from its settings', () => {
  assert.equal(namedRef(settingsAt('v0.2.6')), 'v0.2.6');
  assert.equal(namedRef({}), null);
  assert.equal(namedRef(null), null);
});
