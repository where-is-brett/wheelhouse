// tests/scripts/setup/steps.test.js
// The setup engine's parts: the ten steps in their order, the hash that names a list, the set
// line and the setup click's record, the first unfinished step, and the folder check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEPS, planHash, firstUnfinished } from '../../../scripts/setup/steps.js';
import { admitFolder, runApply } from '../../../scripts/setup/engine.js';
import { setupLine, SETUP_TITLES, SETUP_LABEL, setLineOf } from '../../../scripts/state/card-lines.js';
import { composeCard, DECIDING, HEADERS } from '../../../scripts/cards/compose.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey } from '../../../scripts/state/signing.js';
import { startRun, markStep, findRun, applyJsonKey, reverseChange, newId } from '../../../scripts/setup/journal.js';
import { runStep } from '../../../scripts/setup/run-step.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { tempFolder, withHome } from '../../helpers/homes.js';
import * as setupRun from '../../../scripts/lib/setup-run.js';
import * as setupClicks from '../../../scripts/lib/setup-clicks.js';
import * as journal from '../../../scripts/setup/journal.js';
import * as clicks from '../../../scripts/setup/clicks.js';

const H = 'ab'.repeat(32);
const TEST_STEPS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'helpers', 'setup-steps.js');
const NOW = new Date('2026-10-19T03:00:00.000Z');

