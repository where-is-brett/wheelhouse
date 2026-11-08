// tests/scripts/frontdesk/alerts.test.js
// The front desk's alerts command, against a stand-in helper. The helper alone keeps a channel's topic or token: the command
// passes the topic on (a Telegram token is never an argument; the helper asks for it itself) and prints no secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../scripts/frontdesk/cli.js';

const CWD = '/projects/harbour-demo';

function run(args, alerts) {
  const out = [];
  const err = [];
  const client = { alerts };
  return main(['alerts', ...args], { cwd: CWD, client, out: (t) => out.push(t), err: (t) => err.push(t) })
    .then((code) => ({ code, out: out.join(''), err: err.join('') }));
}

test('alerts ntfy hands the topic to the helper and says what to do next', async () => {
  const sent = [];
  const got = await run(['ntfy', 'harbour-demo-topic-7'], { ntfy: async (body) => { sent.push(body); return { ok: true, channel: 'ntfy' }; } });
  assert.equal(got.code, 0);
  assert.deepEqual(sent, [{ cwd: CWD, topic: 'harbour-demo-topic-7' }]);
  assert.match(got.out, /kept by the helper\. Switch ntfy on under Notifications/u);
  assert.ok(!got.out.includes('harbour-demo-topic-7'), 'the topic is not repeated');
});

test('alerts telegram passes only the chat; the token is the helper\'s to ask for', async () => {
  const sent = [];
  const got = await run(['telegram', '4242'], { telegram: async (body) => { sent.push(body); return { ok: true, channel: 'telegram' }; } });
  assert.equal(got.code, 0);
  assert.deepEqual(sent, [{ cwd: CWD, chat: '4242' }]);
  // A token typed as a further argument is refused, never sent.
  const extra = await run(['telegram', '4242', '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0'], { telegram: async () => { throw new Error('must not be called'); } });
  assert.equal(extra.code, 1);
  assert.match(extra.err, /^Give alerts ntfy <topic>/u);
  assert.ok(!extra.err.includes('AAHdq'));
});

test('alerts status and alerts off say which channels, never what they hold', async () => {
  const status = await run(['status'], { status: async () => ({ ok: true, setUp: ['ntfy'], on: [] }) });
  assert.equal(status.out, 'Phone alerts set up: ntfy. Switched on in Notifications: none.\n');
  const off = await run(['off', 'telegram'], { off: async (body) => ({ ok: true, channel: body.channel }) });
  assert.equal(off.out, 'The telegram channel is forgotten.\n');
});

test('a refusal from the helper is said in its own words, and a wrong command prints the usage', async () => {
  const refused = await run(['ntfy', 'has space'], { ntfy: async () => ({ ok: false, refused: 'an ntfy topic is 1 to 64 letters, digits, dashes or underscores' }) });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /an ntfy topic is 1 to 64 letters/u);
  for (const args of [[], ['sms', 'x'], ['off'], ['off', 'sms'], ['ntfy']]) {
    const wrong = await run(args, {});
    assert.equal(wrong.code, 1, args.join(' '));
    assert.match(wrong.err, /^Give alerts ntfy <topic>/u);
  }
});
