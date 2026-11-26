// tests/scripts/watcher/foreman-away.test.js
// When Desktop is closed (builders and settings design, section 7.5): `foreman-away` is recorded once for each away spell, the
// phone notice goes at most once a day, and nothing here starts anything.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { watchForeman, AWAY_STATE, awayFile } from '../../../scripts/watcher/foreman-away.js';
import { checkIn } from '../../../scripts/foreman/check-in.js';
import { claimWakes, queueWake } from '../../../scripts/watcher/desktop-queue.js';
import { writeWake } from '../../../scripts/watcher/waker.js';
import { withHome } from '../../helpers/homes.js';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { P, T0, project } from '../../helpers/foreman.js';

const hostStandIns = standInTools();
after(() => hostStandIns.restore());

const MIN = 60 * 1000;
const at = (ms) => () => new Date(T0 + ms);
const wakeAt = (ms) => queueWake(P, { kind: 'foreman', file: writeWake(P, { to: 'foreman', events: [], digest: [], dropped: 0 }, { now: at(ms) }), now: at(ms) });

function tools() {
  const seen = { records: [], notices: [] };
  return {
    seen,
    raise: async (r) => { seen.records.push(r); },
    notify: async (n) => { seen.notices.push(n); return { sent: true }; },
  };
}

test('a wake waiting while the check-in is over 3 minutes old records foreman-away once for the spell, and sends one notice', () => withHome(async () => {
  await project();
  wakeAt(0);
  checkIn(P, { sessionId: 'foreman-0001', now: at(0) });
  const t = tools();
  const tick = (ms) => watchForeman(P, { now: at(ms), ...t });
  assert.deepEqual(await tick(2 * MIN), { away: false });
  assert.equal(t.seen.records.length, 0, 'a check-in under 3 minutes old is not away');
  const first = await tick(4 * MIN);
  assert.equal(first.away, true);
  assert.equal(t.seen.records.length, 1);
  assert.equal(t.seen.records[0].kind, 'note');
  assert.match(t.seen.records[0].data.words, /^Claude Desktop isn't running the foreman: 1 wake waits/);
  assert.equal(t.seen.notices.length, 1);
  await tick(5 * MIN);
  await tick(60 * MIN);
  assert.equal(t.seen.records.length, 1, 'recorded once for the spell');
  assert.equal(t.seen.notices.length, 1, 'noticed once');
  assert.equal(JSON.parse(fs.readFileSync(awayFile(P), 'utf8')).since !== undefined, true);
}));

test('a new spell is recorded again, but the notice waits until a day has passed since the last', () => withHome(async () => {
  await project();
  wakeAt(0);
  checkIn(P, { sessionId: 'foreman-0001', now: at(0) });
  const t = tools();
  const tick = (ms) => watchForeman(P, { now: at(ms), ...t });
  await tick(4 * MIN);
  // The foreman comes back and the queue empties: the spell ends.
  checkIn(P, { sessionId: 'foreman-0002', now: at(10 * MIN) });
  const { takeWakes, dropWakes } = await import('../../../scripts/watcher/desktop-queue.js');
  dropWakes(P, takeWakes(P).map((w) => w.path));
  assert.equal((await tick(11 * MIN)).away, false);
  // Away again, an hour later.
  wakeAt(70 * MIN);
  await tick(75 * MIN);
  assert.equal(t.seen.records.length, 2, 'a second spell is recorded');
  assert.equal(t.seen.notices.length, 1, 'no second notice inside a day');
  // And more than a day on, another spell may notice again.
  checkIn(P, { sessionId: 'foreman-0002', now: at(80 * MIN) });
  dropWakes(P, takeWakes(P).map((w) => w.path));
  await tick(81 * MIN);
  wakeAt(25 * 60 * MIN);
  await tick(25 * 60 * MIN + 5 * MIN);
  assert.equal(t.seen.records.length, 3);
  assert.equal(t.seen.notices.length, 2);
}));

test('a notice held by quiet hours or with no channel is not counted as sent, and asked again later', () => withHome(async () => {
  await project();
  wakeAt(0);
  const t = tools();
  let answers = [{ held: true }, { none: true }, { sent: true }];
  const notify = async () => { t.seen.notices.push(1); return answers.shift() ?? { sent: true }; };
  const tick = (ms) => watchForeman(P, { now: at(ms), raise: t.raise, notify });
  await tick(4 * MIN);
  assert.equal(t.seen.notices.length, 1);
  await tick(5 * MIN);
  assert.equal(t.seen.notices.length, 1, 'not asked every tick');
  await tick(15 * MIN);
  assert.equal(t.seen.notices.length, 2);
  await tick(30 * MIN);
  assert.equal(t.seen.notices.length, 3);
  await tick(60 * MIN);
  await tick(120 * MIN);
  assert.equal(t.seen.notices.length, 3, 'sent: no more that day');
  assert.equal(t.seen.records.length, 1);
}));

test('a record that fails is tried again next tick, and a notice that throws does not stop the watcher', () => withHome(async () => {
  await project();
  wakeAt(0);
  let fails = true;
  const seen = [];
  const deps = { raise: async (r) => { if (fails) throw new Error('no helper'); seen.push(r); }, notify: async () => { throw new Error('offline'); } };
  const errors = [];
  const tick = (ms) => watchForeman(P, { now: at(ms), onError: (m) => errors.push(m), ...deps });
  await tick(4 * MIN);
  assert.equal(seen.length, 0);
  fails = false;
  await tick(5 * MIN);
  assert.equal(seen.length, 1);
  assert.ok(errors.length >= 1);
}));

test('no check-in ever: the wake must itself be over 3 minutes old; with nothing waiting nothing is recorded', () => withHome(async () => {
  await project();
  const t = tools();
  assert.equal((await watchForeman(P, { now: at(10 * MIN), ...t })).away, false);
  wakeAt(10 * MIN);
  assert.equal((await watchForeman(P, { now: at(11 * MIN), ...t })).away, false);
  assert.equal((await watchForeman(P, { now: at(14 * MIN), ...t })).away, true);
  assert.equal(AWAY_STATE, 'foreman-away');
}));

test('a foreman handling wakes it took is not away while its claim is fresh, though its heartbeat is old and a new wake waits', () => withHome(async () => {
  await project();
  checkIn(P, { sessionId: 'foreman-0001', now: at(0) });
  wakeAt(0);
  assert.equal(claimWakes(P, { now: at(1 * MIN) }).length, 1, 'the foreman took the wake');
  wakeAt(2 * MIN);
  const t = tools();
  assert.deepEqual(await watchForeman(P, { now: at(6 * MIN), ...t }), { away: false });
  assert.equal(t.seen.records.length + t.seen.notices.length, 0);
  // A claim left stale (the foreman ended mid-way) no longer shows it there.
  assert.equal((await watchForeman(P, { now: at(12 * MIN), ...t })).away, true);
  assert.equal(t.seen.records.length, 1);
}));
