// tests/scripts/desk/evidence.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { checkEvidence, clearUsedSignatures, CLIENT_WINDOW_MS } from '../../../scripts/desk/evidence.js';
import { composeCard, answerInput } from '../../../scripts/cards/compose.js';
import { LIFT_STOP_CARD } from '../../../scripts/frontdesk/cli.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled, sign } from '../../../scripts/state/signing.js';
import { canonicalJson } from '../../../scripts/lib/canonical.js';
import { as, shortHome } from '../../helpers/homes.js';
import { CARD, NOW, now } from './fixture.js';

const views = { waiting: [{ id: 'c1', at: '2026-10-29T09:00:00.000Z', data: CARD }, { id: 'c2', at: '2026-10-29T09:01:00.000Z', data: { ...CARD, question: 'Another question?' } }] };
const approve = (question = CARD.question) => makeEvent({ kind: 'action', data: { action: 'approve-work', work: 'export-csv', lane: 'feature', hash: 'a'.repeat(64), shownFirst: false, question, label: 'Approve' }, now });

function withKey(fn) {
  return as(shortHome(), async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-01T00:00:00.000Z' });
    return fn({ enrolled: readEnrolled() });
  });
}
const context = (enrolled, extra = {}) => ({ enrolled, clients: [], views, events: [], now, project: 'o__p', ...extra });
const answer = { card: 'c1', option: 'Approve' };
const plainAnswer = { card: 'c1', option: 'Not now', hash: 'b'.repeat(64) };

test('a record signed by this computer for the card is accepted', () => withKey(async ({ enrolled }) => {
  const got = checkEvidence('answer', answer, { form: 'signed', records: [approve()] }, context(enrolled));
  assert.equal(got.ok, true, got.refused);
  assert.equal(got.records.length, 1);
}));

test('a record signed by another computer\'s key is refused', () => withKey(async ({ enrolled }) => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const record = approve();
  const { sig, ...body } = record;
  const forged = { ...body, sig: { computer: sig.computer, value: crypto.sign(null, Buffer.from(canonicalJson(body)), privateKey).toString('base64') } };
  const got = checkEvidence('answer', answer, { form: 'signed', records: [forged] }, context(enrolled));
  assert.equal(got.ok, false);
  assert.match(got.refused, /signed/);
}));

test('a record for another card is refused', () => withKey(async ({ enrolled }) => {
  const got = checkEvidence('answer', answer, { form: 'signed', records: [approve('Another question?')] }, context(enrolled));
  assert.equal(got.ok, false);
  assert.match(got.refused, /card/);
}));

test('a record already held is refused', () => withKey(async ({ enrolled }) => {
  const record = approve();
  const got = checkEvidence('answer', answer, { form: 'signed', records: [record] }, context(enrolled, { events: [record] }));
  assert.equal(got.ok, false);
  assert.match(got.refused, /already/);
}));

test('a chat click on a signed label is refused', () => withKey(async ({ enrolled }) => {
  const got = checkEvidence('answer', answer, { form: 'chat-click', proof: 'chat-click' }, context(enrolled));
  assert.equal(got.ok, false);
  assert.match(got.refused, /chat/);
}));

test('a chat click on Not now is accepted', () => withKey(async ({ enrolled }) => {
  const got = checkEvidence('answer', { card: 'c1', option: 'Not now' }, { form: 'chat-click', proof: 'chat-click' }, context(enrolled));
  assert.equal(got.ok, true, got.refused);
}));

// A later app's key and its signature over the act, as Task 10's pairing enrols one.
function client(id = 'app-1') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const entry = { id, name: 'An app', publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), pairedAt: NOW };
  const signs = (command, args, at, project = 'o__p') => crypto.sign(null, Buffer.from(canonicalJson({ command, args, at, project })), privateKey).toString('base64');
  return { entry, signs };
}

