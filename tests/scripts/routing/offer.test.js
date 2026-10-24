// tests/scripts/routing/offer.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageOffer, USAGE_ASK } from '../../../scripts/routing/offer.js';
import { usageLine } from '../../../scripts/state/card-lines.js';

const NOW = '2026-10-26T01:00:00.000Z';
const allowance = (used) => ({ used, resetsAt: '2026-10-28T22:00:00.000Z', at: NOW });
const setting = (key, value) => ({ [key]: { key, value, id: `${key}-1`, at: NOW } });

test('the level in force is read from the project\'s settings, the mark from the profile, and the line says the switch\'s click is the change itself', () => {
  const got = usageOffer({ views: { settings: setting('efficiency', 'lean') }, profile: {}, allowance: allowance(91), ready: ['lean', 'lightest'], now: NOW, timeZone: 'UTC' });
  assert.ok(got.line.startsWith(USAGE_ASK));
  assert.match(got.line, /Switch to Lightest until it resets/);
  // The card carries its line naming the level and the offer, so the click on its switch is the confirmation.
  assert.ok(got.line.includes(JSON.stringify(usageLine('lightest', NOW)).slice(1, -1)));
  assert.match(got.line, /The director's click on "Switch to Lightest until it resets" is the change itself, recorded and confirmed by that click: record nothing and ask no confirm card\. Any other pick changes nothing\.$/);
  assert.doesNotMatch(got.line, /record setting|usageCard/);
  assert.deepEqual(got.record, { card: 'lightest', at: NOW, reset: '2026-10-28T22:00:00.000Z', from: 'lean', to: 'lightest' });
  assert.equal(usageOffer({ views: {}, profile: setting('usageMark', 90), allowance: allowance(80), now: NOW }), null);
  assert.equal(usageOffer({ views: {}, profile: setting('usageMark', 65), allowance: allowance(80), ready: ['lean'], now: NOW }).record.card, 'nudge');
});

test('anything unreadable gives no offer', () => {
  assert.equal(usageOffer({ views: null, profile: null, allowance: null, now: NOW }), null);
  assert.equal(usageOffer({ views: { settings: 'x', usageCards: 'y' }, profile: 5, allowance: allowance(80), ready: ['lean'], now: NOW }).record.card, 'nudge');
});

test('no switch is offered to a column that is not ready', () => {
  assert.equal(usageOffer({ views: {}, profile: setting('usageMark', 65), allowance: allowance(80), now: NOW }), null);
  assert.equal(usageOffer({ views: { settings: setting('efficiency', 'lean') }, profile: {}, allowance: allowance(91), ready: ['lean'], now: NOW, timeZone: 'UTC' }), null);
});
