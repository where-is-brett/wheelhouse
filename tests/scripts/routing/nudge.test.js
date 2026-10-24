// tests/scripts/routing/nudge.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nudgeCard, weeklyOf, whenOf } from '../../../scripts/routing/nudge.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';

const TZ = 'Australia/Sydney';
// Thursday 29 October 2026, 09:00 in Sydney (UTC+11) is 22:00 UTC on Wednesday 28 October.
const RESET = '2026-10-28T22:00:00.000Z';
const NOW = '2026-10-26T01:00:00.000Z'; // Monday 12:00 Sydney: about 3 days to the reset
const NEAR = '2026-10-28T01:00:00.000Z'; // Wednesday 12:00 Sydney: 21 hours to the reset
const reading = (used, at = NOW, resetsAt = RESET) => ({ used, resetsAt, at });
const ask = (more) => nudgeCard({ allowance: reading(76), level: 'balanced', mark: 75, offers: [], ready: ['lean', 'lightest'], now: NOW, timeZone: TZ, ...more });
const card = (more) => ask(more)?.card ?? null;

test('at the mark, Balanced or Thorough is offered Lean, with the reset in the director\'s own time zone', () => {
  const got = ask();
  assert.equal(got.card, 'nudge');
  assert.equal(got.switchLabel, 'Switch to Lean until it resets');
  assert.equal(got.switchTo, 'lean');
  assert.equal(got.input.ask, 'Switch to Lean until it resets?');
  assert.equal(got.input.what, 'You\'ve used 76% of this week\'s allowance. It resets on Thursday at 09:00.');
  assert.equal(got.input.why, 'Only you choose how thorough the work is.');
  assert.deepEqual(got.input.options.map((o) => o.label), ['Switch to Lean until it resets', 'Stay on Balanced']);
  assert.equal(got.input.meanwhile, 'Work carries on as it is.');
  assert.deepEqual(got.record, { card: 'nudge', at: NOW, reset: RESET, from: 'balanced', to: 'lean' });
  assert.equal(card({ level: 'thorough' }), 'nudge');
  assert.equal(whenOf(RESET, 'UTC'), 'Wednesday at 22:00');
  assert.match(ask({ timeZone: 'UTC' }).input.what, /Wednesday at 22:00/);
});

test('below the mark, or with the mark off, or at Lean, the first card is not offered', () => {
  assert.equal(card({ allowance: reading(74) }), null);
  assert.equal(card({ mark: 'off' }), null);
  assert.equal(card({ mark: 90 }), null);
  assert.equal(card({ mark: 50, allowance: reading(55) }), 'nudge');
  assert.equal(card({ level: 'lean' }), null);
});

test('no card for a reading that is missing, over a day old or not in the allowance\'s shape', () => {
  assert.equal(card({ allowance: null }), null);
  assert.equal(card({ allowance: reading(80, '2026-10-24T23:59:00.000Z') }), null);
  assert.equal(card({ allowance: reading(80, '2026-10-25T01:01:00.000Z') }), 'nudge');
  assert.equal(card({ allowance: { used: 'lots', resetsAt: RESET, at: NOW } }), null);
  assert.equal(card({ level: 'nonsense' }), null);
});

test('no card to switch down within a day of the reset, nor once it was offered this week', () => {
  assert.equal(card({ now: NEAR, allowance: reading(80, NEAR) }), null);
  const offered = { card: 'nudge', at: '2026-10-25T23:00:00.000Z', reset: RESET, from: 'balanced', to: 'lean' };
  assert.equal(card({ offers: [offered] }), null);
  // The reset time moving a little between readings is still the same week.
  assert.equal(card({ offers: [{ ...offered, reset: '2026-10-28T22:00:05.000Z' }] }), null);
  // An offer in an earlier week doesn't count.
  assert.equal(card({ offers: [{ ...offered, reset: '2026-10-21T22:00:00.000Z' }] }), 'nudge');
});

test('at Lean and 90%, Lightest is offered once a week, with its safety cost on the card', () => {
  const got = ask({ level: 'lean', allowance: reading(91) });
  assert.equal(got.card, 'lightest');
  assert.equal(got.input.what, 'You\'ve used 91% of this week\'s allowance, and you\'re on Lean. It resets on Thursday at 09:00.');
  assert.equal(got.input.why, 'Lightest saves more, but it\'s less safe, so only you can choose it.');
  assert.deepEqual(got.input.options.map((o) => o.label), ['Switch to Lightest until it resets', 'Stay on Lean']);
  assert.equal(got.input.recommend, 'Stay on Lean');
  assert.match(got.input.because, /a lighter model also designs and checks risky work, so mistakes are likelier to slip through\. Every check still runs/);
  assert.equal(got.input.meanwhile, 'Work carries on on Lean.');
  assert.equal(got.record.to, 'lightest');
  assert.equal(card({ level: 'lean', allowance: reading(89) }), null);
  assert.equal(card({ level: 'lean', allowance: reading(95), now: NEAR }), null);
  assert.equal(card({ level: 'lean', allowance: reading(95, NEAR), now: NEAR }), null);
  const offered = { card: 'lightest', at: NOW, reset: RESET, from: 'lean', to: 'lightest' };
  assert.equal(card({ level: 'lean', allowance: reading(95), offers: [offered] }), null);
  assert.equal(card({ level: 'lean', allowance: reading(95), mark: 'off' }), null);
});

