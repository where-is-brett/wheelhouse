// tests/scripts/lib/first-mate-seat.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RECENT_MS, STALE_AFTER_MS, SEEN_EVERY_MS,
  seatFile, readSeat, firstMatePid, seatInUse, takeSeat, holdsSeat, refreshSeat, handOverSeat, releaseSeat,
} from '../../../scripts/lib/first-mate-seat.js';

const T0 = new Date('2026-11-08T10:00:00Z');
const at = (ms) => new Date(T0.getTime() + ms);
const table = [{ pid: 10, ppid: 1, command: 'claude' }, { pid: 20, ppid: 10, command: 'node hook.js' }];

// Options with a temporary home, a process table with one Claude Code process, and a clock the test moves.
function setup(extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-seat-'));
  const clock = { t: T0 };
  const options = {
    home,
    alive: () => true,
    startTime: async () => 'T1',
    ancestor: { pid: 20, table },
    now: () => clock.t,
    ...extra,
  };
  return { home, clock, options, done: () => fs.rmSync(home, { recursive: true, force: true }) };
}
const file = (home, project = 'p') => seatFile(project, { home });
const take = (project, session, options) => takeSeat(project, { session, folder: `/work/${session}` }, options);

test('the constants are the spec\'s', () => {
  assert.equal(RECENT_MS, 30 * 60 * 1000);
  assert.equal(STALE_AFTER_MS, 2 * 60 * 60 * 1000);
  assert.equal(SEEN_EVERY_MS, 60 * 1000);
});

test('takes a free seat', async () => {
  const s = setup();
  try {
    const got = await take('p', 'a', s.options);
    assert.equal(got.held, true);
    assert.equal(readSeat('p', s.options).session, 'a');
    assert.equal(file(s.home), path.join(s.home, 'projects', 'p', 'first-mate.json'));
    assert.equal(got.seat.pid, 10);
    assert.equal(got.seat.pidStart, 'T1');
  } finally { s.done(); }
});

test('two takers at once: one wins', async () => {
  for (let round = 0; round < 50; round += 1) {
    const s = setup();
    try {
      const [a, b] = await Promise.all([take('p', 'a', s.options), take('p', 'b', s.options)]);
      assert.equal([a, b].filter((r) => r.held).length, 1, `round ${round}`);
      const winner = a.held ? 'a' : 'b';
      assert.equal(readSeat('p', s.options).session, winner);
      assert.equal(a.seat.session, winner);
      assert.equal(b.seat.session, winner);
    } finally { s.done(); }
  }
});

test('two takers at once over a dead holder: one wins', async () => {
  for (let round = 0; round < 25; round += 1) {
    const s = setup();
    try {
      await take('p', 'old', { ...s.options, ancestor: { pid: 31, table: [{ pid: 30, ppid: 1, command: 'claude' }, { pid: 31, ppid: 30, command: 'node' }] } });
      const dead = { ...s.options, alive: (pid) => pid !== 30 }; // only the old holder's process has gone
      const [a, b] = await Promise.all([take('p', 'a', dead), take('p', 'b', dead)]);
      assert.equal([a, b].filter((r) => r.held).length, 1, `round ${round}`);
      assert.equal(readSeat('p', s.options).session, a.held ? 'a' : 'b');
    } finally { s.done(); }
  }
});

test('a live holder keeps the seat', async () => {
  const s = setup();
  try {
    await take('p', 'a', s.options);
    const got = await take('p', 'b', s.options);
    assert.equal(got.held, false);
    assert.equal(got.seat.session, 'a');
    assert.equal(readSeat('p', s.options).session, 'a');
  } finally { s.done(); }
});

test('the holder asking again still holds it', async () => {
  const s = setup();
  try {
    await take('p', 'a', s.options);
    const got = await take('p', 'a', s.options);
    assert.equal(got.held, true);
    assert.equal(holdsSeat('p', 'a', s.options), true);
    assert.equal(holdsSeat('p', 'b', s.options), false);
  } finally { s.done(); }
});

test('a dead holder frees the seat', async () => {
  const s = setup();
  try {
    await take('p', 'a', s.options);
    const got = await take('p', 'b', { ...s.options, alive: () => false });
    assert.equal(got.held, true);
    assert.equal(readSeat('p', s.options).session, 'b');
  } finally { s.done(); }
});

test('a reused pid frees the seat', async () => {
  const s = setup();
  try {
    await take('p', 'a', s.options);
    const got = await take('p', 'b', { ...s.options, startTime: async () => 'T2' });
    assert.equal(got.held, true);
  } finally { s.done(); }
});

test('no pid frees after two hours', async () => {
  const s = setup({ ancestor: { pid: 20, table: [] } });
  try {
    await take('p', 'a', s.options);
    assert.equal(readSeat('p', s.options).pid, null);
    s.clock.t = at(STALE_AFTER_MS - 60 * 1000 + 0); // 1 hour 59 minutes
    assert.equal((await take('p', 'b', s.options)).held, false);
    s.clock.t = at(STALE_AFTER_MS + 1000);
    assert.equal((await take('p', 'b', s.options)).held, true);
  } finally { s.done(); }
});

