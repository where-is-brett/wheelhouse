// tests/scripts/frontdesk/learning.test.js
// What learning works out from the director's clicks: the concepts they know and the settings
// they would like, each proposed once, and the delegation review's proposals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  conceptProposals, settingProposals, conceptSetting, dayOf, delegationProposals, delegationReview, lastReview, reviewDue,
} from '../../../scripts/frontdesk/learning.js';
import { composeCard, answerInput } from '../../../scripts/cards/compose.js';
import { makeEvent, confirmationFor, dataHash } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { effectiveSettings } from '../../../scripts/settings/effective.js';
import { DELEGATE_AFTER, KNOWN_AFTER } from '../../../scripts/lib/front-desk.js';
import { as, tempFolder } from '../../helpers/homes.js';

const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
// Noon UTC on a day of October 2026: consecutive days are different days in any time zone.
const day = (d, minutes = 0) => new Date(Date.UTC(2026, 9, d, 12, minutes)).toISOString();
const when = (iso) => () => new Date(iso);

// A home with an enrolled signing key, for makeEvent and the signed records.
async function inHome(fn) {
  const home = path.join(tempFolder('wh-learning-'), 'home');
  return as(home, async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-01T00:00:00.000Z' });
    return fn();
  });
}

const QUESTION = (n) => ({
  kind: 'question', level: 2, what: `Which name suits page ${n}?`, why: 'It is the wording users see.',
  options: [{ label: 'Plain', says: 'Plain words.' }, { label: 'Playful', says: 'Playful words.' }],
  recommend: 'Plain', because: 'it reads quickest', meanwhile: 'The page keeps its old name.',
});
let numbered = 0;
const cardAt = (at, concepts = ['pull request'], input = QUESTION((numbered += 1))) => makeEvent({ kind: 'card', data: composeCard({ ...input, concepts }).card, now: when(at) });
const answer = (card, label, at) => makeEvent({ kind: 'card-answer', data: { card: card.id, label }, now: when(at) });
// A card asked and decided with its first option.
const decided = (cardTime, answerTime = cardTime, concepts) => {
  const card = cardAt(cardTime, concepts);
  return [card, answer(card, 'Plain', answerTime)];
};
// A profile event setting `key` to `value`, as learning writes one.
const setting = (key, value, at) => makeEvent({ kind: 'setting', data: { key, value, words: `${key}: ${value}`, because: 'learnt' }, now: when(at) });
// The settings in force from a settings view's entries.
const inForce = (entries = {}, now = day(20)) => effectiveSettings({
  project: {}, profile: Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, { key, id: key, at: day(1), value, before: null }])), now,
});
const profileOf = ({ events = [], settings = {}, unconfirmed = [] } = {}) => ({ events, settings: inForce(settings), unconfirmed });

test('a concept is proposed as known after three cards on different days without Explain more', async () => {
  await inHome(async () => {
    assert.equal(KNOWN_AFTER, 3);
    const events = [...decided(day(10)), ...decided(day(11)), ...decided(day(12))];
    assert.deepEqual(conceptProposals(events, profileOf(), { now: when(day(13)) }), [{ concept: 'pull-request', known: true, confirm: true }]);
    // Two days are not enough.
    assert.deepEqual(conceptProposals(events.slice(0, 4), profileOf(), { now: when(day(13)) }), []);
    // A card with Explain more on it doesn't count, and the cards decided before it don't either.
    const card = cardAt(day(13));
    const asked = [...events, card, answer(card, 'Explain more', day(13, 5)), answer(card, 'Plain', day(13, 10))];
    assert.deepEqual(conceptProposals(asked, profileOf(), { now: when(day(14)) }), []);
    const later = [...asked, ...decided(day(14)), ...decided(day(15)), ...decided(day(16))];
    assert.deepEqual(conceptProposals(later, profileOf(), { now: when(day(17)) }), [{ concept: 'pull-request', known: true, confirm: true }]);
    // A card put off or waiting is no answer.
    const putOff = cardAt(day(18));
    assert.deepEqual(conceptProposals([...events.slice(0, 4), putOff, answer(putOff, 'Not now', day(18))], profileOf(), { now: when(day(19)) }), []);
    // Outcomes worked out once by the caller are the ones used.
    assert.deepEqual(conceptProposals(events, profileOf(), { now: when(day(13)), outcomes: [] }), []);
    // A concept already known is not proposed again.
    assert.deepEqual(conceptProposals(events, profileOf({ settings: { 'known:pull-request': true } }), { now: when(day(13)) }), []);
    // The days are calendar days in this computer's time zone: a day function decides them.
    const allOne = conceptProposals(events, profileOf(), { now: when(day(13)), dayOf: () => 'one day' });
    assert.deepEqual(allOne, []);
    assert.equal(dayOf(new Date(2026, 9, 10, 23, 59).toISOString()), '2026-10-10');
    assert.equal(dayOf(new Date(2026, 9, 11, 0, 1).toISOString()), '2026-10-11');
    // The setting it would write: the key, the value and the reason.
    assert.deepEqual(conceptSetting({ concept: 'pull-request', known: true, confirm: true }).key, 'known:pull-request');
    assert.equal(conceptSetting({ concept: 'pull-request', known: true, confirm: true }).value, true);
    assert.match(conceptSetting({ concept: 'pull-request', known: true, confirm: true }).because, /^you /);
  });
});

