// tests/scripts/setup/questions.test.js
// Step 4, Three questions (design section 15): what the product is and who uses it, and whether it
// has live data; step 3 asks whether it has real users (ruling R37: the Mac-only offer of Locked is
// step 3's, tested in host.test.js). The first answer records the product's glossary entry and its
// phase, which the prompt record signs from the click (rulings R38, R59); live data reaches step 7
// through the answers; the step settles with no Go ahead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { questionsStep, readmeDescription, LIVE_DATA, PRODUCT, PROJECT_WAIT_MS } from '../../../scripts/setup/questions.js';
import { REAL_USERS, LEVELS } from '../../../scripts/setup/host.js';
import { noteAsked, answersFor } from '../../../scripts/setup/clicks.js';
import { keepAnswer } from '../../../scripts/lib/setup-clicks.js';
import { findRun, readJournal, startRun } from '../../../scripts/setup/journal.js';
import { checkSetting } from '../../../scripts/settings/catalogue.js';
import { eventHash, makeEvent } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { readEnrolled, verify } from '../../../scripts/state/signing.js';
import { setLineOf } from '../../../scripts/state/card-lines.js';
import { withProject, T0 } from '../../helpers/setup-answers.js';

const README = '# Café Menu\n\n![badge](x.svg)\n\nCafé Menu lets a small café put its menu online, for its regulars to read on their phones. It is built with care.\n';

// Step 3's answers, as the director gave them on step 3's cards: asked for the folder's run and
// kept signed, as the helper and the prompt record keep them. Gives them as ctx.answers holds them.
function answerStep3(folder, { realUsers, locked }) {
  const run = findRun(folder) ?? startRun({ folder, now: () => T0 });
  const keepOne = (id, labels, label) => {
    const card = { question: `What this is: step 3 asks ${id}.`, header: 'Question', options: labels.map((l) => ({ label: l, description: l })) };
    noteAsked({ runId: run.id, folder, step: 3, id, card, now: () => T0 });
    keepAnswer(makeEvent({ kind: 'action', data: { action: 'setup-answer', runId: run.id, step: 3, questionId: id, question: card.question, label, text: null }, now: () => T0 }));
  };
  keepOne('real-users', [REAL_USERS.yes, REAL_USERS.no], realUsers);
  if (locked) keepOne('locked', [LEVELS.locked, LEVELS.standard], locked);
  return answersFor(run.id);
}

test('step 4 waits until step 3 has set up the project\'s records, and asks nothing meanwhile', async () => {
  await withProject(async ({ folder, plan, home }) => {
    const got = await plan(4);
    assert.equal(got.ok, true, got.refused);
    assert.equal(got.wait, PROJECT_WAIT_MS);
    assert.match(got.why, /step 3/);
    assert.equal(fs.existsSync(path.join(home, 'setup', 'asked')), false);
    // With step 3's answers in, still the same: the answers need the project's records.
    const step = questionsStep();
    assert.deepEqual(await step.plan({ folder, answers: { '3.real-users': { label: REAL_USERS.yes } } }), { wait: got.wait, why: got.why });
  }, { connected: false, files: { 'README.md': README } });
});

