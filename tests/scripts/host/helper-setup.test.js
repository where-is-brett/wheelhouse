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
import { CARD } from '../../../scripts/lib/front-desk.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { findRun, readJournal, markStep, reverseChange, addChanges, newId } from '../../../scripts/setup/journal.js';
import { setupRoutes, stepsBefore, asksDuring } from '../../../scripts/setup/engine.js';
import { keepClick, clicksDir, answersFor } from '../../../scripts/setup/clicks.js';
import { decide } from '../../../scripts/hooks/prompt-record.js';
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

// The director's click on the card for this step and list, as the prompt record keeps it, for
// the run the card was shown for (the latest one, unless named).
function click(step, hash, { at = new Date(T0.getTime() - MINUTE), runId = readJournal().runs.at(-1)?.id ?? 'run-0000000000' } = {}) {
  const question = `What this is: setup step ${step}.\n${setupLine(step, hash)}`;
  const event = makeEvent({ kind: 'action', data: { action: 'setup', runId, step, hash, question, label: 'Go ahead' }, now: () => at });
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

test('a short step that fails part-way leaves every change it made in the journal, each one put back', async () => {
  await withSetup(async ({ client, home, folder }) => {
    const second = { file: path.join('.claude', 'y.json'), key: ['b'], value: 2 };
    setWorld(home, { 1: [KEY(1), second], fail: { 1: 'the installer stopped' } });
    fs.mkdirSync(path.join(folder, '.claude'));
    fs.writeFileSync(path.join(folder, '.claude', 'x.json'), '{"wheelhouse":{"a":"theirs"}}\n');
    const card = await client.setup.plan({ folder, step: 1 });
    click(1, card.hash);
    const failed = await client.setup.apply({ folder, step: 1, hash: card.hash });
    assert.equal(failed.ok, false);
    assert.match(failed.refused, /did not finish: the installer stopped/);
    const run = runOf(folder);
    assert.equal(run.steps[1].failed, 'the installer stopped');
    assert.deepEqual(run.changes.map((c) => [c.step, c.key, c.before, c.after]), [[1, ['wheelhouse', 'a'], 'theirs', 1], [1, ['b'], null, 2]]);
    for (const change of [...run.changes].reverse()) assert.deepEqual(reverseChange(change), { put: true });
    assert.deepEqual(written(folder), { wheelhouse: { a: 'theirs' } });
  });
});

test('a click on one folder\'s card is not used for another folder\'s run, though their lists are the same', async () => {
  await withSetup(async ({ client, user, folder }) => {
    const other = path.join(user, 'Projects', 'Other shop');
    fs.mkdirSync(other);
    // Both cards list nothing, so both lists have one hash.
    const mine = await client.setup.plan({ folder, step: 1 });
    const theirs = await client.setup.plan({ folder: other, step: 1 });
    assert.equal(mine.hash, theirs.hash);
    click(1, mine.hash, { runId: runOf(folder).id });
    assert.match((await client.setup.apply({ folder: other, step: 1, hash: theirs.hash })).refused, /click/);
    assert.equal(runOf(other).steps[1].clickedAt, undefined);
    assert.equal((await client.setup.apply({ folder, step: 1, hash: mine.hash })).ok, true);
  });
});

test('a short step still working in the helper past its time is not started again, nor its card shown again', async () => {
  await withSetup(async ({ home, user, folder }) => {
    setWorld(home, { 1: [KEY(1)], hold: [1] });
    let clock = T0;
    const routes = setupRoutes({ now: () => clock, stepsModule: STEPS_MODULE, userHome: user });
    const card = await routes['/setup/plan']({ folder, step: 1 });
    click(1, card.hash);
    const first = routes['/setup/apply']({ folder, step: 1, hash: card.hash });
    for (let i = 0; i < 500 && !runOf(folder).steps[1]?.clickedAt; i += 1) await sleep(10);
    // Past STEP_TIMEOUT_MS by the clock, the journal alone would read it as stuck.
    clock = new Date(T0.getTime() + 25 * MINUTE);
    click(1, card.hash, { at: new Date(clock.getTime() - MINUTE) });
    await assert.rejects(routes['/setup/plan']({ folder, step: 1 }), /already running/);
    await assert.rejects(routes['/setup/apply']({ folder, step: 1, hash: card.hash }), /already running/);
    assert.ok((await routes['/setup/status']({ folder })).lines.some((l) => /^Step 1, Install: running since /.test(l)));
    fs.writeFileSync(path.join(home, 'release-1'), '');
    assert.deepEqual(await first, { ok: true, started: true, done: true });
    assert.equal(runOf(folder).changes.length, 1);
    assert.equal(fs.readdirSync(path.join(home, 'setup', 'clicks-used')).length, 1, 'the second click was not used');
  });
});

test('the plan of a step that is running is refused, and its card\'s shown time and record are left as they were', async () => {
  const spawn = () => ({ on() {}, unref() {} });
  await withSetup(async ({ client, home, folder }) => {
    setWorld(home, { 2: [KEY(1)] });
    const card = await client.setup.plan({ folder, step: 2 });
    click(2, card.hash);
    assert.deepEqual(await client.setup.apply({ folder, step: 2, hash: card.hash }), { ok: true, started: true });
    const shownFile = path.join(home, 'setup', 'shown', `${runOf(folder).id}-2.json`);
    const shown = fs.readFileSync(shownFile, 'utf8');
    const shownAt = runOf(folder).steps[2].shownAt;
    const again = await client.setup.plan({ folder, step: 2 });
    assert.equal(again.ok, false);
    assert.match(again.refused, /already running/);
    assert.equal(runOf(folder).steps[2].shownAt, shownAt);
    assert.equal(fs.readFileSync(shownFile, 'utf8'), shown);
  }, { spawn });
});

test('what setup\'s routes say is cleaned of anything key-like, as the other routes\' answers are', async () => {
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  await withSetup(async ({ client, home, folder }) => {
    setWorld(home, { 1: [KEY(1)], fail: { 1: `the installer said: bad credentials ${token}` } });
    const card = await client.setup.plan({ folder, step: 1 });
    click(1, card.hash);
    const failed = await client.setup.apply({ folder, step: 1, hash: card.hash });
    assert.equal(failed.ok, false);
    assert.ok(!failed.refused.includes(token), failed.refused);
    assert.match(failed.refused, /\[hidden\]/);
    const status = await client.setup.status({ folder });
    assert.equal(status.ok, true);
    assert.ok(status.lines.some((l) => l.includes('did not finish') && l.includes('[hidden]')), status.lines.join('\n'));
    assert.ok(!status.lines.join('\n').includes(token));
    // A refusal from a step's plan is cleaned too, and so is an address with a sign-in in it.
    setWorld(home, { planFail: { 3: `could not reach https://jo:${token}@example.com/o/p.git` } });
    const planned = await client.setup.plan({ folder, step: 3 });
    assert.equal(planned.ok, false);
    assert.equal(planned.refused.includes(token), false, planned.refused);
    assert.match(planned.refused, /https:\/\/\[hidden\]@example\.com/);
  });
});

// The director's click on `card` in a session in `cwd`, as the prompt record sees it.
async function choose(cwd, card, label, { at = new Date(T0.getTime() - MINUTE) } = {}) {
  await decide({
    cwd, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
    tool_input: { questions: [card], answers: { [card.question]: label } },
    tool_response: { answers: { [card.question]: label } },
  }, { now: () => at, projectOf: () => null });
}

test('a card naming ssh://git@… is stored as sent and can be clicked through', async () => {
  // Ruling R26: the card the helper stores is the card it sends, cleaned of any sign-in in an
  // address, so the director's click on the card they saw counts.
  await withSetup(async ({ client, home, folder }) => {
    const remote = 'ssh://git@github.com/o/r.git';
    setWorld(home, {
      1: [{ file: path.join('.claude', 'x.json'), key: ['wheelhouse', 'remote'], value: remote }],
      what: { 1: `Setup step 1, Install: the remote ${remote} is written.` },
    });
    const plan = await client.setup.plan({ folder, step: 1 });
    assert.equal(plan.ok, true, plan.refused);
    assert.ok(plan.card.question.includes('ssh://[hidden]@github.com/o/r.git'), plan.card.question);
    assert.ok(!JSON.stringify(plan).includes('git@'), 'nothing the helper sends holds the sign-in');
    const shown = JSON.parse(fs.readFileSync(path.join(home, 'setup', 'shown', `${readJournal().runs.at(-1).id}-1.json`), 'utf8'));
    assert.deepEqual(shown.card.question, plan.card.question, 'the card stored is the card sent');
    // The list is hashed as the step gave it: the helper applies the real address.
    assert.equal(plan.hash, planHash([{ kind: 'json-key', target: path.join(fs.realpathSync.native(folder), '.claude', 'x.json'), key: ['wheelhouse', 'remote'], after: remote }]));
    await choose(folder, plan.card, 'Go ahead');
    assert.equal(fs.readdirSync(clicksDir()).length, 1, 'the Go ahead is kept');
    const done = await client.setup.apply({ folder, step: 1, hash: plan.hash });
    assert.equal(done.ok, true, done.refused);
    assert.deepEqual(written(folder), { wheelhouse: { remote } });

    // An address with a sign-in in a question card: the answer on the card as sent is kept.
    setWorld(home, { ask: { 3: [{ id: 'remote', options: ['Use it', 'Another one'], what: 'Setup step 3 found https://jo@bitbucket.org/o/r.git as this folder\'s remote.' }] } });
    const asked = await client.setup.plan({ folder, step: 3 });
    assert.equal(asked.ok, true, asked.refused);
    assert.ok(asked.ask.card.question.includes('https://[hidden]@bitbucket.org/o/r.git'), asked.ask.card.question);
    await choose(folder, asked.ask.card, 'Use it');
    assert.deepEqual(Object.values(answersFor(readJournal().runs.at(-1).id)).map((a) => a.label), ['Use it']);
    assert.equal((await client.setup.plan({ folder, step: 3 })).ask, undefined, 'the answer is in, so the step is not asked again');
  });
});

test('from a registered project below a folder being set up, the routes do not carry on its run', async () => {
  // Ruling R27: a project registered in a folder inside another product's folder, whose setup is
  // unfinished, has its own run, or none; never the parent's.
  await withSetup(async ({ client, home, folder }) => {
    setWorld(home, {});
    assert.equal((await client.setup.plan({ folder, step: 1 })).ok, true);
    const parent = readJournal().runs.at(-1);
    const project = path.join(folder, 'shop');
    fs.mkdirSync(path.join(project, 'web'), { recursive: true });
    writeProject('o__shop', { folder: project, remoteUrl: 'https://example.com/o/shop.git', host: 'github', repo: 'o/shop', connection: {} });
    for (const inside of [project, path.join(project, 'web')]) {
      const status = await client.setup.status({ folder: inside });
      assert.equal(status.ok, true);
      assert.deepEqual(status.lines, ['Setup has not started in this folder.'], inside);
    }
    // Its plan starts a run of its own, in its own folder; the parent's is left as it was.
    assert.equal((await client.setup.plan({ folder: project, step: 2 })).ok, true);
    const runs = readJournal().runs;
    assert.equal(runs.length, 2);
    assert.deepEqual(runs.find((r) => r.id === parent.id).steps, parent.steps);
    assert.equal(runs.at(-1).folder, fs.realpathSync.native(project));
    assert.ok((await client.setup.status({ folder: path.join(project, 'web') })).lines[0].startsWith(`Setup of ${runs.at(-1).folder}, `));
    // The parent's own folder still carries on its run.
    assert.ok((await client.setup.status({ folder })).lines[0].startsWith(`Setup of ${parent.folder}, `));
  });
});

test('a card is cleaned before it is composed, so the card sent is within the composer\'s length', async () => {
  // "[hidden]" is longer than the sign-in it stands for: cleaned after composing, a card at the
  // limit would be sent past it.
  await withSetup(async ({ client, home, folder }) => {
    const what = (pad) => `Setup step 1, Install: the remote ssh://git@github.com/o/r.git is written.${' x'.repeat(pad)}`;
    setWorld(home, { what: { 1: what(0) } });
    const base = (await client.setup.plan({ folder, step: 1 })).card.question.length;
    // Padding that brings the uncleaned card to the limit, and the cleaned one past it.
    const pad = Math.floor((CARD.chars - (base - '[hidden]'.length + 'git'.length)) / 2);
    setWorld(home, { what: { 1: what(pad) } });
    const plan = await client.setup.plan({ folder, step: 1 });
    if (plan.ok) assert.ok(plan.card.question.length <= CARD.chars, `${plan.card.question.length} characters`);
    assert.equal(plan.ok, false, 'a card the composer would refuse once cleaned is refused');
    assert.match(plan.refused, /characters/);
    // One a little shorter is sent within the limit, and stored as sent.
    setWorld(home, { what: { 1: what(pad - 4) } });
    const shorter = await client.setup.plan({ folder, step: 1 });
    assert.equal(shorter.ok, true, shorter.refused);
    assert.ok(shorter.card.question.length <= CARD.chars);
    const shown = JSON.parse(fs.readFileSync(path.join(home, 'setup', 'shown', `${readJournal().runs.at(-1).id}-1.json`), 'utf8'));
    assert.equal(shown.card.question, shorter.card.question);
  });
});

test('a step that waits for another asks its questions meanwhile, waits in place of its Go ahead, and is applied once that one is done', async () => {
  // Rulings R47 and R54: step 3 needs the git that step 2 installs, so no Go ahead for it is shown
  // while step 2 is unfinished; its questions are asked meanwhile, as it names step 2 in its
  // `asksDuring`, and apply refuses as a backstop.
  await withSetup(async ({ client, home, folder }) => {
    setWorld(home, { 3: [KEY(3)], after: { 3: [2] }, asksDuring: { 3: [2] }, ask: { 3: [{ id: 'which', options: ['GitHub', 'GitLab'] }] } });
    const asked = await client.setup.plan({ folder, step: 3 });
    assert.equal(asked.ok, true, asked.refused);
    assert.equal(asked.ask?.id, 'which', 'its question is asked while step 2 is unfinished');
    setWorld(home, { 3: [KEY(3)], after: { 3: [2] } });
    const waiting = await client.setup.plan({ folder, step: 3 });
    assert.equal(waiting.ok, true, waiting.refused);
    assert.equal(waiting.card, undefined, 'no Go ahead is shown');
    assert.ok(Number.isFinite(waiting.wait) && waiting.wait > 0);
    assert.match(waiting.why, /^step 2 \(Tools\) is not done yet/);
    const run = runOf(folder);
    assert.equal(run.steps[3]?.shownAt, undefined);
    // While step 2 runs with an installer, the wait names it.
    markStep(run.id, 2, 'clickedAt', { now: () => T0 });
    addChanges(run.id, [{ id: newId('chg'), step: 2, kind: 'process', target: 'Install Command Line Developer Tools', before: null, after: { tool: 'git', pid: 4242, startedAt: T0.toISOString(), image: 'Install Command Line Developer Tools' } }]);
    assert.match((await client.setup.plan({ folder, step: 3 })).why, /^step 2 is still installing: git/);
    // Apply refuses as a backstop, whatever it is sent, and uses no click.
    const listed = [{ kind: 'json-key', target: path.join(fs.realpathSync.native(folder), '.claude', 'x.json'), key: ['wheelhouse', 'a'], after: 3 }];
    click(3, planHash(listed));
    assert.match((await client.setup.apply({ folder, step: 3, hash: planHash(listed) })).refused, /^step 2 is still installing: git/);
    // Once step 2 failed, the installer is not named: nothing says it is still running.
    markStep(run.id, 2, 'failed', { now: () => T0, reason: 'the git installer closed before it finished' });
    assert.match((await client.setup.plan({ folder, step: 3 })).why, /^step 2 \(Tools\) did not finish/);
    assert.match((await client.setup.apply({ folder, step: 3, hash: planHash(listed) })).refused, /^step 2 \(Tools\) did not finish/);
    assert.equal(written(folder), null, 'nothing was written');
    assert.equal(runOf(folder).steps[3]?.clickedAt, undefined);
    // Once step 2 is done, the Go ahead is shown, and the click the director gave meanwhile counts.
    markStep(run.id, 2, 'doneAt', { now: () => T0 });
    const plan = await client.setup.plan({ folder, step: 3 });
    assert.equal(plan.hash, planHash(listed));
    const done = await client.setup.apply({ folder, step: 3, hash: plan.hash });
    assert.equal(done.ok, true, done.refused);
    assert.deepEqual(written(folder), { wheelhouse: { a: 3 } });
  });
});

test('the steps a step waits for must be other steps\' numbers, and those it asks during among them', () => {
  assert.deepEqual(stepsBefore({ n: 3 }), []);
  assert.deepEqual(stepsBefore({ n: 3, after: [2] }), [2]);
  for (const after of [[3], [11], ['2'], 2, null]) assert.throws(() => stepsBefore({ n: 3, after }), /other steps' numbers/, JSON.stringify(after));
  assert.deepEqual(asksDuring({ n: 3, after: [2] }), []);
  assert.deepEqual(asksDuring({ n: 3, after: [2], asksDuring: [2] }), [2]);
  for (const during of [[4], [3], ['2'], 2, null]) assert.throws(() => asksDuring({ n: 3, after: [2], asksDuring: during }), /steps it waits for/, JSON.stringify(during));
});
