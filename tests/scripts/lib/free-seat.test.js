// tests/scripts/lib/free-seat.test.js
// Taking a free First Mate's seat for a front-desk session that holds none: taken when absent or free, left alone while
// another live session holds it, and no helper is asked when this session holds it already.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { takeSeatIfFree } from '../../../scripts/lib/free-seat.js';
import { readSeat, takeSeat, seatFile } from '../../../scripts/lib/first-mate-seat.js';
import { inHome } from '../../helpers/decisions-world.js';

const input = (session) => ({ session_id: session, cwd: '/work/product', hook_event_name: 'PreToolUse' });
function helper() {
  const asked = [];
  return { asked, client: { lock: { read: async (what) => { asked.push(what); return { ok: true, result: null }; } } } };
}

test('a front-desk session takes the seat when none exists', async () => {
  await inHome(async () => {
    const { client, asked } = helper();
    await takeSeatIfFree({ project: 'p', input: input('s1'), env: {}, now: () => new Date(), client });
    assert.equal(readSeat('p')?.session, 's1');
    assert.equal(asked.length, 1, 'the lock is read once');
  });
});

test('a session that holds the seat asks nothing of the helper', async () => {
  await inHome(async () => {
    await takeSeat('p', { session: 's1', folder: '/work/product' });
    const { client, asked } = helper();
    await takeSeatIfFree({ project: 'p', input: input('s1'), env: {}, now: () => new Date(), client });
    assert.equal(asked.length, 0);
    assert.equal(readSeat('p')?.session, 's1');
  });
});

test('a seat another live session holds is left alone, with no helper asked', async () => {
  await inHome(async () => {
    await takeSeat('p', { session: 'other', folder: '/work/product' });
    const { client, asked } = helper();
    await takeSeatIfFree({ project: 'p', input: input('s1'), env: {}, now: () => new Date(), client, free: async () => false });
    assert.equal(readSeat('p')?.session, 'other');
    assert.equal(asked.length, 0);
  });
});

test('a free seat another session left is taken', async () => {
  await inHome(async () => {
    // A seat with no process to follow, last seen three hours ago.
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    fs.mkdirSync(path.dirname(seatFile('p')), { recursive: true });
    fs.writeFileSync(seatFile('p'), JSON.stringify({ session: 'gone', pid: null, pidStart: null, folder: '/work/product', since: old, seenAt: old }));
    const { client } = helper();
    await takeSeatIfFree({ project: 'p', input: input('s1'), env: {}, now: () => new Date(), client });
    assert.equal(readSeat('p')?.session, 's1');
  });
});

test('a session a script started takes no seat', async () => {
  await inHome(async () => {
    const { client } = helper();
    await takeSeatIfFree({ project: 'p', input: input('s1'), env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' }, now: () => new Date(), client });
    assert.equal(readSeat('p'), null);
  });
});

test('another computer\'s live lock keeps the seat untaken', async () => {
  await inHome(async () => {
    const client = { lock: { read: async () => ({ ok: true, result: { computer: '0badf00d', counter: 1, lastWriteAt: new Date().toISOString() } }) } };
    await takeSeatIfFree({ project: 'p', input: input('s1'), env: {}, now: () => new Date(), client });
    assert.equal(readSeat('p'), null);
  });
});