test('three cards in one visit do not make a concept known', async () => {
  await inHome(async () => {
    const events = [...decided(day(10)), ...decided(day(10, 10)), ...decided(day(10, 20)), ...decided(day(10, 30))];
    assert.deepEqual(conceptProposals(events, profileOf(), { now: when(day(11)) }), []);
    // Asked on one day, answered on three: it is the answers' days that count.
    const spread = [...decided(day(10), day(11)), ...decided(day(10, 5), day(12)), ...decided(day(10, 10), day(13))];
    assert.deepEqual(conceptProposals(spread, profileOf(), { now: when(day(14)) }), [{ concept: 'pull-request', known: true, confirm: true }]);
  });
});

test('Explain more on a known concept makes explanations longer at once, with no card', async () => {
  await inHome(async () => {
    const made = setting('known:pull-request', true, day(5));
    const card = cardAt(day(10));
    const events = [card, answer(card, 'Explain more', day(10, 5))];
    const profile = profileOf({ events: [made, makeEvent({ ...confirmationFor(made), now: when(day(5, 1)) })], settings: { 'known:pull-request': true } });
    assert.deepEqual(conceptProposals(events, profile, { now: when(day(11)) }), [{ concept: 'pull-request', known: false, confirm: false }]);
    assert.deepEqual(conceptSetting({ concept: 'pull-request', known: false, confirm: false }).value, false);
    // An Explain more from before the concept was known is not counted against it.
    const before = cardAt(day(3));
    assert.deepEqual(conceptProposals([before, answer(before, 'Explain more', day(3))], profile, { now: when(day(11)) }), []);
    // A card about another concept says nothing about this one.
    const other = cardAt(day(10), ['CI']);
    assert.deepEqual(conceptProposals([other, answer(other, 'Explain more', day(10))], profile, { now: when(day(11)) }), []);
    // Once false is the latest value in the profile, it is not proposed again.
    const unlearnt = setting('known:pull-request', false, day(10, 30));
    assert.deepEqual(conceptProposals(events, { ...profile, events: [...profile.events, unlearnt] }, { now: when(day(11)) }), []);
  });
});

test('an Explain more between a proposal and its Confirm does not make the concept unknown again', async () => {
  await inHome(async () => {
    // Proposed on the 5th, Explain more on a card that uses it on the 6th, confirmed on the 7th.
    const made = setting('known:pull-request', true, day(5));
    const card = cardAt(day(6));
    const events = [card, answer(card, 'Explain more', day(6, 5))];
    const profile = profileOf({ events: [made, makeEvent({ ...confirmationFor(made), now: when(day(7)) })], settings: { 'known:pull-request': true } });
    assert.deepEqual(conceptProposals(events, profile, { now: when(day(8)) }), []);
    // An Explain more after the Confirm does.
    const later = cardAt(day(8));
    assert.deepEqual(conceptProposals([...events, later, answer(later, 'Explain more', day(8, 5))], profile, { now: when(day(9)) }), [
      { concept: 'pull-request', known: false, confirm: false },
    ]);
    // A false counts from its own time: an Explain more before it, after a later true was confirmed, says nothing new.
    const forgot = setting('known:pull-request', false, day(9));
    const relearnt = setting('known:pull-request', true, day(10));
    const after = profileOf({
      events: [made, forgot, relearnt, makeEvent({ ...confirmationFor(relearnt), now: when(day(12)) })], settings: { 'known:pull-request': true },
    });
    const between = cardAt(day(11));
    assert.deepEqual(conceptProposals([between, answer(between, 'Explain more', day(11, 5))], after, { now: when(day(13)) }), []);
  });
});

