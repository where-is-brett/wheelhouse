// tests/scripts/routing/premium.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  premiumValueOf, premiumInput, premiumState, premiumPinOf, withPremiumPin, premiumRefusal, checkRefusal, foundPremium,
  ALLOW_WITHIN, ALLOW_PAID, ALLOW_PAID_ON_TOP, refusalOf, restUntil, restOf, failedInput, offeredFrom, REST_LINE,
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
  assert.deepEqual(premiumState({ signed: () => true, setting: undefined, events: [] }), { value: 'off', setting: null, at: null, check: null, absent: false, failed: null, rest: null });
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

// --- When it can't be used, and when its evaluation fails ---

test('a usage limit or a billing refusal is read only from a premium wake that failed', () => {
  assert.equal(refusalOf('You hit your limit. Claude AI usage limit reached', 0), null, 'a wake that ended well is never one');
  assert.equal(refusalOf('Everything went fine.', 1), null);
  assert.deepEqual(refusalOf('Claude AI usage limit reached|1793000000', 1), { why: 'limit', until: new Date(1793000000 * 1000).toISOString() });
  for (const text of ["You've hit your limit · resets 5pm", 'API Error: 429 Too Many Requests', 'Weekly limit reached']) assert.deepEqual(refusalOf(text, 1), { why: 'limit', until: null }, text);
  for (const text of ['Credit balance is too low', 'Insufficient credits to run this model', 'Extra usage is off']) assert.deepEqual(refusalOf(text, 1), { why: 'billing', until: null }, text);
  // An exit the watcher didn't see is read as well.
  assert.equal(refusalOf('Credit balance is too low', null).why, 'billing');
});

test('the rest lasts until the limit\'s own end when it is given and to come, else a day', () => {
  const at = '2026-10-26T01:00:00.000Z';
  assert.equal(restUntil({ until: '2026-10-26T05:00:00.000Z' }, at), '2026-10-26T05:00:00.000Z');
  assert.equal(restUntil({ until: '2026-10-25T05:00:00.000Z' }, at), '2026-10-27T01:00:00.000Z');
  assert.equal(restUntil({ until: null }, at), '2026-10-27T01:00:00.000Z');
  const rest = (until, when = at) => ({ kind: 'premium-rest', id: `r-${when}`, at: when, data: { why: 'limit', at: when, until } });
  assert.deepEqual(restOf([rest('2026-10-27T01:00:00.000Z')], () => new Date('2026-10-26T12:00:00.000Z')), { until: '2026-10-27T01:00:00.000Z', why: 'limit' });
  assert.equal(restOf([rest('2026-10-27T01:00:00.000Z')], () => new Date('2026-10-27T01:00:00.000Z')), null, 'over at its end');
});

test('while it rests, or once its evaluation failed under this Yes, the premium model isn\'t used', () => {
  const config = readConfig(JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], tiers: { pins: { mostCapable: 'model-top', midSized: 'model-mid' } } }));
  const settings = { efficiency: { key: 'efficiency', value: 'thorough', id: 'e', at: AT } };
  const ready = { premium: { pins: { mostCapable: 'model-top', midSized: 'model-mid', premium: 'model-premium' } } };
  const events = [check('model-premium', true)];
  const view = (more = []) => premiumState({ signed: () => true, setting: allowed('paid-too'), events: [...events, ...more], now: () => new Date('2026-10-26T12:00:00.000Z') });
  const at = (premium, resting) => routingFrom({ config, views: { settings, columnsReady: ready, premium }, now: () => new Date(AT), resting });
  assert.equal(at(view()).roles.feature.model, 'model-premium');
  assert.equal(at(view()).premium, true);
  // Resting, by the state's record or the waker's own.
  const rest = { kind: 'premium-rest', id: 'r', at: AT, data: { why: 'billing', at: AT, until: '2026-10-27T01:00:00.000Z' } };
  for (const r of [at(view([rest])), at(view(), true)]) {
    assert.deepEqual(r.roles.feature, { model: 'model-top', effort: 'xhigh', fallback: 'model-mid' }, 'the most capable model at the cell\'s own effort');
    assert.ok(r.lines.includes(REST_LINE));
    assert.equal(r.premium, undefined);
  }
  // Failed under this Yes: off, and its card offers a new Yes.
  const failed = view([{ kind: 'premium-failed', id: 'f', at: AT, data: { setting: ID, model: 'model-premium', failed: ['scenario 22 trial 1 failed'] } }]);
  assert.deepEqual(failed.failed, { id: 'f', at: AT, model: 'model-premium' });
  assert.equal(at(failed).roles.feature.model, 'model-top');
  assert.equal(premiumRefusal({ level: 'thorough', view: failed }), null);
  assert.equal(offeredFrom(failed), 'off');
  assert.equal(offeredFrom({ value: 'within-plan', failed: null }), 'within-plan');
  // A failure no enrolled computer signed counts for nothing.
  assert.equal(premiumState({ setting: allowed('paid-too'), events: [{ kind: 'premium-failed', id: 'f', at: AT, data: { setting: ID, model: 'model-premium', failed: ['x'] } }] }).failed, null);
});

test('the failed evaluation\'s card is plain, offers OK or Try it again, and says what happens next', () => {
  const { question } = composeCard(failedInput({ id: 'f-1' }));
  assert.deepEqual(question.options.map((o) => o.label), ['OK', 'Try it again']);
  assert.match(question.options[1].description, /Nothing is spent unless you allow it there/);
  assert.match(question.question, /stay on the most capable standard model/);
  assert.match(question.question, /nothing more is charged/);
  assert.equal(setLinesOf(question.question).length, 0, 'nothing to sign');
});

test('a later rest record can only make a rest longer, never cut it short', () => {
  const rest = (until, at) => ({ kind: 'premium-rest', id: `r-${at}`, at, data: { why: 'limit', at, until } });
  const now = () => new Date('2026-10-26T12:00:00.000Z');
  assert.equal(restOf([rest('2026-10-27T01:00:00.000Z', '2026-10-26T01:00:00.000Z'), rest('2026-10-26T02:00:00.000Z', '2026-10-26T03:00:00.000Z')], now).until, '2026-10-27T01:00:00.000Z');
});

test('more wordings of a limit or a refusal are read, and a run whose exit wasn\'t seen is read from its last lines only', () => {
  assert.equal(refusalOf("You've reached your weekly limit for this model", 1).why, 'limit');
  assert.equal(refusalOf('You are out of extra usage', 1).why, 'billing');
  // A finished wake that wrote about rate limits in its work, early in its output, isn't one.
  assert.equal(refusalOf(`Added a rate limit to the login form, returning 429 when hit.\n${'Done with the next step.\n'.repeat(200)}`, null), null);
  assert.equal(refusalOf(`${'Working.\n'.repeat(400)}Claude AI usage limit reached|1793000000`, null).why, 'limit');
});
