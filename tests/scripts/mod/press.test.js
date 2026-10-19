// tests/scripts/mod/press.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pressCard, SAYS } from '../../../scripts/mod/press.js';
import { replyRecord, repliedDir } from '../../../scripts/mod/reply.js';
import { hashOf } from '../../../scripts/mod/status.js';
import { decide } from '../../../scripts/hooks/prompt-record.js';
import { pendingDir } from '../../../scripts/hooks/pending.js';
import { answerInput, composeCard } from '../../../scripts/cards/compose.js';
import { makeEvent, eventPath, listEvents, dataHash } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { makeSigningKey, enrol, verify, readEnrolled } from '../../../scripts/state/signing.js';
import { setStop, stopState, liftStop } from '../../../scripts/lib/stop.js';
import { computerId, profileDir, stateDir } from '../../../scripts/lib/paths.js';
import { BUILD_QUESTION_LABELS, BUILD_QUESTION_OPTIONS, USE_GUARDED, settingKey, UNATTENDED_CARD } from '../../../scripts/protection/windows-builds.js';
import { unattendedCardData } from '../../../scripts/foreman/act.js';
import { withHome } from '../../helpers/homes.js';

const P = 'owner__name';
const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const NOW = new Date('2026-10-19T05:00:00.000Z');
const LATER = new Date('2026-10-19T06:00:00.000Z');
const STOP_REFUSAL = { ok: false, refused: 'STOP is on' };

const common = {
  why: 'It changes what users see, which is yours to decide at level 3.',
  because: 'the checks passed and the change is small.',
  meanwhile: 'Nothing is released and the agents carry on with other work.',
  level: 3,
};
const says = (label) => ({ label, says: `It ${label.toLowerCase()} and goes ahead.` });
const approvalCard = (pr = 13) => composeCard({ ...common, kind: 'approval', recommend: 'Approve', what: `Pull request #${pr} changes the wording on the sign-in page.`, options: [says('Approve')], target: { pr, sha: FULL } }).card;
const liftStopCard = () => composeCard({ ...common, kind: 'lift-stop', recommend: 'Lift STOP', what: 'Every agent is stopped, and nothing moves until you say.', options: [says('Lift STOP')], target: {} }).card;
const OWN = [{ label: 'Comma', says: 'Commas between values.' }, { label: 'Tab', says: 'Tabs between values.' }];
const answerCard = () => composeCard({ ...common, kind: 'answer', recommend: 'Comma', what: 'The export needs to know which separator to use.', options: OWN, target: { questionId: 'q-export-csv-1' } }).card;
const questionCard = (what = 'Which separator should the export use?') => composeCard({ ...common, kind: 'question', recommend: 'Comma', what, options: OWN }).card;
const QUESTION = { id: 'q-export-csv-1', work: 'export-csv', what: 'Which separator?', why: 'It changes the file', options: [{ label: 'Comma', says: 'Commas' }, { label: 'Tab', says: 'Tabs' }], recommendation: 'Comma', level: 2 };

function keepEvent(event) {
  const file = path.join(stateDir(P), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(event));
}

// A home with an enrolled signing key, for each test.
const withKey = (fn) => withHome(async (home) => {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
  return fn(home);
});

// Puts a card in the state clone, as the front desk's card write does, `minute` minutes past NOW.
function putCard(data, minute = 0) {
  const event = makeEvent({ kind: 'card', data, now: () => new Date(NOW.getTime() + minute * 60 * 1000) });
  keepEvent(event);
  return { id: event.id, data, hash: hashOf(data.question) };
}