test('a reply code counts as the click it stands for', async () => {
  await inHome(async () => {
    const approvalCard = (d) => cardAt(day(d), ['pull request'], {
      kind: 'approval', level: 3, what: `Pull request #${d} changes the sign-in page.`, why: 'It changes what users see.',
      options: [{ label: 'Approve', says: 'It merges.' }], recommend: 'Approve', because: 'the checks passed', meanwhile: 'Nothing is released.',
      target: { pr: d, sha: FULL },
    });
    // The signed approval a reply code earns carries the card's question, as the click's does; no card-answer is written.
    const signed = (card, d) => makeEvent({ kind: 'approval', data: { pr: d, commit: FULL, question: card.data.question }, now: when(day(d, 5)) });
    const cards = [10, 11, 12].map(approvalCard);
    const events = [...cards, ...cards.map((card, i) => signed(card, 10 + i))];
    assert.deepEqual(conceptProposals(events, profileOf(), { now: when(day(13)), enrolled: readEnrolled() }), [{ concept: 'pull-request', known: true, confirm: true }]);
    // A record no enrolled computer signed is no click.
    assert.deepEqual(conceptProposals(events, profileOf(), { now: when(day(13)), enrolled: [] }), []);
  });
});

test('the build tab asked for three visits running proposes it as the default', async () => {
  await inHome(async () => {
    const ask = (d, tab, minutes = 0) => ({ at: day(d, minutes), tab, visit: day(d) });
    const three = [ask(10, 'build'), ask(11, null), ask(11, 'build', 5), ask(12, 'build')];
    const proposed = settingProposals([], profileOf(), { now: when(day(13)), boardAsks: three });
    assert.equal(proposed.length, 1);
    assert.equal(proposed[0].key, 'boardTab');
    assert.equal(proposed[0].value, 'build');
    assert.match(proposed[0].because, /^you /);
    // Two visits are not enough, nor three in one visit.
    assert.deepEqual(settingProposals([], profileOf(), { now: when(day(13)), boardAsks: three.slice(1) }), []);
    assert.deepEqual(settingProposals([], profileOf(), { now: when(day(13)), boardAsks: [ask(12, 'build'), ask(12, 'build', 5), ask(12, 'build', 10)] }), []);
    // A visit whose last board was the director's breaks the run.
    assert.deepEqual(settingProposals([], profileOf(), { now: when(day(13)), boardAsks: [...three, ask(13, 'build'), ask(13, 'director', 5)] }), []);
    // Already the default: nothing to propose.
    assert.deepEqual(settingProposals([], profileOf({ settings: { boardTab: 'build' } }), { now: when(day(13)), boardAsks: three }), []);
    // Visits from before the latest boardTab setting don't count.
    assert.deepEqual(settingProposals([], profileOf({ events: [setting('boardTab', 'director', day(11, 30))] }), { now: when(day(13)), boardAsks: three }), []);
  });
});

test('Explain more on three cards in a week proposes plain explanations', async () => {
  await inHome(async () => {
    const explained = (d) => {
      const card = cardAt(day(d), []);
      return [card, answer(card, 'Explain more', day(d, 1))];
    };
    const events = [...explained(10), ...explained(12), ...explained(15)];
    const some = profileOf({ settings: { explanations: 'some-terms' } });
    const proposed = settingProposals(events, some, { now: when(day(16)), boardAsks: [] });
    assert.deepEqual(proposed.map(({ key, value }) => ({ key, value })), [{ key: 'explanations', value: 'plain' }]);
    // The first is more than a week old by the 18th.
    assert.deepEqual(settingProposals(events, some, { now: when(day(18)), boardAsks: [] }), []);
    // Already plain: nothing to propose.
    assert.deepEqual(settingProposals(events, profileOf(), { now: when(day(16)), boardAsks: [] }), []);
  });
});

