// tests/scripts/update/helper-answer.test.js
// The director's answer to the old helper's card (update design, section 7.3) becomes a signed `update-helper-answer` action in
// the two ways every action card is signed: by the prompt record, from a click in Claude Code, and by the helper's own window.
// Either is earned only from the card the update's finish is waiting on, by its id and its options; and the answer is read
// back by finish as a verified record of this computer's own key. Nothing here signs for the director.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { shortHome, testAddress, withHome } from '../../helpers/homes.js';
import { run } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { dataHash, listEvents, makeEvent, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled, verify } from '../../../scripts/state/signing.js';
import { updateHelperLine } from '../../../scripts/state/card-lines.js';
import { earned } from '../../../scripts/hooks/prompt-record.js';
import { openJournal } from '../../../scripts/update/journal.js';
import { helperCardFor } from '../../../scripts/update/cards.js';
import { helperCard, helperCardId, signedAnswer, STOP_IT, LEAVE_IT, WAIT_LONGER } from '../../../scripts/update/finish.js';

const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const T0 = new Date('2026-11-04T01:00:00.000Z');
const ID = helperCardId({ pid: 4242, startTime: '2026-11-04T09:00:00.000Z' });
const given = (kind = 'unknown', canStop = true) => helperCard({ kind, version: '0.2.4', canStop, id: ID });
const now = () => T0;

// The card the helper raised, in the project's state, as the update's runner keeps it.
function raised(project, card) {
  const { card: data } = helperCardFor(card);
  const file = path.join(stateDir(project), eventPath(makeEvent({ kind: 'card', data, now })));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(makeEvent({ kind: 'card', data, now }), null, 2)}\n`);
}

function waiting(project, card) {
  const journal = openJournal(project);
  fs.mkdirSync(journal.folder, { recursive: true });
  fs.writeFileSync(path.join(journal.folder, 'finish.json'), JSON.stringify({ handover: { waiting: { card } } }));
}

test('the prompt record earns the answer only from the card finish is waiting on, by its id and its options', () => withHome(async () => {
  const { question } = helperCardFor(given());
  const click = (text = question.question, label = STOP_IT) => earned({ project: 'p1', question: text, label, client: {}, now, left: (p) => p });
  // No card is waiting: nothing is earned, however the card is worded.
  assert.equal(await click(), null);
  waiting('p1', given());
  await raised('p1', given());
  const got = await click();
  assert.deepEqual(got.made, { kind: 'action', data: { action: 'update-helper-answer', card: ID, question: question.question, label: STOP_IT } });
  assert.equal((await click(question.question, LEAVE_IT)).made.data.label, LEAVE_IT);
  // Not for a label the card does not offer, nor for another helper's id, nor for two lines.
  assert.equal(await click(question.question, WAIT_LONGER), null);
  assert.equal(await click(question.question, 'Approve'), null);
  assert.equal(await click(`Words.\n${updateHelperLine('update-helper-9999-other')}`), null);
  assert.equal(await click(`${question.question}\n${updateHelperLine('update-helper-9999-other')}`), null);
  // The busy card offers Wait longer, and only then.
  waiting('p1', given('busy', true));
  await raised('p1', given('busy', true));
  assert.equal((await click(helperCardFor(given('busy', true)).question.question, WAIT_LONGER)).made.data.label, WAIT_LONGER);
}));

test('the prompt record compares the question and options with the card the helper composes from the waiting record', () => withHome(async () => {
  const { question } = helperCardFor(given());
  const click = (text, card, label = STOP_IT) => earned({ project: 'p1', question: text, label, card, client: {}, now, left: (p) => p });
  waiting('p1', given());
  await raised('p1', given());
  // Right words and options: earned, with or without the card as asked.
  assert.ok(await click(question.question, question));
  assert.ok(await click(question.question, undefined));
  // The set line with other words around it is not the card the helper raised.
  const reworded = question.question.replace('The old helper', 'A helper');
  assert.notEqual(reworded, question.question);
  assert.equal(await click(reworded, { ...question, question: reworded }), null);
  // The card as asked offers other options than the one raised.
  assert.equal(await click(question.question, { ...question, options: [question.options[0], { label: 'Do anything' }] }), null);
}));

// A computer with an enrolled key, a project and a helper whose window answers as the director would.
async function computer(choose) {
  const home = shortHome();
  const folder = path.join(shortHome(), 'shop');
  fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  writeProject('shop', { folder, remoteUrl: null, host: 'local', repo: 'local/shop', connection: { mode: 'none' } });
  const own = makeSigningKey();
  enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: T0.toISOString() });
  let tick = 0;
  const helper = await startHelper({
    run: hostGuard,
    askWindow: async (card) => ({ choice: choose(card) }),
    address: testAddress(home),
    envFor: async () => ({}),
    adapterFor: async () => ({}),
    now: () => new Date(T0.getTime() + 1000 * (tick += 1)),
  });
  return {
    client: helperClient({ address: helper.address }),
    events: () => listEvents(stateDir('shop'), { report: () => {} }),
    close: async () => {
      await helper.close();
      if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    },
  };
}

test('the helper\'s window signs the answer as an action for the card, and finish reads it back; Not now records nothing', async () => {
  const shown = [];
  let pick = STOP_IT;
  const c = await computer((card) => { shown.push(card); return pick; });
  try {
    waiting('shop', given());
    const { card } = helperCardFor(given());
    const made = await c.client.state.write({ project: 'shop', kind: 'card', data: card });
    assert.equal(made.ok, true, JSON.stringify(made));
    const hash = dataHash(card);
    // The window shows the card's words and its options, and only those the card is waiting on.
    pick = 'Not now';
    const later = await c.client.confirm({ project: 'shop', card: made.id, hash });
    assert.equal(later.recorded, false);
    assert.equal(c.events().filter((e) => e.kind === 'action').length, 0);
    pick = STOP_IT;
    const got = await c.client.confirm({ project: 'shop', card: made.id, hash });
    assert.deepEqual([got.ok, got.recorded, got.kind, got.step, got.choice], [true, true, 'action', 'update-helper', STOP_IT]);
    assert.deepEqual(shown[0].options, [STOP_IT, LEAVE_IT]);
    const action = c.events().find((e) => e.kind === 'action');
    assert.equal(action.data.action, 'update-helper-answer');
    assert.equal(action.data.card, ID);
    assert.equal(action.data.proof, 'window');
    assert.equal(verify(action, readEnrolled()), true, 'signed by this computer\'s own key');
    assert.equal(signedAnswer({ events: c.events(), enrolled: readEnrolled(), card: ID, options: [STOP_IT, LEAVE_IT] }), STOP_IT);
    assert.equal(signedAnswer({ events: c.events(), enrolled: readEnrolled(), card: 'update-helper-9999-other', options: [STOP_IT, LEAVE_IT] }), null);
  } finally {
    await c.close();
  }
});

test('a card the update is not waiting on is no card the window confirms', async () => {
  const c = await computer(() => assert.fail('no window opens'));
  try {
    const { card } = helperCardFor(given());
    const made = await c.client.state.write({ project: 'shop', kind: 'card', data: card });
    const got = await c.client.confirm({ project: 'shop', card: made.id, hash: dataHash(card) });
    assert.equal(got.ok, false);
    assert.match(got.refused, /not one the window confirms/);
    assert.equal(c.events().filter((e) => e.kind === 'action').length, 0);
  } finally {
    await c.close();
  }
});
