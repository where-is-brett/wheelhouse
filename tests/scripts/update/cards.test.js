// tests/scripts/update/cards.test.js
// The update's cards (update design, sections 4 and 7.3): the one card the director sees first, the old helper's card, and the
// approval card for a release that is not pins-only, which the state keeps as a real card the prompt record can sign.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateCard, stopCard, releaseCard, helperCardFor, UPDATE, NOT_NOW } from '../../../scripts/update/cards.js';
import { helperCard, helperCardId, STOP_IT, LEAVE_IT, WAIT_LONGER } from '../../../scripts/update/finish.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';
import { setLineOf, releaseLine, updateHelperLine, updateLine } from '../../../scripts/state/card-lines.js';
import { CARD } from '../../../scripts/lib/front-desk.js';
import { makeEvent } from '../../../scripts/state/events.js';

const SHA = 'a'.repeat(40);
const HASH = 'd'.repeat(64);
const labels = (card) => card.options.map((o) => o.label);

test('cards: the update card names both releases, what is new, what happens and what carries on meanwhile', () => {
  const card = updateCard({ hash: HASH, from: 'v0.2.6', to: 'v0.2.7', says: 'GitLab merges no longer need glab.', approval: 'review', locked: false, others: [] });
  assert.match(card.question, /^Update Wheelhouse · v0\.2\.6 → v0\.2\.7$/m);
  assert.match(card.question, /What's new: GitLab merges no longer need glab\./);
  assert.match(card.question, /What happens: your project gets a small reviewed change naming v0\.2\.7, then this computer installs it and hands over to the new helper\. About five minutes\. Work in progress finishes first\./);
  assert.match(card.question, /Meanwhile: nothing stops; sessions open now keep v0\.2\.6 until you start a new one\./);
  assert.deepEqual(labels(card), [UPDATE, NOT_NOW]);
  assert.ok(card.header.length <= CARD.header);
  assert.equal(card.multiSelect, false);
  assert.match(card.options[0].description, /^Recommended/);
  assert.doesNotMatch(card.question, /approve/i, 'a pins-only release asks for no approval');
});

test('cards: the update card carries one set line naming the move, its kind and the plan, and passes the card check', () => {
  const card = updateCard({ hash: HASH, from: 'v0.2.6', to: 'v0.2.7', says: 'x', approval: 'review' });
  assert.equal(setLineOf(card.question), updateLine('v0.2.6', 'v0.2.7', 'release', HASH));
  assert.match(setLineOf(card.question), /\(release\), plan d{12}$/);
  assert.deepEqual(cardProblems(card), []);
  const back = updateCard({ hash: HASH, from: 'v0.2.8', to: 'v0.2.7', says: 'x', put: 'undo' });
  assert.match(setLineOf(back.question), /\(undo\)/);
  // A summary that holds a line the prompt record reads as a set line is left out, not carried onto the card.
  const odd = updateCard({ hash: HASH, from: 'v0.2.6', to: 'v0.2.7', says: updateHelperLine('update-helper-1-x') });
  assert.match(odd.question, /No summary was given/);
});

test('cards: a release with no summary says so', () => {
  const card = updateCard({ hash: HASH, from: 'v0.2.6', to: 'v0.2.7', says: null, approval: 'review' });
  assert.match(card.question, /What's new: No summary was given for this release\./);
});

test('cards: a release that is not pins-only says the director approves the change when it is ready, and the Update click is not that approval', () => {
  const card = updateCard({ hash: HASH, from: 'v0.2.6', to: 'v0.2.7', says: 'x', approval: 'card' });
  assert.match(card.question, /approve/i);
  assert.match(card.question, /once the change is ready/);
  assert.match(card.question, /Update starts it; it is not that approval/);
});

test('cards: Locked, and the other projects that keep an older Locked, are named', () => {
  const card = updateCard({ hash: HASH, from: 'v0.2.6', to: 'v0.2.7', says: 'x', approval: 'review', locked: true, others: ['shop', 'blog'] });
  assert.match(card.question, /password window/);
  assert.match(card.question, /shop and blog/);
});

test('cards: a put-back and a carry-on are worded as such', () => {
  const back = updateCard({ hash: HASH, from: 'v0.2.8', to: 'v0.2.7', says: 'x', approval: 'review', put: 'undo' });
  assert.match(back.question, /^Put Wheelhouse back to v0\.2\.7 · v0\.2\.8 → v0\.2\.7$/m);
  const on = updateCard({ hash: HASH, from: 'v0.2.6', to: 'v0.2.7', says: 'x', approval: 'review', carryOn: true });
  assert.match(on.question, /^Carry on with the update to v0\.2\.7$/m);
  assert.match(on.options[0].description, /^Recommended/);
});

test('cards: the stop card asks the question of section 7.3 with Stop it recommended', () => {
  const card = stopCard({ version: 'v0.2.4' });
  assert.match(card.question, /The old helper isn't answering\. Stop it\?/);
  assert.match(card.question, /Work it was doing is picked up again by the new one\./);
  assert.deepEqual(labels(card), [STOP_IT, LEAVE_IT]);
  assert.equal(card.recommend, STOP_IT);
});

test('cards: the release approval card is a real card with the set line the prompt record signs, named for the commit', () => {
  const { question, card } = releaseCard({ previous: 'v0.2.6', release: 'v0.2.7', commit: SHA });
  assert.equal(setLineOf(question.question), releaseLine('v0.2.6', 'v0.2.7', SHA));
  assert.deepEqual(card.options.slice(0, 2), ['Approve', 'Not now']);
  assert.equal(card.kind, 'release');
  assert.equal(card.recommend, 'Approve');
  makeEvent({ kind: 'card', data: card, now: () => new Date('2026-11-04T10:00:00Z') });
});

test('cards: the old helper\'s card is a real card whose set line names the helper card id, in each of its kinds', () => {
  for (const [kind, canStop] of [['busy', true], ['busy', false], ['unknown', true], ['hung', true]]) {
    const id = helperCardId({ pid: 4242, startTime: '2026-11-04T09:00:00.000Z' });
    const given = helperCard({ kind, version: '0.2.5', canStop, id });
    const made = helperCardFor(given);
    assert.equal(setLineOf(made.question.question), updateHelperLine(id));
    assert.deepEqual(made.card.options, given.options);
    assert.ok(made.card.options.every((o) => [STOP_IT, LEAVE_IT, WAIT_LONGER].includes(o)));
    assert.ok(made.question.question.length <= CARD.chars);
    makeEvent({ kind: 'card', data: made.card, now: () => new Date('2026-11-04T10:00:00Z') });
  }
});

test('cards: the update card names the account settings entry it changes, in one plain line', () => {
  const card = updateCard({ hash: HASH, from: 'v0.2.6', to: 'v0.2.7', says: 'x', account: { from: 'v0.2.6', to: 'v0.2.7' } });
  assert.match(card.question, /Your account settings name Wheelhouse at v0\.2\.6; the update changes that one entry to v0\.2\.7\./);
  assert.deepEqual(cardProblems(card), []);
  assert.doesNotMatch(updateCard({ hash: HASH, from: 'v0.2.6', to: 'v0.2.7', says: 'x' }).question, /account settings/);
});

test('the card says in plain words that the project-scope install of the dropped plugin is removed, and an account-level one is left', () => {
  const card = updateCard({ hash: HASH, from: 'v0.2.6', to: 'v0.3.0', says: 'x', removes: ["Matt Pocock's skills"] });
  const text = JSON.stringify(card);
  assert.match(text, /Matt Pocock's skills is installed for this project; the update removes it/);
  assert.match(text, /Wheelhouse carries the two skills it needs/);
  assert.match(text, /One you installed for your whole account is left/);
  assert.doesNotMatch(JSON.stringify(updateCard({ hash: HASH, from: 'v0.2.6', to: 'v0.3.0', says: 'x' })), /is installed for this project/);
});
