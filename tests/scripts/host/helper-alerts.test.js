// tests/scripts/host/helper-alerts.test.js
// Phone alerts through the helper: only the helper holds the ntfy topic and the Telegram token, and only the helper sends. An alert
// holds a count and the project's name. The network is never reached: `fetch` is the test's own. Made-up project: harbour-demo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { profileViewsDir, stateDir } from '../../../scripts/lib/paths.js';
import { listEvents } from '../../../scripts/state/events.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';
const TOPIC = 'harbour-demo-topic-7';
const PROJECT = 'owner__harbour-demo';

const cardOf = (got) => listEvents(stateDir(PROJECT), { report: () => {} }).find((e) => e.id === got.card);
// The director's click on a card in the chat: a hook that only reads posts that it was shown, then that it was clicked.
async function click(client, got, label = 'Yes') {
  const card = cardOf(got);
  const ask = { project: PROJECT, session: 'chat-1', message: card.data.question, options: card.data.options };
  const shown = await client.cards.hookShown(ask);
  if (shown.ok !== true) return shown;
  return client.cards.hookClick({ ...ask, label });
}
// A call that asks first, then goes through once the card is clicked Yes.
async function through(client, call) {
  const first = await call();
  if (first.needs !== 'card') return first;
  const clicked = await click(client, first);
  assert.equal(clicked.ok, true, JSON.stringify(clicked));
  return call();
}

function notify(value) {
  const dir = profileViewsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ notifications: { key: 'notifications', value } }));
}

async function withHelper(fn, { token = TOKEN, status = 200, brokenHost = false } = {}) {
  const home = shortHome();
  await as(home, async () => {
    const folder = path.join(tempFolder('wh-alert-'), 'harbour-demo');
    fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
    writeProject('owner__harbour-demo', { folder, remoteUrl: 'https://example.test/owner/harbour-demo.git', host: 'github', repo: 'owner/harbour-demo', connection: { host: 'github', mode: 'quick', project: 'owner/harbour-demo' } });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await openTestRecord({ project: 'owner__harbour-demo' });
    const kept = new Map();
    const sent = [];
    const asked = [];
    const reads = [];
    const keyDeps = { store: { readKey: async (name) => { reads.push(name); return kept.get(name) ?? null; }, storeKey: async (name, value) => { kept.set(name, value); }, deleteKey: async (name) => { kept.delete(name); } } };
    const fetch = async (url, init) => { sent.push({ url, init }); return { ok: status === 200, status }; };
    const helper = await startHelper({
      run: hostGuard, address: testAddress(home), adapterFor: async () => ({}), keyDeps, fetch,
      envFor: async () => { if (brokenHost) throw new Error('the host sign-in is broken'); return {}; },
      hookClicks: true,
      askToken: async (box) => { asked.push(box); if (token === null) throw new Error('Cancelled'); return token; },
    });
    try {
      await fn({ client: helperClient({ address: helper.address }), folder, kept, sent, asked, reads, home });
    } finally {
      await helper.close();
    }
  });
}

test('the helper keeps an ntfy topic and a Telegram token, and no answer holds either', () => withHelper(async ({ client, folder, kept, asked }) => {
  const a = await through(client, () => client.alerts.ntfy({ cwd: folder, topic: TOPIC }));
  assert.deepEqual(a, { ok: true, channel: 'ntfy' });
  const b = await through(client, () => client.alerts.telegram({ cwd: folder, chat: '4242' }));
  assert.deepEqual(b, { ok: true, channel: 'telegram' });
  assert.equal(asked.length, 1, 'the helper asked the director for the token itself');
  assert.deepEqual(kept.get('alerts-ntfy'), { topic: TOPIC });
  assert.deepEqual(kept.get('alerts-telegram'), { token: TOKEN, chat: '4242' });
  const status = await client.alerts.status({ cwd: folder });
  assert.deepEqual(status, { ok: true, setUp: ['ntfy', 'telegram'], on: [] });
  for (const answer of [a, b, status]) {
    assert.ok(!JSON.stringify(answer).includes(TOKEN) && !JSON.stringify(answer).includes(TOPIC));
  }
  assert.equal((await through(client, () => client.alerts.off({ cwd: folder, channel: 'ntfy' }))).ok, true);
  assert.deepEqual((await client.alerts.status({ cwd: folder })).setUp, ['telegram']);
}));

test('a refused topic, chat, token or server leaves nothing kept', () => withHelper(async ({ client, folder, kept }) => {
  for (const body of [{ topic: 'has space' }, { topic: '' }, { topic: TOPIC, server: 'http://ntfy.example.test' }, { topic: TOPIC, server: 'https://user:pw@ntfy.example.test' }]) {
    const got = await client.alerts.ntfy({ cwd: folder, ...body });
    assert.equal(got.ok, false, JSON.stringify(body));
  }
  assert.equal((await client.alerts.telegram({ cwd: folder, chat: 'not a chat' })).ok, false);
  assert.equal(kept.size, 0);
  assert.equal((await client.alerts.off({ cwd: folder, channel: 'sms' })).ok, false);
}));