// The profile as the hook reads it: its events, the settings in force and `unconfirmed`, from its views.
const profileFrom = (events, now) => {
  const views = buildViews(events, readEnrolled(), { now: when(now) });
  return { events, settings: effectiveSettings({ project: {}, profile: views.settings, now }), unconfirmed: views.unconfirmed };
};
const confirmCardFor = (event) => makeEvent({
  kind: 'card',
  now: when(day(1, 1)),
  data: composeCard({
    kind: 'confirm', level: 3, what: `A change to your settings: ${event.data.words}`, why: 'It changes only once you confirm it.',
    options: [{ label: 'Confirm', says: 'It takes effect.' }], recommend: 'Confirm', because: 'it fits', meanwhile: 'Nothing changes.',
    target: { event },
  }).card,
});

test('a proposal turned down is not made again for 30 days', async () => {
  await inHome(async () => {
    const LATE = new Date(Date.UTC(2026, 10, 2, 12)).toISOString();
    // The proposal, its card put off with Not now. While it waits for its confirmation it is not made again at all.
    const made = setting('known:pull-request', true, day(1));
    const card = confirmCardFor(made);
    const putOff = [card, answer(card, 'Not now', day(2))];
    const answered = [...putOff, ...decided(day(3)), ...decided(day(4)), ...decided(day(5))];
    const waiting = profileFrom([made], LATE);
    assert.deepEqual(waiting.unconfirmed.map((u) => u.id), [made.id]);
    assert.deepEqual(conceptProposals(answered, waiting, { now: when(LATE) }), []);

    // It stops waiting once a later value of the setting counts: here Explain more made the concept
    // not known, which counts at once. Three more days of answers after that would propose it again,
    // but not within 30 days of the Not now.
    const forgot = setting('known:pull-request', false, day(2, 30));
    const moved = profileFrom([made, forgot], day(6));
    assert.deepEqual(moved.unconfirmed, []);
    assert.equal(moved.settings['known:pull-request'].value, false);
    assert.deepEqual(conceptProposals(answered, moved, { now: when(day(6)) }), []);
    // 30 days after the Not now it may be proposed again.
    assert.deepEqual(conceptProposals(answered, profileFrom([made, forgot], LATE), { now: when(LATE) }), [{ concept: 'pull-request', known: true, confirm: true }]);

    // The same for a setting: the proposal leaves `unconfirmed` once the director sets and confirms
    // another value, and a Not now on its card still holds it back for 30 days.
    const tab = setting('boardTab', 'build', day(1));
    const tabCard = confirmCardFor(tab);
    const chosen = setting('boardTab', 'director', day(9, 30));
    const confirmed = makeEvent({ ...confirmationFor(chosen), now: when(day(9, 31)) });
    const asks = [10, 11, 12].map((d) => ({ at: day(d), tab: 'build', visit: day(d) }));
    const declined = [tabCard, answer(tabCard, 'Not now', day(9))];
    const before = profileFrom([tab, chosen, confirmed], day(13));
    assert.deepEqual(before.unconfirmed, []);
    assert.equal(before.settings.boardTab.value, 'director');
    assert.deepEqual(settingProposals(declined, before, { now: when(day(13)), boardAsks: asks }), []);
    const NOV_9 = new Date(Date.UTC(2026, 10, 9, 12)).toISOString();
    assert.equal(settingProposals(declined, profileFrom([tab, chosen, confirmed], NOV_9), { now: when(NOV_9), boardAsks: asks }).length, 1);

    // Kept as is: the proposal's card is decided, so though the setting is still unconfirmed in the
    // profile it no longer waits, and it is held back for 30 days from that answer.
    assert.ok(tabCard.data.options.includes('Keep as is'));
    assert.equal(settingProposals([tabCard], profileFrom([tab], NOV_9), { now: when(NOV_9), boardAsks: asks }).length, 0);
    const kept = [tabCard, answer(tabCard, 'Keep as is', day(9))];
    assert.deepEqual(profileFrom([tab], day(13)).unconfirmed.map((u) => u.id), [tab.id]);
    assert.deepEqual(settingProposals(kept, profileFrom([tab], day(13)), { now: when(day(13)), boardAsks: asks }), []);
    const again = settingProposals(kept, profileFrom([tab], NOV_9), { now: when(NOV_9), boardAsks: asks });
    assert.deepEqual(again.map(({ key, value }) => ({ key, value })), [{ key: 'boardTab', value: 'build' }]);
    // And a concept the same way.
    const keptConcept = [card, answer(card, 'Keep as is', day(2)), ...decided(day(3)), ...decided(day(4)), ...decided(day(5))];
    assert.deepEqual(conceptProposals(keptConcept, profileFrom([made], day(6)), { now: when(day(6)) }), []);
    assert.deepEqual(conceptProposals(keptConcept, profileFrom([made], LATE), { now: when(LATE) }), [{ concept: 'pull-request', known: true, confirm: true }]);
  });
});

