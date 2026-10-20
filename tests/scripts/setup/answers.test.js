// tests/scripts/setup/answers.test.js
// Setup's answer path (rulings R30 to R32): a step's plan may ask the director a question in
// place of giving its list. The helper composes and records the card as asked; the prompt record
// keeps a signed answer only on that exact card, for its run; the answers reach every step's plan,
// so a Go ahead's hash includes them. A step may also wait, or settle on its answers alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { makeSigningKey, enrol, readEnrolled, verify } from '../../../scripts/state/signing.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { findRun, markStep, reverseChange } from '../../../scripts/setup/journal.js';
import { answersFor, noteAsked, notAnAnswer } from '../../../scripts/setup/clicks.js';
import { planHash } from '../../../scripts/setup/steps.js';
import { runStep } from '../../../scripts/setup/run-step.js';
import { main as cli } from '../../../scripts/setup/cli.js';
import { AFTER_WAIT_MS, NOT_AN_ANSWER } from '../../../scripts/setup/engine.js';
import { decide } from '../../../scripts/hooks/prompt-record.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

const STEPS_MODULE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'helpers', 'setup-steps.js');
const T0 = new Date('2026-10-19T03:00:00.000Z');
const MINUTE = 60 * 1000;
const HOST = { id: 'host', options: ['GitHub', 'GitLab'] };

function setWorld(home, world) {
  fs.writeFileSync(path.join(home, 'test-world.json'), JSON.stringify(world));
}

// A Wheelhouse home with this computer's key enrolled, a user's home with a space and an accent,
// and two product folders under its Projects. `extra` goes to the helper.
async function withSetup(fn, extra = {}) {
  const home = shortHome();
  const user = tempFolder('wh-user zoë ');
  const folder = path.join(user, 'Projects', 'Café Menu');
  const other = path.join(user, 'Projects', 'Other');
  fs.mkdirSync(folder, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  await as(home, async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
    const helper = await startHelper({
      address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({}),
      now: () => T0, setupSteps: STEPS_MODULE, userHome: user, ...extra,
    });
    try {
      await fn({ client: helperClient({ address: helper.address }), home, user, folder: fs.realpathSync.native(folder), other: fs.realpathSync.native(other) });
    } finally {
      await helper.close();
    }
  });
}

// The director's click on `card` in a session in `cwd`, as the prompt record sees it, a minute
// before the helper's clock. `options` stands in for the card's own, when a test changes them.
async function choose(cwd, card, label, { at = new Date(T0.getTime() - MINUTE) } = {}) {
  await decide({
    cwd, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
    tool_input: { questions: [card], answers: { [card.question]: label } },
    tool_response: { answers: { [card.question]: label } },
  }, { now: () => at, projectOf: () => null });
}

const dir = (home, name) => path.join(home, 'setup', name);
const files = (home, name) => {
  try {
    return fs.readdirSync(dir(home, name)).sort();
  } catch {
    return [];
  }
};
const kept = (home) => files(home, 'answers').map((n) => JSON.parse(fs.readFileSync(path.join(dir(home, 'answers'), n), 'utf8')));