test('a Telegram token that is wrong, or never given, is refused and kept nowhere', async () => {
  await withHelper(async ({ client, folder, kept }) => {
    assert.equal((await through(client, () => client.alerts.telegram({ cwd: folder, chat: '4242' }))).ok, false);
    assert.equal(kept.size, 0);
  }, { token: 'not a token' });
  await withHelper(async ({ client, folder, kept }) => {
    assert.equal((await through(client, () => client.alerts.telegram({ cwd: folder, chat: '4242' }))).ok, false);
    assert.equal(kept.size, 0);
  }, { token: null });
});

test('an alert goes out through each channel that is set up and switched on, with a count and the name only', () => withHelper(async ({ client, folder, sent, reads }) => {
  await through(client, () => client.alerts.ntfy({ cwd: folder, topic: TOPIC }));
  await through(client, () => client.alerts.telegram({ cwd: folder, chat: '4242' }));
  // Only the chat is switched on: nothing is sent.
  assert.deepEqual(await client.alert({ project: 'owner__harbour-demo', count: 1 }), { ok: true, none: true });
  assert.equal(sent.length, 0);
  assert.deepEqual(reads.filter((n) => n.startsWith('alerts-')), [], 'a channel nobody switched on is never looked for in the store');
  notify({ channels: ['claude', 'ntfy', 'telegram'] });
  const got = await client.alert({ project: 'owner__harbour-demo', count: 2 });
  assert.deepEqual(got, { ok: true, sent: true, failed: [] });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, `https://ntfy.sh/${TOPIC}`);
  assert.equal(sent[0].init.body, '2 decisions wait in harbour-demo');
  assert.deepEqual(Object.keys(sent[0].init.headers), ['Content-Type']);
  const body = JSON.parse(sent[1].init.body);
  assert.deepEqual(body, { chat_id: '4242', text: '2 decisions wait in harbour-demo', disable_web_page_preview: true });
  assert.ok(!JSON.stringify(got).includes(TOPIC));
  // A bad count is refused, and nothing more is sent.
  assert.equal((await client.alert({ project: 'owner__harbour-demo', count: 0 })).ok, false);
  assert.equal(sent.length, 2);
}));

test('the quiet hours hold an alert and send nothing', () => withHelper(async ({ client, folder, sent, reads }) => {
  await through(client, () => client.alerts.ntfy({ cwd: folder, topic: TOPIC }));
  // Quiet from midnight to one minute before: every minute of the day but the last.
  notify({ channels: ['ntfy'], quiet: { from: '00:00', to: '23:59' } });
  const now = new Date();
  if (now.getHours() === 23 && now.getMinutes() === 59) return;
  assert.deepEqual(await client.alert({ project: 'owner__harbour-demo', count: 1 }), { ok: true, held: true });
  assert.equal(sent.length, 0);
  assert.deepEqual(reads.filter((n) => n.startsWith('alerts-')), [], 'quiet hours are checked before the store is read');
}));

test('a channel that fails is tried once more and then reported, never counted as sent', () => withHelper(async ({ client, folder, sent }) => {
  await through(client, () => client.alerts.ntfy({ cwd: folder, topic: TOPIC }));
  notify({ channels: ['ntfy'] });
  assert.deepEqual(await client.alert({ project: 'owner__harbour-demo', count: 1 }), { ok: true, sent: false, failed: ['ntfy'] });
  assert.equal(sent.length, 2, 'tried twice');
}, { status: 503 }));