// A helper that records every call in order. `takes` writes what it takes into the state clone,
// as the helper does; `stop` refuses /state/write as the helper does under STOP.
function fake({ pr = { ok: true, result: { headSha: FULL, state: 'open' } }, takes = true, refuse = false, stop = false, onWrite } = {}) {
  const calls = { order: [], write: [], record: [], profileRecord: [], prState: [] };
  const no = { ok: false, refused: 'no' };
  return {
    calls,
    prState: async (b) => { calls.prState.push(b); calls.order.push('prState'); return pr; },
    state: {
      write: async (b) => {
        calls.write.push(b);
        calls.order.push('write');
        onWrite?.(b);
        if (stop) return STOP_REFUSAL;
        if (refuse) return no;
        if (takes) keepEvent(makeEvent({ kind: b.kind, data: b.data, now: () => LATER }));
        return { ok: true };
      },
      record: async (b) => {
        calls.record.push(b);
        calls.order.push('record');
        if (refuse) return no;
        if (takes) keepEvent(b.event);
        return { ok: true };
      },
    },
    profile: { record: async (b) => { calls.profileRecord.push(b); return refuse ? no : { ok: true }; } },
  };
}

const press = (c, client, label, extra = {}) => pressCard({ project: P, card: c.id, hash: c.hash, label, client, now: () => LATER, liftStop: () => {}, ...extra });
const signed = (client) => client.calls.record.map((r) => ({ kind: r.event.kind, data: r.event.data }));
const waitingIds = () => buildViews(listEvents(stateDir(P), { report: () => {} }), readEnrolled(), { now: () => LATER }).waiting.map((w) => w.id);
const pendingFiles = () => {
  try {
    return fs.readdirSync(pendingDir(P)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
};
const untouched = (client) => client.calls.write.length + client.calls.record.length + client.calls.prState.length;
// The click the card would have taken: AskUserQuestion's answer on the card's own options.
const click = (data, label) => ({
  cwd: '/x', hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question: data.question, options: data.options.map((o) => ({ label: o })), multiSelect: false }], answers: { [data.question]: label } },
  tool_response: { answers: { [data.question]: label } },
});
const clickDeps = (client) => ({ client, now: () => LATER, projectOf: () => ({ project: P }), liftStop: () => {} });

test('Approve on an approval card signs the approval a click earns, then writes the card answer', () => withKey(async () => {
  const card = putCard(approvalCard());
  // When the answer is written, the signed record is already kept or taken.
  let keptFirst = null;
  const helper = fake({ refuse: true, onWrite: () => { keptFirst = pendingFiles().length; } });
  const out = await press(card, helper, 'Approve');
  assert.deepEqual(out, { made: true, says: 'Recorded: Approve on card 1 (kept until the helper takes it)' });
  assert.equal(keptFirst, 1);

  // Taken by the helper: the same record a click earns, signed, and then the plain answer.
  const other = putCard(approvalCard(14), 1);
  const client = fake();
  assert.deepEqual(await press(other, client, 'Approve'), { made: true, says: 'Recorded: Approve on card 2' });
  assert.deepEqual(client.calls.order, ['prState', 'record', 'write']);
  assert.deepEqual(signed(client), [{ kind: 'approval', data: { pr: 14, commit: FULL, words: 'Approve', question: other.data.question } }]);
  assert.equal(verify(client.calls.record[0].event, readEnrolled()), true);
  assert.deepEqual(client.calls.write, [{ project: P, kind: 'card-answer', data: { question: other.data.question, label: 'Approve' } }]);
  const clicked = fake({ takes: false });
  await decide(click(other.data, 'Approve'), clickDeps(clicked));
  assert.deepEqual(signed(client), signed(clicked).filter((r) => r.kind !== 'shown'));
  assert.equal(waitingIds().includes(other.id), false);
}));

test('an answer card\'s option signs the answer action for its question', () => withKey(async () => {
  const asked = makeEvent({ kind: 'question', data: QUESTION, now: () => NOW });
  keepEvent(asked);
  const card = putCard(answerCard());
  const client = fake();
  assert.deepEqual(await press(card, client, 'Tab'), { made: true, says: 'Recorded: Tab on card 1' });
  assert.deepEqual(signed(client), [{ kind: 'action', data: { action: 'answer', questionId: 'q-export-csv-1', questionHash: dataHash(QUESTION), question: card.data.question, label: 'Tab' } }]);
  assert.equal(verify(client.calls.record[0].event, readEnrolled()), true);
  const clicked = fake({ takes: false });
  await decide(click(card.data, 'Tab'), clickDeps(clicked));
  assert.deepEqual(signed(client), signed(clicked).filter((r) => r.kind !== 'shown'));
  assert.equal(client.calls.write.length, 1);
}));