test('a question card is recorded as asked and an exact answer is kept, signed, for its run', async () => {
  await withSetup(async ({ client, home, folder }) => {
    setWorld(home, { ask: { 3: [HOST] } });
    const asked = await client.setup.plan({ folder, step: 3 });
    assert.equal(asked.ok, true, asked.refused);
    assert.equal(asked.hash, undefined, 'a question has no list, so no hash');
    assert.equal(asked.changes, undefined);
    assert.deepEqual(Object.keys(asked.ask).sort(), ['card', 'id', 'step']);
    assert.equal(asked.ask.step, 3);
    assert.equal(asked.ask.id, 'host');
    const { card } = asked.ask;
    assert.equal(card.header, 'Question');
    assert.deepEqual(card.options.map((o) => o.label), ['GitHub', 'GitLab', 'Explain more']);
    assert.ok(card.question.startsWith('What this is: Setup step 3 needs to know'), card.question);
    assert.ok(!/Reply code:|Set up step/.test(card.question), card.question);
    // Recorded as asked for this run; the step's shown time is the Go-ahead card's, so none yet.
    const run = findRun(folder);
    assert.deepEqual(files(home, 'asked'), [`${run.id}-3-host.json`]);
    const record = JSON.parse(fs.readFileSync(path.join(dir(home, 'asked'), `${run.id}-3-host.json`), 'utf8'));
    assert.deepEqual([record.runId, record.folder, record.step, record.id, record.typed], [run.id, folder, 3, 'host', false]);
    assert.deepEqual(record.card, { question: card.question, header: card.header, options: card.options.map((o) => ({ label: o.label, description: o.description })) });
    assert.equal(run.steps[3]?.shownAt, undefined);
    assert.deepEqual(files(home, 'shown'), []);

    // The director's click on that very card is kept, signed by this computer, for this run.
    await choose(folder, card, 'GitHub');
    const [answer, ...rest] = kept(home);
    assert.deepEqual(rest, []);
    assert.equal(answer.kind, 'action');
    assert.deepEqual(answer.data, { action: 'setup-answer', runId: run.id, step: 3, questionId: 'host', question: card.question, label: 'GitHub', text: null });
    assert.equal(verify(answer, readEnrolled()), true);
    assert.deepEqual(files(home, 'clicks'), [], 'an answer is not a Go ahead');
    assert.deepEqual(answersFor(run.id), { '3.host': { label: 'GitHub', text: null, at: answer.at } });
    // With its answer in, the step gives its Go-ahead card.
    const plan = await client.setup.plan({ folder, step: 3 });
    assert.equal(plan.ok, true, plan.refused);
    assert.match(plan.hash, /^[0-9a-f]{64}$/);
  });
});

test('an answer on a reworded card, another run\'s card, or Explain more is not kept', async () => {
  await withSetup(async ({ client, home, folder, other }) => {
    setWorld(home, { ask: { 3: [HOST], 4: [{ id: 'name', options: ['Keep it'], typed: true }] } });
    const { card } = (await client.setup.plan({ folder, step: 3 })).ask;
    const { card: typed } = (await client.setup.plan({ folder, step: 4 })).ask;
    const reworded = [
      { ...card, question: card.question.replace('needs to know', 'would like to know') },
      { ...card, header: 'Setup' },
      { ...card, options: card.options.map((o) => (o.label === 'GitHub' ? { ...o, description: 'Setup uses GitHub for everything.' } : o)) },
      { ...card, options: [...card.options, { label: 'Bitbucket', description: 'Setup uses Bitbucket.' }] },
    ];
    for (const shown of reworded) await choose(folder, shown, 'GitHub');
    // A put-off is never an answer, even on a card that takes typed answers.
    await choose(folder, card, 'Explain more');
    await choose(folder, typed, 'Explain more');
    await choose(folder, typed, 'Not now');
    // The card asked for this folder, answered in a session in another product's folder, which
    // has a run of its own.
    await client.setup.plan({ folder: other, step: 1 });
    await choose(other, card, 'GitHub');
    assert.deepEqual(kept(home), []);

    // A kept answer whose words were changed after it was signed, or that names another run, or
    // whose card was asked again in other words, does not count.
    await choose(folder, card, 'GitLab');
    const run = findRun(folder);
    assert.deepEqual(Object.keys(answersFor(run.id)), ['3.host']);
    const [name] = files(home, 'answers');
    const file = path.join(dir(home, 'answers'), name);
    const signed = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...signed, data: { ...signed.data, label: 'GitHub' } }));
    assert.deepEqual(answersFor(run.id), {});
    fs.writeFileSync(file, JSON.stringify(signed));
    assert.deepEqual(Object.keys(answersFor(run.id)), ['3.host']);
    assert.deepEqual(answersFor(findRun(other).id), {});
    // The question asked again in other words: the earlier answer was to the words before.
    const record = JSON.parse(fs.readFileSync(path.join(dir(home, 'asked'), `${run.id}-3-host.json`), 'utf8'));
    noteAsked({ ...record, card: { ...record.card, question: record.card.question.replace('needs to know', 'asks') } });
    assert.deepEqual(answersFor(run.id), {});
  });
});

