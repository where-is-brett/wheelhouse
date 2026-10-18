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
import { tempFolder } from '../../helpers/homes.js';

const T0 = new Date('2026-10-18T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const HOUR = 3600000;

function makeHome() {
  return path.join(tempFolder('wh-lk-'), 'Zoë home');
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

// Puts a lock.json with this text on the remote's lock branch, as another computer's push would.
async function plant(remote, text) {
  const scratch = tempFolder('wh-plant-');
  const id = ['-c', 'user.name=T', '-c', 'user.email=t@invalid'];
  try {
    await run('git', ['init', '-q'], { cwd: scratch });
    await run('git', ['symbolic-ref', 'HEAD', 'refs/heads/wheelhouse-lock'], { cwd: scratch });
    fs.writeFileSync(path.join(scratch, 'lock.json'), text);
    await run('git', ['add', '--', 'lock.json'], { cwd: scratch });
    await run('git', [...id, 'commit', '-q', '-m', 'plant'], { cwd: scratch });
    await run('git', ['push', '-q', '-f', remote.url, 'wheelhouse-lock'], { cwd: scratch });
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

test('an unreadable or malformed lock.json refuses the lock instead of counting it free', async () => {
  for (const text of ['{ not json', '', 'null', '[]', '"x"', '7']) {
    const remote = await makeBareRemote();
    try {
      const [a] = await setup(remote);
      await plant(remote, text);
      await as(a, async () => {
        await assert.rejects(takeLock({ project: 'o__p', push, now: at(5 * HOUR) }), /the lock can't be read/);
        assert.equal(await holdsLock({ project: 'o__p', counter: 1 }), false);
        const heads = await run('git', ['--git-dir', remote.url, 'log', '--format=%s', 'wheelhouse-lock']);
        assert.equal(heads.stdout.trim(), 'plant', 'nothing was pushed over it');
      });
    } finally { remote.cleanup(); }
  }
});

test('readLock checks the shape it returns', async () => {
  const good = { computer: 'aaaaaaaa', counter: 3, takenAt: '2026-10-18T01:00:00.000Z', lastWriteAt: '2026-10-18T01:00:00.000Z' };
  const bad = [
    { ...good, computer: 5 }, { ...good, computer: '' }, { ...good, counter: '3' }, { ...good, counter: 1.5 }, { ...good, counter: -1 }, { ...good, counter: 0 }, { ...good, takenAt: 'yesterday' },
    { ...good, takenAt: 1 }, { ...good, lastWriteAt: undefined }, { ...good, lastWriteAt: 'yesterday' }, {},
  ];
  for (const lock of bad) {
    const remote = await makeBareRemote();
    try {
      const [a] = await setup(remote);
      await plant(remote, JSON.stringify(lock));
      await as(a, async () => {
        await assert.rejects(readLock({ project: 'o__p' }), /the lock can't be read/, JSON.stringify(lock));
      });
    } finally { remote.cleanup(); }
  }
  const remote = await makeBareRemote();
  try {
    const [a] = await setup(remote);
    await plant(remote, JSON.stringify(good));
    await as(a, async () => assert.deepEqual(await readLock({ project: 'o__p' }), good));
  } finally { remote.cleanup(); }
});

test('the lock clone\'s remote must be the state clone\'s', async () => {
  const remote = await makeBareRemote();
  const other = await makeBareRemote();
  try {
    const [a] = await setup(remote);
    await as(a, async () => {
      assert.equal(await readLock({ project: 'o__p' }), null);
      const lockClone = path.join(a, 'projects', 'o__p', 'lock');
      await run('git', ['remote', 'set-url', 'origin', other.url], { cwd: lockClone });
      await assert.rejects(readLock({ project: 'o__p' }), /state clone/);
      await assert.rejects(takeLock({ project: 'o__p', push, now: at(0) }), /state clone/);
      assert.equal(await holdsLock({ project: 'o__p', counter: 1 }), false);
      // the same repository spelled another way is the same remote
      await run('git', ['remote', 'set-url', 'origin', `file://${remote.url}`], { cwd: lockClone });
      assert.equal(await readLock({ project: 'o__p' }), null);
    });
  } finally { remote.cleanup(); other.cleanup(); }
});

test('holdsLock makes one round trip to the host', async () => {
  const remote = await makeBareRemote();
  try {
    const [a] = await setup(remote);
    await as(a, async () => {
      await takeLock({ project: 'o__p', push, now: at(0) });
      const trips = async () => {
        const trace = path.join(a, 'trace.txt');
        fs.rmSync(trace, { force: true });
        await holdsLock({ project: 'o__p', counter: 1, env: { GIT_TRACE: trace } });
        const lines = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').split('\n') : [];
        return lines.filter((l) => /\bgit (fetch|ls-remote|pull|clone)\b/.test(l) && !/run_command|exec/.test(l)).length;
      };
      assert.equal(await trips(), 1);
      // and the same when the remote has no lock branch
      await run('git', ['--git-dir', remote.url, 'update-ref', '-d', 'refs/heads/wheelhouse-lock']);
      assert.equal(await trips(), 1);
    });
  } finally { remote.cleanup(); }
});