test('Not now writes the card answer alone, and the card stays waiting', () => withKey(async () => {
  const card = putCard(approvalCard());
  const client = fake();
  assert.deepEqual(await press(card, client, 'Not now'), { made: true, says: 'Recorded: Not now on card 1' });
  assert.deepEqual(client.calls.order, ['write']);
  assert.deepEqual(client.calls.write, [{ project: P, kind: 'card-answer', data: { question: card.data.question, label: 'Not now' } }]);
  assert.deepEqual(waitingIds(), [card.id]);
  // It can still be answered.
  assert.equal((await press(card, fake(), 'Approve')).made, true);

  // Not taken: kept for the next session start to send, as a click's answer is.
  const later = putCard(approvalCard(14), 1);
  const refused = fake({ refuse: true });
  assert.deepEqual(await press(later, refused, 'Not now'), { made: true, says: 'Recorded: Not now on card 1 (kept until the helper takes it)' });
  const kept = pendingFiles().map((n) => JSON.parse(fs.readFileSync(path.join(pendingDir(P), n), 'utf8')));
  assert.deepEqual(kept.map((k) => [k.route, k.body.data.label]), [['write', 'Not now']]);
}));

test('Explain more and Show me write the card answer and give one prompt naming the card', () => withKey(async () => {
  const first = putCard(approvalCard());
  const second = putCard(approvalCard(14), 1);
  for (const label of ['Explain more', 'Show me']) {
    const client = fake();
    assert.deepEqual(await press(second, client, label), {
      made: true, says: `Recorded: ${label} on card 2`, submit: [`Wheelhouse pane: the director pressed ${label} on card 2 (${second.id}).`],
    });
    assert.deepEqual(client.calls.order, ['write']);
    assert.deepEqual(client.calls.write[0].data, { question: second.data.question, label });
  }
  assert.deepEqual(waitingIds(), [first.id, second.id]);

  // A question card's own option is a choice the front desk takes up.
  const asking = putCard(questionCard(), 2);
  const client = fake();
  assert.deepEqual(await press(asking, client, 'Comma'), {
    made: true, says: 'Recorded: Comma on card 3', submit: [`Wheelhouse pane: the director chose "Comma" on card 3 (${asking.id}).`],
  });
  assert.deepEqual(client.calls.write[0].data, { question: asking.data.question, label: 'Comma' });
}));

test('a card already answered, by a click, a reply code or a press, records nothing', () => withKey(async (home) => {
  const replied = path.join(home, 'projects', P, 'replied');
  const answered = { made: false, says: 'That card has already been answered' };

  // A click, taken by the helper.
  const clicked = putCard(approvalCard(13));
  await decide(click(clicked.data, 'Approve'), clickDeps(fake()));
  let client = fake();
  assert.deepEqual(await press(clicked, client, 'Approve'), answered);
  assert.deepEqual(await press(clicked, client, 'Not now'), answered);
  assert.equal(untouched(client), 0);

  // A reply code: the card shown with its code, then the reply taken by the helper.
  const coded = putCard(approvalCard(14), 1);
  await decide(click(coded.data, 'Explain more'), clickDeps(fake()));
  assert.equal((await replyRecord({ project: P, text: `${coded.data.code} Approve`, client: fake(), now: () => LATER })).made, true);
  client = fake();
  assert.deepEqual(await press(coded, client, 'Approve'), answered);
  assert.equal(untouched(client), 0);

  // A reply whose record the helper hasn't taken yet: it waits in pending/.
  const waiting = putCard(approvalCard(15), 2);
  await decide(click(waiting.data, 'Explain more'), clickDeps(fake()));
  assert.equal((await replyRecord({ project: P, text: `${waiting.data.code} Approve`, client: fake({ refuse: true }), now: () => LATER })).made, true);
  fs.rmSync(replied, { recursive: true, force: true });
  client = fake();
  assert.deepEqual(await press(waiting, client, 'Approve'), answered);
  assert.equal(untouched(client), 0);
  fs.rmSync(pendingDir(P), { recursive: true, force: true });

  // A press, taken; and a press whose record is still kept.
  const pressed = putCard(approvalCard(16), 3);
  assert.equal((await press(pressed, fake(), 'Approve')).made, true);
  client = fake();
  assert.deepEqual(await press(pressed, client, 'Approve'), answered);
  const kept = putCard(approvalCard(17), 4);
  assert.equal((await press(kept, fake({ refuse: true }), 'Approve')).made, true);
  fs.rmSync(replied, { recursive: true, force: true });
  assert.deepEqual(await press(kept, client, 'Approve'), answered);
  assert.equal(untouched(client), 0);

  // A press on a card a reply has claimed, and a reply on a card a press has claimed.
  const claimed = putCard(approvalCard(18), 5);
  fs.mkdirSync(replied, { recursive: true });
  fs.writeFileSync(path.join(replied, claimed.id), '');
  assert.deepEqual(await press(claimed, client, 'Approve'), answered);
  assert.equal(untouched(client), 0);
}));

