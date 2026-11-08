// tests/scripts/alerts/send.test.js
// The phone alert holds only a count and the project's name. It is sent through an injected fetch, so nothing here reaches the
// network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertText, sendAlert, deliverAlert, inQuiet, isSetUp } from '../../../scripts/alerts/send.js';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';
const SETTINGS = { ntfy: { topic: 'harbour-demo-topic-7' }, telegram: { token: TOKEN, chat: '4242' } };
const LINK = /https?:|www\.|:\/\//u;

const recorder = (answer = { ok: true, status: 200 }) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (typeof answer === 'function') return answer(calls.length);
    return answer;
  };
  return { calls, fetch };
};

test('an alert holds only a count and the project\'s name', () => {
  assert.equal(alertText({ count: 1, project: 'harbour-demo' }), '1 decision waits in harbour-demo');
  assert.equal(alertText({ count: 3, project: 'harbour-demo' }), '3 decisions wait in harbour-demo');
  for (const count of [1, 2, 11]) assert.match(alertText({ count, project: 'harbour-demo' }), /^\d+ decisions? waits? in \S+$/u);
  // A name that would read as a link is stripped of what makes it one.
  const odd = alertText({ count: 2, project: 'https://harbour.example/demo' });
  assert.match(odd, /^\d+ decisions? waits? in \S+$/u);
  assert.doesNotMatch(odd, LINK);
});

test('a dotted repository name comes out with dashes, and a name is capped', () => {
  assert.equal(alertText({ count: 1, project: 'brett.github.io' }), '1 decision waits in brett-github-io');
  assert.equal(alertText({ count: 2, project: 'harbour demo/api@x' }), '2 decisions wait in harbour-demoapix');
  assert.ok(alertText({ count: 1, project: 'a'.repeat(100) }).endsWith(` in ${'a'.repeat(40)}`));
  assert.equal(alertText({ count: 1, project: '...' }), '1 decision waits in -');
  assert.doesNotMatch(alertText({ count: 3, project: 'www.example.com' }), /\./u);
});

test('ntfy gets the text as the body and no click, attach or actions header', async () => {
  const { calls, fetch } = recorder();
  const got = await sendAlert({ channel: 'ntfy', settings: SETTINGS, text: '1 decision waits in harbour-demo', fetch });
  assert.deepEqual(got, { sent: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ntfy.sh/harbour-demo-topic-7');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, '1 decision waits in harbour-demo');
  const names = Object.keys(calls[0].init.headers).map((n) => n.toLowerCase());
  for (const banned of ['click', 'attach', 'actions', 'icon', 'filename', 'email']) assert.ok(!names.includes(banned), banned);
  assert.doesNotMatch(calls[0].init.body, LINK);
});

test('Telegram sends the text with link previews off and no link in it', async () => {
  const { calls, fetch } = recorder();
  const got = await sendAlert({ channel: 'telegram', settings: SETTINGS, text: '2 decisions wait in harbour-demo', fetch });
  assert.deepEqual(got, { sent: true });
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, { chat_id: '4242', text: '2 decisions wait in harbour-demo', disable_web_page_preview: true });
});

test('a failure reports a reason that holds neither the topic, the token nor the address', async () => {
  const boom = async (url) => { throw new Error(`connect failed to ${url}`); };
  for (const channel of ['ntfy', 'telegram']) {
    const got = await sendAlert({ channel, settings: SETTINGS, text: 'x', fetch: boom });
    assert.equal(got.sent, false);
    for (const secret of ['harbour-demo-topic-7', TOKEN, 'ntfy.sh', 'telegram.org']) assert.ok(!got.reason.includes(secret), secret);
  }
  const refused = await sendAlert({ channel: 'ntfy', settings: SETTINGS, text: 'x', fetch: async () => ({ ok: false, status: 429 }) });
  assert.deepEqual(refused, { sent: false, reason: 'the service refused it (status 429)' });
});

test('a channel that is not set up sends nothing', async () => {
  const { calls, fetch } = recorder();
  assert.equal((await sendAlert({ channel: 'ntfy', settings: {}, text: 'x', fetch })).sent, false);
  assert.equal((await sendAlert({ channel: 'telegram', settings: { telegram: { token: 'no', chat: '1' } }, text: 'x', fetch })).sent, false);
  assert.equal((await sendAlert({ channel: 'claude', settings: SETTINGS, text: 'x', fetch })).sent, false);
  assert.equal(calls.length, 0);
  assert.equal(isSetUp('ntfy', SETTINGS), true);
});

test('quiet hours hold an alert until they end', async () => {
  const notifications = { channels: ['ntfy'], quiet: { from: '22:00', to: '07:00' } };
  const { calls, fetch } = recorder();
  const at = (h, m = 0) => new Date(2026, 10, 8, h, m);
  assert.deepEqual(await deliverAlert({ count: 1, project: 'harbour-demo', notifications, settings: SETTINGS, now: at(23), fetch }), { held: true });
  assert.deepEqual(await deliverAlert({ count: 1, project: 'harbour-demo', notifications, settings: SETTINGS, now: at(6, 59), fetch }), { held: true });
  assert.equal(calls.length, 0);
  const after = await deliverAlert({ count: 1, project: 'harbour-demo', notifications, settings: SETTINGS, now: at(7), fetch });
  assert.deepEqual(after, { sent: true, failed: [] });
  assert.equal(calls.length, 1);
  assert.equal(inQuiet({ from: '09:00', to: '17:00' }, at(12)), true);
  assert.equal(inQuiet({ from: '09:00', to: '17:00' }, at(18)), false);
  assert.equal(inQuiet(undefined, at(3)), false);
  assert.equal(inQuiet({ from: '09:00', to: '09:00' }, at(9)), false);
});

test('a channel that fails is tried once more, and the other is still tried', async () => {
  const notifications = { channels: ['ntfy', 'telegram'] };
  const { calls, fetch } = recorder((n) => (n <= 2 ? { ok: false, status: 503 } : { ok: true }));
  const got = await deliverAlert({ count: 2, project: 'harbour-demo', notifications, settings: SETTINGS, now: new Date(2026, 10, 8, 12), fetch });
  assert.deepEqual(got, { sent: true, failed: ['ntfy'] });
  assert.equal(calls.length, 3, 'ntfy twice, Telegram once');
  const second = recorder((n) => (n === 1 ? { ok: false, status: 500 } : { ok: true }));
  assert.deepEqual(await deliverAlert({ count: 1, project: 'harbour-demo', notifications: { channels: ['ntfy'] }, settings: SETTINGS, fetch: second.fetch }), { sent: true, failed: [] });
  assert.equal(second.calls.length, 2);
});

test('no alert is sent when no channel is set up, and the decision still waits in the chat', async () => {
  const { calls, fetch } = recorder();
  // Only the chat is switched on, or a channel is switched on with nothing set up for it.
  assert.deepEqual(await deliverAlert({ count: 1, project: 'harbour-demo', notifications: { channels: ['claude'] }, settings: SETTINGS, fetch }), { none: true });
  assert.deepEqual(await deliverAlert({ count: 1, project: 'harbour-demo', notifications: { channels: ['ntfy', 'telegram'] }, settings: {}, fetch }), { none: true });
  assert.deepEqual(await deliverAlert({ count: 1, project: 'harbour-demo', notifications: undefined, settings: SETTINGS, fetch }), { none: true });
  assert.equal(calls.length, 0);
});