// --- The delegation review ---

const DOC = 'fedcba9876543210'.repeat(4);
// A product question on a decision topic, recommending Plain.
const CHOICE = (n, { topic = 'copy-changes', level = 3 } = {}) => ({
  ...QUESTION(n), level, topic, ...(level === 4 ? { checks: 'It changes nothing in the checks.' } : {}),
});
const APPROVAL = (n, { topic = 'copy-changes', level = 3 } = {}) => ({
  kind: 'approval', level, topic, what: `Pull request #${n} changes the wording on the sign-in page.`, why: 'It changes what users see.',
  options: [{ label: 'Approve', says: 'It merges.' }], recommend: 'Approve', because: 'the checks passed', meanwhile: 'Nothing is released.',
  target: { pr: n, sha: FULL }, ...(level === 4 ? { checks: 'It changes nothing in the checks.' } : {}),
});
const WORK = (work, topic = 'copy-changes') => ({
  kind: 'approve-work', level: 3, topic, what: `The work ${work} is written up and ready.`, why: 'It changes what users see.',
  options: [{ label: 'Approve', says: 'It is built.' }], recommend: 'Approve', because: 'it is small', meanwhile: 'Nothing is built.',
  target: { work, lane: 'small', hash: DOC },
});
const cardOf = (input, at) => makeEvent({ kind: 'card', data: composeCard(input).card, now: when(at) });
// A card asked on day d and answered a minute later, with the option it recommends unless another is given.
const chosen = (input, d, label = input.recommend) => {
  const card = cardOf(input, day(d));
  return [card, answer(card, label, day(d, 1))];
};
// Five product questions on a topic decided as recommended, on five days from d.
const five = (d, make = (n) => CHOICE(n)) => [0, 1, 2, 3, 4].flatMap((i) => chosen(make(d + i), d + i));
const levelEvent = (key, value, at, extra = {}) => makeEvent({ kind: 'level', data: { key, value, words: `"${key}": level ${value}`, ...extra }, now: when(at) });
const confirmed = (event, at) => makeEvent({ ...confirmationFor(event), now: when(at) });
const reversal = (topic, at) => makeEvent({ kind: 'reversal', data: { topic, what: 'The director undid a change made alone' }, now: when(at) });
const reviewNote = (at) => makeEvent({ kind: 'note', data: { review: 'delegation', at }, now: when(at) });
const withoutBecause = (proposals) => proposals.map(({ because, ...rest }) => rest);

