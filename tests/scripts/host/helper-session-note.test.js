// tests/scripts/host/helper-session-note.test.js
// /session/note: a session's note, written by the helper beside the gauge's reading, whole and renamed.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

test('/session/note writes the note under the project\'s sessions folder, refuses an over-long or empty one, and waits out STOP', async () => {
  const home = shortHome();
  await as(home, async () => {
    const folder = path.join(tempFolder('wh-note-'), 'shop');
    fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
    writeProject('o__p', { folder, remoteUrl: 'https://example.test/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({}) });
    try {
      const client = helperClient({ address: helper.address });
      const dir = path.join(home, 'projects', 'o__p', 'sessions');
      const kept = await client.session.note({ cwd: folder, session: 'abc-123', text: 'Task: a\nDone: b\nNext: c\nOpen: none\n' });
      assert.equal(kept.ok, true, JSON.stringify(kept));
      assert.equal(kept.file, path.join(dir, 'abc-123.md'));
      assert.equal(fs.readFileSync(kept.file, 'utf8'), 'Task: a\nDone: b\nNext: c\nOpen: none\n');
      assert.deepEqual(fs.readdirSync(dir), ['abc-123.md'], 'no temporary file left');
      assert.equal((await client.session.note({ project: 'o__p', session: 'abc-123', text: 'x'.repeat(1200) })).ok, true);
      for (const body of [
        { session: 'abc-123', text: 'x'.repeat(1201) }, { session: 'abc-123', text: ' \n' }, { session: '../x', text: 'a' }, { session: undefined, text: 'a' },
      ]) {
        const refused = await client.session.note({ project: 'o__p', ...body });
        assert.notEqual(refused.ok, true);
        assert.equal(typeof refused.refused, 'string');
      }
      assert.equal(fs.readFileSync(path.join(dir, 'abc-123.md'), 'utf8'), `${'x'.repeat(1200)}\n`, 'a refused note leaves the last one');
      setStop({ by: 'prompt' });
      assert.notEqual((await client.session.note({ project: 'o__p', session: 'abc-123', text: 'a' })).ok, true);
    } finally {
      await helper.close();
    }
  });
});