test('a card whose text changed since it was drawn records nothing', () => withKey(async () => {
  const card = putCard(approvalCard());
  const client = fake();
  assert.deepEqual(await press({ ...card, hash: hashOf(`${card.data.question} `) }, client, 'Approve'), { made: false, says: 'That card changed: look at it again' });
  for (const hash of [undefined, 42, '', card.hash.toUpperCase()]) {
    assert.deepEqual(await press({ ...card, hash }, client, 'Approve'), { made: false, says: 'That card changed: look at it again' });
  }
  // A label the card doesn't offer, and a card that isn't waiting.
  assert.deepEqual(await press(card, client, 'Confirm'), { made: false, says: 'That card doesn\'t offer Confirm' });
  assert.deepEqual(await press(card, client, 'Approve\nApprove'), { made: false, says: 'That card doesn\'t offer that' });
  for (const id of ['no-such-card', '../escape', 42, undefined]) {
    assert.deepEqual(await press({ ...card, id }, client, 'Approve'), { made: false, says: 'That card has already been answered' });
  }
  assert.equal(untouched(client), 0);
  assert.deepEqual(pendingFiles(), []);
}));

test('two presses at once record once', () => withKey(async () => {
  const card = putCard(approvalCard());
  const client = fake({ takes: false });
  const results = await Promise.all([press(card, client, 'Approve'), press(card, client, 'Approve')]);
  assert.deepEqual(results.map((r) => r.made).sort(), [false, true]);
  assert.equal(client.calls.record.length, 1);
  assert.equal(client.calls.write.length, 1);

  // A press and a reply on the same card at once.
  const coded = putCard(approvalCard(14), 1);
  await decide(click(coded.data, 'Explain more'), clickDeps(fake({ takes: true })));
  const both = fake({ takes: false });
  const mixed = await Promise.all([
    press(coded, both, 'Approve'),
    replyRecord({ project: P, text: `${coded.data.code} Approve`, client: both, now: () => LATER }),
  ]);
  assert.deepEqual(mixed.map((r) => r.made).sort(), [false, true]);
  assert.equal(both.calls.record.length, 1);
}));

test('an approval whose pull request moved records nothing and says why', () => withKey(async () => {
  const card = putCard(approvalCard());
  const moved = fake({ pr: { ok: true, result: { headSha: '1'.repeat(40), state: 'open' } } });
  const says = 'That couldn\'t be recorded: the card no longer matches what it decides';
  assert.deepEqual(await press(card, moved, 'Approve'), { made: false, says });
  assert.deepEqual(moved.calls.prState, [{ project: P, number: 13 }]);
  assert.equal(moved.calls.record.length + moved.calls.write.length, 0);
  assert.deepEqual(pendingFiles(), []);
  // The card was let go, so it can be pressed again once it matches.
  assert.equal((await press(card, fake(), 'Approve')).made, true);

  // A Lift STOP while STOP is off.
  const lift = putCard(liftStopCard(), 1);
  let lifted = 0;
  const off = fake();
  assert.deepEqual(await press(lift, off, 'Lift STOP', { liftStop: () => { lifted += 1; } }), { made: false, says });
  assert.equal(off.calls.record.length + off.calls.write.length, 0);
  assert.equal(lifted, 0);
}));

