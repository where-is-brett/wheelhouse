// tests/scripts/state/lock.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLock, takeLock, touchLock, holdsLock, heldCounter } from '../../../scripts/state/lock.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { run } from '../../../scripts/lib/run.js';
import { makeBareRemote, push } from '../../helpers/git-fixture.js';

const T0 = new Date('2026-10-18T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const HOUR = 3600000;

function makeHome() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-lk-')), 'Zoë home');
}
async function as(home, fn) {
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try { return await fn(); } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
  }
}
async function setup(remote) {
  const homes = [makeHome(), makeHome()];
  for (const h of homes) await as(h, () => cloneState({ project: 'o__p', remoteUrl: remote.url }));
  return homes;
}
const idOf = (h) => JSON.parse(fs.readFileSync(path.join(h, 'computer.json'), 'utf8')).id;

test('the first computer takes the lock with counter 1', async () => {
  const remote = await makeBareRemote();
  try {
    const [a] = await setup(remote);
    await as(a, async () => {
      assert.equal(await readLock({ project: 'o__p' }), null);
      const r = await takeLock({ project: 'o__p', push, now: at(0) });
      assert.deepEqual(r, { taken: true, counter: 1 });
      const lock = await readLock({ project: 'o__p' });
      assert.equal(lock.counter, 1);
      assert.equal(lock.takenAt, '2026-10-18T01:00:00.000Z');
      assert.equal(heldCounter({ project: 'o__p' }), 1);
      assert.equal(await holdsLock({ project: 'o__p', counter: 1 }), true);
      assert.equal(await holdsLock({ project: 'o__p', counter: 2 }), false);
      // the same computer may take its own lock again
      assert.deepEqual(await takeLock({ project: 'o__p', push, now: at(1000) }), { taken: true, counter: 2 });
    });
  } finally { remote.cleanup(); }
});

test('a second computer is refused while the lock is fresh, and told who holds it', async () => {
  const remote = await makeBareRemote();
  try {
    const [a, b] = await setup(remote);
    await as(a, () => takeLock({ project: 'o__p', push, now: at(0) }));
    const holder = idOf(a);
    await as(b, async () => {
      const r = await takeLock({ project: 'o__p', push, now: at(2 * HOUR - 1) });
      assert.deepEqual(r, { taken: false, holder, since: '2026-10-18T01:00:00.000Z' });
      assert.equal(heldCounter({ project: 'o__p' }), null);
    });
  } finally { remote.cleanup(); }
});

test('a lock with no write for two hours can be taken over, and the counter rises', async () => {
  const remote = await makeBareRemote();
  try {
    const [a, b] = await setup(remote);
    await as(a, () => takeLock({ project: 'o__p', push, now: at(0) }));
    await as(b, async () => {
      assert.deepEqual(await takeLock({ project: 'o__p', push, now: at(2 * HOUR) }), { taken: true, counter: 2 });
      assert.equal(heldCounter({ project: 'o__p' }), 2);
    });
  } finally { remote.cleanup(); }
});

test('when two computers take a free lock at once, exactly one wins', async () => {
  const remote = await makeBareRemote();
  try {
    const [a, b] = await setup(remote);
    let bResult;
    // A has read the free lock; B takes it before A's push lands.
    const racingPush = async (dir, branch) => {
      bResult = await as(b, () => takeLock({ project: 'o__p', push, now: at(0) }));
      return push(dir, branch);
    };
    const aResult = await as(a, () => takeLock({ project: 'o__p', push: racingPush, now: at(0) }));
    assert.equal(bResult.taken, true);
    assert.equal(aResult.taken, false);
    assert.equal(aResult.holder, idOf(b));
    await as(a, async () => {
      assert.equal(heldCounter({ project: 'o__p' }), null);
      const status = await run('git', ['status', '-sb'], { cwd: path.join(a, 'projects', 'o__p', 'lock') });
      assert.doesNotMatch(status.stdout, /ahead/);
    });
  } finally { remote.cleanup(); }
});

test('any push failure other than non-fast-forward throws a plain error', async () => {
  const remote = await makeBareRemote();
  try {
    const [a] = await setup(remote);
    await as(a, async () => {
      await assert.rejects(takeLock({ project: 'o__p', push: async () => ({ ok: false, rejected: 'other' }), now: at(0) }), /could not be pushed/);
      assert.equal(await readLock({ project: 'o__p' }), null);
    });
  } finally { remote.cleanup(); }
});

test('touchLock updates lastWriteAt only for the holder', async () => {
  const remote = await makeBareRemote();
  try {
    const [a, b] = await setup(remote);
    await as(a, async () => {
      await takeLock({ project: 'o__p', push, now: at(0) });
      assert.deepEqual(await touchLock({ project: 'o__p', push, now: at(HOUR) }), { touched: true });
      assert.equal((await readLock({ project: 'o__p' })).lastWriteAt, '2026-10-18T02:00:00.000Z');
    });
    await as(b, async () => {
      assert.deepEqual(await touchLock({ project: 'o__p', push, now: at(HOUR) }), { touched: false });
    });
  } finally { remote.cleanup(); }
});

test('holdsLock is false for a computer that lost the lock while asleep', async () => {
  const remote = await makeBareRemote();
  try {
    const [a, b] = await setup(remote);
    await as(a, () => takeLock({ project: 'o__p', push, now: at(0) }));
    await as(b, () => takeLock({ project: 'o__p', push, now: at(3 * HOUR) }));
    await as(a, async () => {
      assert.equal(await holdsLock({ project: 'o__p', counter: 1 }), false);
      assert.equal(heldCounter({ project: 'o__p' }), null);
      assert.deepEqual(await touchLock({ project: 'o__p', push, now: at(3 * HOUR) }), { touched: false });
    });
    await as(b, async () => assert.equal(await holdsLock({ project: 'o__p', counter: 2 }), true));
  } finally { remote.cleanup(); }
});

test('holdsLock fails closed when the remote cannot be reached', async () => {
  const remote = await makeBareRemote();
  const [a] = await setup(remote);
  await as(a, () => takeLock({ project: 'o__p', push, now: at(0) }));
  remote.cleanup();
  await as(a, async () => assert.equal(await holdsLock({ project: 'o__p', counter: 1 }), false));
});
