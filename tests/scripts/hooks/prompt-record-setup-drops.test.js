// tests/scripts/hooks/prompt-record-setup-drops.test.js
// An answer on a card a setup step asked, in a folder with no project record yet (step 4's
// description, asked with the questions up front): the answer is found where Claude Code puts it,
// a claim left by a hook cut short does not hold the card for ever, and every answer on such a card
// that is not kept leaves a line in setup/dropped.log saying why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { decide } from '../../../scripts/hooks/prompt-record.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { startRun } from '../../../scripts/setup/journal.js';
import { noteAsked, noteShown, clicksDir } from '../../../scripts/setup/clicks.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { setLineOf } from '../../../scripts/state/card-lines.js';

const NOW = new Date('2026-11-03T00:00:00.000Z');
const PLAIN = 'A stock tool for shift leads (SLs) in example distribution centres.';
const README = 'The README\'s words';
const CARD = {
  question: 'In a sentence, what is example_tool, and who uses it? Choose the README\'s words, or type your own as your answer.\n'
    + 'Wheelhouse explains its work to you in terms of your product; it is recorded as launched.\nNothing runs until your Go ahead on the plan.\nTo know more, just ask.',
  header: 'Question',
  options: [
    { label: README, description: `Recommended: "${PLAIN}", because it is how the project already describes itself.` },
    { label: 'Describe it later', description: 'Setup records no description of it yet; you can give one to the First Mate later.' },
  ],
};
const PHASE = { kind: 'setting', data: { key: 'phase', value: 'launched' } };
const WRITES = {
  labels: { [README]: [{ kind: 'glossary', data: { term: 'example_tool', plain: PLAIN } }, PHASE], 'Describe it later': [PHASE] },
  typed: [{ kind: 'glossary', data: { term: 'example_tool', plain: '' }, typedInto: 'plain' }, PHASE],
};