test('an approval whose pull request the helper couldn\'t answer records nothing and says to try again', () => withKey(async () => {
  const card = putCard(approvalCard());
  const says = 'Wheelhouse couldn\'t check the pull request just now, so nothing was recorded; try again';
  // The helper answers that it can't, or fails outright.
  const refused = fake({ pr: { ok: false, why: 'the host is down' } });
  assert.deepEqual(await press(card, refused, 'Approve'), { made: false, says });
  const failing = fake();
  failing.prState = async () => { throw new Error('the helper is down'); };
  assert.deepEqual(await press(card, failing, 'Approve'), { made: false, says });
  for (const client of [refused, failing]) assert.equal(client.calls.record.length + client.calls.write.length, 0);
  assert.deepEqual(pendingFiles(), []);
  // The card was let go, and a closed pull request is a card that no longer matches.
  const closed = fake({ pr: { ok: true, result: { headSha: FULL, state: 'closed' } } });
  assert.deepEqual(await press(card, closed, 'Approve'), { made: false, says: 'That couldn\'t be recorded: the card no longer matches what it decides' });
  assert.equal((await press(card, fake(), 'Approve')).made, true);
}));

test('under STOP, Approve still records and closes its card; Not now says it was not noted', () => withKey(async () => {
  setStop({ by: 'prompt', now: () => NOW });
  const approval = putCard(approvalCard());
  const other = putCard(approvalCard(14), 1);
  const client = fake({ stop: true });
  assert.deepEqual(await press(approval, client, 'Approve'), { made: true, says: 'Recorded: Approve on card 1' });
  assert.equal(client.calls.record.length, 1);
  assert.equal(verify(client.calls.record[0].event, readEnrolled()), true);
  // The record closes the card on its own; the helper would refuse the plain answer.
  assert.equal(client.calls.write.length, 0);
  assert.deepEqual(waitingIds(), [other.id]);

  const noted = fake({ stop: true });
  assert.deepEqual(await press(other, noted, 'Not now'), { made: false, says: 'STOP is on, so that wasn\'t noted; the card stays as it was' });
  assert.equal(untouched(noted), 0);
  assert.deepEqual(pendingFiles(), []);

  // Reading and explaining carry on: Explain more still gives its prompt.
  const explain = fake({ stop: true });
  const asked = await press(other, explain, 'Explain more');
  assert.equal(asked.made, false);
  assert.equal(asked.says, 'STOP is on, so that wasn\'t noted; the front desk has Explain more on card 1');
  assert.deepEqual(asked.submit, [`Wheelhouse pane: the director pressed Explain more on card 1 (${other.id}).`]);
  assert.equal(untouched(explain), 0);
  assert.equal(stopState().on, true);

  // A Lift STOP press lifts it, and its answer is then written.
  const lift = putCard(liftStopCard(), 2);
  const lifting = fake();
  assert.deepEqual(await press(lift, lifting, 'Lift STOP', { liftStop }), { made: true, says: 'Recorded: Lift STOP on card 2' });
  assert.equal(stopState().on, false);
  assert.deepEqual(lifting.calls.order, ['record', 'write']);
}));

