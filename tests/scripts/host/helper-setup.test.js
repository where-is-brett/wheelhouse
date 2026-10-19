// tests/scripts/host/helper-setup.test.js
// The helper's setup routes: a step's list is worked out by the helper, shown on a card named by
// its hash, and applied only after the director's signed click on that card (design section 15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { setupLine } from '../../../scripts/state/card-lines.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { findRun, readJournal, markStep } from '../../../scripts/setup/journal.js';
import { setupRoutes } from '../../../scripts/setup/engine.js';
import { keepClick, clicksDir } from '../../../scripts/setup/clicks.js';
import { planHash } from '../../../scripts/setup/steps.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

const STEPS_MODULE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'helpers', 'setup-steps.js');
const T0 = new Date('2026-10-19T03:00:00.000Z');
const MINUTE = 60 * 1000;
const NAME = 'My Prodüct';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function setWorld(home, world) {
  fs.writeFileSync(path.join(home, 'test-world.json'), JSON.stringify(world));
}

async function startOne(home, user, extra = {}) {
  const helper = await startHelper({
    address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({}),
    now: () => T0, setupSteps: STEPS_MODULE, userHome: user, ...extra,
  });
  return { helper, client: helperClient({ address: helper.address }) };
}

// A Wheelhouse home with this computer's key enrolled, a user's home with a space and an accent
// in its name, and a folder under its Projects with both too. `extra` goes to the helper.
async function withSetup(fn, extra = {}) {
  const home = shortHome();
  const user = tempFolder('wh-user zoë ');
  const folder = path.join(user, 'Projects', NAME);
  fs.mkdirSync(folder, { recursive: true });
  await as(home, async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
    const { helper, client } = await startOne(home, user, extra);
    let closed = false;
    const close = async () => { if (!closed) { closed = true; await helper.close(); } };
    try {
      await fn({ client, home, user, folder, close });
    } finally {
      await close();
    }
  });
}

// The director's click on the card for this step and list, as the prompt record keeps it.
function click(step, hash, { at = new Date(T0.getTime() - MINUTE) } = {}) {
  const question = `What this is: setup step ${step}.\n${setupLine(step, hash)}`;
  const event = makeEvent({ kind: 'action', data: { action: 'setup', step, hash, question, label: 'Go ahead' }, now: () => at });
  keepClick(event);
  return event;
}

const KEY = (value) => ({ file: path.join('.claude', 'x.json'), key: ['wheelhouse', 'a'], value });
const written = (folder) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(folder, '.claude', 'x.json'), 'utf8'));
  } catch {
    return null;
  }
};
const runOf = (folder) => findRun(fs.realpathSync.native(folder));

test('apply is refused without a fresh click naming this step and this list', async () => {
  await withSetup(async ({ client, home, folder }) => {
    setWorld(home, { 1: [KEY(1)] });
    const plan = await client.setup.plan({ folder, step: 1 });
    assert.equal(plan.ok, true, plan.refused);
    assert.match(plan.hash, /^[0-9a-f]{64}$/);
    assert.equal(plan.hash, planHash(plan.changes));
    assert.ok(plan.card.question.includes(setupLine(1, plan.hash)), plan.card.question);
    assert.deepEqual(plan.card.options.map((o) => o.label).slice(0, 2), ['Go ahead', 'Not now']);
    assert.equal(plan.changes.length, 1);

    const apply = () => client.setup.apply({ folder, step: 1, hash: plan.hash });
    // No click at all.
    assert.match((await apply()).refused, /click/);
    // A click on another step's card, on another list, or from more than ten minutes ago.
    click(2, plan.hash);
    click(1, 'f'.repeat(64));
    click(1, plan.hash, { at: new Date(T0.getTime() - 11 * MINUTE) });
    assert.match((await apply()).refused, /click/);
    // A click whose words were changed after it was signed.
    const forged = click(3, plan.hash);
    const file = fs.readdirSync(clicksDir()).find((name) => fs.readFileSync(path.join(clicksDir(), name), 'utf8').includes(forged.id));
    const changed = { ...forged, data: { ...forged.data, step: 1 } };
    fs.writeFileSync(path.join(clicksDir(), file), JSON.stringify(changed));
    assert.match((await apply()).refused, /click/);
    assert.equal(written(folder), null, 'nothing was written');
    assert.equal(runOf(folder).steps[1]?.clickedAt, undefined);

    // The director's fresh click on this card: the list is applied, and the step is done.
    click(1, plan.hash);
    const done = await apply();
    assert.equal(done.ok, true, done.refused);
    assert.equal(done.started, true);
    assert.deepEqual(written(folder), { wheelhouse: { a: 1 } });
    const run = runOf(folder);
    assert.ok(run.steps[1].shownAt && run.steps[1].clickedAt && run.steps[1].doneAt);
    assert.deepEqual(run.changes.map((c) => [c.step, c.kind, c.key, c.before, c.after]), [[1, 'json-key', ['wheelhouse', 'a'], null, 1]]);
    // A finished step is never applied again, and its plan is not offered again.
    click(1, plan.hash);
    assert.match((await apply()).refused, /already done/);
    assert.match((await client.setup.plan({ folder, step: 1 })).refused, /already done/);
    assert.equal(runOf(folder).changes.length, 1);
  });
});