async function inSetup(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-drops-'));
  const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-drops-tool-')));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const run = startRun({ folder, now: () => NOW });
    noteAsked({ runId: run.id, folder, step: 4, id: 'product-launched', card: CARD, typed: true, writes: WRITES, now: () => NOW });
    return await fn({ home, folder, run });
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

const shown = { ...CARD, multiSelect: false };
const answersOf = (label) => ({ [CARD.question]: label });
const click = (cwd, { toolInput = true, response = 'object', label = README } = {}) => ({
  cwd, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
  tool_input: { questions: [shown], ...(toolInput ? { answers: answersOf(label) } : {}) },
  ...(response === 'object' ? { tool_response: { questions: [shown], answers: answersOf(label) } } : {}),
  ...(response === 'string' ? { tool_response: JSON.stringify({ questions: [shown], answers: answersOf(label) }) } : {}),
});
const run = (input) => decide(input, { now: () => NOW, projectOf: () => null, client: {} });
const listOf = (home, dir) => {
  try {
    return fs.readdirSync(path.join(home, 'setup', dir));
  } catch {
    return [];
  }
};
const keptLabels = (home) => listOf(home, 'answers').map((n) => JSON.parse(fs.readFileSync(path.join(home, 'setup', 'answers', n), 'utf8')).data.label);
const dropped = (home) => {
  try {
    return fs.readFileSync(path.join(home, 'setup', 'dropped.log'), 'utf8');
  } catch {
    return '';
  }
};

test('an answer on the description card asked before step 3 is kept, with its records, as setup reads it', async () => {
  await inSetup(async ({ home, folder }) => {
    await run(click(folder));
    assert.deepEqual(keptLabels(home), [README]);
    assert.equal(listOf(home, 'records').length, 2);
    assert.equal(dropped(home), '');
  });
});

test('an answer Claude Code gives only in its tool response is kept as one in its tool input is', async () => {
  for (const response of ['object', 'string']) {
    await inSetup(async ({ home, folder }) => {
      await run(click(folder, { toolInput: false, response }));
      assert.deepEqual(keptLabels(home), [README], response);
      assert.equal(listOf(home, 'records').length, 2, response);
    });
  }
});

test('with no answer anywhere in the hook input, nothing is kept and the log says the hook was given no answer', async () => {
  await inSetup(async ({ home, folder, run: r }) => {
    await run(click(folder, { toolInput: false, response: 'none' }));
    assert.deepEqual(keptLabels(home), []);
    const log = dropped(home);
    assert.match(log, /no answer/);
    assert.ok(log.includes(r.id) && log.includes('product-launched'), log);
  });
});

test('an answer from a session outside the folder setup asked it for is not kept, and the log names both folders', async () => {
  await inSetup(async ({ home, folder }) => {
    const elsewhere = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-drops-elsewhere-')));
    try {
      fs.mkdirSync(path.join(elsewhere, '.claude'));
      fs.writeFileSync(path.join(elsewhere, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'wheelhouse@wheelhouse': true } }));
      await run(click(elsewhere));
      assert.deepEqual(keptLabels(home), []);
      const log = dropped(home);
      assert.ok(log.includes(folder) && log.includes(elsewhere), log);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

test('the log never holds the words typed on a card', async () => {
  await inSetup(async ({ home, folder }) => {
    const words = 'my own secret description words';
    const input = click(folder, { label: words });
    // The question is not among the questions asked, so the answer is neither a click nor typed.
    input.tool_input.questions = [];
    await run(input);
    assert.deepEqual(keptLabels(home), []);
    assert.notEqual(dropped(home), '');
    assert.ok(!dropped(home).includes(words));
  });
});

// The claim a click makes before its records are kept, as claimAnswer names it.
const claimFile = (home, r) => path.join(home, 'setup', 'answered',
  `${r.id}-4-product-launched-${crypto.createHash('sha256').update(CARD.question).digest('hex').slice(0, 16)}`);

test('a claim left by a hook cut short, with no answer kept, does not hold the card for ever', async () => {
  await inSetup(async ({ home, folder, run: r }) => {
    fs.mkdirSync(path.dirname(claimFile(home, r)), { recursive: true });
    fs.writeFileSync(claimFile(home, r), `${new Date(NOW.getTime() - 10 * 60 * 1000).toISOString()}\n`);
    await run(click(folder));
    assert.deepEqual(keptLabels(home), [README]);
    assert.equal(listOf(home, 'records').length, 2);
  });
});

test('a claim made a moment ago is left to the hook that made it, and the log says so', async () => {
  await inSetup(async ({ home, folder, run: r }) => {
    fs.mkdirSync(path.dirname(claimFile(home, r)), { recursive: true });
    fs.writeFileSync(claimFile(home, r), `${NOW.toISOString()}\n`);
    await run(click(folder));
    assert.deepEqual(keptLabels(home), []);
    assert.match(dropped(home), /answered already/);
  });
});

test('a card answered and kept is not taken again by a second click, stale or not', async () => {
  await inSetup(async ({ home, folder }) => {
    await run(click(folder));
    await run(click(folder));
    assert.deepEqual(keptLabels(home), [README]);
    assert.equal(listOf(home, 'records').length, 2);
  });
});

// --- A claim does not outlive its card asked again (Customise asks every choice again, the
// description among them), and an answer under one phase's id takes back the other's records.

const at = (ms) => new Date(NOW.getTime() + ms);
const recordsKept = (home) => listOf(home, 'records').map((n) => JSON.parse(fs.readFileSync(path.join(home, 'setup', 'records', n), 'utf8')).body);
const phasesKept = (home) => recordsKept(home).filter((b) => b.target?.kind === 'setting').map((b) => b.target.data.value);
const askAgain = (folder, r, when, { id = 'product-launched', card = CARD, writes = WRITES } = {}) => noteAsked({ runId: r.id, folder, step: 4, id, card, typed: true, writes, now: () => when });
const clickAt = (input, when) => decide(input, { now: () => when, projectOf: () => null, client: {} });

test('a card asked again after its answer was claimed takes the new answer, and the old answer\'s records not yet sent are taken back', async () => {
  await inSetup(async ({ home, folder, run: r }) => {
    await clickAt(click(folder), at(1000));
    assert.equal(listOf(home, 'records').length, 2);
    askAgain(folder, r, at(60 * 1000));
    await clickAt(click(folder, { label: 'Describe it later' }), at(61 * 1000));
    assert.deepEqual(keptLabels(home).sort(), ['Describe it later', README].sort());
    // Only the new answer's record is left to send: its phase, and no glossary entry.
    assert.deepEqual(recordsKept(home).filter((b) => b.kind === 'glossary'), []);
    assert.deepEqual(phasesKept(home), ['launched']);
  });
});

test('a claim made before records were listed on it takes back the records its click kept, by their time, once its card is asked again', async () => {
  await inSetup(async ({ home, folder, run: r }) => {
    await clickAt(click(folder), at(1000));
    // As an earlier Wheelhouse left it: the claim's time alone, a moment after its records were named.
    const claim = path.join(home, 'setup', 'answered', listOf(home, 'answered')[0]);
    fs.writeFileSync(claim, `${at(1019).toISOString()}\n`);
    askAgain(folder, r, at(60 * 60 * 1000));
    await clickAt(click(folder), at(60 * 60 * 1000 + 1000));
    assert.equal(keptLabels(home).length, 2);
    assert.equal(listOf(home, 'records').length, 2);
    assert.ok(listOf(home, 'records').every((n) => n.includes('T01-00-01')), listOf(home, 'records').join(' '));
  });
});

test('a card not asked again since its claim stays answered: a second click keeps nothing', async () => {
  await inSetup(async ({ home, folder }) => {
    await clickAt(click(folder), at(1000));
    await clickAt(click(folder), at(5000));
    assert.deepEqual(keptLabels(home), [README]);
    assert.equal(listOf(home, 'records').length, 2);
  });
});

test('an answer to the description under one phase\'s id takes back the records the other phase\'s answer has not sent', async () => {
  await inSetup(async ({ home, folder, run: r }) => {
    const before = { ...CARD, question: CARD.question.replace('recorded as launched', 'recorded as before launch') };
    const beforeWrites = JSON.parse(JSON.stringify(WRITES).replaceAll('"launched"', '"before-launch"'));
    askAgain(folder, r, at(0), { id: 'product-before-launch', card: before, writes: beforeWrites });
    const shownBefore = { ...before, multiSelect: false };
    const answers = { [before.question]: README };
    await clickAt({ ...click(folder), tool_input: { questions: [shownBefore], answers }, tool_response: { answers } }, at(1000));
    assert.deepEqual(phasesKept(home), ['before-launch']);
    askAgain(folder, r, at(90 * 1000));
    await clickAt(click(folder), at(91 * 1000));
    assert.deepEqual(phasesKept(home), ['launched']);
    assert.equal(recordsKept(home).filter((b) => b.kind === 'glossary').length, 1);
  });
});

// A card with a different first option label and/or descriptions, as the session writes it to the question tool.
const clickOn = (cwd, shownCard, label) => ({
  cwd, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
  tool_input: { questions: [shownCard], answers: { [shownCard.question]: label } },
  tool_response: { questions: [shownCard], answers: { [shownCard.question]: label } },
});

test('a "(Recommended)" label on a setup question\'s button is kept as the card\'s own label', async () => {
  await inSetup(async ({ home, folder }) => {
    const label = `${README} (Recommended)`;
    const card = { ...shown, options: [{ ...CARD.options[0], label }, CARD.options[1]] };
    await run(clickOn(folder, card, label));
    assert.deepEqual(keptLabels(home), [README]);
  });
});

test('a setup question with a trimmed description is dropped, and the log names the option', async () => {
  await inSetup(async ({ home, folder }) => {
    const card = { ...shown, options: [{ ...CARD.options[0], description: 'Recommended: a trimmed one.' }, CARD.options[1]] };
    await run(clickOn(folder, card, README));
    assert.deepEqual(keptLabels(home), []);
    assert.match(dropped(home), /option 1's description is not worded as printed/);
  });
});

const PLAN = (step, hash) => composeCard({
  kind: 'setup', level: 3, what: `Setup step ${step}, Three questions: nothing changes on this computer.`, why: 'Setup asks first.',
  options: [{ label: 'Go ahead', says: 'Setup records it.' }], recommend: 'Go ahead', because: 'nothing changes', meanwhile: 'Setup waits.', target: { step, hash },
});
const HASH = 'ab'.repeat(32);
const planShown = (c) => ({ question: c.question.question, header: c.question.header, options: c.question.options.map(({ label, description }) => ({ label, description })), multiSelect: false });
const keptClickFiles = () => {
  try {
    return fs.readdirSync(clicksDir());
  } catch {
    return [];
  }
};

test('a setup plan card reworded around its set line keeps no click, and the log names the question', async () => {
  await inSetup(async ({ home, folder, run: started }) => {
    const plan = PLAN(4, HASH);
    noteShown({ runId: started.id, folder, step: 4, hash: HASH, card: plan.question, now: () => NOW });
    const asked = planShown(plan);
    const reworded = { ...asked, question: `Go ahead with step 4?\n${setLineOf(asked.question)}` };
    await run(clickOn(folder, reworded, 'Go ahead'));
    assert.deepEqual(keptClickFiles(), []);
    assert.match(dropped(home), /its question is not worded as printed/);
  });
});

test('a setup plan card with "Go ahead (Recommended)" and its own words keeps its click', async () => {
  await inSetup(async ({ home, folder, run: started }) => {
    const plan = PLAN(4, HASH);
    noteShown({ runId: started.id, folder, step: 4, hash: HASH, card: plan.question, now: () => NOW });
    const asked = planShown(plan);
    const suffixed = { ...asked, options: asked.options.map((o, i) => (i === 0 ? { ...o, label: 'Go ahead (Recommended)' } : o)) };
    await run(clickOn(folder, suffixed, 'Go ahead (Recommended)'));
    assert.equal(keptClickFiles().length, 1);
  });
});

test('"(Recommended)" on one label with another label changed is still dropped, and the log names the changed label', async () => {
  await inSetup(async ({ home, folder }) => {
    const label = `${README} (Recommended)`;
    const card = { ...shown, options: [{ ...CARD.options[0], label }, { ...CARD.options[1], label: 'Later' }] };
    await run(clickOn(folder, card, label));
    assert.deepEqual(keptLabels(home), []);
    assert.match(dropped(home), /option 2's label is "Later", and the card's is "Describe it later"/);
  });
});

test('a card that reads as none setup asked leaves no line when the click was not refused (Not now)', async () => {
  await inSetup(async ({ home, folder }) => {
    const card = { ...shown, options: [{ ...CARD.options[0], description: 'Recommended: a trimmed one.' }, CARD.options[1]] };
    await run(clickOn(folder, card, 'Not now'));
    assert.equal(dropped(home), '');
  });
});