test('a choice on a question card is claimed, so two presses at once record it once', () => withKey(async (home) => {
  const replied = path.join(home, 'projects', P, 'replied');
  const answered = { made: false, says: 'That card has already been answered' };

  // Neither taken nor kept: nothing was noted, so the card is let go and no prompt is given.
  const lost = putCard(questionCard());
  fs.mkdirSync(path.dirname(pendingDir(P)), { recursive: true });
  fs.writeFileSync(pendingDir(P), 'not a folder');
  const down = fake({ refuse: true });
  assert.deepEqual(await press(lost, down, 'Comma'), { made: false, says: 'That wasn\'t noted this time, so the card stays as it was' });
  assert.equal(fs.existsSync(path.join(replied, lost.id)), false);
  fs.rmSync(pendingDir(P), { force: true });

  // Two presses at once, with a helper that takes its time: one answer, one prompt.
  const client = fake({ takes: false });
  const results = await Promise.all([press(lost, client, 'Comma'), press(lost, client, 'Tab')]);
  assert.deepEqual(results.map((r) => r.made).sort(), [false, true]);
  assert.equal(client.calls.write.length, 1);
  assert.equal(results.flatMap((r) => r.submit ?? []).length, 1);
  assert.equal(results.find((r) => !r.made).says, answered.says);

  // A choice kept in pending/, the helper being down, closes the card to a second choice.
  const kept = putCard(questionCard('Which separator should the import use?'), 1);
  const refused = fake({ refuse: true });
  assert.deepEqual(await press(kept, refused, 'Tab'), {
    made: true, says: 'Recorded: Tab on card 2 (kept until the helper takes it)', submit: [`Wheelhouse pane: the director chose "Tab" on card 2 (${kept.id}).`],
  });
  fs.rmSync(replied, { recursive: true, force: true });
  const second = fake();
  assert.deepEqual(await press(kept, second, 'Comma'), answered);
  assert.equal(untouched(second), 0);

  // Explain more and Not now kept in pending/ don't close it, and claim nothing.
  const open = putCard(questionCard('Which separator should the report use?'), 2);
  assert.equal((await press(open, fake({ refuse: true }), 'Explain more')).made, true);
  assert.equal(fs.existsSync(path.join(replied, open.id)), false);
  assert.equal((await press(open, fake(), 'Comma')).made, true);
}));

test('a Lift STOP card drawn before this STOP began records nothing', () => withKey(async () => {
  const old = putCard(liftStopCard());
  // STOP went on half an hour after the card was drawn.
  setStop({ by: 'prompt', now: () => new Date(NOW.getTime() + 30 * 60 * 1000) });
  let lifted = 0;
  const client = fake();
  assert.deepEqual(await press(old, client, 'Lift STOP', { liftStop: () => { lifted += 1; } }), {
    made: false, says: 'That couldn\'t be recorded: the card no longer matches what it decides',
  });
  assert.equal(untouched(client), 0);
  assert.equal(lifted, 0);
  assert.equal(stopState().on, true);
  assert.deepEqual(pendingFiles(), []);

  // A card drawn after it began lifts it.
  const fresh = putCard(liftStopCard(), 31);
  assert.equal((await press(fresh, fake(), 'Lift STOP', { liftStop })).made, true);
  assert.equal(stopState().on, false);
}));

// A confirm card for a setting event, as the front desk composes it.
const settingCard = (event) => composeCard({ ...common, kind: 'confirm', recommend: 'Confirm', what: `A setting you asked for: ${event.data.words}.`, options: [says('Confirm')], target: { event } }).card;
const claimedNothing = () => {
  try {
    return fs.readdirSync(repliedDir(P)).length === 0;
  } catch {
    return true;
  }
};

test('no press confirms a Windows build-commands setting: only a click on its own card does', () => withKey(async () => {
  const me = computerId();
  const setting = (value) => makeEvent({ kind: 'setting', data: { key: settingKey(me), value, words: `Run build commands ${value}` }, now: () => NOW });
  const guarded = setting('guarded');
  keepEvent(guarded);
  // Nor one in the director's profile.
  const profiled = setting('unattended');
  fs.mkdirSync(path.join(profileDir(), path.dirname(eventPath(profiled))), { recursive: true });
  fs.writeFileSync(path.join(profileDir(), eventPath(profiled)), JSON.stringify(profiled));
  const refused = { made: false, says: SAYS.buildsByClick };
  for (const [event, minute] of [[guarded, 0], [profiled, 1]]) {
    const card = putCard(settingCard(event), minute);
    const client = fake();
    assert.deepEqual(await press(card, client, 'Confirm'), refused);
    assert.equal(untouched(client), 0);
    assert.equal(waitingIds().includes(card.id), true);
  }
  // Use Guarded, which confirms that setting, is a click only too, whatever card offers it.
  const offers = putCard(composeCard({ ...common, kind: 'question', recommend: 'Keep asking', what: 'How should build commands run on this computer?', options: [{ label: 'Keep asking', says: 'Each run is asked.' }, { label: USE_GUARDED, says: 'Runs in the guarded runner.' }] }).card, 2);
  const client = fake();
  assert.deepEqual(await press(offers, client, USE_GUARDED), refused);
  assert.equal(untouched(client), 0);
  assert.deepEqual(pendingFiles(), []);
  assert.equal(claimedNothing(), true);
}));