test('a level-3 topic approved unchanged five times is proposed for level 2', async () => {
  await inHome(async () => {
    assert.equal(DELEGATE_AFTER, 5);
    const now = when(day(20));
    // Approved unchanged: a product question on the topic decided by the option the card recommended.
    const events = five(10);
    const proposed = delegationProposals(events, { now });
    assert.deepEqual(withoutBecause(proposed), [{ topic: 'copy-changes', from: 3, to: 2 }]);
    assert.match(proposed[0].because, /^you chose what I recommended 5 times/);
    // Four are not enough.
    assert.deepEqual(delegationProposals(events.slice(2), { now }), []);
    // Only decisions since the last review count.
    assert.deepEqual(delegationProposals(events, { now, since: day(11, 30) }), []);
    assert.deepEqual(withoutBecause(delegationProposals([...events, ...five(21)], { now: when(day(27)), since: day(20) })), [{ topic: 'copy-changes', from: 3, to: 2 }]);

    // Another option than the recommended one, or a card that doesn't say what it recommended, doesn't count.
    assert.deepEqual(delegationProposals([10, 11, 12, 13, 14].flatMap((n) => chosen(CHOICE(n), n, 'Playful')), { now }), []);
    const unsaid = events.map((e) => (e.kind === 'card' ? { ...e, data: { ...e.data, recommend: undefined } } : e));
    assert.deepEqual(delegationProposals(unsaid, { now }), []);
    // Explain more is no decision; a level 2 card and a card with no topic don't count.
    assert.deepEqual(delegationProposals([10, 11, 12, 13, 14].flatMap((n) => chosen(CHOICE(n), n, 'Explain more')), { now }), []);
    assert.deepEqual(delegationProposals(five(10, (n) => CHOICE(n, { level: 2 })), { now }), []);
    assert.deepEqual(delegationProposals(five(10, (n) => ({ ...CHOICE(n), topic: undefined })), { now }), []);
    // Topics are counted by their exact slug.
    const split = five(10, (n) => CHOICE(n, { topic: n % 2 === 0 ? 'copy-changes' : 'copy-change' }));
    assert.deepEqual(delegationProposals(split, { now }), []);

    // An answer card that carries a topic counts as a product question does, and so does the
    // answer a reply code signs, which carries the label it stands for.
    const asked = (n) => ({ id: `q-page-${n}-1`, work: `page-${n}`, what: `The page ${n} needs a separator.`, why: 'It changes the file.',
      options: [{ label: 'Comma', says: 'Commas.' }, { label: 'Tab', says: 'Tabs.' }], recommendation: 'Tab', level: 3 });
    const answerCards = [10, 11, 12, 13, 14].map((n) => cardOf({ ...answerInput(asked(n), `page-${n}`), topic: 'separators' }, day(n)));
    const signed = answerCards.map((card, i) => makeEvent({
      kind: 'action', now: when(day(10 + i, 5)),
      data: { action: 'answer', questionId: asked(10 + i).id, questionHash: dataHash(asked(10 + i)), question: card.data.question, label: 'Tab' },
    }));
    assert.deepEqual(withoutBecause(delegationProposals([...answerCards, ...signed], { now, enrolled: readEnrolled() })), [{ topic: 'separators', from: 3, to: 2 }]);
    assert.deepEqual(delegationProposals([...answerCards, ...signed], { now, enrolled: [] }), []);
    const clicked = answerCards.flatMap((card, i) => [card, answer(card, 'Tab', day(10 + i, 5))]);
    assert.equal(delegationProposals(clicked, { now }).length, 1);
    // An answer card with no topic, as the build's questions become, doesn't count.
    const plain = [10, 11, 12, 13, 14].flatMap((n) => chosen(answerInput(asked(n), `page-${n}`), n, 'Tab'));
    assert.deepEqual(delegationProposals(plain, { now }), []);

    // Already level 2 in force, or a proposal for level 2 waiting: nothing to propose.
    const lower = levelEvent('copy-changes', 2, day(16));
    assert.deepEqual(delegationProposals([...events, lower], { now }), []);
    assert.deepEqual(delegationProposals([...events, lower, confirmed(lower, day(16, 1))], { now }), []);
    // Level 3 in force is where the topic is proposed from.
    const three = levelEvent('copy-changes', 3, day(1));
    assert.equal(delegationProposals([three, confirmed(three, day(1, 1)), ...events], { now }).length, 1);
    // A choice the director later reversed doesn't count.
    const sixth = [...events, ...chosen(CHOICE(16), 16)];
    assert.equal(delegationProposals(sixth, { now }).length, 1);
    assert.deepEqual(withoutBecause(delegationProposals([...sixth, reversal('copy-changes', day(11, 30))], { now, since: day(11) })), [{ topic: 'copy-changes', from: 2, to: 3 }]);
  });
});