test('the ten steps are numbered 1 to 10 in the design\'s order, with its titles', () => {
  assert.deepEqual(STEPS.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(STEPS.map((s) => s.title), [
    'Install', 'Tools', 'The host and the connection', 'Three questions', 'Rules found',
    'Changes to this computer', 'The project\'s files, pins and protection', 'Locked', 'Phone notifications', 'Health check',
  ]);
  assert.deepEqual(STEPS.map((s) => s.title), Object.values(SETUP_TITLES));
  for (const step of STEPS) {
    assert.equal(typeof step.plan, 'function');
    assert.equal(typeof step.apply, 'function');
  }
});

test('until its task fills it, each step lists no changes and its card composes with the setup line', async () => {
  for (const step of STEPS) {
    const ctx = { folder: '/tmp/x', step: step.n, now: () => NOW };
    const planned = await step.plan(ctx);
    assert.deepEqual(planned.changes, []);
    assert.equal(typeof planned.director, 'string');
    const hash = planHash(planned.changes);
    const { question, card } = composeCard({ ...planned.card, target: { step: step.n, hash } });
    assert.equal(setLineOf(question.question), setupLine(step.n, hash));
    assert.equal(card.kind, 'setup');
    assert.ok(question.question.includes(step.title), question.question);
    assert.deepEqual(await step.apply(ctx, planned.changes), []);
  }
});

test('a list\'s hash is the SHA-256 of its canonical JSON: key order does not change it, a value does', () => {
  const a = [{ kind: 'json-key', target: '/x/y.json', key: ['a'], after: 1 }];
  const b = [{ after: 1, key: ['a'], target: '/x/y.json', kind: 'json-key' }];
  assert.match(planHash(a), /^[0-9a-f]{64}$/);
  assert.equal(planHash(a), planHash(b));
  assert.notEqual(planHash(a), planHash([{ ...a[0], after: 2 }]));
  assert.notEqual(planHash(a), planHash([...a, ...a]));
});

test('the setup line names the step and the hash\'s first twelve characters, and its card is decided by Go ahead', () => {
  assert.equal(setupLine(3, H), `Set up step 3 as listed, ${H.slice(0, 12)}`);
  assert.equal(setupLine(10, H), `Set up step 10 as listed, ${H.slice(0, 12)}`);
  assert.equal(setLineOf(`x\n${setupLine(10, H)}\ny`), setupLine(10, H));
  assert.equal(setLineOf('Set up step 11 as listed, abababababab'), null);
  assert.equal(setLineOf('Set up step 0 as listed, abababababab'), null);
  assert.equal(SETUP_LABEL, 'Go ahead');
  assert.equal(DECIDING.setup, 'Go ahead');
  assert.ok(HEADERS.setup.length <= 12);
  assert.throws(() => composeCard({ kind: 'setup', level: 3, what: 'Step 1.', why: 'w', because: 'b', meanwhile: 'm', recommend: 'Go ahead', options: [{ label: 'Go ahead', says: 's' }], target: { step: 11, hash: H } }), /target/);
});

test('a setup click is an action naming the run, the step and the full hash, with the Go ahead label', () => {
  withHome(() => {
    makeSigningKey();
    const make = (data) => makeEvent({ kind: 'action', data: { action: 'setup', question: setupLine(1, H), label: 'Go ahead', runId: 'run-0123456789', step: 1, hash: H, ...data }, now: () => NOW });
    const event = make({});
    assert.ok(event.sig);
    assert.deepEqual(Object.keys(event.data).sort(), ['action', 'hash', 'label', 'question', 'runId', 'step']);
    assert.throws(() => make({ runId: undefined }), /run/);
    assert.throws(() => make({ runId: 'run-x' }), /run/);
    assert.throws(() => make({ step: 11 }), /step/);
    assert.throws(() => make({ step: 0 }), /step/);
    assert.throws(() => make({ hash: H.slice(0, 12) }), /hash/);
    assert.throws(() => make({ label: 'Approve' }), /Go ahead/);
    assert.throws(() => make({ sha: 'a'.repeat(12) }), /field/);
  });
});

test('the first unfinished step is the lowest one not done, whatever ran after it', () => {
  assert.equal(firstUnfinished(null), 1);
  assert.equal(firstUnfinished({ steps: {} }), 1);
  assert.equal(firstUnfinished({ steps: { 1: { doneAt: 'x' }, 2: { clickedAt: 'y' }, 3: { doneAt: 'z' } } }), 2);
  assert.equal(firstUnfinished({ steps: { 1: { doneAt: 'x' }, 2: { doneAt: 'y', failed: undefined }, 3: { doneAt: 'z' } } }), 4);
  const all = Object.fromEntries(STEPS.map((s) => [s.n, { doneAt: 'x' }]));
  assert.equal(firstUnfinished({ steps: all }), null);
});

test('the hooks read where a run stands as setup does: the same steps, titles, journal reader and click keeper', () => {
  // The hooks take these from scripts/lib, so the mod's bridge reaches nothing under scripts/setup/.
  assert.deepEqual(setupRun.SETUP_STEPS.map((s) => [s.n, s.title]), STEPS.map((s) => [s.n, s.title]));
  assert.equal(firstUnfinished, setupRun.firstUnfinished);
  const some = [null, { steps: {} }, { steps: { 1: { doneAt: 'x' }, 3: { doneAt: 'y' } } }, { steps: Object.fromEntries(STEPS.map((s) => [s.n, { doneAt: 'x' }])) }];
  for (const run of some) assert.equal(setupRun.firstUnfinished(run), firstUnfinished(run, STEPS));
  assert.equal(journal.readJournal, setupRun.readJournal);
  assert.equal(journal.journalFile, setupRun.journalFile);
  assert.equal(clicks.keepClick, setupClicks.keepClick);
  assert.equal(clicks.shownHash, setupClicks.shownHash);
  assert.equal(clicks.clicksDir, setupClicks.clicksDir);
});

test('the folder check admits ~/Projects folders, registered projects and setup runs, by their real paths', () => {
  withHome(() => {
    const user = fs.realpathSync.native(tempFolder('wh-home Zoë '));
    const projects = path.join(user, 'Projects');
    const inside = path.join(projects, 'Café Menu');
    fs.mkdirSync(inside, { recursive: true });
    assert.equal(admitFolder(inside, { userHome: user }), inside);
    assert.equal(admitFolder(`${inside}${path.sep}`, { userHome: user }), inside);
    assert.equal(admitFolder(path.join(inside, '.', 'sub', '..'), { userHome: user }), inside);
    const outside = fs.realpathSync.native(tempFolder('wh-out '));
    assert.throws(() => admitFolder(outside, { userHome: user }), /folder/);
    assert.throws(() => admitFolder(projects, { userHome: user }), /folder/);
    assert.throws(() => admitFolder('relative/path', { userHome: user }), /full path/);
    assert.throws(() => admitFolder(42, { userHome: user }), /full path/);
    // A run's folder is admitted wherever it is.
    startRun({ folder: outside, now: () => NOW });
    assert.equal(admitFolder(outside, { userHome: user }), outside);
    // So is a registered project's folder, and a folder inside it.
    const project = fs.realpathSync.native(tempFolder('wh-proj '));
    fs.mkdirSync(path.join(project, 'web'));
    writeProject('o__p', { folder: project, remoteUrl: 'https://example.com/o/p.git', host: 'github', repo: 'o/p', connection: {} });
    assert.equal(admitFolder(path.join(project, 'web'), { userHome: user }), path.join(project, 'web'));
    // A link under ~/Projects that leads outside is placed where it leads.
    const away = fs.realpathSync.native(tempFolder('wh-away '));
    fs.symlinkSync(away, path.join(projects, 'link'), 'dir');
    assert.throws(() => admitFolder(path.join(projects, 'link'), { userHome: user }), /folder/);
  });
});

test('a folder outside ~/Projects whose own settings switch the plugin on is admitted', () => {
  // Ruling R34: the product's folder exists from step 1, with the plugin installed there, so an
  // existing project outside ~/Projects (~/code/app, D:\\work\\app) can be set up.
  withHome(() => {
    const user = fs.realpathSync.native(tempFolder('wh-home Zoë '));
    const on = (folder, name, value) => {
      fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(folder, '.claude', name), JSON.stringify({ enabledPlugins: { 'wheelhouse@wheelhouse': value } }));
      return folder;
    };
    const shared = on(fs.realpathSync.native(tempFolder('wh-code app ')), 'settings.json', true);
    assert.equal(admitFolder(shared, { userHome: user }), shared);
    const local = on(fs.realpathSync.native(tempFolder('wh-local-')), 'settings.local.json', true);
    assert.equal(admitFolder(local, { userHome: user }), local);
    // Switched off by the local file, which wins, another plugin, no settings at all, or the
    // plugin on only in a folder above: refused.
    const off = on(on(fs.realpathSync.native(tempFolder('wh-off-')), 'settings.json', true), 'settings.local.json', false);
    assert.throws(() => admitFolder(off, { userHome: user }), /not under ~\/Projects/);
    const otherPlugin = fs.realpathSync.native(tempFolder('wh-other-'));
    fs.mkdirSync(path.join(otherPlugin, '.claude'));
    fs.writeFileSync(path.join(otherPlugin, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'helper@wheelhouse': true } }));
    assert.throws(() => admitFolder(otherPlugin, { userHome: user }), /not under ~\/Projects/);
    const bare = fs.realpathSync.native(tempFolder('wh-bare-'));
    assert.throws(() => admitFolder(bare, { userHome: user }), /not under ~\/Projects/);
    fs.mkdirSync(path.join(shared, 'web'));
    assert.throws(() => admitFolder(path.join(shared, 'web'), { userHome: user }), /not under ~\/Projects/);
  });
});

