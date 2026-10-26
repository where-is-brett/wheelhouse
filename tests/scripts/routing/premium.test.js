// tests/scripts/routing/premium.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  premiumValueOf, premiumInput, premiumState, premiumPinOf, withPremiumPin, premiumRefusal, checkRefusal, foundPremium,
  ALLOW_WITHIN, ALLOW_PAID, ALLOW_PAID_ON_TOP,
} from '../../../scripts/routing/premium.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { premiumLine, setLinesOf } from '../../../scripts/state/card-lines.js';
import { routingFrom } from '../../../scripts/routing/in-force.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';

const AT = '2026-10-26T01:00:00.000Z';
const ID = '11111111-2222-4333-8444-555555555555';
const allowed = (value, more = {}) => ({ key: 'premium', value, id: ID, at: AT, premiumCard: AT, ...more });
const check = (model, found, at = '2026-10-26T02:00:00.000Z', setting = ID) => ({ kind: 'premium-check', id: `c-${at}`, at, data: { setting, model, found } });
const survey = (at) => ({ kind: 'survey', id: `s-${at}`, at, data: {} });

test('only an Allow option makes a setting, each its own: within the plan, or paid credits too', () => {
  assert.equal(premiumValueOf('off', ALLOW_WITHIN), 'within-plan');
  assert.equal(premiumValueOf('off', ALLOW_PAID), 'paid-too');
  assert.equal(premiumValueOf('within-plan', ALLOW_PAID_ON_TOP), 'paid-too');
  // Never read across cards, and Not now or a put-off button makes nothing.
  for (const [from, label] of [['off', ALLOW_PAID_ON_TOP], ['within-plan', ALLOW_WITHIN], ['within-plan', ALLOW_PAID], ['off', 'Not now'], ['off', 'Suggest a change…'], ['paid-too', ALLOW_PAID]]) {
    assert.equal(premiumValueOf(from, label), null, `${from} ${label}`);
  }
});

test('the cards compose as level 4 cards with no reply code, each Allow option on its own line, the cost said plainly', () => {
  const full = composeCard(premiumInput({ from: 'off', at: AT })).question;
  assert.equal(full.header, 'Premium');
  assert.deepEqual(full.options.map((o) => o.label).slice(0, 3), [ALLOW_WITHIN, ALLOW_PAID, 'Not now']);
  assert.match(full.options[0].description, /^Recommended:/);
  assert.match(full.question, /real money/);
  assert.match(full.question, /two and a half times/);
  assert.deepEqual(setLinesOf(full.question), [premiumLine(AT)]);
  assert.doesNotMatch(full.question, /Reply code/);
  const top = composeCard(premiumInput({ from: 'within-plan', at: AT })).question;
  assert.deepEqual(top.options.map((o) => o.label).slice(0, 2), [ALLOW_PAID_ON_TOP, 'Not now']);
  assert.match(top.options[1].description, /^Recommended:/);
  assert.match(top.question, /real money/);
});

