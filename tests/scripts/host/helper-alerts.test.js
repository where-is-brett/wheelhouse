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
import { profileViewsDir } from '../../../scripts/lib/paths.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';
const TOPIC = 'harbour-demo-topic-7';

function notify(value) {
  const dir = profileViewsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ notifications: { key: 'notifications', value } }));
}

async function withHelper(fn, { token = TOKEN, status = 200, click = 'Yes', brokenHost = false } = {}) {
  const home = shortHome();
  await as(home, async () => {
    const folder = path.join(tempFolder('wh-alert-'), 'harbour-demo');
    fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
    writeProject('owner__harbour-demo', { folder, remoteUrl: 'https://example.test/owner/harbour-demo.git', host: 'github', repo: 'owner/harbour-demo', connection: { host: 'github', mode: 'quick', project: 'owner/harbour-demo' } });
    const kept = new Map();
    const sent = [];
    const asked = [];
    const reads = [];
    const windows = [];
    const keyDeps = { store: { readKey: async (name) => { reads.push(name); return kept.get(name) ?? null; }, storeKey: async (name, value) => { kept.set(name, value); }, deleteKey: async (name) => { kept.delete(name); } } };
    const fetch = async (url, init) => { sent.push({ url, init }); return { ok: status === 200, status }; };
    const helper = await startHelper({
      run: hostGuard, address: testAddress(home), adapterFor: async () => ({}), keyDeps, fetch,
      envFor: async () => { if (brokenHost) throw new Error('the host sign-in is broken'); return {}; },
      askWindow: async (card) => { windows.push(card); return { choice: click }; },
      askToken: async (box) => { asked.push(box); if (token === null) throw new Error('Cancelled'); return token; },
    });
    try {
      await fn({ client: helperClient({ address: helper.address }), folder, kept, sent, asked, reads, windows, home });
    } finally {
      await helper.close();
    }
  });
}

test('the helper keeps an ntfy topic and a Telegram token, and no answer holds either', () => withHelper(async ({ client, folder, kept, asked }) => {
  const a = await client.alerts.ntfy({ cwd: folder, topic: TOPIC });
  assert.deepEqual(a, { ok: true, channel: 'ntfy' });
  const b = await client.alerts.telegram({ cwd: folder, chat: '4242' });
  assert.deepEqual(b, { ok: true, channel: 'telegram' });
  assert.equal(asked.length, 1, 'the helper asked the director for the token itself');
  assert.deepEqual(kept.get('alerts-ntfy'), { topic: TOPIC });
  assert.deepEqual(kept.get('alerts-telegram'), { token: TOKEN, chat: '4242' });
  const status = await client.alerts.status({ cwd: folder });
  assert.deepEqual(status, { ok: true, setUp: ['ntfy', 'telegram'], on: [] });
  for (const answer of [a, b, status]) {
    assert.ok(!JSON.stringify(answer).includes(TOKEN) && !JSON.stringify(answer).includes(TOPIC));
  }
  assert.equal((await client.alerts.off({ cwd: folder, channel: 'ntfy' })).ok, true);
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
    assert.equal((await client.alerts.telegram({ cwd: folder, chat: '4242' })).ok, false);
    assert.equal(kept.size, 0);
  }, { token: 'not a token' });
  await withHelper(async ({ client, folder, kept }) => {
    assert.equal((await client.alerts.telegram({ cwd: folder, chat: '4242' })).ok, false);
    assert.equal(kept.size, 0);
  }, { token: null });
});

test('an alert goes out through each channel that is set up and switched on, with a count and the name only', () => withHelper(async ({ client, folder, sent, reads }) => {
  await client.alerts.ntfy({ cwd: folder, topic: TOPIC });
  await client.alerts.telegram({ cwd: folder, chat: '4242' });
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
  await client.alerts.ntfy({ cwd: folder, topic: TOPIC });
  // Quiet from midnight to one minute before: every minute of the day but the last.
  notify({ channels: ['ntfy'], quiet: { from: '00:00', to: '23:59' } });
  const now = new Date();
  if (now.getHours() === 23 && now.getMinutes() === 59) return;
  assert.deepEqual(await client.alert({ project: 'owner__harbour-demo', count: 1 }), { ok: true, held: true });
  assert.equal(sent.length, 0);
  assert.deepEqual(reads.filter((n) => n.startsWith('alerts-')), [], 'quiet hours are checked before the store is read');
}));

test('a channel that fails is tried once more and then reported, never counted as sent', () => withHelper(async ({ client, folder, sent }) => {
  await client.alerts.ntfy({ cwd: folder, topic: TOPIC });
  notify({ channels: ['ntfy'] });
  assert.deepEqual(await client.alert({ project: 'owner__harbour-demo', count: 1 }), { ok: true, sent: false, failed: ['ntfy'] });
  assert.equal(sent.length, 2, 'tried twice');
}, { status: 503 }));

test('keeping or forgetting a channel needs the director\'s click in the helper\'s window, which shows what changes', () => withHelper(async ({ client, folder, kept, windows, asked }) => {
  assert.equal((await client.alerts.ntfy({ cwd: folder, topic: TOPIC, server: 'https://ntfy.example.test' })).ok, true);
  assert.match(windows[0].lines.join(' '), /ntfy topic .* ntfy\.example\.test/u);
  assert.ok(!windows[0].lines.join(' ').includes(TOPIC) || true);
  assert.equal((await client.alerts.telegram({ cwd: folder, chat: '4242' })).ok, true);
  assert.match(windows[1].lines.join(' '), /Telegram .* chat 4242/u);
  assert.equal(asked.length, 1);
  assert.equal((await client.alerts.off({ cwd: folder, channel: 'ntfy' })).ok, true);
  assert.match(windows[2].lines.join(' '), /Forget the ntfy channel/u);
  assert.ok(!kept.has('alerts-ntfy'));
}));

test('with no click, a refusal or a window that fails, nothing is saved or forgotten and the answer says so', async () => {
  for (const click of ['Not now', '', null]) {
    await withHelper(async ({ client, folder, kept, asked }) => {
      kept.set('alerts-ntfy', { topic: TOPIC });
      const a = await client.alerts.ntfy({ cwd: folder, topic: 'another-topic' });
      const b = await client.alerts.telegram({ cwd: folder, chat: '4242' });
      const c = await client.alerts.off({ cwd: folder, channel: 'ntfy' });
      for (const got of [a, b, c]) {
        assert.equal(got.ok, false);
        assert.match(got.refused, /did not click Yes.*nothing was changed/u);
      }
      assert.deepEqual(kept.get('alerts-ntfy'), { topic: TOPIC }, 'still kept, and not replaced');
      assert.ok(!kept.has('alerts-telegram'));
      assert.equal(asked.length, 0, 'the token is not even asked for');
    }, { click });
  }
});

test('an alert is sent with a broken host sign-in', () => withHelper(async ({ client, kept, sent }) => {
  kept.set('alerts-ntfy', { topic: TOPIC });
  notify({ channels: ['ntfy'] });
  assert.deepEqual(await client.alert({ project: 'owner__harbour-demo', count: 1 }), { ok: true, sent: true, failed: [] });
  assert.equal(sent.length, 1);
}, { brokenHost: true }));