test('a press allows a build-command question\'s commands only on the computer that recorded the question', () => withKey(async () => {
  const asked = (n) => ({
    id: `q-export-csv-${n}`, work: 'export-csv', what: 'Let this feature\'s builder run: npm test.', why: 'The tests need running',
    options: BUILD_QUESTION_OPTIONS.map((o) => ({ ...o })), recommendation: BUILD_QUESTION_LABELS.once, level: 3, commands: ['npm test'],
  });
  const elsewhere = { ...makeEvent({ kind: 'question', data: asked(2), now: () => NOW }), computer: 'deadbeef' };
  const unknown = { ...makeEvent({ kind: 'question', data: asked(3), now: () => NOW }), computer: undefined };
  for (const e of [elsewhere, unknown]) keepEvent(e);
  for (const [e, minute] of [[elsewhere, 0], [unknown, 1]]) {
    const card = putCard(composeCard(answerInput(e.data, 'export-csv')).card, minute);
    for (const label of [BUILD_QUESTION_LABELS.once, BUILD_QUESTION_LABELS.feature]) {
      const client = fake();
      assert.deepEqual(await press(card, client, label), { made: false, says: 'Build commands are allowed only on the Windows computer that asked: answer the card there' }, `${e.data.id} ${label}`);
      assert.equal(untouched(client), 0);
    }
    assert.equal(waitingIds().includes(card.id), true);
  }
  assert.deepEqual(pendingFiles(), []);
  assert.equal(claimedNothing(), true);
}));

test('an ordinary press beside those still records: Allow on this computer\'s question, Confirm on another setting', () => withKey(async () => {
  const data = {
    id: 'q-export-csv-1', work: 'export-csv', what: 'Let this feature\'s builder run: npm test.', why: 'The tests need running',
    options: BUILD_QUESTION_OPTIONS.map((o) => ({ ...o })), recommendation: BUILD_QUESTION_LABELS.once, level: 3, commands: ['npm test'],
  };
  const here = makeEvent({ kind: 'question', data, now: () => NOW });
  keepEvent(here);
  const card = putCard(composeCard(answerInput(data, 'export-csv')).card);
  const client = fake();
  assert.deepEqual(await press(card, client, BUILD_QUESTION_LABELS.feature), { made: true, says: `Recorded: ${BUILD_QUESTION_LABELS.feature} on card 1` });
  assert.deepEqual(signed(client).map((r) => [r.data.action, r.data.questionId, r.data.label]), [['answer', 'q-export-csv-1', BUILD_QUESTION_LABELS.feature]]);
  assert.equal(waitingIds().includes(card.id), false);

  const tab = makeEvent({ kind: 'setting', data: { key: 'boardTab', value: 'build', words: 'Open the board on its build tab' }, now: () => NOW });
  keepEvent(tab);
  const confirm = putCard(settingCard(tab), 1);
  const other = fake();
  assert.equal((await press(confirm, other, 'Confirm')).made, true);
  assert.deepEqual(signed(other).map((r) => r.kind), ['confirmation']);
  assert.equal(waitingIds().includes(confirm.id), false);
}));