test('a list that changed between the card and the click is refused', async () => {
  await withSetup(async ({ client, home, folder }) => {
    setWorld(home, { 1: [KEY(1)] });
    const card = await client.setup.plan({ folder, step: 1 });
    click(1, card.hash);
    // Meanwhile what the step would change moved on: the helper works the list out again.
    setWorld(home, { 1: [KEY(2)] });
    const refused = await client.setup.apply({ folder, step: 1, hash: card.hash });
    assert.equal(refused.ok, false);
    assert.match(refused.refused, /changed since the card/);
    assert.equal(written(folder), null);
    // The new list's hash, before any card has shown it, is refused too, and so is a click on it.
    const fresh = planHash([{ kind: 'json-key', target: path.join(fs.realpathSync.native(folder), '.claude', 'x.json'), key: ['wheelhouse', 'a'], after: 2 }]);
    click(1, fresh);
    assert.match((await client.setup.apply({ folder, step: 1, hash: fresh })).refused, /changed since the card/);
    assert.equal(written(folder), null);
    // Shown again and clicked, the new list goes ahead.
    const again = await client.setup.plan({ folder, step: 1 });
    assert.equal(again.hash, fresh);
    assert.notEqual(again.hash, card.hash);
    click(1, again.hash);
    assert.equal((await client.setup.apply({ folder, step: 1, hash: again.hash })).ok, true);
    assert.deepEqual(written(folder), { wheelhouse: { a: 2 } });
  });
});

test('an apply with a list of the caller\'s own is refused', async () => {
  await withSetup(async ({ client, home, user, folder }) => {
    setWorld(home, { 1: [KEY(1)] });
    const card = await client.setup.plan({ folder, step: 1 });
    click(1, card.hash);
    const evil = path.join(user, 'evil.json');
    const own = [{ kind: 'json-key', target: evil, key: ['x'], after: true }];
    // The caller's list is never read: a request carrying one is refused outright.
    const withList = await client.setup.apply({ folder, step: 1, hash: card.hash, changes: own });
    assert.equal(withList.ok, false);
    assert.match(withList.refused, /works out the list itself/);
    // Its hash names no list the helper works out.
    assert.equal((await client.setup.apply({ folder, step: 1, hash: planHash(own) })).ok, false);
    assert.equal(fs.existsSync(evil), false);
    assert.equal(written(folder), null);
    // The director's click still stands for the list on the card, and only that list is applied.
    assert.equal((await client.setup.apply({ folder, step: 1, hash: card.hash })).ok, true);
    assert.deepEqual(written(folder), { wheelhouse: { a: 1 } });
    assert.equal(fs.existsSync(evil), false);
  });
});

