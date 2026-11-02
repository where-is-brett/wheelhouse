// tests/scripts/state/key-renewal.test.js
// New signing keys after risky periods (Task B2): when one is due, the card that asks for it, and the replacement, which
// keeps the old key enrolled as retired so earlier records still verify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { keyRenewalDue, keyRenewalCardInput, KEY_RENEWAL_TOPIC, KEY_RENEWAL_LABEL, KEY_RENEWAL_ON_UNSANDBOXED_STEPS, replaceSigningKey, renewKeyOnClick } from '../../../scripts/state/key-renewal.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled, sign, verify, ownKey } from '../../../scripts/state/signing.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { as, tempFolder } from '../../helpers/homes.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-09T00:00:00.000Z');
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();
const setting = (value, days, key = 'windowsBuildCommands:abcd1234') => ({ kind: 'setting', at: ago(days), data: { key, value } });
const allowance = (days) => ({ kind: 'level', at: ago(days), data: { level: 'ask', pr: 7, allowance: 'npm run build' } });

test('renewal is due after Unattended ends, and not while it lasts or before', () => {
  assert.equal(keyRenewalDue({ events: [], now: NOW, lastRenewal: null }).due, false, 'nothing happened');
  assert.equal(keyRenewalDue({ events: [setting('unattended', 3)], now: NOW, lastRenewal: null }).due, false, 'still at Unattended');
  const ended = keyRenewalDue({ events: [setting('unattended', 5), setting('ask', 2)], now: NOW, lastRenewal: null });
  assert.equal(ended.due, true);
  assert.match(ended.why, /Unattended/);
  assert.equal(keyRenewalDue({ events: [setting('unattended', 5), setting('ask', 2)], now: NOW, lastRenewal: ago(1) }).due, false, 'a key made since');
  assert.equal(keyRenewalDue({ events: [setting('unattended', 5, 'other'), setting('ask', 2, 'another')], now: NOW, lastRenewal: null }).due, false, 'another setting\'s end is no end');
});

test('a level the audit reads (a word, for a change or for all after it) opens and ends a period too', () => {
  const level = (value, days, pr) => ({ kind: 'level', at: ago(days), data: { level: value, ...(pr === undefined ? {} : { pr }) } });
  assert.equal(keyRenewalDue({ events: [level('unattended', 5, 7), level('guarded', 2, 7)], now: NOW }).due, true);
  assert.equal(keyRenewalDue({ events: [level('unattended', 5)], now: NOW }).due, false);
  assert.equal(keyRenewalDue({ events: [level('unattended', 5), level('ask', 4)], now: NOW }).due, true);
  assert.equal(keyRenewalDue({ events: [{ kind: 'level', at: ago(5), data: { level: 3, work: 'w' } }, { kind: 'level', at: ago(4), data: { level: 2, work: 'w' } }], now: NOW }).due, false, 'decision levels are numbers');
});

test('renewal is due a week after an Ask allowance, and not before', () => {
  assert.equal(keyRenewalDue({ events: [allowance(6)], now: NOW, lastRenewal: null }).due, false);
  const week = keyRenewalDue({ events: [allowance(8)], now: NOW, lastRenewal: null });
  assert.equal(week.due, true);
  assert.match(week.why, /allowance/);
  assert.equal(keyRenewalDue({ events: [allowance(8)], now: NOW, lastRenewal: ago(3) }).due, false);
  const click = { kind: 'card-answer', at: ago(9), data: { label: 'Allow for this feature', card: 'c1' } };
  assert.equal(keyRenewalDue({ events: [click], now: NOW, lastRenewal: null }).due, true, 'the build question\'s own Allow click');
});

test('a week of Copilot steps outside the sandbox makes it due only with its own switch on', () => {
  assert.equal(KEY_RENEWAL_ON_UNSANDBOXED_STEPS, false, 'the switch starts off');
  const outside = [ago(9)];
  assert.equal(keyRenewalDue({ events: [], now: NOW, lastRenewal: null, outsideSandbox: outside }).due, false, 'off: the old triggers are what runs');
  const on = keyRenewalDue({ events: [], now: NOW, lastRenewal: null, outsideSandbox: outside, outsideSandboxOn: true });
  assert.equal(on.due, true);
  assert.match(on.why, /sandbox/);
  assert.equal(keyRenewalDue({ events: [], now: NOW, lastRenewal: null, outsideSandbox: [ago(2)], outsideSandboxOn: true }).due, false, 'not yet a week');
  assert.equal(keyRenewalDue({ events: [], now: NOW, lastRenewal: ago(1), outsideSandbox: outside, outsideSandboxOn: true }).due, false, 'since the last key');
});

test('garbled input is never due', () => {
  for (const bad of [undefined, null, {}, { events: 'x', now: NOW }, { events: [null, 5, { kind: 'setting' }], now: 'later' }]) {
    assert.equal(keyRenewalDue(bad).due, false);
  }
});

test('the card is one a card can be composed from, and says what the click does', () => {
  const input = keyRenewalCardInput('it has been a week since an Ask allowance');
  assert.equal(input.topic, KEY_RENEWAL_TOPIC);
  assert.equal(input.recommend, KEY_RENEWAL_LABEL);
  const { card } = composeCard(input);
  assert.equal(card.topic, KEY_RENEWAL_TOPIC);
  assert.ok(card.options.includes(KEY_RENEWAL_LABEL));
});

const signedClick = (label = KEY_RENEWAL_LABEL) => sign(makeEvent({ kind: 'card-answer', data: { label, card: 'card-1' }, now: () => new Date('2026-11-08T01:00:00.000Z') }));