test('a decision a signed click makes never counts, and its topic is never proposed for level 2', async () => {
  await inHome(async () => {
    const now = when(day(20));
    // Five approvals, by click or by the record a reply code earns, and five approvals of work: none count.
    assert.deepEqual(delegationProposals(five(10, (n) => APPROVAL(n)), { now }), []);
    const cards = [10, 11, 12, 13, 14].map((n) => cardOf(APPROVAL(n), day(n)));
    const signed = cards.map((card, i) => makeEvent({ kind: 'approval', data: { pr: 10 + i, commit: FULL, question: card.data.question }, now: when(day(10 + i, 5)) }));
    assert.deepEqual(delegationProposals([...cards, ...signed], { now, enrolled: readEnrolled() }), []);
    const works = ['page-a', 'page-b', 'page-c', 'page-d', 'page-e'];
    assert.deepEqual(delegationProposals(works.flatMap((work, i) => chosen(WORK(work), 10 + i)), { now }), []);
    // Five product questions on a topic an approval card also carries, decided or not: never proposed for level 2.
    assert.equal(delegationProposals(five(10), { now }).length, 1);
    assert.deepEqual(delegationProposals([cardOf(APPROVAL(9), day(1)), ...five(10)], { now }), []);
    assert.deepEqual(delegationProposals([...five(10), cardOf(WORK('page-z'), day(18))], { now }), []);
    // A reversal still moves such a topic from 2 to 3.
    assert.deepEqual(withoutBecause(delegationProposals([...five(10, (n) => APPROVAL(n)), reversal('copy-changes', day(16))], { now })), [{ topic: 'copy-changes', from: 2, to: 3 }]);
  });
});

test('a level proposal kept as is is not waiting, and is not proposed again for 30 days', async () => {
  await inHome(async () => {
    const LATE = new Date(Date.UTC(2026, 10, 20, 12)).toISOString();
    const events = five(10);
    const proposal = levelEvent('copy-changes', 2, day(15, 30), { because: 'you chose what I recommended 5 times so far' });
    const card = cardOf({
      kind: 'confirm', level: 3, what: `A change to what I can decide alone: ${proposal.data.words}`, why: 'Only you change it.',
      options: [{ label: 'Confirm', says: 'It goes into the rulebook.' }], recommend: 'Confirm', because: 'it fits', meanwhile: 'Nothing changes.',
      target: { event: proposal },
    }, day(15, 31));
    assert.ok(card.data.options.includes('Keep as is'));
    // Waiting for the director, or put off with Not now: not proposed again, however long it waits.
    assert.deepEqual(delegationProposals([...events, proposal, card], { now: when(LATE) }), []);
    assert.deepEqual(delegationProposals([...events, proposal, card, answer(card, 'Not now', day(16))], { now: when(LATE) }), []);
    // Kept as is: the card is decided, the proposal no longer waits, and it is held back for 30 days from that answer.
    const kept = [...events, proposal, card, answer(card, 'Keep as is', day(17))];
    assert.deepEqual(buildViews(kept, readEnrolled(), { now: when(day(18)) }).waiting.filter((c) => c.id === card.id), []);
    assert.deepEqual(delegationProposals(kept, { now: when(day(20)) }), []);
    assert.deepEqual(withoutBecause(delegationProposals(kept, { now: when(LATE) })), [{ topic: 'copy-changes', from: 3, to: 2 }]);
  });
});

test('a reversed topic is proposed one level up', async () => {
  await inHome(async () => {
    const now = when(day(20));
    const proposed = delegationProposals([reversal('colours', day(12))], { now });
    assert.deepEqual(withoutBecause(proposed), [{ topic: 'colours', from: 2, to: 3 }]);
    assert.match(proposed[0].because, /^you undid a decision made on it without you/);
    assert.match(delegationProposals([reversal('colours', day(12)), reversal('colours', day(13))], { now })[0].because, /^you undid 2 decisions/);
    // A reversal from before the last review is not this review's.
    assert.deepEqual(delegationProposals([reversal('colours', day(12))], { now, since: day(13) }), []);
    // A reversed topic is not proposed for level 2 in the same review, however often it was approved.
    const approvedToo = [...five(10, (n) => APPROVAL(n, { topic: 'colours' })), reversal('colours', day(16))];
    assert.deepEqual(withoutBecause(delegationProposals(approvedToo, { now })), [{ topic: 'colours', from: 2, to: 3 }]);
    // Level 2 in force moves up; level 3 in force, or a proposal for level 3 waiting, has nowhere to go.
    const two = levelEvent('colours', 2, day(1));
    assert.equal(delegationProposals([two, confirmed(two, day(1, 1)), reversal('colours', day(12))], { now }).length, 1);
    const three = levelEvent('colours', 3, day(1));
    assert.deepEqual(delegationProposals([three, confirmed(three, day(1, 1)), reversal('colours', day(12))], { now }), []);
    assert.deepEqual(delegationProposals([reversal('colours', day(12)), levelEvent('colours', 3, day(14))], { now }), []);
    // A reversal only moves a topic from 2 to 3: one at level 1 in force stays for the director to move.
    const one = levelEvent('colours', 1, day(1));
    assert.deepEqual(delegationProposals([one, confirmed(one, day(1, 1)), reversal('colours', day(12))], { now }), []);
    // A topic that isn't a slug is never counted.
    assert.deepEqual(delegationProposals([reversal('Colours and fonts', day(12))], { now }), []);
  });
});