test('with plenty left near the reset, Thorough is offered, unless a switch down or a decline came this week', () => {
  const near = { now: NEAR, allowance: reading(32, NEAR) };
  const got = ask(near);
  assert.equal(got.card, 'up');
  assert.equal(got.input.ask, 'Plenty left: switch to Thorough until it resets?');
  assert.equal(got.input.what, 'You\'ve used 32% of this week\'s allowance, and it resets on Thursday at 09:00.');
  assert.deepEqual(got.input.options.map((o) => o.label), ['Switch to Thorough until it resets', 'Stay on Balanced']);
  assert.match(got.input.because, /Allowance left at the reset is lost|allowance left at the reset is lost/);
  assert.equal(got.switchTo, 'thorough');
  assert.equal(card({ ...near, level: 'lightest' }), 'up');
  assert.equal(card({ ...near, level: 'thorough' }), null);
  assert.equal(card({ ...near, allowance: reading(40, NEAR) }), null);
  assert.equal(card({ now: NOW, allowance: reading(32) }), null, 'three days to the reset is too far');
  assert.equal(card({ ...near, mark: 'off' }), null);
  for (const kind of ['nudge', 'lightest', 'up']) {
    assert.equal(card({ ...near, offers: [{ card: kind, at: NOW, reset: RESET, from: 'balanced', to: 'lean' }] }), null, kind);
  }
});

test('after a reset, the first reading offers to go back to the level before, when a card switched', () => {
  const NEXT = '2026-11-04T22:00:00.000Z';
  const AFTER = '2026-10-28T23:30:00.000Z'; // Thursday 10:30 Sydney, after the 09:00 reset
  const switched = { card: 'nudge', at: '2026-10-25T23:00:00.000Z', reset: RESET, from: 'balanced', to: 'lean' }; // Monday 10:00 Sydney
  const made = { value: 'lean', at: '2026-10-25T23:05:00.000Z', usageCard: switched.at };
  const after = { now: AFTER, allowance: reading(2, AFTER, NEXT), level: 'lean', offers: [switched], switched: made };
  const got = ask(after);
  assert.equal(got.card, 'return');
  assert.equal(got.input.ask, 'Go back to Balanced?');
  assert.equal(got.input.what, 'Your allowance reset this morning. You switched to Lean on Monday to save it.');
  assert.deepEqual(got.input.options.map((o) => o.label), ['Go back to Balanced', 'Stay on Lean']);
  assert.equal(got.input.because, 'there\'s a full week\'s allowance again');
  assert.equal(got.input.meanwhile, 'Work carries on on Lean.');
  assert.deepEqual(got.record, { card: 'return', at: AFTER, reset: RESET, from: 'lean', to: 'balanced' });
  // Once offered, not again. A level that did not come from the card gets no return card.
  assert.equal(card({ ...after, offers: [switched, { card: 'return', at: AFTER, reset: RESET, from: 'lean', to: 'balanced' }] }), null);
  assert.equal(card({ ...after, level: 'balanced' }), null);
  assert.equal(card({ ...after, level: 'thorough' }), null);
  assert.equal(card({ ...after, offers: [] }), null);
  // A switch made another way (no card named, or another offer's, or before the offer, or after the reset) gets none.
  assert.equal(card({ ...after, switched: { ...made, usageCard: undefined } }), null);
  assert.equal(card({ ...after, switched: { ...made, usageCard: '2026-10-20T00:00:00.000Z' } }), null);
  assert.equal(card({ ...after, switched: { ...made, at: '2026-10-25T22:00:00.000Z' } }), null);
  assert.equal(card({ ...after, switched: { ...made, at: '2026-10-28T22:30:00.000Z' } }), null);
  assert.equal(card({ ...after, switched: null }), null);
  // Before the reading is past the reset, or with the mark off, nothing.
  assert.equal(card({ ...after, allowance: reading(2, '2026-10-28T21:00:00.000Z', NEXT), now: '2026-10-28T21:30:00.000Z' }), null);
  assert.equal(card({ ...after, mark: 'off' }), null);
  // The day later in the week it is said by its day.
  assert.match(ask({ ...after, now: '2026-10-29T23:30:00.000Z', allowance: reading(2, '2026-10-29T23:30:00.000Z', NEXT) }).input.what, /reset on Thursday/);
});

