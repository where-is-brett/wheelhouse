// tests/scripts/agents/copilot-allowances.test.js
// Lift All stop and Ask allowances confirmed in the helper's own window on Copilot (Part 8 Task 1, dispatch 1d; rulings
// P8-7 and P8-8). Under STOP the Copilot cards line names the window at every tier, and at Middle and Full the
// Wheelhouse command's `confirm lift-stop`, which posts /confirm as the Lean command does. An Ask build question's
// Allow this time and Allow for this feature are confirmed in the window, which says what allowing the commands
// means; a Copilot builder's grant counts only from an answer the window signed, and Claude Code's grants and cards
// are as they were. Every window is a stand-in `run`, and stand-ins for gh, glab and copilot come first on the PATH;
// the last test asserts none of them ran.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun, standInTools } from '../../helpers/host-stand-ins.js';
import { shortHome, testAddress } from '../../helpers/homes.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';
import { run } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { registerLean } from '../../../scripts/lean/project.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { liftStop, stopState } from '../../../scripts/lib/stop.js';
import { dataHash, listEvents, makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled, sign, verify } from '../../../scripts/state/signing.js';
import { buildViews } from '../../../scripts/state/views.js';
import { answerLine } from '../../../scripts/state/card-lines.js';
import { askInWindow } from '../../../scripts/confirm/window.js';
import { composeCard, answerInput } from '../../../scripts/cards/compose.js';
import { cardsLineFor } from '../../../scripts/agents/card-words.js';
import { main as frontDesk } from '../../../scripts/frontdesk/cli.js';
import { glossaryOf, termsIn } from '../../../scripts/frontdesk/glossary.js';
import { CONFIRMED_STEPS } from '../../../scripts/lib/copilot-numbers.js';
import {
  ALLOWANCE_LABELS, BUILD_QUESTION_LABELS, BUILD_QUESTION_OPTIONS, allowanceWindowLines, buildGrants,
} from '../../../scripts/protection/windows-builds.js';
import { windowsBuildsOf } from '../../../scripts/watcher/waker.js';
import { GRANT_PROOFS } from '../../../adapters/copilot/sessions.js';

const shims = standInTools();
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
afterEach(() => {
  assert.deepEqual(hostLog, [], 'no host tool ran through the helper');
});
after(() => shims.restore());

waitLongerOnTheHelper();

const PROJECT = 'shop';
const WORK = 'login-page';
const T0 = new Date('2026-10-24T01:00:00.000Z');
const said = (text) => ({ code: 0, stdout: `${text}\n`, stderr: '' });
const argvOf = (args) => args.slice(args.indexOf('--') + 1);

// --- The cards line under STOP (P8-7) ---