test('a paired client\'s signature is accepted', () => withKey(async ({ enrolled }) => {
  const app = client();
  const at = NOW;
  const got = checkEvidence('answer', plainAnswer, { form: 'client', client: 'app-1', at, sig: app.signs('answer', plainAnswer, at) }, context(enrolled, { clients: [app.entry] }));
  assert.equal(got.ok, true, got.refused);
}));

test('a client id that was never paired is refused', () => withKey(async ({ enrolled }) => {
  const app = client();
  const got = checkEvidence('answer', answer, { form: 'client', client: 'app-2', at: NOW, sig: app.signs('answer', answer, NOW) }, context(enrolled, { clients: [app.entry] }));
  assert.equal(got.ok, false);
  assert.match(got.refused, /paired/);
}));

test('a client signature older than five minutes is refused', () => withKey(async ({ enrolled }) => {
  assert.equal(CLIENT_WINDOW_MS, 5 * 60 * 1000);
  const app = client();
  const at = new Date(Date.parse(NOW) - CLIENT_WINDOW_MS - 1000).toISOString();
  const got = checkEvidence('answer', answer, { form: 'client', client: 'app-1', at, sig: app.signs('answer', answer, at) }, context(enrolled, { clients: [app.entry] }));
  assert.equal(got.ok, false);
  assert.match(got.refused, /old|minutes/);
}));

test('a client signature over other words is refused', () => withKey(async ({ enrolled }) => {
  const app = client();
  const got = checkEvidence('answer', answer, { form: 'client', client: 'app-1', at: NOW, sig: app.signs('answer', { card: 'c2', option: 'Approve' }, NOW) }, context(enrolled, { clients: [app.entry] }));
  assert.equal(got.ok, false);
}));

test('an evidence form the desk doesn\'t know is refused', () => withKey(async ({ enrolled }) => {
  assert.equal(checkEvidence('answer', answer, { form: 'trust-me' }, context(enrolled)).ok, false);
  assert.equal(checkEvidence('answer', answer, { form: 'signed', records: [] }, context(enrolled)).ok, false);
}));

// What a paired app may decide: never more than a click in the chat. The cards here are the ones the composer writes, waiting under
// random ids, and what a card is comes from its kind, level and set line, never from its id.
const FULL = 'a'.repeat(40);
const HASH = 'b'.repeat(64);
const says = (label) => ({ label, says: `It ${label.toLowerCase()}s and goes ahead.` });
const base = { why: 'It changes what users see.', because: 'the checks passed.', meanwhile: 'Nothing is released.' };
const MERGE = composeCard({ ...base, kind: 'approval', level: 3, recommend: 'Approve', what: 'Pull request #12 has everything else it needs to merge.', options: [says('Approve')], target: { pr: 12, sha: FULL } }).card;
const GUARDRAIL = composeCard({ ...base, kind: 'approval', level: 4, recommend: 'Approve', what: 'Pull request #13 changes a file that steers the agents.', checks: 'It changes no checks: the change is still checked before it is added.', options: [says('Approve')], target: { pr: 13, sha: FULL } }).card;
const RUNBOOK = composeCard({ ...base, kind: 'runbook', level: 4, recommend: 'Do it', checks: 'It changes no checks.', what: 'The emergency steps say: put the product back to an earlier release.', options: [says('Do it')], target: { step: 3, sha: FULL } }).card;
const LIFT = composeCard(LIFT_STOP_CARD).card;
const DECISION = composeCard(answerInput({
  id: 'q-w-tide-1-1', work: 'w-tide-1', what: 'How often should the digest go out?', why: 'It changes what readers get.',
  options: [{ label: 'Daily', says: 'One a day.' }, { label: 'Weekly', says: 'One a week.' }], recommendation: 'Weekly', level: 3,
}, 'w-tide-1')).card;
const waitingOf = (data, id = crypto.randomUUID()) => ({ id, views: { waiting: [{ id, at: '2026-10-29T09:00:00.000Z', data }] } });
const PROJECT = 'o__p';