async function withHome(fn) {
  return as(path.join(tempFolder('wh-keys-'), 'home'), async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-11-01T00:00:00.000Z' });
    return fn();
  });
}

test('records signed before the new key still verify, and the old key signs nothing new', async () => {
  await withHome(() => {
    const before = sign(makeEvent({ kind: 'review', data: { pr: 1, commit: 'a'.repeat(40), verdict: 'CLEAN' }, now: () => new Date('2026-11-02T00:00:00.000Z') }));
    const oldKey = ownKey();
    const made = replaceSigningKey({ enrolled: readEnrolled(), now: () => NOW, click: signedClick(), known: [before.id] });
    assert.notEqual(made.publicKey, oldKey.publicKey);
    assert.equal(ownKey().publicKey, made.publicKey, 'the computer now signs with the new key');
    const list = readEnrolled();
    assert.equal(list.filter((e) => e.computer === made.computer).length, 2, 'both enrolled');
    assert.equal(verify(before, list), true, 'the earlier record still verifies');
    const after = sign(makeEvent({ kind: 'review', data: { pr: 1, commit: 'b'.repeat(40), verdict: 'CLEAN' }, now: () => new Date('2026-11-10T00:00:00.000Z') }));
    assert.equal(verify(after, list), true);
    assert.notEqual(after.sig.value, before.sig.value);
    // The retired key counts only for what it signed before it was retired.
    assert.equal(list.find((e) => e.publicKey === oldKey.publicKey).retiredAt, NOW.toISOString());
  });
});

test('a record the retired key signs after its retirement doesn\'t verify', async () => {
  await withHome(() => {
    const oldPem = fs.readFileSync(path.join(process.env.WHEELHOUSE_HOME, 'keys', 'signing.pem'));
    replaceSigningKey({ enrolled: readEnrolled(), now: () => NOW, click: signedClick(), known: [] });
    const current = fs.readFileSync(path.join(process.env.WHEELHOUSE_HOME, 'keys', 'signing.pem'));
    // Put the old key back for a moment, as a thief with a copy of it would use it.
    fs.writeFileSync(path.join(process.env.WHEELHOUSE_HOME, 'keys', 'signing.pem'), oldPem);
    // Backdated to before the renewal, as a thief would stamp it: still not a record the old key had signed.
    const late = sign(makeEvent({ kind: 'review', data: { pr: 1, commit: 'c'.repeat(40), verdict: 'CLEAN' }, now: () => new Date('2026-11-01T00:00:00.000Z') }));
    fs.writeFileSync(path.join(process.env.WHEELHOUSE_HOME, 'keys', 'signing.pem'), current);
    assert.equal(verify(late, readEnrolled()), false);
  });
});

test('a key isn\'t replaced without the card\'s click', async () => {
  await withHome(() => {
    const kept = ownKey().publicKey;
    assert.throws(() => replaceSigningKey({ enrolled: readEnrolled(), now: () => NOW }), /click/);
    assert.throws(() => replaceSigningKey({ enrolled: readEnrolled(), now: () => NOW, click: null }), /click/);
    assert.throws(() => replaceSigningKey({ enrolled: readEnrolled(), now: () => NOW, click: { kind: 'card-answer', data: { label: KEY_RENEWAL_LABEL } } }), /click/, 'an unsigned one');
    assert.throws(() => replaceSigningKey({ enrolled: readEnrolled(), now: () => NOW, click: signedClick('Not now') }), /click/, 'another label');
    assert.equal(ownKey().publicKey, kept);
    assert.equal(readEnrolled().length, 1);
  });
});

test('renewKeyOnClick replaces the key only for a signed click on the renewal card\'s own label, once', async () => {
  await withHome(() => {
    const kept = ownKey().publicKey;
    const card = makeEvent({ kind: 'card', data: composeCard(keyRenewalCardInput('a week with an allowance')).card, now: () => new Date('2026-11-08T00:00:00.000Z') });
    const answer = (label, extra = {}) => sign(makeEvent({ kind: 'card-answer', data: { label, card: card.id, ...extra }, now: () => new Date('2026-11-08T01:00:00.000Z') }));
    const events = (...more) => [card, ...more];
    assert.equal(renewKeyOnClick({ events: events(), enrolled: readEnrolled(), now: () => NOW }).renewed, false, 'no click');
    assert.equal(renewKeyOnClick({ events: events(answer('Not now')), enrolled: readEnrolled(), now: () => NOW }).renewed, false, 'another label');
    const unsigned = makeEvent({ kind: 'card-answer', data: { label: KEY_RENEWAL_LABEL, card: card.id }, now: () => new Date('2026-11-08T01:00:00.000Z') });
    assert.equal(renewKeyOnClick({ events: events(unsigned), enrolled: readEnrolled(), now: () => NOW }).renewed, false, 'unsigned');
    assert.equal(ownKey().publicKey, kept);
    const click = answer(KEY_RENEWAL_LABEL);
    const got = renewKeyOnClick({ events: events(click), enrolled: readEnrolled(), now: () => NOW });
    assert.equal(got.renewed, true);
    assert.notEqual(ownKey().publicKey, kept);
    // The same click, seen again after the renewal, renews nothing more.
    const again = renewKeyOnClick({ events: events(click), enrolled: readEnrolled(), now: () => new Date(NOW.getTime() + DAY), lastRenewal: NOW.toISOString() });
    assert.equal(again.renewed, false);
  });
});