test('a typed answer counts only where the card allows it, and one holding a password is not kept', async () => {
  await withSetup(async ({ client, home, folder }) => {
    setWorld(home, { ask: { 3: [HOST], 4: [{ id: 'name', options: ['Keep it'], typed: true }] } });
    const { card } = (await client.setup.plan({ folder, step: 3 })).ask;
    const { card: typed } = (await client.setup.plan({ folder, step: 4 })).ask;
    // Typed where the card takes only its own options.
    await choose(folder, card, 'Bitbucket');
    assert.deepEqual(kept(home), []);
    // Typed text that holds a key or a password in an address.
    await choose(folder, typed, `ghp_${'a'.repeat(36)}`);
    await choose(folder, typed, 'postgres://me:hunter2pass@db.example.com/shop');
    assert.deepEqual(kept(home), []);
    // Typed where the card takes it: the text is kept, with no label.
    await choose(folder, typed, 'Café Menu for the shop');
    const [answer] = kept(home);
    assert.deepEqual([answer.data.label, answer.data.text, answer.data.questionId, answer.data.step], [null, 'Café Menu for the shop', 'name', 4]);
    assert.deepEqual(answersFor(findRun(folder).id)['4.name'], { label: null, text: 'Café Menu for the shop', at: answer.at });
    // The card's own option is kept as its label.
    await choose(folder, typed, 'Keep it', { at: T0 });
    assert.deepEqual(answersFor(findRun(folder).id)['4.name'], { label: 'Keep it', text: null, at: T0.toISOString() });
  });
});

test('the answers reach the step\'s plan, in the helper and in the long step\'s process, so the hash includes them', async () => {
  await withSetup(async ({ client, home, user, folder }) => {
    setWorld(home, { ask: { 3: [HOST] }, uses: { 1: ['3.host'], 2: ['3.host'] } });
    await choose(folder, (await client.setup.plan({ folder, step: 3 })).ask.card, 'GitLab');
    // A short step, in the helper: its list holds the answer, and so does the hash its card names.
    const plan = await client.setup.plan({ folder, step: 1 });
    assert.equal(plan.ok, true, plan.refused);
    assert.deepEqual(plan.changes.map((c) => [c.key, c.after]), [[['3.host'], 'GitLab']]);
    assert.equal(plan.hash, planHash(plan.changes));
    await choose(folder, plan.card, 'Go ahead');
    const done = await client.setup.apply({ folder, step: 1, hash: plan.hash });
    assert.equal(done.ok, true, done.refused);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, '.claude', 'answers.json'), 'utf8')), { '3.host': 'GitLab' });

    // A long step's own process works the list out with the answers too, or its hash would differ.
    fs.rmSync(path.join(folder, '.claude', 'answers.json'));
    const long = await client.setup.plan({ folder, step: 2 });
    const run = findRun(folder);
    const clicked = new Date();
    markStep(run.id, 2, 'clickedAt', { now: () => clicked });
    const code = await runStep([STEPS_MODULE, folder, '2', long.hash, run.id, clicked.toISOString(), new Date(clicked.getTime() + 20 * MINUTE).toISOString(), user], { exit: () => {} });
    assert.equal(code, 0, findRun(folder).steps[2]?.failed);
    assert.ok(findRun(folder).steps[2].doneAt);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, '.claude', 'answers.json'), 'utf8')), { '3.host': 'GitLab' });
  });
});