test('Turn on (dangerous) on the Unattended card records nothing from the pane, and the card stays waiting', () => withKey(async () => {
  const me = computerId();
  const on = makeEvent({ kind: 'setting', data: { key: settingKey(me), value: 'unattended', words: 'Run build commands unattended' }, now: () => NOW });
  keepEvent(on);
  const card = putCard(unattendedCardData(UNATTENDED_CARD(), on.id, me));
  for (const label of ['Turn on (dangerous)', 'Keep asking']) {
    const client = fake();
    const out = await press(card, client, label);
    assert.equal(out.made, false, label);
    assert.equal(out.submit, undefined, label);
    assert.equal(/\n/.test(out.says), false, label);
    assert.equal(untouched(client), 0, label);
  }
  assert.deepEqual(await press(card, fake(), 'Turn on (dangerous)'), { made: false, says: SAYS.buildsByClick });
  assert.equal(waitingIds().includes(card.id), true);
  assert.deepEqual(pendingFiles(), []);
  assert.equal(claimedNothing(), true);
  assert.equal(listEvents(stateDir(P), { report: () => {} }).some((e) => e.kind === 'card-answer' || e.kind === 'confirmation'), false);

  // An ordinary press beside it still records.
  const other = putCard(questionCard(), 1);
  const client = fake();
  assert.equal((await press(other, client, 'Comma')).made, true);
  assert.equal(client.calls.write.length, 1);
  assert.equal(waitingIds().includes(other.id), false);
}));

test('no press on a trust card records anything or trusts anyone: only the director\'s click on the card itself does (ruling R80)', () => withKey(async (home) => {
  const trust = putCard(composeCard({
    ...common, kind: 'trust', recommend: 'Trust it', what: 'Your computer 0a1b2c3d put its key in your profile.',
    options: [says('Trust it')], target: { computer: '0a1b2c3d', at: '2026-10-19T04:00:00.000Z', fingerprint: 'abcdef012345' },
  }).card);
  const before = readEnrolled();
  for (const label of ['Trust it', 'Not now', 'Explain more']) {
    const client = fake();
    const got = await press(trust, client, label);
    assert.equal(got.made, false, label);
    assert.equal(untouched(client), 0, label);
    assert.equal(client.calls.profileRecord.length, 0, label);
  }
  assert.deepEqual(readEnrolled(), before, 'nothing enrolled');
  assert.equal(fs.existsSync(path.join(home, 'trust')), false, 'no trust click kept');
  assert.deepEqual(pendingFiles(), []);
  assert.equal(listEvents(stateDir(P), { report: () => {} }).some((e) => e.kind === 'card-answer' || e.kind === 'action'), false);
}));

test('no press on a setup card records anything: only the director\'s click on the card setup showed lets its step go ahead', () => withKey(async () => {
  const hash = 'fedcba9876543210'.repeat(4);
  const setup = putCard(composeCard({ ...common, kind: 'setup', recommend: 'Go ahead', what: 'Setup step 1, checking this computer, changes nothing on it.', options: [says('Go ahead')], target: { step: 1, hash } }).card);
  for (const label of ['Go ahead', 'Not now', 'Explain more', 'Show me']) {
    const client = fake();
    assert.deepEqual(await press(setup, client, label), { made: false, says: SAYS.setupByClick }, label);
    assert.equal(untouched(client), 0, label);
    assert.equal(client.calls.profileRecord.length, 0, label);
  }
  // Nor on setup's card of the rules found (ruling R35).
  const rules = putCard(composeCard({
    ...common, kind: 'confirm-all', recommend: 'Confirm all', what: 'Setup step 5 found 1 rule: 1) "Never push to main".',
    options: [says('Confirm all'), says('Let me correct some')], target: { count: 1, hash },
  }).card, 1);
  for (const label of ['Confirm all', 'Let me correct some', 'Not now', 'Explain more']) {
    const client = fake();
    assert.deepEqual(await press(rules, client, label), { made: false, says: SAYS.setupByClick }, label);
    assert.equal(untouched(client), 0, label);
  }
  assert.equal(waitingIds().includes(rules.id), true);
  assert.equal(waitingIds().includes(setup.id), true);
  assert.deepEqual(pendingFiles(), []);
  assert.equal(claimedNothing(), true);
  assert.equal(listEvents(stateDir(P), { report: () => {} }).some((e) => e.kind === 'card-answer' || e.kind === 'action'), false);
}));
