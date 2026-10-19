// tests/scripts/setup/steps.test.js
// The setup engine's parts: the ten steps in their order, the hash that names a list, the set
// line and the setup click's record, the first unfinished step, and the folder check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEPS, planHash, firstUnfinished } from '../../../scripts/setup/steps.js';
import { admitFolder } from '../../../scripts/setup/engine.js';
import { setupLine, SETUP_TITLES, SETUP_LABEL, setLineOf } from '../../../scripts/state/card-lines.js';
import { composeCard, DECIDING, HEADERS } from '../../../scripts/cards/compose.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey } from '../../../scripts/state/signing.js';
import { startRun, markStep, findRun } from '../../../scripts/setup/journal.js';
import { runStep } from '../../../scripts/setup/run-step.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

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

test('a setup click is an action naming the step and the full hash, with the Go ahead label', () => {
  withHome(() => {
    makeSigningKey();
    const make = (data) => makeEvent({ kind: 'action', data: { action: 'setup', question: setupLine(1, H), label: 'Go ahead', step: 1, hash: H, ...data }, now: () => NOW });
    const event = make({});
    assert.ok(event.sig);
    assert.deepEqual(Object.keys(event.data).sort(), ['action', 'hash', 'label', 'question', 'step']);
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

test('a long step\'s own process acts only on a step the helper marked clicked, and only on the list the click named', async () => {
  await withHome(async (home) => {
    const folder = fs.realpathSync.native(tempFolder('wh-child Zoë '));
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'test-world.json'), JSON.stringify({ 1: [{ file: 'x.json', key: ['a'], value: 1 }] }));
    const hash = planHash([{ kind: 'json-key', target: path.join(folder, 'x.json'), key: ['a'], after: 1 }]);
    const run = startRun({ folder, now: () => NOW });
    const args = (h = hash) => [TEST_STEPS, folder, '1', h, run.id, '60000'];
    const written = () => fs.existsSync(path.join(folder, 'x.json'));
    // Started by hand, with no click the helper checked: nothing is applied or recorded.
    assert.equal(await runStep(args(), { now: () => NOW }), 1);
    assert.equal(written(), false);
    assert.deepEqual(findRun(folder).steps, {});
    // Another folder or run than the one named: nothing.
    markStep(run.id, 1, 'clickedAt', { now: () => NOW });
    assert.equal(await runStep([TEST_STEPS, path.dirname(folder), '1', hash, run.id, '60000'], { now: () => NOW }), 1);
    for (const left of ['0', '-1', 'x', String(20 * 60 * 1000 + 1)]) assert.equal(await runStep([...args().slice(0, 5), left], { now: () => NOW }), 1, left);
    assert.equal(written(), false);
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