// A paired app's answer, as the add-on sends it: signed over the command, its arguments, the time and the project.
function paired(command, args, views, { project = PROJECT, signedProject = PROJECT, inContext = {} } = {}) {
  return withKey(async ({ enrolled }) => {
    const app = client('vscode-panel');
    const evidence = { form: 'client', client: 'vscode-panel', at: NOW, sig: app.signs(command, args, NOW, signedProject) };
    return checkEvidence(command, args, evidence, context(enrolled, { clients: [app.entry], views, project, ...inContext }));
  });
}
const answerOn = (card, option, extra = {}) => ({ card: card.id, option, hash: HASH, ...extra });

test('a paired app\'s Approve on a plain merge approval passes, marked as deciding, whatever its id', async () => {
  for (const id of [crypto.randomUUID(), 'x']) {
    const card = waitingOf(MERGE, id);
    const got = await paired('answer', answerOn(card, 'Approve', { commit: FULL }), card.views);
    assert.deepEqual([got.ok, got.decides, got.client], [true, true, 'vscode-panel'], got.refused);
  }
});

test('a paired app\'s signing option on a card that is not a merge approval is refused, whatever the card\'s id', async () => {
  for (const [name, data] of [['a guardrail change', GUARDRAIL], ['a runbook step', RUNBOOK], ['Lift STOP', LIFT]]) {
    for (const id of [crypto.randomUUID(), 'merge-12']) {
      const card = waitingOf(data, id);
      const option = data.options[0];
      const got = await paired('answer', answerOn(card, option), card.views);
      assert.equal(got.ok, false, `${name} under ${id}`);
      assert.match(got.refused, /window/, name);
    }
  }
});

test('every signing label on a card that is not a merge approval is refused', async () => {
  const card = waitingOf(GUARDRAIL);
  for (const option of ['Approve', 'Confirm', 'Lift All stop', 'Lift STOP', 'Do it', 'Push it', 'Change it', 'End it', 'Merge the fix', 'Pair it', 'Unpair it']) {
    const got = await paired('answer', answerOn(card, option), card.views);
    assert.equal(got.ok, false, option);
  }
});

test('a paired app\'s answer on a decision is refused, naming the window or a typed reply', async () => {
  const card = waitingOf(DECISION);
  const got = await paired('answer', answerOn(card, 'Weekly'), card.views);
  assert.equal(got.ok, false);
  assert.match(got.refused, /window|reply/);
});

test('a paired app\'s plain option on any card passes, deciding nothing', async () => {
  for (const data of [MERGE, GUARDRAIL, RUNBOOK, LIFT]) {
    const card = waitingOf(data);
    const got = await paired('answer', answerOn(card, 'Not now'), card.views);
    assert.deepEqual([got.ok, got.decides], [true, false], data.kind);
  }
});

test('an answer from a paired app names the card\'s hash, and an option the card offers', async () => {
  const card = waitingOf(MERGE);
  const noHash = await paired('answer', { card: card.id, option: 'Approve' }, card.views);
  assert.equal(noHash.ok, false);
  assert.match(noHash.refused, /hash/);
  assert.equal((await paired('answer', { card: card.id, option: 'Approve', hash: '' }, card.views)).ok, false);
  const other = await paired('answer', answerOn(card, 'Merge the fix'), card.views);
  assert.equal(other.ok, false);
  assert.match(other.refused, /options/);
});

test('a signature for another project, or one that names none, is no signature here', async () => {
  const card = waitingOf(MERGE);
  const args = answerOn(card, 'Not now');
  assert.equal((await paired('answer', args, card.views, { signedProject: 'o__other' })).ok, false, 'signed for another project');
  assert.equal((await paired('answer', args, card.views, { project: null })).ok, false, 'the helper names no project');
  assert.equal((await paired('answer', args, card.views, { project: 'o__other' })).ok, false, 'the act is for another project than the signature');
});