test('a long step runs on and reports its progress in status', async () => {
  // The step's own process reads the wall clock, so here the helper does too. Its second change is
  // in the user's home the helper was given, which the process must plan with as well, or the
  // list it works out would not be the one clicked.
  await withSetup(async ({ client, home, user, folder, close }) => {
    setWorld(home, { 2: [KEY(1), { file: 'y.json', key: ['b'], value: 'two', home: true }] });
    const card = await client.setup.plan({ folder, step: 2 });
    click(2, card.hash, { at: new Date(Date.now() - MINUTE) });
    const started = await client.setup.apply({ folder, step: 2, hash: card.hash });
    assert.deepEqual(started, { ok: true, started: true });
    // While it runs: its first change is in the journal, and status says it is running.
    let lines = [];
    for (let i = 0; i < 750 && !lines.some((l) => l.includes('x.json')); i += 1) {
      await sleep(20);
      lines = (await client.setup.status({ folder })).lines ?? [];
    }
    assert.ok(lines.some((l) => /^Step 2, Tools: running since /.test(l)), lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('x.json')), lines.join('\n'));
    assert.ok(!lines.some((l) => l.includes('y.json')), lines.join('\n'));
    // A second click can't start it again while it runs.
    click(2, card.hash, { at: new Date(Date.now() - MINUTE) });
    assert.match((await client.setup.apply({ folder, step: 2, hash: card.hash })).refused, /running/);
    // The helper goes; the step runs on in its own process and finishes.
    await close();
    fs.writeFileSync(path.join(home, 'release-2'), '');
    for (let i = 0; i < 1500 && !runOf(folder).steps[2]?.doneAt; i += 1) await sleep(20);
    assert.ok(runOf(folder).steps[2].doneAt, 'the step finished');
    assert.equal(runOf(folder).changes.length, 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(user, 'y.json'), 'utf8')), { b: 'two' });
    const next = await startOne(home, user);
    try {
      const status = await next.client.setup.status({ folder });
      assert.equal(status.ok, true);
      assert.ok(status.lines.some((l) => /^Step 2, Tools: done at /.test(l)), status.lines.join('\n'));
      assert.ok(status.lines.some((l) => l.includes('y.json')), status.lines.join('\n'));
      assert.equal(status.next, 1);
    } finally {
      await next.helper.close();
    }
  }, { now: () => new Date() });
});

test('two applies in flight together, on two Go aheads on one card, start the step once', async () => {
  // A short step, applied in the helper, and a long one, started in its own process.
  for (const [step, long] of [[1, false], [2, true]]) {
    const spawned = [];
    const spawn = (...args) => { spawned.push(args); return { on() {}, unref() {} }; };
    await withSetup(async ({ client, home, folder }) => {
      setWorld(home, { [step]: [KEY(1)], planMs: 150 });
      const card = await client.setup.plan({ folder, step });
      click(step, card.hash);
      click(step, card.hash, { at: new Date(T0.getTime() - 2 * MINUTE) });
      const answers = await Promise.all([1, 2].map(() => client.setup.apply({ folder, step, hash: card.hash })));
      assert.equal(answers.filter((a) => a.ok === true).length, 1, JSON.stringify(answers));
      assert.match(answers.find((a) => a.ok !== true).refused, /already (running|done)/);
      if (long) assert.equal(spawned.length, 1);
      else assert.equal(runOf(folder).changes.length, 1);
      // The other click was not used: it can start the step again once this attempt has failed.
      assert.equal(fs.readdirSync(path.join(home, 'setup', 'clicks-used')).length, 1);
    }, { spawn });
  }
});

test('from a folder inside the one being set up, the routes carry on its run', async () => {
  await withSetup(async ({ client, home, folder }) => {
    setWorld(home, { 1: [KEY(1)] });
    const card = await client.setup.plan({ folder, step: 1 });
    click(1, card.hash);
    assert.equal((await client.setup.apply({ folder, step: 1, hash: card.hash })).ok, true);
    const inside = path.join(folder, 'web', 'src');
    fs.mkdirSync(inside, { recursive: true });
    const status = await client.setup.status({ folder: inside });
    assert.equal(status.ok, true);
    assert.equal(status.next, 2);
    assert.ok(status.lines[0].startsWith(`Setup of ${fs.realpathSync.native(folder)}, `), status.lines[0]);
    assert.match((await client.setup.plan({ folder: inside, step: 1 })).refused, /already done/);
    assert.equal((await client.setup.plan({ folder: inside, step: 2 })).ok, true);
    assert.equal(readJournal().runs.length, 1, 'no second run was started');
  });
});

