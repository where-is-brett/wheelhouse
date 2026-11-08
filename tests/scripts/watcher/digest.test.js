// tests/scripts/watcher/digest.test.js
// The watcher's tick for the director's day: the daily digest once a day after digestAt, the weekly log once a week, and the
// phone alert for a decision newly waiting. Made-up project: harbour-demo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDigestTicker } from '../../../scripts/watcher/digest.js';
import { readDigest, clearDigest } from '../../../scripts/digest/due.js';
import { markSeen } from '../../../scripts/briefing/seen.js';
import { readAlerts } from '../../../scripts/alerts/tick.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { inHome, keep, P, raise } from '../../helpers/decisions-world.js';
import { readEnrolled } from '../../../scripts/state/signing.js';
import { listEvents } from '../../../scripts/state/events.js';
import { stateDir } from '../../../scripts/lib/paths.js';

const day = (d, h, m = 0) => new Date(2026, 10, d, h, m);
const iso = (date) => date.toISOString();

function setup({ clock, at = '17:00', alert = { ok: true, sent: true, failed: [] } } = {}) {
  const logged = [];
  const asked = [];
  const state = { now: clock };
  const ticker = makeDigestTicker({
    project: P,
    client: { alert: async (body) => { asked.push(body); return typeof alert === 'function' ? alert() : alert; } },
    now: () => state.now,
    log: (m) => logged.push(m),
    read: {
      events: () => listEvents(stateDir(P), { report: () => {} }),
      enrolled: () => readEnrolled(),
      settings: () => ({ digestAt: { value: at } }),
      usage: () => ({ week: { tokens: 1200000, usd: 84, share: 34 } }),
    },
  });
  return { ticker, state, logged, asked };
}

test('the digest is made once a day after digestAt, and waits for the director\'s next message', () => inHome(async () => {
  const { ticker, state, logged } = setup({ clock: day(8, 16, 59) });
  assert.equal(readDigest(P), null);
  assert.deepEqual((await ticker.tick()).digest, { made: false });
  state.now = day(8, 17, 1);
  const first = (await ticker.tick()).digest;
  assert.equal(first.made, true);
  assert.equal(first.weekly, true, 'the first digest carries the log');
  const kept = readDigest(P);
  assert.match(kept.text, /^Daily digest, 8 November 2026/u);
  assert.match(kept.text, /Usage this week: 1\.2M tokens/u);
  // Not again the same evening, even though the digest has not been shown.
  const shownLater = () => clearDigest(P);
  state.now = day(8, 19, 0);
  assert.deepEqual((await ticker.tick()).digest, { made: false });
  assert.equal(readDigest(P).at, kept.at);
  // The director reads it. Tomorrow it is due again, and the log is a week away.
  shownLater();
  state.now = day(9, 17, 5);
  const second = (await ticker.tick()).digest;
  assert.equal(second.weekly, false);
  assert.deepEqual(logged, []);
}));

test('the weekly decision log comes on the first digest seven days after the last', () => inHome(async () => {
  const { ticker, state } = setup({ clock: day(1, 17, 1) });
  await ticker.tick();
  for (let d = 2; d <= 7; d += 1) {
    state.now = day(d, 17, 1);
    clearDigest(P); // shown each day
    assert.equal((await ticker.tick()).digest.weekly, false, `day ${d}`);
  }
  state.now = day(8, 17, 1);
  assert.equal((await ticker.tick()).digest.weekly, true);
  assert.match(readDigest(P).text, /decision log/u);
}));