test('a switch up returns too, and a chain of switches goes back to the level before the first', () => {
  const NEXT = '2026-11-04T22:00:00.000Z';
  const AFTER = '2026-10-28T23:30:00.000Z';
  const up = { card: 'up', at: '2026-10-27T01:00:00.000Z', reset: RESET, from: 'balanced', to: 'thorough' };
  const got = ask({ now: AFTER, allowance: reading(1, AFTER, NEXT), level: 'thorough', offers: [up], switched: { value: 'thorough', at: '2026-10-27T01:05:00.000Z', usageCard: up.at } });
  assert.equal(got.card, 'return');
  assert.match(got.input.what, /You switched to Thorough on Tuesday to use what was left\./);
  const down = { card: 'nudge', at: '2026-10-25T23:00:00.000Z', reset: RESET, from: 'balanced', to: 'lean' };
  const lightest = { card: 'lightest', at: '2026-10-27T01:00:00.000Z', reset: RESET, from: 'lean', to: 'lightest' };
  const chain = ask({ now: AFTER, allowance: reading(1, AFTER, NEXT), level: 'lightest', offers: [down, lightest], switched: { value: 'lightest', at: '2026-10-27T01:05:00.000Z', usageCard: lightest.at } });
  assert.equal(chain.input.ask, 'Go back to Balanced?');
});

test('the cards compose as the composer takes them, and pass the card check', () => {
  const NEXT = '2026-11-04T22:00:00.000Z';
  const AFTER = '2026-10-28T23:30:00.000Z';
  const switched = { card: 'nudge', at: '2026-10-25T23:00:00.000Z', reset: RESET, from: 'balanced', to: 'lean' };
  const cards = [
    ask(), ask({ level: 'lean', allowance: reading(91) }), ask({ now: NEAR, allowance: reading(32, NEAR) }),
    ask({ now: AFTER, allowance: reading(2, AFTER, NEXT), level: 'lean', offers: [switched], switched: { value: 'lean', at: '2026-10-25T23:05:00.000Z', usageCard: switched.at } }),
  ];
  for (const got of cards) {
    const composed = composeCard(got.input);
    assert.deepEqual(cardProblems(composed.question), [], got.card);
    assert.equal(composed.question.options[0].label, got.switchLabel);
  }
});

test('weeklyOf reads the seven-day window of the allowance file', () => {
  const file = { at: NOW, windows: [{ kind: 'five_hour', percentUsed: 5, resetsAt: NOW }, { kind: 'seven_day', percentUsed: 76, resetsAt: RESET }] };
  assert.deepEqual(weeklyOf(file), { used: 76, resetsAt: RESET, at: NOW });
  assert.equal(weeklyOf({ at: NOW, windows: [{ kind: 'five_hour', percentUsed: 5 }] }), null);
  assert.equal(weeklyOf({ at: NOW, windows: [{ kind: 'seven_day', percentUsed: 76 }] }), null);
  assert.equal(weeklyOf(null), null);
});

test('boundaries: exactly a day or two days to the reset, exactly at the mark, and a reading stamped ahead', () => {
  const at = (hoursBefore) => new Date(Date.parse(RESET) - hoursBefore * 3600000).toISOString();
  // Exactly 24 hours to the reset is not "more than 24 hours": no switch down; a minute more is.
  assert.equal(card({ now: at(24), allowance: reading(80, at(24)) }), null);
  assert.equal(card({ now: at(24.02), allowance: reading(80, at(24.02)) }), 'nudge');
  assert.equal(card({ level: 'lean', now: at(24), allowance: reading(95, at(24)) }), null);
  assert.equal(card({ level: 'lean', now: at(24.02), allowance: reading(95, at(24.02)) }), 'lightest');
  // Exactly 48 hours is not "under 48 hours": no upward card; a minute less is.
  assert.equal(card({ now: at(48), allowance: reading(10, at(48)) }), null);
  assert.equal(card({ now: at(47.98), allowance: reading(10, at(47.98)) }), 'up');
  // Exactly at the mark counts; exactly at 90 and 40.
  assert.equal(card({ allowance: reading(75) }), 'nudge');
  assert.equal(card({ level: 'lean', allowance: reading(90) }), 'lightest');
  assert.equal(card({ now: NEAR, allowance: reading(40, NEAR) }), null);
  // A reading stamped ahead of now: within an hour is tolerated, beyond it is not.
  const ahead = (ms) => new Date(Date.parse(NOW) + ms).toISOString();
  assert.equal(card({ allowance: reading(80, ahead(3600000)) }), 'nudge');
  assert.equal(card({ allowance: reading(80, ahead(3600001)) }), null);
  // Exactly a day old is still read; a millisecond more is stale.
  assert.equal(card({ allowance: reading(80, ahead(-86400000)) }), 'nudge');
  assert.equal(card({ allowance: reading(80, ahead(-86400001)) }), null);
});

test('a card is offered only when its target column is ready; Thorough always is', () => {
  assert.equal(card({ ready: [] }), null, 'Lean is not offered before it is ready');
  assert.equal(card({ ready: ['lightest'] }), null);
  assert.equal(card({ ready: ['lean'] }), 'nudge');
  assert.equal(card({ level: 'lean', allowance: reading(91), ready: ['lean'] }), null, 'Lightest is not offered before it is ready');
  assert.equal(card({ level: 'lean', allowance: reading(91), ready: ['lightest'] }), 'lightest');
  assert.equal(card({ level: 'balanced', allowance: reading(10, NEAR), now: NEAR, ready: [] }), 'up', 'the upward card needs nothing ready');
});
