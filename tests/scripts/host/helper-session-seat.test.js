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
import { takeSeat } from '../../../scripts/lib/first-mate-seat.js';
import { setStop } from '../../../scripts/lib/stop.js';
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