test('the card is offered at Thorough only, never once paid credits are allowed, and never on an account found without it', () => {
  for (const level of ['lightest', 'lean', 'balanced']) assert.match(premiumRefusal({ level, view: { value: 'off' } }), /Thorough only/);
  assert.equal(premiumRefusal({ level: 'thorough', view: { value: 'off', absent: false } }), null);
  assert.equal(premiumRefusal({ level: 'thorough', view: { value: 'within-plan', absent: false } }), null);
  assert.match(premiumRefusal({ level: 'thorough', view: { value: 'paid-too' } }), /already allowed/);
  assert.match(premiumRefusal({ level: 'thorough', view: { value: 'off', absent: true } }), /doesn't have/);
});

test('the premium view takes the setting only from its own card, and the pin only from the helper\'s check for that Yes', () => {
  assert.deepEqual(premiumState({ signed: () => true, setting: undefined, events: [] }), { value: 'off', setting: null, at: null, check: null, absent: false });
  // A setting that allows it but names no card counts as off.
  assert.equal(premiumState({ signed: () => true, setting: allowed('paid-too', { premiumCard: undefined }), events: [] }).value, 'off');
  const found = premiumState({ signed: () => true, setting: allowed('paid-too'), events: [check('model-premium', true)] });
  assert.equal(found.value, 'paid-too');
  assert.equal(premiumPinOf(found), 'model-premium');
  // A check no enrolled computer signed counts for nothing.
  assert.equal(premiumState({ setting: allowed('paid-too'), events: [check('model-premium', true)] }).check, null);
  // A check made for another Yes is not this one's.
  const other = premiumState({ signed: () => true, setting: allowed('paid-too'), events: [check('model-premium', true, AT, '99999999-2222-4333-8444-555555555555')] });
  assert.equal(other.check, null);
  assert.equal(premiumPinOf(other), null);
  // Not found: no pin, and the account is known not to have it until setup runs again.
  const none = premiumState({ signed: () => true, setting: allowed('paid-too'), events: [check(null, false)] });
  assert.equal(premiumPinOf(none), null);
  assert.equal(none.absent, true);
  assert.equal(premiumState({ signed: () => true, setting: undefined, events: [check(null, false), survey('2026-10-27T00:00:00.000Z')] }).absent, false);
  assert.equal(premiumState({ signed: () => true, setting: undefined, events: [survey('2026-10-25T00:00:00.000Z'), check(null, false)] }).absent, true);
  // Off again: no pin, whatever was found.
  assert.equal(premiumPinOf(premiumState({ signed: () => true, setting: { key: 'premium', value: 'off', id: ID, at: AT }, events: [check('model-premium', true)] })), null);
});

test('a premium pin in the configuration counts for nothing: only the state\'s does', () => {
  const config = { tiers: { pins: { mostCapable: 'model-top', midSized: 'model-mid', premium: 'model-agent' } } };
  assert.deepEqual(withPremiumPin(config, null).tiers.pins, { mostCapable: 'model-top', midSized: 'model-mid' });
  const view = premiumState({ signed: () => true, setting: allowed('paid-too'), events: [check('model-premium', true)] });
  assert.deepEqual(withPremiumPin(config, view).tiers.pins, { mostCapable: 'model-top', midSized: 'model-mid', premium: 'model-premium' });
  assert.equal(withPremiumPin({ routing: {} }, view).tiers, undefined);
});

test('the alias is checked only for a Yes in force, once, and never within the plan alone while billing can\'t be told', () => {
  assert.match(checkRefusal({ value: 'off', check: null }), /not allowed/);
  assert.match(checkRefusal({ value: 'within-plan', check: null }), /can't yet tell/);
  assert.equal(checkRefusal({ value: 'within-plan', check: null }, { billing: 'within-plan' }), null);
  assert.equal(checkRefusal({ value: 'paid-too', check: null }), null);
  assert.match(checkRefusal({ value: 'paid-too', check: { model: null, found: false } }), /already/);
  assert.equal(foundPremium('model-premium', 'model-top'), true);
  assert.equal(foundPremium('model-top', 'model-top'), false);
  assert.equal(foundPremium(null, 'model-top'), false);
});

test('the column in force uses the premium model only at Thorough, on the state\'s pin, with paid credits allowed and its pass recorded', () => {
  const config = readConfig(JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], tiers: { pins: { mostCapable: 'model-top', midSized: 'model-mid', premium: 'model-agent' } } }));
  const settings = (level) => ({ efficiency: { key: 'efficiency', value: level, id: 'e', at: AT } });
  const ready = { premium: { pins: { mostCapable: 'model-top', midSized: 'model-mid', premium: 'model-premium' } } };
  const premium = premiumState({ signed: () => true, setting: allowed('paid-too'), events: [check('model-premium', true)] });
  const at = (level, more = {}) => routingFrom({ config, views: { settings: settings(level), columnsReady: ready, premium, ...more }, now: () => new Date(AT) });
  assert.equal(at('thorough').roles.feature.model, 'model-premium');
  assert.equal(at('thorough').roles.feature.effort, 'high');
  assert.equal(at('thorough').roles.feature.fallback, 'model-top');
  assert.equal(at('thorough').roles.reviewerCritical.model, 'model-top');
  assert.ok(at('thorough').lines.includes('Premium model in use for design and risky work.'));
  assert.equal(at('balanced').roles.feature.model, 'model-top');
  // The configuration's own premium pin never stands in for the state's.
  assert.equal(at('thorough', { premium: null }).roles.feature.model, 'model-top');
  // A pass recorded on another premium model doesn't count for this one.
  assert.equal(at('thorough', { columnsReady: { premium: { pins: { mostCapable: 'model-top', premium: 'model-older' } } } }).roles.feature.model, 'model-top');
  // Within the plan alone, it isn't used, and the board says why.
  const plan = premiumState({ signed: () => true, setting: allowed('within-plan'), events: [check('model-premium', true)] });
  const r = at('thorough', { premium: plan });
  assert.equal(r.roles.feature.model, 'model-top');
  assert.ok(r.lines.includes('Premium model not used: it might have been paid from credits.'));
});