test('an answer that changes an earlier step\'s list makes its Go ahead CHANGED', async () => {
  await withSetup(async ({ client, home, folder }) => {
    setWorld(home, { ask: { 3: [HOST] }, uses: { 1: ['3.host'] } });
    const { card } = (await client.setup.plan({ folder, step: 3 })).ask;
    await choose(folder, card, 'GitHub', { at: new Date(T0.getTime() - 3 * MINUTE) });
    const first = await client.setup.plan({ folder, step: 1 });
    assert.deepEqual(first.changes.map((c) => c.after), ['GitHub']);
    await choose(folder, first.card, 'Go ahead', { at: new Date(T0.getTime() - 2 * MINUTE) });
    // The director answers step 3's card again: the newest answer is the one that counts.
    await choose(folder, card, 'GitLab', { at: new Date(T0.getTime() - MINUTE) });
    const refused = await client.setup.apply({ folder, step: 1, hash: first.hash });
    assert.equal(refused.ok, false);
    assert.match(refused.refused, /changed since the card/);
    assert.equal(fs.existsSync(path.join(folder, '.claude', 'answers.json')), false);
    // Its card is asked again, naming the new list.
    const second = await client.setup.plan({ folder, step: 1 });
    assert.deepEqual(second.changes.map((c) => c.after), ['GitLab']);
    assert.notEqual(second.hash, first.hash);
    await choose(folder, second.card, 'Go ahead');
    assert.equal((await client.setup.apply({ folder, step: 1, hash: second.hash })).ok, true);
  });
});

test('a settled step is marked done with its answer recorded, and needs no Go ahead', async () => {
  await withSetup(async ({ client, home, folder }) => {
    setWorld(home, { ask: { 5: [{ id: 'rules', options: ['Yes', 'No'] }] }, settle: [5, 6] });
    const asked = await client.setup.plan({ folder, step: 5 });
    await choose(folder, asked.ask.card, 'Yes');
    const settled = await client.setup.plan({ folder, step: 5 });
    assert.deepEqual(settled, { ok: true, done: true });
    const run = findRun(folder);
    assert.ok(run.steps[5].doneAt);
    assert.equal(run.steps[5].clickedAt, undefined, 'no Go ahead');
    const change = run.changes.find((c) => c.step === 5);
    assert.deepEqual([change.kind, change.after], ['answer', { rules: 'Yes' }]);
    assert.deepEqual(reverseChange(change), { put: false, why: 'nothing to put back' });
    assert.match((await client.setup.plan({ folder, step: 5 })).refused, /already done/);
    assert.match((await client.setup.apply({ folder, step: 5, hash: 'a'.repeat(64) })).refused, /already done/);
    // A step with nothing to ask and nothing to do settles at once, with an empty record.
    assert.deepEqual(await client.setup.plan({ folder, step: 6 }), { ok: true, done: true });
    assert.deepEqual(findRun(folder).changes.find((c) => c.step === 6).after, {});
    const lines = (await client.setup.status({ folder })).lines;
    assert.ok(lines.some((l) => /^Step 5, Rules found: done at /.test(l)), lines.join('\n'));
    assert.deepEqual(files(home, 'clicks'), []);
    // A settling whose record is not an object is refused, and marks nothing.
    for (const bad of [null, [1, 2], 'yes']) {
      setWorld(home, { settle: [7], record: { 7: bad } });
      const refused = await client.setup.plan({ folder, step: 7 });
      assert.equal(refused.ok, false, JSON.stringify(bad));
      assert.match(refused.refused, /settling without its record/);
    }
    assert.equal(findRun(folder).steps[7]?.doneAt, undefined);
  });
});

