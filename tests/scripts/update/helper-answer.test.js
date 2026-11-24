// tests/scripts/update/helper-answer.test.js
// The director's answer to the old helper's card (update design, section 7.3) becomes a signed `update-helper-answer` action in
// the way every action card is signed: by the prompt record, from a click in Claude Code.
// It is earned only from the card the update's finish is waiting on, by its id and its options; and the answer is read
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