test('each answer writes its setting or configuration key, checked by the catalogue', async () => {
  for (const [realUsers, phase] of [[REAL_USERS.yes, 'launched'], [REAL_USERS.no, 'before-launch']]) {
    await withProject(async ({ folder, plan, answer, home }) => {
      // Until step 3 has asked about real users, step 4 waits; then it reads that answer and does
      // not ask it again.
      const first = await plan(4);
      assert.equal(first.wait, PROJECT_WAIT_MS);
      assert.match(first.why, /real users/);
      const step3 = answerStep3(folder, { realUsers });
      // The questions, as the plan gives them with step 3's answers in.
      const step = questionsStep();
      const productAsk = (await step.plan({ folder, answers: step3 })).ask;
      assert.equal(productAsk.id, 'product');
      assert.equal(productAsk.typed, true);
      assert.deepEqual(productAsk.card.options.map((o) => o.label), [PRODUCT.readme, PRODUCT.later]);
      assert.match(productAsk.card.what, /Cafe-Menu's entry in the glossary/);
      assert.match(productAsk.card.what, phase === 'launched' ? /as launched, since it has real users/ : /as before launch, since it has no real users yet/);
      const described = readmeDescription(folder);
      assert.equal(described, 'Café Menu lets a small café put its menu online, for its regulars to read on their phones.');
      // Every setting an answer writes is one the catalogue takes.
      const settings = [...Object.values(productAsk.writes.labels).flat(), ...productAsk.writes.typed].filter((w) => w.kind === 'setting');
      assert.ok(settings.length >= 3);
      for (const w of settings) {
        assert.deepEqual(w.data, { key: 'phase', value: phase });
        assert.doesNotThrow(() => checkSetting(w.data.key, w.data.value));
      }
      // No configuration key for real users (ruling R38): the phase is the one place it is kept.
      assert.ok(!JSON.stringify(productAsk).includes('realUsers'));

      // Through the helper: the card asked is composed as a question, with no set line.
      const asked = await plan(4);
      assert.equal(asked.ask.id, 'product');
      assert.equal(setLineOf(asked.ask.card.question), null);
      assert.ok(!asked.ask.card.question.includes('Reply code:'));

      // The director types what the product is: the click records the glossary entry, and the
      // phase with its confirmation, in the project's state, then the answer.
      const sent = await answer(asked.ask.card, 'A menu for a small café, read by its regulars.');
      assert.deepEqual(sent.map((s) => s.route), ['write', 'record']);
      const [entry, phased] = sent;
      assert.deepEqual(entry.body.kind, 'glossary');
      assert.deepEqual(entry.body.data, { term: 'Cafe-Menu', plain: 'A menu for a small café, read by its regulars.' });
      assert.match(entry.body.id, /^[0-9a-f-]{36}$/);
      const { event: confirmation, target } = phased.body;
      assert.equal(target.kind, 'setting');
      assert.deepEqual(target.data, { key: 'phase', value: phase, words: `Product phase: ${phase}` });
      assert.equal(confirmation.kind, 'confirmation');
      assert.deepEqual(confirmation.data, { confirms: target.id, confirmsHash: eventHash(target) });
      assert.equal(verify(confirmation, readEnrolled()), true);
      // In the state, the phase counts at once: confirmed by the director's own click.
      const glossary = makeEvent({ kind: 'glossary', data: entry.body.data, now: () => T0 });
      const views = buildViews([glossary, target, confirmation], readEnrolled(), { now: () => T0 });
      assert.equal(views.settings.phase.value, phase);
      assert.equal(views.glossary['Cafe-Menu'].data.plain, 'A menu for a small café, read by its regulars.');
      assert.deepEqual(views.unconfirmed, []);
      // The answer is kept for the run, typed.
      const runId = findRun(folder).id;
      assert.deepEqual(answersFor(runId)['4.product'].text, 'A menu for a small café, read by its regulars.');

      // Then live data, which records nothing in the state: step 7 writes liveData from it.
      const live = await plan(4);
      assert.equal(live.ask.id, 'live-data');
      assert.deepEqual(live.ask.card.options.map((o) => o.label), [LIVE_DATA.yes, LIVE_DATA.no, 'Explain more']);
      assert.match(live.ask.card.options[0].description, /test data only/);
      assert.deepEqual(await answer(live.ask.card, LIVE_DATA.yes), []);
      assert.equal(answersFor(runId)['4.live-data'].label, LIVE_DATA.yes);

      // Every answer in: the step settles, with no Go ahead, its record in the journal.
      const done = await plan(4);
      assert.deepEqual(done, { ok: true, done: true });
      const settled = readJournal().runs.find((r) => r.id === runId);
      assert.equal(typeof settled.steps[4].doneAt, 'string');
      assert.deepEqual(settled.changes.filter((c) => c.step === 4).map((c) => [c.kind, c.after]), [['answer', { described: true, phase, locked: false, liveData: true }]]);
      assert.equal(fs.existsSync(path.join(home, 'setup', 'shown')), false, 'no Go-ahead card');
    }, { files: { 'README.md': README } });
  }
});


test('the README\'s words, or a description left for later, record what the card says', async () => {
  await withProject(async ({ folder, plan, answer }) => {
    answerStep3(folder, { realUsers: REAL_USERS.yes, locked: LEVELS.locked });
    const asked = await plan(4);
    const readme = await answer(asked.ask.card, PRODUCT.readme);
    assert.deepEqual(readme[0].body.data, { term: 'Cafe-Menu', plain: readmeDescription(folder) });
    assert.equal(readme[1].body.target.data.value, 'launched');
  }, { files: { 'README.md': README } });

  // No README: the director types it, or leaves it for later, which records the phase alone.
  await withProject(async ({ folder, plan, answer }) => {
    answerStep3(folder, { realUsers: REAL_USERS.no });
    const asked = await plan(4);
    assert.deepEqual(asked.ask.card.options.map((o) => o.label), [PRODUCT.later, 'Explain more']);
    const later = await answer(asked.ask.card, PRODUCT.later);
    assert.deepEqual(later.map((s) => [s.route, s.body.target?.data.value]), [['record', 'before-launch']]);
    // Explain more records nothing and is no answer.
    assert.deepEqual(await answer(asked.ask.card, 'Explain more'), []);
  });
});

test('a typed description holding a key records nothing, and the question is asked again', async () => {
  await withProject(async ({ folder, plan, answer, home }) => {
    answerStep3(folder, { realUsers: REAL_USERS.no });
    const asked = await plan(4);
    const key = `ghp_${'b'.repeat(36)}`;
    assert.deepEqual(await answer(asked.ask.card, `Our menu app, token ${key}`), []);
    assert.equal(answersFor(findRun(folder).id)['4.product'], undefined);
    assert.equal((await plan(4)).ask.id, 'product');
    const holding = (dir) => fs.readdirSync(dir, { withFileTypes: true }).some((e) => (e.isDirectory()
      ? holding(path.join(dir, e.name)) : fs.readFileSync(path.join(dir, e.name), 'utf8').includes(key)));
    assert.equal(holding(home), false);
  });
});