// The engine's one ordering (ruling R70): a step that waits for others is not asked, settled or
// shown its Go ahead before they are done, and the wait names the step it waits for, so the
// playbook never reads it as the step's own wait (step 9's "push once it is over"). Only the steps
// it names in `asksDuring` let its questions be asked meanwhile (ruling R54: step 3's while step
// 2's installers run).
test('a step\'s questions and its settling wait for the steps it waits for, but for those it asks during', async () => {
  await withSetup(async ({ client, home, folder }) => {
    const world = { ask: { 5: [{ id: 'rules', options: ['Yes', 'No'] }] }, settle: [5], after: { 5: [4] } };
    setWorld(home, world);
    const waiting = await client.setup.plan({ folder, step: 5 });
    assert.equal(waiting.ok, true, waiting.refused);
    assert.equal(waiting.ask, undefined, 'not asked while step 4 is unfinished');
    assert.equal(waiting.wait, AFTER_WAIT_MS);
    assert.equal(waiting.waitsFor, 4);
    assert.match(waiting.why, /^step 4 \(Three questions\) is not done yet/);
    assert.deepEqual(files(home, 'asked'), []);
    const printed = async (argv) => {
      let out = '';
      assert.equal(await cli(argv, { client, cwd: folder, out: (t) => { out += t; }, err: () => {} }), 0);
      return JSON.parse(out);
    };
    assert.deepEqual(await printed(['plan', '5']), { step: 5, title: 'Rules found', wait: AFTER_WAIT_MS, why: waiting.why, waitsFor: 4 });

    // Asked during step 4 when the step names it so.
    setWorld(home, { ...world, asksDuring: { 5: [4] } });
    const asked = await client.setup.plan({ folder, step: 5 });
    assert.equal(asked.ask?.id, 'rules');
    await choose(folder, asked.ask.card, 'Yes');
    // Every answer is in, but it does not settle before step 4 is done.
    const held = await client.setup.plan({ folder, step: 5 });
    assert.equal(held.ok, true, held.refused);
    assert.equal(held.done, undefined);
    assert.equal(held.waitsFor, 4);
    assert.equal(findRun(folder).steps[5]?.doneAt, undefined);
    assert.equal(findRun(folder).changes.filter((c) => c.step === 5).length, 0);
    markStep(findRun(folder).id, 4, 'doneAt', { now: () => T0 });
    assert.deepEqual(await client.setup.plan({ folder, step: 5 }), { ok: true, done: true });
  });
});

test('a wait is passed to the playbook', async () => {
  await withSetup(async ({ client, home, folder }) => {
    setWorld(home, { wait: { 9: { ms: 2 * MINUTE, why: 'the push test waits two minutes' } }, ask: { 3: [HOST] } });
    assert.deepEqual(await client.setup.plan({ folder, step: 9 }), { ok: true, wait: 2 * MINUTE, why: 'the push test waits two minutes' });
    // The command prints the wait, and the question card exactly as the helper gave it.
    const run = async (argv) => {
      let out = '';
      let err = '';
      const code = await cli(argv, { client, cwd: folder, out: (t) => { out += t; }, err: (t) => { err += t; } });
      assert.equal(code, 0, err);
      return JSON.parse(out);
    };
    assert.deepEqual(await run(['plan', '9']), { step: 9, title: 'Phone notifications', wait: 2 * MINUTE, why: 'the push test waits two minutes' });
    const asked = await client.setup.plan({ folder, step: 3 });
    assert.deepEqual(await run(['plan', '3']), { step: 3, title: 'The host and the connection', ask: asked.ask });
    setWorld(home, { settle: [4] });
    assert.deepEqual(await run(['plan', '4']), { step: 4, title: 'Three questions', done: true });
  });
});

test('a setup answer is an action naming the run, the step, the question and its label or its text', () => {
  const home = shortHome();
  return as(home, () => {
    makeSigningKey();
    const make = (data) => makeEvent({
      kind: 'action',
      data: { action: 'setup-answer', runId: 'run-0123456789', step: 3, questionId: 'host', question: 'Which host?', label: 'GitHub', text: null, ...data },
    });
    assert.deepEqual(Object.keys(make({}).data).sort(), ['action', 'label', 'question', 'questionId', 'runId', 'step', 'text']);
    assert.equal(make({ label: null, text: 'Bitbucket' }).data.text, 'Bitbucket');
    assert.throws(() => make({ runId: 'run-x' }), /run/);
    assert.throws(() => make({ step: 11 }), /step/);
    assert.throws(() => make({ questionId: 'Host!' }), /question/);
    assert.throws(() => make({ questionId: 'a'.repeat(41) }), /question/);
    assert.throws(() => make({ text: 'Bitbucket' }), /label or/);
    assert.throws(() => make({ label: null }), /label or/);
    assert.throws(() => make({ label: null, text: '' }), /label or/);
    assert.throws(() => make({ label: 'Explain more' }), /not an answer/);
    assert.throws(() => make({ hash: 'a'.repeat(64) }), /field/);
  });
});