const MINUTE = 60 * 1000;
const at = (ms) => new Date(NOW.getTime() + ms);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
async function until(check) {
  for (let i = 0; i < 1500 && !check(); i += 1) await sleep(10);
  assert.ok(check(), 'it happened in time');
}

// A long step's process for `step` in `folder`, for the click at `clicked`, with its deadline
// STEP_TIMEOUT_MS later; `home` is the user home it plans with.
const childArgs = ({ folder, step = '1', hash, runId, clicked = NOW, home = folder }) => [
  TEST_STEPS, folder, step, hash, runId, clicked.toISOString(), at(clicked.getTime() - NOW.getTime() + 20 * MINUTE).toISOString(), home,
];

test('a long step\'s own process acts only on a step the helper marked clicked, and only on the list the click named', async () => {
  await withHome(async (home) => {
    const folder = fs.realpathSync.native(tempFolder('wh-child Zoë '));
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'test-world.json'), JSON.stringify({ 1: [{ file: 'x.json', key: ['a'], value: 1 }] }));
    const hash = planHash([{ kind: 'json-key', target: path.join(folder, 'x.json'), key: ['a'], after: 1 }]);
    const run = startRun({ folder, now: () => NOW });
    const args = (h = hash) => childArgs({ folder, hash: h, runId: run.id });
    const written = () => fs.existsSync(path.join(folder, 'x.json'));
    // Started by hand, with no click the helper checked: nothing is applied or recorded.
    assert.equal(await runStep(args(), { now: () => NOW }), 1);
    assert.equal(written(), false);
    assert.deepEqual(findRun(folder).steps, {});
    // Another folder or run than the one named, another click, a deadline later than the click
    // allows or none, or no full user home: nothing.
    markStep(run.id, 1, 'clickedAt', { now: () => NOW });
    const good = args();
    const bad = [
      [TEST_STEPS, path.dirname(folder), ...good.slice(2)],
      [...good.slice(0, 4), 'run-0000000000', ...good.slice(5)],
      [...good.slice(0, 5), at(1).toISOString(), ...good.slice(6)],
      [...good.slice(0, 6), at(20 * MINUTE + 1).toISOString(), good[7]],
      [...good.slice(0, 6), 'x', good[7]],
      [...good.slice(0, 7), 'relative/home'],
    ];
    for (const given of bad) assert.equal(await runStep(given, { now: () => NOW }), 1, given.join(' '));
    assert.equal(written(), false);
    assert.equal(findRun(folder).steps[1].failed, undefined);
    // A list that is not the one the click named is refused, and the step says why.
    assert.equal(await runStep(args('cd'.repeat(32)), { now: () => NOW }), 1);
    assert.equal(written(), false);
    assert.match(findRun(folder).steps[1].failed, /list changed/);
    // Clicked again: the named list is applied and the step is done, once.
    markStep(run.id, 1, 'clickedAt', { now: () => NOW });
    assert.equal(await runStep(args(), { now: () => NOW }), 0);
    assert.equal(written(), true);
    assert.equal(typeof findRun(folder).steps[1].doneAt, 'string');
    assert.equal(await runStep(args(), { now: () => NOW }), 1);
    assert.equal(findRun(folder).changes.length, 1);
  });
});