test('the digest lists what merged by itself and what waits, and a failed alert is noted in it', () => inHome(async () => {
  const when = day(8, 17, 1);
  raise('Should the harbour map show tide times?', iso(day(8, 9)));
  const merged = makeEvent({ kind: 'self-merged', data: { pr: 12, commit: 'b'.repeat(40), reason: 'internal', title: 'Rename the tide table' }, now: () => day(8, 11) });
  keep(merged);
  const { ticker, asked } = setup({ clock: when, alert: { ok: true, sent: false, failed: ['ntfy'] } });
  const got = await ticker.tick();
  assert.equal(got.alert.sent, false);
  assert.deepEqual(asked, [{ project: P, count: 1 }]);
  const text = readDigest(P).text;
  assert.match(text, /Pull request #12: Rename the tide table/u);
  assert.match(text, /1\. Should the harbour map show tide times\?/u);
  assert.match(text, /A phone alert couldn't be sent through ntfy/u);
  assert.equal(readAlerts(P).failures.length, 1, 'kept until the director is shown the digest');
}));

test('an unshown digest replaced by the next keeps the weekly log and the failure note', () => inHome(async () => {
  raise('Should the harbour map show tide times?', iso(day(8, 9)));
  const { ticker, state } = setup({ clock: day(8, 17, 1), alert: { ok: true, sent: false, failed: ['ntfy'] } });
  await ticker.tick();
  assert.equal(readDigest(P).weekly, true);
  // No message from the director between the two digests.
  state.now = day(9, 17, 1);
  const second = (await ticker.tick()).digest;
  assert.equal(second.weekly, true, 'the log is carried on, though a week has not passed');
  const kept = readDigest(P);
  assert.equal(kept.weekly, true);
  assert.match(kept.text, /decision log/u);
  assert.match(kept.text, /A phone alert couldn't be sent through ntfy/u);
  assert.equal(kept.failures, 1);
  assert.equal(readAlerts(P).failures.length, 1, 'only showing the digest clears the failure');
}));

test('the log runs from the last one shown, so one made and never shown is not lost', () => inHome(async () => {
  const { ticker, state } = setup({ clock: day(1, 17, 1) });
  markSeen(P, { digestLogShownAt: day(1, 9) });
  keep(makeEvent({ kind: 'agent-call', data: { work: 'w-tide-1', at: iso(day(3, 9)), decided: 'Use a table', options: ['A table', 'A chart'], why: 'Reads on a phone', kind: 'structure' }, now: () => day(3, 9) }));
  state.now = day(9, 17, 1);
  await ticker.tick();
  assert.match(readDigest(P).text, /w-tide-1: Use a table/u, 'a call from before the last seven days is still in, since the last log was shown on day 1');
}));

test('a decision newly waiting brings one alert, and none is sent for a digest or for progress', () => inHome(async () => {
  const { ticker, state, asked } = setup({ clock: day(8, 10) });
  await ticker.tick();
  assert.deepEqual(asked, []);
  raise('Should the harbour map show tide times?', iso(day(8, 10, 5)));
  state.now = day(8, 10, 10);
  await ticker.tick();
  await ticker.tick();
  assert.deepEqual(asked, [{ project: P, count: 1 }]);
  state.now = day(8, 17, 5);
  await ticker.tick();
  assert.equal(asked.length, 1, 'the digest brings no alert');
}));

test('no channel set up: the decision waits, the digest still comes, and nothing is logged as a failure', () => inHome(async () => {
  raise('Should the harbour map show tide times?', iso(day(8, 9)));
  const { ticker, logged } = setup({ clock: day(8, 17, 1), alert: { ok: true, none: true } });
  const got = await ticker.tick();
  assert.equal(got.alert.none, true);
  assert.equal(got.digest.made, true);
  assert.deepEqual(logged, []);
  assert.deepEqual(readAlerts(P).failures, []);
}));

test('a helper that gives no answer is logged and the digest is still made', () => inHome(async () => {
  raise('Should the harbour map show tide times?', iso(day(8, 9)));
  const { ticker, logged } = setup({ clock: day(8, 17, 1), alert: () => null });
  const got = await ticker.tick();
  assert.equal(got.alert, null);
  assert.equal(got.digest.made, true);
  assert.match(logged[0], /A phone alert couldn't be sent: the helper gave no answer/u);
}));