test('a signed act is taken once: the same signature again is refused, and a watch may repeat', () => withKey(async ({ enrolled }) => {
  clearUsedSignatures();
  const app = client('vscode-panel');
  const card = waitingOf(MERGE);
  const args = answerOn(card, 'Not now');
  const evidence = { form: 'client', client: 'vscode-panel', at: NOW, sig: app.signs('answer', args, NOW) };
  const ctx = context(enrolled, { clients: [app.entry], views: card.views, project: PROJECT });
  assert.equal(checkEvidence('answer', args, evidence, ctx).ok, true);
  const again = checkEvidence('answer', args, evidence, ctx);
  assert.equal(again.ok, false);
  assert.match(again.refused, /used already/);
  const watch = { form: 'client', client: 'vscode-panel', at: NOW, sig: app.signs('watch', { cursor: null }, NOW) };
  assert.equal(checkEvidence('watch', { cursor: null }, watch, ctx).ok, true);
  assert.equal(checkEvidence('watch', { cursor: null }, watch, ctx).ok, true, 'a watch\'s signature may be used again');
}));

test('a paired app\'s signature carries only card answers, its watch and Ask me here', async () => {
  const card = waitingOf(MERGE);
  const sent = {
    safekeeping: { action: 'keep-online' }, set: { setting: 'level', value: 'unattended' }, 'all-stop': { by: 'mod' }, 'lift-all-stop': {}, request: { words: 'x' },
    'pull-cards': {}, pair: { client: { id: 'x' } }, unpair: { client: 'vscode-panel' },
  };
  for (const [command, args] of Object.entries(sent)) {
    const got = await paired(command, args, card.views);
    assert.equal(got.ok, false, command);
    assert.match(got.refused, /can't/, command);
  }
  assert.equal((await paired('ask-here', { card: card.id }, card.views)).ok, true);
  assert.equal((await paired('watch', { cursor: null }, card.views)).ok, true);
});

test('a signature over one answer doesn\'t carry another', () => withKey(async ({ enrolled }) => {
  const app = client('vscode-panel');
  const card = waitingOf(MERGE);
  const sent = answerOn(card, 'Approve');
  const evidence = { form: 'client', client: 'vscode-panel', at: NOW, sig: app.signs('answer', answerOn(card, 'Not now'), NOW) };
  assert.equal(checkEvidence('answer', sent, evidence, context(enrolled, { clients: [app.entry], views: card.views, project: PROJECT })).ok, false);
}));

// A click in the chat is judged from the live card, as a paired app's answer is: a plain merge approval is read from its fields, and the
// card's id says nothing (a real card's id is a random one, never a name).
test('a chat click that would sign is taken on a plain merge approval, whatever its id', () => withKey(async ({ enrolled }) => {
  for (const id of [crypto.randomUUID(), 'x']) {
    const card = waitingOf(MERGE, id);
    const got = checkEvidence('answer', { card: id, option: 'Approve' }, { form: 'chat-click', proof: 'chat-click' }, context(enrolled, { views: card.views }));
    assert.deepEqual([got.ok, got.chatClick], [true, true], `${id} ${got.refused}`);
  }
}));

test('a chat click that would sign is refused on any card that is not a plain merge approval, even one named merge-', () => withKey(async ({ enrolled }) => {
  for (const [data, option] of [[GUARDRAIL, 'Approve'], [RUNBOOK, 'Do it'], [LIFT, 'Lift STOP'], [CARD, 'Approve']]) {
    for (const id of [crypto.randomUUID(), 'merge-12']) {
      const card = waitingOf(data, id);
      const got = checkEvidence('answer', { card: id, option }, { form: 'chat-click', proof: 'chat-click' }, context(enrolled, { views: card.views }));
      assert.equal(got.ok, false, `${data.kind} under ${id}`);
    }
  }
}));

test('a chat click that would sign on a card that is not waiting is refused', () => withKey(async ({ enrolled }) => {
  const got = checkEvidence('answer', { card: 'merge-12', option: 'Approve' }, { form: 'chat-click', proof: 'chat-click' }, context(enrolled, { views: { waiting: [] } }));
  assert.equal(got.ok, false);
}));