// Step 2 of the test steps is long: it makes its first change, then waits for <home>/release-2.
function longWorld(home, folder) {
  fs.mkdirSync(home, { recursive: true });
  const listed = [{ file: 'x.json', key: ['a'], value: 1 }, { file: 'y.json', key: ['b'], value: 2 }];
  fs.writeFileSync(path.join(home, 'test-world.json'), JSON.stringify({ 2: listed }));
  return planHash(listed.map((k) => ({ kind: 'json-key', target: path.join(folder, k.file), key: k.key, after: k.value })));
}

test('a long step\'s process past its deadline by the wall clock stops, after a sleep too, and marks nothing after', async () => {
  await withHome(async (home) => {
    const folder = fs.realpathSync.native(tempFolder('wh-sleep '));
    const hash = longWorld(home, folder);
    const run = startRun({ folder, now: () => NOW });
    markStep(run.id, 2, 'clickedAt', { now: () => NOW });
    const exited = [];
    let clock = at(MINUTE);
    const options = { now: () => clock, exit: (code) => exited.push(code), tickMs: 5 };
    // Started past its deadline (the helper already counts it stopped): it does nothing at all.
    clock = at(20 * MINUTE);
    assert.equal(await runStep(childArgs({ folder, step: '2', hash, runId: run.id }), options), 1);
    assert.equal(fs.existsSync(path.join(folder, 'x.json')), false);
    assert.deepEqual(findRun(folder).steps[2], { clickedAt: NOW.toISOString() });
    // Started in time, it makes its first change; then the computer sleeps past the deadline. One
    // timer would not count the sleep; the next tick reads the wall clock, marks the step failed
    // and ends the process.
    clock = at(MINUTE);
    const running = runStep(childArgs({ folder, step: '2', hash, runId: run.id }), options);
    await until(() => findRun(folder).changes.length === 1);
    assert.deepEqual(exited, []);
    clock = at(3 * 60 * MINUTE);
    await until(() => exited.length === 1);
    assert.deepEqual(exited, [1]);
    assert.match(findRun(folder).steps[2].failed, /still running 20 minutes after the click/);
    // Even if it got as far as finishing, it marks nothing more.
    fs.writeFileSync(path.join(home, 'release-2'), '');
    assert.equal(await running, 1);
    assert.equal(findRun(folder).steps[2].doneAt, undefined);
  });
});