// Ruling R125: a typed question, or the choice handed back, is no answer.
test('only a question or the choice handed back, alone, is no answer; any other typed text is one (ruling R125)', () => {
  for (const text of ['what do you mean?', 'Which one is cheaper ? ', 'you decide', 'You Choose.', 'not sure', 'I don\'t know', 'I don\u2019t know!', 'SKIP', ' whatever ', 'you  decide']) {
    assert.equal(notAnAnswer(text), true, text);
  }
  for (const text of ['A menu for the café, with prices.', 'Skip the prices for now', 'whatever sells best on Fridays', 'I don\'t know the name yet, call it Café', 'Not sure about colours, but a menu', null, 7]) {
    assert.equal(notAnAnswer(text), false, String(text));
  }
});

test('a typed question or "you decide" on a setup card is not taken as the answer: the card is asked again, saying why once, and a real answer then counts (ruling R125)', async () => {
  let clock = T0;
  await withSetup(async ({ client, home, folder }) => {
    setWorld(home, { ask: { 4: [{ id: 'name', options: ['Keep it'], typed: true }] }, settle: [4] });
    const asked = await client.setup.plan({ folder, step: 4 });
    assert.equal(asked.unanswered, undefined);
    const run = findRun(folder);
    const texts = ['what do you mean?', 'you decide', 'Not sure.'];
    for (const [i, text] of texts.entries()) {
      clock = new Date(T0.getTime() + (i + 1) * MINUTE);
      // Typed after the card was last asked.
      await choose(folder, asked.ask.card, text, { at: new Date(clock.getTime() - 1000) });
      assert.equal(kept(home).length, i + 1, 'the record stays as the prompt record kept it');
      assert.deepEqual(answersFor(run.id), {}, text);
      const again = await client.setup.plan({ folder, step: 4 });
      assert.equal(again.ok, true, again.refused);
      assert.equal(again.ask?.id, 'name', text);
      assert.deepEqual(again.ask.card, asked.ask.card, 'the same card, asked again');
      assert.equal(again.unanswered, NOT_AN_ANSWER, text);
    }
    // Said once: asked again with nothing new typed, the line is not repeated.
    clock = new Date(T0.getTime() + 10 * MINUTE);
    const quiet = await client.setup.plan({ folder, step: 4 });
    assert.equal(quiet.ask?.id, 'name');
    assert.equal(quiet.unanswered, undefined);
    // Through the command, the line comes with the card.
    clock = new Date(T0.getTime() + 11 * MINUTE);
    await choose(folder, asked.ask.card, 'whatever', { at: new Date(clock.getTime() - 1000) });
    let out = '';
    const code = await cli(['plan', '4'], { client, cwd: folder, out: (t) => { out += t; }, err: () => {} });
    assert.equal(code, 0);
    assert.equal(JSON.parse(out).unanswered, NOT_AN_ANSWER);
    // A typed answer that is one counts, and the step settles on it.
    clock = new Date(T0.getTime() + 12 * MINUTE);
    await choose(folder, asked.ask.card, 'A menu for the café, with prices.', { at: new Date(clock.getTime() - 1000) });
    assert.equal(answersFor(run.id)['4.name'].text, 'A menu for the café, with prices.');
    const settled = await client.setup.plan({ folder, step: 4 });
    assert.equal(settled.done, true, JSON.stringify(settled));
  }, { now: () => clock });
});
