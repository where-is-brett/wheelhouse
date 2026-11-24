// tests/scripts/lib/alerts-card.test.js
// The card that asks before a phone-alert channel is kept or forgotten: what it says, what it leaves out, and how its line binds a click
// to one request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALERTS_LINE, ALERTS_STEPS, alertsCard, alertsHash, alertsLine } from '../../../scripts/lib/alerts-card.js';

test('every step has a card that names it, offers Yes and Not now, and ends with its own line', () => {
  for (const step of ALERTS_STEPS) {
    const hash = alertsHash(step, { x: 1 });
    const card = alertsCard(step, hash, 'ntfy.sh');
    assert.deepEqual(card.options, ['Yes', 'Not now']);
    assert.equal(card.line, alertsLine(step, hash));
    assert.equal(card.question.split('\n').at(-1), card.line);
    assert.ok(ALERTS_LINE.test(card.line));
    assert.match(card.question, /decisions wait and in which project/);
  }
});

test('the hash binds a click to one request: another step or another request gives another line', () => {
  const one = alertsHash('keep-ntfy', { topic: 'a' });
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.notEqual(one, alertsHash('keep-ntfy', { topic: 'b' }));
  assert.notEqual(one, alertsHash('keep-telegram', { topic: 'a' }));
  assert.equal(one, alertsHash('keep-ntfy', { topic: 'a' }));
  assert.equal(alertsLine('keep-ntfy', one), `Phone alerts: keep-ntfy ${one.slice(0, 12)}`);
});

test('the card never holds the topic or the chat, only where it goes', () => {
  const card = alertsCard('keep-ntfy', alertsHash('keep-ntfy', { topic: 'secret-topic-9' }), 'ntfy.example.test');
  assert.doesNotMatch(JSON.stringify(card), /secret-topic-9/);
  assert.match(card.question, /ntfy\.example\.test/);
});
