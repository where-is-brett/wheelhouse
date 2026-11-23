// tests/scripts/host/helper-session-seat.test.js
// /session/seat: whether a session holds the project's First Mate seat, read by the helper for the front desk's command.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { takeSeat, readSeat, seatFile } from '../../../scripts/lib/first-mate-seat.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { roleFile, recordRole } from '../../../scripts/lib/role.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

test('/session/seat says whether the session holds the seat, refuses a session with no id, and answers under STOP', async () => {
  const home = shortHome();
  await as(home, async () => {
    const folder = path.join(tempFolder('wh-seat-'), 'shop');
    fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
    writeProject('o__p', { folder, remoteUrl: 'https://example.test/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({}) });
    try {
      const client = helperClient({ address: helper.address });
      assert.deepEqual(await client.session.seat({ cwd: folder, session: 'a' }), { ok: true, holds: false }, 'no seat file: held by no one');
      const table = [{ pid: 10, ppid: 1, command: 'claude' }, { pid: 20, ppid: 10, command: 'node hook.js' }];
      const taken = await takeSeat('o__p', { session: 'b', folder }, { alive: () => true, startTime: async () => 'T1', ancestor: { pid: 20, table } });
      assert.equal(taken.held, true);
      assert.deepEqual(await client.session.seat({ cwd: folder, session: 'b' }), { ok: true, holds: true });
      assert.deepEqual(await client.session.seat({ cwd: folder, session: 'a' }), { ok: true, holds: false });
      for (const session of [undefined, '']) assert.notEqual((await client.session.seat({ project: 'o__p', session })).ok, true);
      setStop({ by: 'prompt' });
      assert.deepEqual(await client.session.seat({ project: 'o__p', session: 'b' }), { ok: true, holds: true }, 'a read under STOP');
    } finally {
      await helper.close();
    }
  });
});

// A project in a temporary folder and a helper, for the seat's refresh and take.
async function withSeatHelper(fn, { host = 'local' } = {}) {
  const home = shortHome();
  await as(home, async () => {
    const folder = path.join(tempFolder('wh-seat-'), 'shop');
    fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
    writeProject('o__p', host === 'local' ? { folder, remoteUrl: null, host: 'local', repo: 'local/o__p', connection: { mode: 'none' } } : { folder, remoteUrl: 'https://example.test/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({}) });
    try {
      await fn({ client: helperClient({ address: helper.address }), folder: fs.realpathSync.native(folder) });
    } finally {
      await helper.close();
    }
  });
}
const putSeat = (over = {}) => {
  const file = seatFile('o__p');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const long = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify({ session: 'a', pid: process.pid, pidStart: null, folder: '/x', since: long, seenAt: long, ...over }));
};

test('/session/seat keeps the holder\'s seat fresh at most once a minute, and another session\'s ask doesn\'t', async () => {
  await withSeatHelper(async ({ client, folder }) => {
    putSeat();
    const stale = readSeat('o__p').seenAt;
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'b' }), { ok: true, holds: false });
    assert.equal(readSeat('o__p').seenAt, stale, 'another session\'s ask changes nothing');
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'a' }), { ok: true, holds: true });
    const fresh = readSeat('o__p').seenAt;
    assert.ok(Date.parse(fresh) > Date.parse(stale), 'the holder\'s ask refreshes it');
    await client.session.seat({ cwd: folder, session: 'a' });
    assert.equal(readSeat('o__p').seenAt, fresh, 'not again within a minute');
  });
});

test('/session/seat with take takes a free seat for the session, with no process, and not one another live window holds', async () => {
  await withSeatHelper(async ({ client, folder }) => {
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'chat-1', take: true }), { ok: true, holds: true }, 'no seat file');
    const seat = readSeat('o__p');
    assert.deepEqual([seat.session, seat.pid, seat.pidStart], ['chat-1', null, null]);
    putSeat();
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'chat-2', take: true }), { ok: true, holds: false }, 'held by a live window');
    assert.equal(readSeat('o__p').session, 'a');
    putSeat({ pid: 999999 });
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'chat-2', take: true }), { ok: true, holds: true }, 'its window is gone');
    // A seat with no process is free after it has sat idle two hours, and not before.
    putSeat({ session: 'chat-3', pid: null, seenAt: new Date(Date.now() - 3 * 3600000).toISOString() });
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'chat-2', take: true }), { ok: true, holds: true });
  });
});