test('keeping or forgetting a channel needs the director\'s click on its card in the chat, which says what changes', () => withHelper(async ({ client, folder, kept, asked }) => {
  const ask = await client.alerts.ntfy({ cwd: folder, topic: TOPIC, server: 'https://ntfy.example.test' });
  assert.deepEqual([ask.ok, ask.needs], [false, 'card']);
  assert.match(cardOf(ask).data.question, /ntfy topic .* ntfy\.example\.test/u);
  assert.ok(!cardOf(ask).data.question.includes(TOPIC), 'the topic stays with the helper');
  assert.deepEqual(cardOf(ask).data.options, ['Yes', 'Not now']);
  assert.ok(!kept.has('alerts-ntfy'), 'nothing is kept before the click');
  assert.equal((await click(client, ask)).ok, true);
  assert.equal((await client.alerts.ntfy({ cwd: folder, topic: TOPIC, server: 'https://ntfy.example.test' })).ok, true);
  const tele = await client.alerts.telegram({ cwd: folder, chat: '4242' });
  assert.match(cardOf(tele).data.question, /Telegram .* chat 4242/u);
  assert.equal(asked.length, 0, 'the token is not asked for before the click');
  assert.equal((await click(client, tele)).ok, true);
  assert.equal((await client.alerts.telegram({ cwd: folder, chat: '4242' })).ok, true);
  assert.equal(asked.length, 1);
  const off = await client.alerts.off({ cwd: folder, channel: 'ntfy' });
  assert.match(cardOf(off).data.question, /Forget the ntfy channel/u);
  assert.ok(kept.has('alerts-ntfy'), 'still kept before the click');
  assert.equal((await click(client, off)).ok, true);
  assert.equal((await client.alerts.off({ cwd: folder, channel: 'ntfy' })).ok, true);
  assert.ok(!kept.has('alerts-ntfy'));
  // The click was for that request and is used up: the same request asks again.
  assert.equal((await client.alerts.off({ cwd: folder, channel: 'ntfy' })).needs, 'card');
}));

test('with no click, a click on Not now or a click for another request, nothing is saved or forgotten and the answer says so', () => withHelper(async ({ client, folder, kept, asked }) => {
  kept.set('alerts-ntfy', { topic: TOPIC });
  const a = await client.alerts.ntfy({ cwd: folder, topic: 'another-topic' });
  const b = await client.alerts.telegram({ cwd: folder, chat: '4242' });
  const c = await client.alerts.off({ cwd: folder, channel: 'ntfy' });
  for (const got of [a, b, c]) {
    assert.equal(got.ok, false);
    assert.match(got.refused, /has not clicked Yes.*nothing was changed/u);
    assert.equal(got.needs, 'card');
  }
  // Not now saves nothing, and a click on a card clicked for another request does not carry this one.
  assert.notEqual((await click(client, a, 'Not now')).recorded, true);
  assert.equal((await client.alerts.ntfy({ cwd: folder, topic: 'another-topic' })).ok, false);
  assert.equal((await click(client, b)).ok, true);
  assert.equal((await client.alerts.ntfy({ cwd: folder, topic: 'another-topic' })).ok, false, 'the Telegram click is not for ntfy');
  assert.equal((await client.alerts.off({ cwd: folder, channel: 'ntfy' })).ok, false);
  assert.deepEqual(kept.get('alerts-ntfy'), { topic: TOPIC }, 'still kept, and not replaced');
  assert.ok(!kept.has('alerts-telegram'));
  assert.equal(asked.length, 0, 'the token is not even asked for');
}));

test('/cards/earnable says what a click on the alerts card would record, from the card as asked, and writes nothing; /cards/apply carries out nothing unsigned', () => withHelper(async ({ client, folder, kept }) => {
  const ask = await client.alerts.ntfy({ cwd: folder, topic: TOPIC });
  const card = cardOf(ask);
  const body = { project: PROJECT, message: card.data.question, options: card.data.options };
  const before = listEvents(stateDir(PROJECT), { report: () => {} }).length;
  const yes = await client.cards.earnable({ ...body, label: 'Yes' });
  assert.equal(yes.ok, true, JSON.stringify(yes));
  assert.deepEqual([yes.made.kind, yes.made.data.action, yes.made.data.step, yes.made.data.label], ['action', 'alerts-keep', 'keep-ntfy', 'Yes']);
  assert.equal(yes.made.data.proof, undefined, 'the helper does not sign: the hook that asked does');
  // Not now earns nothing, a label that is no option is refused, and words that are no waiting card earn nothing.
  assert.deepEqual(await client.cards.earnable({ ...body, label: 'Not now' }), { ok: true, made: null });
  assert.equal((await client.cards.earnable({ ...body, label: 'Maybe' })).ok, false);
  assert.deepEqual(await client.cards.earnable({ ...body, message: `${card.data.question}\nAnd more words.`, label: 'Yes' }), { ok: true, made: null });
  assert.equal(listEvents(stateDir(PROJECT), { report: () => {} }).length, before, 'nothing was written');
  assert.ok(!kept.has('alerts-ntfy'));
  assert.deepEqual(await client.cards.apply({ project: PROJECT }), { ok: true }, 'no signed click, nothing carried out');
}));

test('an alert is sent with a broken host sign-in', () => withHelper(async ({ client, kept, sent }) => {
  kept.set('alerts-ntfy', { topic: TOPIC });
  notify({ channels: ['ntfy'] });
  assert.deepEqual(await client.alert({ project: 'owner__harbour-demo', count: 1 }), { ok: true, sent: true, failed: [] });
  assert.equal(sent.length, 1);
}, { brokenHost: true }));
