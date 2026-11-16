// tests/scripts/host/helper-own-files.test.js
// The helper's look at Wheelhouse's own files, as /health gives it: an answer kept from before the baseline was made afresh
// (setup does so at its health check) is never shown again, so setup's own changes aren't reported as someone else's.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { acceptOwnFiles, ownFilesFile } from '../../../scripts/health/own-files.js';
import { ROOT as OWN_ROOT } from '../../../scripts/lineage/check.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';

const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const health = (address) => helperClient({ address }).health();

test('a baseline made afresh drops the look\'s kept answer at once', async () => {
  const home = shortHome();
  await as(home, async () => {
    const guarded = path.join(wheelhouseHome(), 'engine', 'copilot', 'home', 'settings.json');
    fs.mkdirSync(path.dirname(guarded), { recursive: true });
    fs.writeFileSync(guarded, '{"a":1}\n');
    let clock = Date.parse('2026-11-17T01:00:00.000Z');
    const where = { root: OWN_ROOT, projects: [], claudeHome: path.join(wheelhouseHome(), 'no-claude-home') };
    acceptOwnFiles({ ...where, now: () => new Date(clock) });
    fs.writeFileSync(guarded, '{"a":2}\n');
    clock += 2 * 24 * 60 * 60 * 1000; // past the day a look's answer is kept in the baseline file
    const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({}), now: () => new Date(clock) });
    try {
      const seen = async (want) => {
        for (let n = 0; n < 200; n += 1) {
          const got = await health(helper.address);
          if (want(got)) return got;
          await new Promise((r) => setTimeout(r, 25));
        }
        assert.fail('the look never answered');
      };
      await seen((got) => typeof got.ownFilesLine === 'string');
      clock += 1000;
      acceptOwnFiles({ ...where, now: () => new Date(clock) });
      assert.ok(fs.existsSync(ownFilesFile()));
      assert.equal((await health(helper.address)).ownFilesLine, undefined);
      // The look made afresh against the new baseline finds nothing either.
      await new Promise((r) => setTimeout(r, 300));
      assert.equal((await health(helper.address)).ownFilesLine, undefined);
    } finally {
      await helper.close();
    }
  });
});
