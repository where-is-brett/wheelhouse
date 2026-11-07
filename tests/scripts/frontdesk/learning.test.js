// tests/scripts/frontdesk/learning.test.js
// What learning works out from the director's clicks: the settings
// they would like, each proposed once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { settingProposals, clickOutcomes, dayOf } from '../../../scripts/frontdesk/learning.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { makeEvent, confirmationFor } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { effectiveSettings } from '../../../scripts/settings/effective.js';
import { as, tempFolder } from '../../helpers/homes.js';
import { WHY } from '../../../scripts/lib/calm-words.js';

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
// A profile event setting `key` to `value`, as learning writes one.
const setting = (key, value, at) => makeEvent({ kind: 'setting', data: { key, value, words: `${key}: ${value}`, because: 'learnt' }, now: when(at) });
// The settings in force from a settings view's entries.
const inForce = (entries = {}, now = day(20)) => effectiveSettings({
  project: {}, profile: Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, { key, id: key, at: day(1), value, before: null }])), now,
});
const profileOf = ({ events = [], settings = {}, unconfirmed = [] } = {}) => ({ events, settings: inForce(settings), unconfirmed });

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
    const decidedCards = (enrolled) => [...clickOutcomes(events, profileOf(), { enrolled }).values()].filter((o) => o.decided).length;
    assert.equal(decidedCards(readEnrolled()), 3);
    // A record no enrolled computer signed is no click.
    assert.equal(decidedCards([]), 0);
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
    // A setting's proposal leaves `unconfirmed` once the director sets and confirms
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
  });
});


test('Why? counts as Explain more for plain explanations', async () => {
  await inHome(async () => {
    // Three cards with Why? in a week propose plain explanations.
    const explained = (d) => {
      const c = cardAt(day(d), []);
      return [c, answer(c, WHY, day(d, 1))];
    };
    const events = [...explained(10), ...explained(12), ...explained(15)];
    const proposed = settingProposals(events, profileOf({ settings: { explanations: 'some-terms' } }), { now: when(day(16)), boardAsks: [] });
    assert.deepEqual(proposed.map(({ key, value }) => ({ key, value })), [{ key: 'explanations', value: 'plain' }]);
  });
});
