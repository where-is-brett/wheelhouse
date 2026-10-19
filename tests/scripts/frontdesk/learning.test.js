// tests/scripts/frontdesk/learning.test.js
// What learning works out from the director's clicks: the concepts they know and the settings
// they would like, each proposed once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { conceptProposals, settingProposals, conceptSetting, dayOf } from '../../../scripts/frontdesk/learning.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { effectiveSettings } from '../../../scripts/settings/effective.js';
import { KNOWN_AFTER } from '../../../scripts/lib/front-desk.js';
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
    const profile = profileOf({ events: [made], settings: { 'known:pull-request': true } });
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
    assert.deepEqual(conceptProposals(events, { ...profile, events: [made, unlearnt] }, { now: when(day(11)) }), []);
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

test('a proposal turned down is not made again for 30 days', async () => {
  await inHome(async () => {
    // The proposal, its card put off with Not now, then three more days of answers.
    const made = setting('known:pull-request', true, day(1));
    const confirmCard = makeEvent({
      kind: 'card',
      now: when(day(1, 1)),
      data: composeCard({
        kind: 'confirm', level: 3, what: `A change to your settings: ${made.data.words}`, why: 'It changes only once you confirm it.',
        options: [{ label: 'Confirm', says: 'It takes effect.' }], recommend: 'Confirm', because: 'it fits', meanwhile: 'Nothing changes.',
        target: { event: made },
      }).card,
    });
    const events = [confirmCard, answer(confirmCard, 'Not now', day(2)), ...decided(day(3)), ...decided(day(4)), ...decided(day(5))];
    const profile = profileOf({ events: [made] });
    assert.deepEqual(conceptProposals(events, profile, { now: when(day(6)) }), []);
    // 30 days after the Not now it may be proposed again.
    assert.deepEqual(conceptProposals(events, profile, { now: when(new Date(Date.UTC(2026, 10, 2, 12)).toISOString()) }), [{ concept: 'pull-request', known: true, confirm: true }]);
    // While the proposal still waits for its confirmation, it is not made again at all.
    const waiting = profileOf({ events: [made], unconfirmed: [{ kind: 'setting', id: made.id, at: made.at, key: made.data.key, data: made.data }] });
    assert.deepEqual(conceptProposals(events, waiting, { now: when(new Date(Date.UTC(2026, 10, 2, 12)).toISOString()) }), []);

    // The same for a setting: a Not now on its card holds it back for 30 days.
    const tab = setting('boardTab', 'build', day(1));
    const tabCard = makeEvent({
      kind: 'card',
      now: when(day(1, 1)),
      data: composeCard({
        kind: 'confirm', level: 3, what: `A change to your settings: ${tab.data.words}`, why: 'It changes only once you confirm it.',
        options: [{ label: 'Confirm', says: 'It takes effect.' }], recommend: 'Confirm', because: 'it fits', meanwhile: 'Nothing changes.',
        target: { event: tab },
      }).card,
    });
    const asks = [10, 11, 12].map((d) => ({ at: day(d), tab: 'build', visit: day(d) }));
    const putOff = [tabCard, answer(tabCard, 'Not now', day(9))];
    assert.deepEqual(settingProposals(putOff, profileOf({ events: [tab] }), { now: when(day(13)), boardAsks: asks }), []);
    assert.equal(settingProposals(putOff, profileOf({ events: [tab] }), { now: when(new Date(Date.UTC(2026, 10, 9, 12)).toISOString()), boardAsks: asks }).length, 1);
  });
});