test('money, secrets and the guardrails are never proposed for a lower level', async () => {
  await inHome(async () => {
    const now = when(day(20));
    for (const topic of ['money', 'secrets', 'guardrails']) {
      // One card at level 4 for the topic, then five product questions at level 3 decided as recommended.
      const events = [cardOf(CHOICE(9, { topic, level: 4 }), day(1)), ...five(10, (n) => CHOICE(n, { topic }))];
      assert.deepEqual(delegationProposals(events, { now }), [], topic);
      // Nor does a reversal move it to level 3, which would be a lower level than its own.
      assert.deepEqual(delegationProposals([...events, reversal(topic, day(16))], { now }), [], topic);
    }
    // Level 4 in force holds a topic the same way.
    const four = levelEvent('payments', 4, day(1));
    const events = [four, confirmed(four, day(1, 1)), ...five(10, (n) => CHOICE(n, { topic: 'payments' }))];
    assert.deepEqual(delegationProposals(events, { now }), []);
    assert.deepEqual(delegationProposals([...events, reversal('payments', day(16))], { now }), []);
  });
});

test('the review is due every two weeks by default and follows the setting', async () => {
  await inHome(async () => {
    const first = makeEvent({ kind: 'idea', data: { key: 'x', title: 'An idea' }, now: when(day(1)) });
    // No events: nothing to review.
    assert.equal(reviewDue({ events: [], now: when(day(20)), days: 14 }), false);
    // From the project's first event, with no review yet.
    assert.equal(reviewDue({ events: [first], now: when(day(14)), days: 14 }), false);
    assert.equal(reviewDue({ events: [first], now: when(day(15)), days: 14 }), true);
    // From the latest review.
    const done = reviewNote(day(10));
    assert.equal(reviewDue({ events: [first, reviewNote(day(3)), done], now: when(day(15)), days: 14 }), false);
    assert.equal(reviewDue({ events: [first, done], now: when(day(24)), days: 14 }), true);
    // Another note is not a review.
    const other = makeEvent({ kind: 'note', data: { incident: 'i1', words: 'No blame' }, now: when(day(10)) });
    assert.equal(reviewDue({ events: [first, other], now: when(day(15)), days: 14 }), true);
    assert.equal(lastReview([first, other]), null);
    assert.equal(lastReview([first, reviewNote(day(3)), done, other]), done.at);
    // Every 7 days.
    assert.equal(reviewDue({ events: [first, done], now: when(day(16)), days: 7 }), false);
    assert.equal(reviewDue({ events: [first, done], now: when(day(17)), days: 7 }), true);

    // The review as the helper gives it: due by the project's setting in force, since the last
    // review, with the proposals counted since then.
    const events = [first, done, ...five(11)];
    assert.deepEqual(delegationReview(events, { now: when(day(17)) }), {
      due: false, since: done.at, proposals: delegationProposals(events, { now: when(day(17)), since: done.at }),
    });
    assert.equal(delegationReview(events, { now: when(day(17)) }).proposals.length, 1);
    const weekly = makeEvent({ kind: 'setting', data: { key: 'delegationReviewDays', value: 7, words: 'Days between delegation reviews: 7 days' }, now: when(day(2)) });
    const setTo7 = [weekly, confirmed(weekly, day(2, 1)), ...events];
    assert.equal(delegationReview(setTo7, { now: when(day(17)) }).due, true);
    // An unconfirmed setting has no effect.
    assert.equal(delegationReview([weekly, ...events], { now: when(day(17)) }).due, false);
    // With no review yet, since is null and everything counts.
    assert.deepEqual(delegationReview([first, ...five(11)], { now: when(day(17)) }).since, null);
  });
});
