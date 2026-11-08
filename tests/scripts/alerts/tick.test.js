// tests/scripts/alerts/tick.test.js
// The watcher's side of the phone alert: one alert per newly waiting decision, never for progress, held and unsent alerts asked
// again, failures kept for the digest. Made-up project: harbour-demo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertTick, readAlerts, takeFailures, newlyWaiting } from '../../../scripts/alerts/tick.js';
import { withHome } from '../../helpers/homes.js';

const D1 = { id: 'card-1', n: 1, question: 'Should the harbour map show tide times?', work: 'w-tide-1' };
const D2 = { id: 'card-2', n: 2, question: 'Which harbour comes first?', work: 'w-tide-2' };
const NOW = () => new Date('2026-11-08T12:00:00.000Z');

const helper = (answer = { ok: true, sent: true, failed: [] }) => {
  const calls = [];
  return { calls, alert: async (body) => { calls.push(body); return typeof answer === 'function' ? answer(calls.length) : answer; } };
};

test('one alert per newly waiting decision, never for progress', () => withHome(async () => {
  const client = helper();
  const tick = (pending) => alertTick({ project: 'harbour-demo', pending, client, now: NOW });
  assert.deepEqual(await tick([]), { asked: false });
  assert.deepEqual(await tick([D1]), { asked: true, sent: true, failed: [] });
  assert.deepEqual(client.calls, [{ project: 'harbour-demo', count: 1 }]);
  // The same decision on the next tick: nothing more, however long it waits.
  assert.deepEqual(await tick([D1]), { asked: false });
  assert.equal(client.calls.length, 1);
  // A second one is new: one alert, saying how many wait now.
  await tick([D1, D2]);
  assert.deepEqual(client.calls.at(-1), { project: 'harbour-demo', count: 2 });
  // Answering one is not an alert; neither is nothing happening.
  assert.deepEqual(await tick([D2]), { asked: false });
  assert.deepEqual(await tick([D2]), { asked: false });
  assert.equal(client.calls.length, 2);
  assert.deepEqual(readAlerts('harbour-demo').ids, ['card-2'], 'a decision answered is forgotten');
}));

test('an alert held by the quiet hours, or with no channel, is asked again until it can be sent', () => withHome(async () => {
  const quiet = helper({ ok: true, held: true });
  const tick = (client, pending = [D1]) => alertTick({ project: 'harbour-demo', pending, client, now: NOW });
  assert.deepEqual(await tick(quiet), { asked: true, held: true });
  assert.deepEqual(await tick(quiet), { asked: true, held: true });
  assert.equal(quiet.calls.length, 2);
  const none = helper({ ok: true, none: true });
  assert.deepEqual(await tick(none), { asked: true, none: true });
  assert.deepEqual(readAlerts('harbour-demo').ids, [], 'not marked, so a channel set up later still says it waits');
  const open = helper();
  assert.equal((await tick(open)).sent, true);
  assert.equal((await tick(open)).asked, false);
}));

test('a channel that failed twice is noted for the digest, once, and the decision is not alerted again', () => withHome(async () => {
  const client = helper({ ok: true, sent: false, failed: ['ntfy'] });
  const got = await alertTick({ project: 'harbour-demo', pending: [D1], client, now: NOW });
  assert.deepEqual(got, { asked: true, sent: false, failed: ['ntfy'] });
  assert.equal((await alertTick({ project: 'harbour-demo', pending: [D1], client, now: NOW })).asked, false);
  assert.deepEqual(takeFailures('harbour-demo'), [{ at: '2026-11-08T12:00:00.000Z', channels: ['ntfy'] }]);
  assert.deepEqual(takeFailures('harbour-demo'), [], 'said once');
}));

test('a helper that gives no answer leaves the decision unmarked and the failure to the caller', () => withHome(async () => {
  const client = helper(null);
  await assert.rejects(alertTick({ project: 'harbour-demo', pending: [D1], client, now: NOW }), /the helper gave no answer/);
  const refused = helper({ ok: false, refused: 'the alert needs a count' });
  await assert.rejects(alertTick({ project: 'harbour-demo', pending: [D1], client: refused, now: NOW }), /the alert needs a count/);
  assert.deepEqual(readAlerts('harbour-demo').ids, []);
  assert.deepEqual(newlyWaiting([D1, D2, { n: 3 }], ['card-1']), [D2]);
}));