test('/session/seat with take takes nothing from a worktree or for a session id a seat can\'t name', async () => {
  await withSeatHelper(async ({ client, folder }) => {
    const tree = path.join(folder, 'tree');
    const gitdir = path.join(folder, '.git', 'worktrees', 'tree');
    fs.mkdirSync(tree, { recursive: true });
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${gitdir}\n`);
    fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/feature/side\n');
    assert.deepEqual(await client.session.seat({ cwd: tree, session: 'chat-1', take: true }), { ok: true, holds: false });
    assert.equal(readSeat('o__p'), null);
    assert.notEqual((await client.session.seat({ cwd: folder, session: 'has space', take: true })).ok, true);
    assert.equal(readSeat('o__p'), null);
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'chat-1', take: true }), { ok: true, holds: true });
  });
});

test('/session/seat takes a free or absent seat for a front-desk chat in the main folder, and a held seat still needs the click', async () => {
  await withSeatHelper(async ({ client, folder }) => {
    // The setup chat that never got a seat.
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'setup-chat' }), { ok: true, holds: true });
    const seat = readSeat('o__p');
    assert.deepEqual([seat.session, seat.pid, seat.pidStart], ['setup-chat', null, null]);
    // A held seat is left alone.
    putSeat();
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'chat-2' }), { ok: true, holds: false });
    assert.equal(readSeat('o__p').session, 'a');
    // A holder that ended after the chat started.
    putSeat({ pid: 999999 });
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'chat-2' }), { ok: true, holds: true });
    assert.equal(readSeat('o__p').session, 'chat-2');
  });
});

test('/session/seat takes nothing for an aside chat, a worktree or an id a seat can\'t name', async () => {
  await withSeatHelper(async ({ client, folder }) => {
    // A role recorded as aside.
    assert.equal(recordRole('side-chat', 'aside'), true);
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'side-chat' }), { ok: true, holds: false });
    assert.equal(readSeat('o__p'), null);
    // A worktree.
    const tree = path.join(folder, 'tree');
    const gitdir = path.join(folder, '.git', 'worktrees', 'tree');
    fs.mkdirSync(tree, { recursive: true });
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${gitdir}\n`);
    fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/feature/side\n');
    assert.deepEqual(await client.session.seat({ cwd: tree, session: 'chat-1' }), { ok: true, holds: false });
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'has space' }), { ok: true, holds: false });
    assert.equal(readSeat('o__p'), null);
  });
});

test('/session/seat with aside records the choice, gives up a seat the session holds, and the session then takes nothing', async () => {
  await withSeatHelper(async ({ client, folder }) => {
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'chat-1' }), { ok: true, holds: true });
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'chat-1', aside: true }), { ok: true, holds: false });
    assert.equal(readSeat('o__p'), null);
    assert.equal(JSON.parse(fs.readFileSync(roleFile('chat-1'), 'utf8')).role, 'aside');
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'chat-1' }), { ok: true, holds: false }, 'a free seat, and the chat is an aside');
    assert.equal(readSeat('o__p'), null);
    assert.notEqual((await client.session.seat({ cwd: folder, session: 'has space', aside: true })).ok, true);
  });
});

test('/session/seat takes nothing when the project\'s lock can\'t be read', async () => {
  await withSeatHelper(async ({ client, folder }) => {
    assert.deepEqual(await client.session.seat({ cwd: folder, session: 'chat-1' }), { ok: true, holds: false });
    assert.equal(readSeat('o__p'), null);
  }, { host: 'github' });
});