test('a long step\'s process from an older click never marks the newer attempt done or failed', async () => {
  // The old process either finishes, or wakes past its own deadline, after a newer click started
  // the step again (the helper had counted the old attempt stuck).
  for (const ending of ['finishes', 'wakes past its deadline']) {
    await withHome(async (home) => {
      const folder = fs.realpathSync.native(tempFolder('wh-stale '));
      const hash = longWorld(home, folder);
      const run = startRun({ folder, now: () => NOW });
      markStep(run.id, 2, 'clickedAt', { now: () => NOW });
      const exited = [];
      let clock = at(MINUTE);
      const running = runStep(childArgs({ folder, step: '2', hash, runId: run.id }), { now: () => clock, exit: (code) => exited.push(code), tickMs: 5 });
      await until(() => findRun(folder).changes.length === 1);
      markStep(run.id, 2, 'clickedAt', { now: () => at(25 * MINUTE) });
      const newer = { clickedAt: at(25 * MINUTE).toISOString() };
      if (ending === 'wakes past its deadline') {
        clock = at(26 * MINUTE);
        await until(() => exited.length === 1);
        assert.deepEqual(findRun(folder).steps[2], newer, ending);
      }
      fs.writeFileSync(path.join(home, 'release-2'), '');
      assert.equal(await running, ending === 'finishes' ? 0 : 1, ending);
      assert.deepEqual(findRun(folder).steps[2], newer, ending);
    });
  }
});

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('a step records each change as it makes it, so one that fails part-way leaves every change it made in the journal', async () => {
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-record Zoë '));
    const file = path.join(folder, 'x.json');
    fs.writeFileSync(file, '{"a":"theirs"}\n');
    const run = startRun({ folder, now: () => NOW });
    const stepOf = (n, apply) => ({ n, title: SETUP_TITLES[n], plan: async () => ({ changes: [] }), apply });
    // Two key edits through ctx, then a throw: both are in the journal, the step is failed, and
    // both are put back, the director's own value first among them.
    const failing = stepOf(6, async (ctx) => {
      ctx.applyJsonKey({ file, key: ['a'], value: 'setup' });
      ctx.applyJsonKey({ file, key: ['b'], value: 2 });
      throw new Error('the installer stopped');
    });
    markStep(run.id, 6, 'clickedAt', { now: () => NOW });
    assert.deepEqual(await runApply({ step: failing, runId: run.id, changes: [], ctx: { now: () => NOW } }), { ok: false, reason: 'the installer stopped' });
    const made = findRun(folder).changes;
    assert.deepEqual(made.map((c) => [c.step, c.key, c.before, c.after]), [[6, ['a'], 'theirs', 'setup'], [6, ['b'], null, 2]]);
    assert.equal(findRun(folder).steps[6].failed, 'the installer stopped');
    assert.deepEqual(readJson(file), { a: 'setup', b: 2 });
    for (const change of [...made].reverse()) assert.deepEqual(reverseChange(change), { put: true });
    assert.deepEqual(readJson(file), { a: 'theirs' });

    // Each way of recording gives each change once: returned only; through ctx and returned too;
    // and ctx.record of one change, made before the change it names.
    const returned = stepOf(7, async () => [applyJsonKey({ file, key: ['c'], value: 3 })]);
    const both = stepOf(8, async (ctx) => [ctx.applyJsonKey({ file, key: ['d'], value: 4 })]);
    const own = stepOf(9, async (ctx) => {
      const change = { id: newId('chg'), kind: 'folder', target: path.join(folder, 'made'), before: null, after: 'made' };
      ctx.record(change);
      fs.mkdirSync(change.target);
      return [change];
    });
    for (const step of [returned, both, own]) {
      markStep(run.id, step.n, 'clickedAt', { now: () => NOW });
      assert.deepEqual(await runApply({ step, runId: run.id, changes: [], ctx: { now: () => NOW } }), { ok: true });
    }
    assert.deepEqual(findRun(folder).changes.slice(2).map((c) => [c.step, c.kind]), [[7, 'json-key'], [8, 'json-key'], [9, 'folder']]);
  });
});

test('a long step that fails part-way leaves every change it made in the journal, each one put back', async () => {
  await withHome(async (home) => {
    const folder = fs.realpathSync.native(tempFolder('wh-long-fail '));
    const hash = longWorld(home, folder);
    fs.writeFileSync(path.join(folder, 'x.json'), '{"a":"theirs"}\n');
    const world = readJson(path.join(home, 'test-world.json'));
    fs.writeFileSync(path.join(home, 'test-world.json'), JSON.stringify({ ...world, fail: { 2: 'the installer stopped' } }));
    fs.writeFileSync(path.join(home, 'release-2'), '');
    const run = startRun({ folder, now: () => NOW });
    markStep(run.id, 2, 'clickedAt', { now: () => NOW });
    assert.equal(await runStep(childArgs({ folder, step: '2', hash, runId: run.id }), { now: () => at(MINUTE), exit: () => {} }), 1);
    const { changes, steps } = findRun(folder);
    assert.equal(steps[2].failed, 'the installer stopped');
    assert.deepEqual(changes.map((c) => [c.step, c.target, c.before, c.after]), [[2, path.join(folder, 'x.json'), 'theirs', 1], [2, path.join(folder, 'y.json'), null, 2]]);
    for (const change of [...changes].reverse()) assert.deepEqual(reverseChange(change), { put: true });
    assert.deepEqual(readJson(path.join(folder, 'x.json')), { a: 'theirs' });
    assert.deepEqual(readJson(path.join(folder, 'y.json')), {});
  });
});