test('under STOP on Copilot the cards line names Lift All stop in the window at every tier, and the Wheelhouse command\'s confirm at Middle and Full', () => {
  const lean = cardsLineFor('copilot', { count: 1, lean: true, stop: true });
  const middle = cardsLineFor('copilot', { count: 1, stop: true });
  // Lean's line is as it was.
  assert.equal(lean, 'Cards to ask this visit: 1, Lift All stop, which is confirmed in Wheelhouse\'s own window: after the briefing, run the Lean command\'s `confirm lift-stop` and wait for the director\'s click there.');
  assert.equal(middle, 'Cards to ask this visit: 1, Lift All stop, which is confirmed in Wheelhouse\'s own window: after the briefing, run the Wheelhouse command\'s `confirm lift-stop` and wait for the director\'s click there.');
  for (const line of [lean, middle]) {
    assert.match(line, /Wheelhouse's own window/);
    assert.doesNotMatch(line, /ask_user|AskUserQuestion|cli\.js/);
  }
  // STOP off: the cards are asked in the chat, as before.
  assert.equal(cardsLineFor('copilot', { count: 2 }), 'Cards to ask this visit: 2. Run the Wheelhouse command\'s `cards` and ask them in one call of ask_user (askQuestions in VS Code), after the briefing.');
  // Claude Code keeps the core's line, with STOP on or off.
  assert.equal(cardsLineFor('claude-code', { count: 1, stop: true }), null);
  assert.equal(cardsLineFor('claude-code', { count: 1, lean: true, stop: true }), null);
});

// --- The front desk's confirm (P8-7), against a stand-in helper ---

// A stand-in helper client: the card events its views hold, and each /confirm request kept and answered.
function deskClient({ cards = [], answer = { ok: true, recorded: true, choice: 'Lift All stop' } } = {}) {
  const asked = [];
  return {
    asked,
    state: { views: async (body) => ({ ok: true, views: {}, stop: true, ...(body.cards ? { cards } : {}) }) },
    confirm: async (body) => { asked.push(body); return answer; },
  };
}
async function desk(argv, client) {
  const out = [];
  const err = [];
  const code = await frontDesk(argv, { cwd: '/projects/shop', client, out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join(''), err: err.join('') };
}

test('the front desk\'s confirm posts /confirm for Lift All stop, and for a card by its id with the hash the state holds', async () => {
  const lift = deskClient();
  const got = await desk(['confirm', 'lift-stop'], lift);
  assert.equal(got.code, 0, got.err);
  assert.deepEqual(lift.asked, [{ cwd: path.resolve('/projects/shop'), card: 'lift-stop' }]);
  assert.deepEqual(JSON.parse(got.out), { ok: true, recorded: true, choice: 'Lift All stop' });

  const data = { question: 'Q', options: ['Allow this time', 'Not now'] };
  const id = '0b7c1d1e-2f3a-4b5c-8d6e-7f8091a2b3c4';
  const byId = deskClient({ cards: [{ id, data }] });
  assert.equal((await desk(['confirm', id], byId)).code, 0);
  assert.deepEqual(byId.asked, [{ cwd: path.resolve('/projects/shop'), card: id, hash: dataHash(data) }]);

  // A card the state doesn't hold opens nothing; a refusal is said in its own words; a missing card is a usage line.
  const none = deskClient();
  const missing = await desk(['confirm', id], none);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /not in this project's state/);
  assert.deepEqual(none.asked, []);
  const refused = await desk(['confirm', 'lift-stop'], deskClient({ answer: { ok: false, refused: 'All stop is not on, so there is nothing to lift' } }));
  assert.equal(refused.code, 1);
  assert.equal(refused.err, 'All stop is not on, so there is nothing to lift\n');
  assert.equal((await desk(['confirm'], deskClient())).code, 1);
  assert.equal((await desk(['confirm', 'a', 'b'], deskClient())).code, 1);
});

// --- Grants and their proofs (P8-8) ---

const COMPUTER = 'computer-a';
const buildQuestion = (n = 1, commands = ['npm test']) => ({
  id: `q-${WORK}-${n}`,
  work: WORK,
  what: `Let this feature's builder run: ${commands.join('; ')}.`,
  why: 'The builder needs it to check its work.',
  options: BUILD_QUESTION_OPTIONS.map((o) => ({ ...o })),
  recommendation: BUILD_QUESTION_LABELS.once,
  level: 3,
  commands,
});

// The views buildGrants reads, by hand: the feature, and one build question per answer, answered on this computer
// with the proof given (none when undefined).
function viewsWith(answers) {
  const questions = {};
  answers.forEach(([label, proof], i) => {
    const data = buildQuestion(i + 1, [`npm run step-${i + 1}`]);
    questions[data.id] = {
      question: { data },
      answer: { computer: COMPUTER, at: '2026-10-24T01:00:00.000Z', label, ...(proof === undefined ? {} : { proof }) },
    };
  });
  return { features: { [WORK]: { data: { step: 'building' }, began: '2026-10-24T00:00:00.000Z' } }, questions, reports: {} };
}

test('with the window\'s proof asked for, a grant counts only from an answer the window signed; without it, every verified answer counts as before', () => {
  assert.ok(CONFIRMED_STEPS.includes('ask-allowance'));
  assert.deepEqual(GRANT_PROOFS, ['window']);
  assert.deepEqual(ALLOWANCE_LABELS, ['Allow this time', 'Allow for this feature']);
  const views = viewsWith([
    [BUILD_QUESTION_LABELS.once, 'window'],
    [BUILD_QUESTION_LABELS.feature, 'window'],
    [BUILD_QUESTION_LABELS.once, 'chat-click'],
    [BUILD_QUESTION_LABELS.feature, undefined],
    [BUILD_QUESTION_LABELS.once, 'signed-hook'],
  ]);
  const ids = (grants) => grants.map((g) => g.questionId);
  const all = [1, 2, 3, 4, 5].map((n) => `q-${WORK}-${n}`);
  // Claude Code: no proofs asked for, so every answer counts, exactly as before.
  assert.deepEqual(ids(buildGrants({ views, work: WORK, used: [], computer: COMPUTER })), all);
  // Copilot: only the window's.
  assert.deepEqual(ids(buildGrants({ views, work: WORK, used: [], computer: COMPUTER, proofs: GRANT_PROOFS })), all.slice(0, 2));
  assert.deepEqual(buildGrants({ views, work: WORK, used: [], computer: COMPUTER, proofs: GRANT_PROOFS })[1], { questionId: all[1], commands: ['npm run step-2'], scope: 'feature' });
  // Proofs that aren't a list count none; an empty list counts none.
  for (const proofs of ['window', null, { window: true }, []]) {
    assert.deepEqual(buildGrants({ views, work: WORK, used: [], computer: COMPUTER, proofs }), [], JSON.stringify(proofs));
  }
});

// --- The helper's window (P8-8, P8-7), on a real helper ---

// A computer with a home of its own, an enrolled key, a Lean project, and a helper whose window is askInWindow on
// macOS with a stand-in `run`, answered by `answer`.
async function computer(answer) {
  const home = shortHome();
  const folder = path.join(shortHome(), 'shop');
  fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  registerLean({ project: PROJECT, folder, now: () => T0 });
  const own = makeSigningKey();
  enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: T0.toISOString() });
  const windows = [];
  const windowRun = async (file, args) => {
    windows.push({ file, args });
    return answer({ argv: argvOf(args) });
  };
  const askWindow = (card) => askInWindow({ ...card, platform: 'darwin', run: windowRun });
  let tick = 0;
  const helper = await startHelper({
    run: hostGuard,
    askWindow,
    address: testAddress(home),
    envFor: async () => { throw new Error('no connection on this computer'); },
    adapterFor: async () => { throw new Error('no adapter on this computer'); },
    now: () => new Date(T0.getTime() + 1000 * (tick += 1)),
  });
  const client = helperClient({ address: helper.address });
  const write = async (kind, data) => {
    const made = await client.state.write({ project: PROJECT, kind, data });
    assert.equal(made.ok, true, JSON.stringify(made));
    return made.id;
  };
  return {
    computer: own.computer,
    windows,
    folder: fs.realpathSync.native(folder),
    client,
    write,
    events: () => listEvents(stateDir(PROJECT), { report: () => {} }),
    views: () => buildViews(listEvents(stateDir(PROJECT), { report: () => {} }), readEnrolled()),
    // A question recorded by the build, and its answer card as the front desk records it.
    ask: async (data) => {
      await write('question', data);
      const card = composeCard(answerInput(data, data.work)).card;
      const id = await write('card', card);
      return { card: id, hash: dataHash(card), data: card };
    },
    close: async () => {
      await helper.close();
      if (before === undefined) delete process.env.WHEELHOUSE_HOME;
      else process.env.WHEELHOUSE_HOME = before;
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

test('an Ask allowance is confirmed in the window, which says what allowing the command means, and only the window\'s click grants on Copilot', async () => {
  let reply = said(BUILD_QUESTION_LABELS.once);
  const c = await computer(() => reply);
  try {
    await c.write('feature', { work: WORK, step: 'building' });
    const question = buildQuestion(1, ['npm test']);
    const shown = await c.ask(question);
    assert.ok(shown.data.question.includes(answerLine(question.id)));

    // The window shows the card's words from the state, then the allowance's own lines, with the two Allow options.
    const got = await c.client.confirm({ cwd: c.folder, card: shown.card, hash: shown.hash });
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.deepEqual([got.recorded, got.choice, got.kind, got.step], [true, BUILD_QUESTION_LABELS.once, 'action', 'ask-allowance']);
    const argv = argvOf(c.windows[0].args);
    assert.deepEqual(argv.slice(3), [BUILD_QUESTION_LABELS.once, BUILD_QUESTION_LABELS.feature]);
    const extra = allowanceWindowLines(['npm test']);
    assert.equal(argv[1], [...shown.data.question.split('\n'), ...extra].join('\n'));
    const words = extra.join('\n');
    assert.match(words, /npm test/, 'it names the command');
    assert.match(words, /runs whatever the project's own files tell it to/, 'and what it runs');
    assert.match(words, /whatever your account can/);
    assert.match(words, /lasting changes/);
    // Plain words: nothing in them the glossary would explain.
    assert.deepEqual(termsIn(words, glossaryOf({})), []);

    // The helper signed the answer itself, with proof window, and the card no longer waits.
    const record = c.events().find((e) => e.id === got.id);
    assert.deepEqual(record.data, { action: 'answer', questionId: question.id, questionHash: dataHash(question), question: shown.data.question, label: BUILD_QUESTION_LABELS.once, proof: 'window' });
    assert.ok(verify(record, readEnrolled()));
    assert.match((await c.client.confirm({ cwd: c.folder, card: shown.card, hash: shown.hash })).refused, /no longer waits/);

    // The views keep the answer's proof, and Copilot's grants count it; the waker's reading gives the same.
    assert.deepEqual(c.views().questions[question.id].answer, { label: BUILD_QUESTION_LABELS.once, at: record.at, computer: c.computer, proof: 'window' });
    const copilotGrants = windowsBuildsOf(PROJECT)(WORK, { proofs: GRANT_PROOFS }).grants;
    assert.deepEqual(copilotGrants, [{ questionId: question.id, commands: ['npm test'], scope: 'run' }]);

    // Allow for this feature, on a second question, likewise.
    reply = said(BUILD_QUESTION_LABELS.feature);
    const second = buildQuestion(2, ['npm run build']);
    const secondCard = await c.ask(second);
    const feature = await c.client.confirm({ cwd: c.folder, card: secondCard.card, hash: secondCard.hash });
    assert.deepEqual([feature.recorded, feature.step], [true, 'ask-allowance']);
    assert.deepEqual(windowsBuildsOf(PROJECT)(WORK, { proofs: GRANT_PROOFS }).grants.map((g) => g.scope), ['run', 'feature']);
  } finally {
    await c.close();
  }
});

test('a Copilot grant from a chat answer, or from an answer the window didn\'t sign, isn\'t counted; Claude Code\'s signed answer still is', async () => {
  const c = await computer(() => assert.fail('no window opens'));
  try {
    await c.write('feature', { work: WORK, step: 'building' });
    const question = buildQuestion(1, ['npm test']);
    const shown = await c.ask(question);

    // A click in the chat: an unsigned card-answer, which grants nothing on any agent.
    const chat = await c.client.cards.chatClick({
      cwd: c.folder, card: shown.card, label: BUILD_QUESTION_LABELS.once, hash: dataHash(shown.data.question), proof: 'chat-click',
    });
    assert.equal(chat.ok, true, JSON.stringify(chat));
    assert.equal(c.views().questions[question.id].answer, null);
    assert.deepEqual(windowsBuildsOf(PROJECT)(WORK, { proofs: GRANT_PROOFS }).grants, []);

    // A signed answer naming no proof, as Claude Code's hook signs one: Claude Code's grants count it, exactly as
    // before, and Copilot's don't.
    const signed = sign(makeEvent({
      kind: 'action',
      data: { action: 'answer', questionId: question.id, questionHash: dataHash(question), question: shown.data.question, label: BUILD_QUESTION_LABELS.feature },
      now: () => new Date(T0.getTime() + 60000),
    }));
    assert.equal((await c.client.state.record({ project: PROJECT, event: signed })).ok, true);
    assert.deepEqual(c.views().questions[question.id].answer, { label: BUILD_QUESTION_LABELS.feature, at: signed.at, computer: c.computer });
    assert.deepEqual(windowsBuildsOf(PROJECT)(WORK).grants, [{ questionId: question.id, commands: ['npm test'], scope: 'feature' }]);
    assert.deepEqual(windowsBuildsOf(PROJECT)(WORK, { proofs: GRANT_PROOFS }).grants, []);

    // A signed answer naming another proof isn't counted on Copilot either.
    const other = sign(makeEvent({
      kind: 'action',
      data: { action: 'answer', questionId: question.id, questionHash: dataHash(question), question: shown.data.question, label: BUILD_QUESTION_LABELS.feature, proof: 'chat-click' },
      now: () => new Date(T0.getTime() + 120000),
    }));
    assert.equal((await c.client.state.record({ project: PROJECT, event: other })).ok, true);
    assert.equal(c.views().questions[question.id].answer.proof, 'chat-click');
    assert.deepEqual(windowsBuildsOf(PROJECT)(WORK, { proofs: GRANT_PROOFS }).grants, []);
  } finally {
    await c.close();
  }
});

test('the window confirms no answer but an Ask allowance on a build question as the state holds it', async () => {
  const c = await computer(() => assert.fail('no window opens'));
  try {
    // A product question's answer card: no step the window confirms.
    const plain = {
      id: `q-${WORK}-1`, work: WORK, what: 'Which colour for the button?', why: 'It is a product choice.', recommendation: 'Blue', level: 2,
      options: [{ label: 'Blue', says: 'Blue.' }, { label: 'Green', says: 'Green.' }],
    };
    const plainCard = await c.ask(plain);
    const refused = await c.client.confirm({ cwd: c.folder, card: plainCard.card, hash: plainCard.hash });
    assert.equal(refused.ok, false);
    assert.match(refused.refused, /not one the window confirms/);

    // A question that looks like a build question but isn't one word for word (another recommendation): refused.
    const odd = { ...buildQuestion(2), recommendation: BUILD_QUESTION_LABELS.feature };
    const oddCard = await c.ask(odd);
    assert.match((await c.client.confirm({ cwd: c.folder, card: oddCard.card, hash: oddCard.hash })).refused, /not one the window confirms/);

    // A build question recorded again with other commands after its card was made: the card's answer names the old
    // question's hash, so it is no allowance any more.
    const first = buildQuestion(3, ['npm test']);
    const firstCard = await c.ask(first);
    await c.write('question', { ...first, commands: ['npm run build'], what: 'Let this feature\'s builder run: npm run build.' });
    assert.match((await c.client.confirm({ cwd: c.folder, card: firstCard.card, hash: firstCard.hash })).refused, /not one the window confirms/);
    assert.equal(c.windows.length, 0);

    // Under STOP an allowance isn't served.
    const live = await c.ask(buildQuestion(4));
    assert.equal((await c.client.stop({})).ok, true);
    assert.deepEqual(await c.client.confirm({ cwd: c.folder, card: live.card, hash: live.hash }), { ok: false, refused: 'All stop is on' });
  } finally {
    liftStop();
    await c.close();
  }
});

test('the front desk\'s confirm lifts STOP through the helper\'s window', async () => {
  const c = await computer(() => said('Lift All stop'));
  try {
    assert.equal((await c.client.stop({})).ok, true);
    const out = [];
    const err = [];
    const code = await frontDesk(['confirm', 'lift-stop'], { cwd: c.folder, client: c.client, out: (t) => out.push(t), err: (t) => err.push(t) });
    assert.equal(code, 0, err.join(''));
    const got = JSON.parse(out.join(''));
    assert.deepEqual([got.recorded, got.step], [true, 'lift-stop']);
    assert.equal(stopState().on, false);
    assert.equal(argvOf(c.windows[0].args)[0], 'Wheelhouse: All stop');
  } finally {
    liftStop();
    await c.close();
  }
});

test('no real copilot, gh, glab or curl ran', () => {
  assert.deepEqual(shims.calls(), []);
});