test('a click used for a step that could not be recorded as started can be used again', async () => {
  await withSetup(async ({ home, user, folder }) => {
    setWorld(home, { 1: [KEY(1)] });
    // The routes as the helper has them, with a journal that can't take the click's time once.
    let failing = true;
    const mark = (...args) => {
      if (args[2] === 'clickedAt' && failing) {
        failing = false;
        throw new Error('the journal could not be written');
      }
      return markStep(...args);
    };
    const routes = setupRoutes({ now: () => T0, stepsModule: STEPS_MODULE, userHome: user, mark });
    const card = await routes['/setup/plan']({ folder, step: 1 });
    click(1, card.hash);
    await assert.rejects(routes['/setup/apply']({ folder, step: 1, hash: card.hash }),
      /could not be recorded as started, so it did not start and the click can be used again: the journal could not be written/);
    assert.equal(written(folder), null);
    // The same click, not a new one, now starts it.
    assert.deepEqual(await routes['/setup/apply']({ folder, step: 1, hash: card.hash }), { ok: true, started: true, done: true });
    assert.deepEqual(written(folder), { wheelhouse: { a: 1 } });
  });
});

test('a folder outside ~/Projects and the registered folders is refused', async () => {
  await withSetup(async ({ client, user, folder }) => {
    const outside = tempFolder('wh-outside-');
    const link = path.join(user, 'Projects', 'link');
    fs.symlinkSync(outside, link, 'dir');
    fs.mkdirSync(path.join(user, 'elsewhere'));
    const refusedFor = [
      outside,
      link,
      path.join(user, 'Projects'),
      path.join(user, 'Projects', '..', 'elsewhere'),
      path.join(user, 'Projects', 'missing'),
      `Projects/${NAME}`,
    ];
    for (const given of refusedFor) {
      for (const answer of [
        await client.setup.plan({ folder: given, step: 1 }),
        await client.setup.status({ folder: given }),
        await client.setup.apply({ folder: given, step: 1, hash: 'a'.repeat(64) }),
      ]) {
        assert.equal(answer.ok, false, given);
        assert.match(answer.refused, /folder/, given);
      }
    }
    assert.deepEqual(readJournal().runs, [], 'no run was started for a refused folder');
    // A folder under ~/Projects, with a space and an accent, and a registered project's folder.
    assert.equal((await client.setup.plan({ folder, step: 1 })).ok, true);
    assert.equal((await client.setup.status({ folder })).ok, true);
    const registered = tempFolder('wh-registered ');
    writeProject('o__p', { folder: registered, remoteUrl: 'https://example.com/o/p.git', host: 'github', repo: 'o/p', connection: {} });
    assert.equal((await client.setup.plan({ folder: registered, step: 1 })).ok, true);
    assert.equal((await client.setup.plan({ folder, step: 11 })).ok, false);
  });
});

test('under STOP, plan and status answer and apply is refused', async () => {
  await withSetup(async ({ client, home, folder }) => {
    setWorld(home, { 1: [KEY(1)] });
    const card = await client.setup.plan({ folder, step: 1 });
    click(1, card.hash);
    setStop({ by: 'prompt' });
    const plan = await client.setup.plan({ folder, step: 1 });
    assert.equal(plan.ok, true);
    assert.equal(plan.hash, card.hash);
    const status = await client.setup.status({ folder });
    assert.equal(status.ok, true);
    assert.ok(status.lines.some((l) => /^Step 1, Install: card shown at /.test(l)), status.lines.join('\n'));
    assert.deepEqual(await client.setup.apply({ folder, step: 1, hash: card.hash }), { ok: false, refused: 'STOP is on' });
    assert.equal(written(folder), null);
    liftStop();
    assert.equal((await client.setup.apply({ folder, step: 1, hash: card.hash })).ok, true);
    assert.deepEqual(written(folder), { wheelhouse: { a: 1 } });
  });
});