test('in use for thirty minutes', async () => {
  const s = setup();
  try {
    const { seat } = await take('p', 'a', s.options);
    assert.equal(seatInUse(seat, { ...s.options, now: () => at(29 * 60 * 1000) }), true);
    assert.equal(seatInUse(seat, { ...s.options, now: () => at(31 * 60 * 1000) }), false);
  } finally { s.done(); }
});

test('a corrupt or empty file is taken over', async () => {
  const s = setup();
  try {
    fs.mkdirSync(path.dirname(file(s.home)), { recursive: true });
    for (const content of ['{', '', '{"session":"x"}']) {
      fs.writeFileSync(file(s.home), content);
      assert.equal(readSeat('p', s.options), null);
      assert.equal((await take('p', 'a', s.options)).held, true, JSON.stringify(content));
      fs.rmSync(file(s.home));
    }
  } finally { s.done(); }
});

test('a stale hand-over is refused and names the holder', async () => {
  const s = setup();
  try {
    const { seat: first } = await take('p', 'a', s.options);
    s.clock.t = at(1000);
    await takeSeatAway('p', 'c', s);
    const got = await handOverSeat('p', { session: 'b', folder: '/work/b', from: { session: 'a', since: first.since } }, s.options);
    assert.equal(got.moved, false);
    assert.equal(got.seat.session, 'c');
    assert.equal(readSeat('p', s.options).session, 'c');
  } finally { s.done(); }
});

// 'c' takes the seat from 'a' as a take-over would have, with 'a' gone.
async function takeSeatAway(project, session, s) {
  const got = await take(project, session, { ...s.options, alive: () => false });
  assert.equal(got.held, true);
}

test('a hand-over moves the seat', async () => {
  const s = setup();
  try {
    const { seat: first } = await take('p', 'a', s.options);
    s.clock.t = at(5000);
    const got = await handOverSeat('p', { session: 'b', folder: '/work/b', from: { session: 'a', since: first.since } }, s.options);
    assert.equal(got.moved, true);
    assert.equal(got.seat.session, 'b');
    assert.equal(readSeat('p', s.options).session, 'b');
    assert.equal(readSeat('p', s.options).folder, '/work/b');
  } finally { s.done(); }
});

test('seenAt is written at most once a minute', async () => {
  const s = setup();
  try {
    await take('p', 'a', s.options);
    const seen = () => readSeat('p', s.options).seenAt;
    const first = seen();
    s.clock.t = at(30 * 1000);
    refreshSeat('p', 'a', s.options);
    assert.equal(seen(), first);
    s.clock.t = at(61 * 1000);
    refreshSeat('p', 'a', s.options);
    assert.equal(seen(), at(61 * 1000).toISOString());
    s.clock.t = at(91 * 1000);
    refreshSeat('p', 'a', s.options);
    assert.equal(seen(), at(61 * 1000).toISOString());
    s.clock.t = at(125 * 1000);
    refreshSeat('p', 'b', s.options); // not the holder: nothing written
    assert.equal(seen(), at(61 * 1000).toISOString());
  } finally { s.done(); }
});

test('refresh and release never throw when there is no seat', () => {
  const s = setup();
  try {
    refreshSeat('p', 'a', s.options);
    releaseSeat('p', 'a', s.options);
    assert.equal(readSeat('p', s.options), null);
  } finally { s.done(); }
});

test('release removes only this session\'s seat', async () => {
  const s = setup();
  try {
    await take('p', 'a', s.options);
    releaseSeat('p', 'b', s.options);
    assert.equal(readSeat('p', s.options).session, 'a');
    releaseSeat('p', 'a', s.options);
    assert.equal(readSeat('p', s.options), null);
  } finally { s.done(); }
});

test('works the same for a local project', async () => {
  const s = setup();
  try {
    const project = 'local-one';
    fs.mkdirSync(path.join(s.home, 'projects', project), { recursive: true });
    fs.writeFileSync(path.join(s.home, 'projects', project, 'project.json'), JSON.stringify({ host: 'local' }));
    assert.equal((await take(project, 'a', s.options)).held, true);
    assert.equal((await take(project, 'b', { ...s.options, alive: () => false })).held, true);
    assert.equal(readSeat(project, s.options).session, 'b');
  } finally { s.done(); }
});

test('the nearest Claude Code ancestor', async () => {
  const got = await firstMatePid({ ancestor: { pid: 20, table }, startTime: async (pid) => `start-${pid}` });
  assert.deepEqual(got, { pid: 10, pidStart: 'start-10' });
  const none = await firstMatePid({ ancestor: { pid: 20, table: [] }, startTime: async () => 'x' });
  assert.deepEqual(none, { pid: null, pidStart: null });
  const nested = [
    { pid: 5, ppid: 1, command: '/usr/local/bin/claude --resume' },
    { pid: 6, ppid: 5, command: 'claude' },
    { pid: 7, ppid: 6, command: 'bash' },
  ];
  assert.equal((await firstMatePid({ ancestor: { pid: 7, table: nested }, startTime: async () => 'x' })).pid, 6);
});

test('a cycle in the process table ends the search', async () => {
  const loop = [{ pid: 1, ppid: 2, command: 'a' }, { pid: 2, ppid: 1, command: 'b' }];
  assert.equal((await firstMatePid({ ancestor: { pid: 1, table: loop }, startTime: async () => 'x' })).pid, null);
});
