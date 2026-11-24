// tests/scripts/host/helper-idle-stop.test.js
// A throwaway home's helper stops an hour after the last session of its home; the default home's never does. No host tool
// and no network: the helper's adapter is a stand-in.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHelper } from '../../../scripts/host/helper.js';
import { recordLastSession, touchLastSession, LAST_SESSION_FILE } from '../../../scripts/lib/standard-env.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { as, shortHome, testAddress, tempFolder } from '../../helpers/homes.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const unix = process.platform !== 'win32';
const HOUR = 60 * 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Starts a helper whose home is `home`, looking at idleness every 20 ms, with `now` as given. `stops` counts its own stops.
async function started(home, now, extra = {}) {
  const stops = { count: 0 };
  const helper = await startHelper({
    run: hostGuard, address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({}), now,
    idleLookMs: 20, idleConfirmMs: 5, dispatchMs: 60 * 1000,
    onStop: (close) => { stops.count += 1; return close(); },
    ...extra,
  });
  return { helper, stops };
}

const later = (ms) => () => new Date(Date.now() + ms);

test('an idle throwaway home\'s helper stops, once, by its own close', { skip: !unix && 'socket files exist only on macOS and Linux' }, async () => {
  const home = shortHome();
  await as(home, async () => {
    recordLastSession(home);
    const { helper, stops } = await started(home, later(HOUR + 60 * 1000));
    await sleep(250);
    assert.equal(stops.count, 1);
    assert.equal(fs.existsSync(helper.address), false, 'the socket is released');
    await helper.close();
  });
});

test('a throwaway home inside the hour keeps its helper', { skip: !unix && 'socket files exist only on macOS and Linux' }, async () => {
  const home = shortHome();
  await as(home, async () => {
    recordLastSession(home);
    const { helper, stops } = await started(home, later(HOUR - 5 * 60 * 1000));
    await sleep(150);
    assert.equal(stops.count, 0);
    await helper.close();
  });
});

test('a live session\'s touch inside the hour keeps the helper', { skip: !unix && 'socket files exist only on macOS and Linux' }, async () => {
  const home = shortHome();
  await as(home, async () => {
    // The session started an hour and a half ago and touched the time ten minutes ago.
    const clock = later(90 * 60 * 1000);
    recordLastSession(home, { now: later(80 * 60 * 1000) });
    const { helper, stops } = await started(home, clock);
    await sleep(100);
    assert.equal(stops.count, 0);
    touchLastSession(home, { now: later(80 * 60 * 1000), gapMs: 0 });
    await sleep(100);
    assert.equal(stops.count, 0);
    await helper.close();
  });
});

test('a missing or unreadable session time never stops the helper', { skip: !unix && 'socket files exist only on macOS and Linux' }, async () => {
  const home = shortHome();
  await as(home, async () => {
    const { helper, stops } = await started(home, later(10 * HOUR));
    await sleep(100);
    fs.writeFileSync(path.join(home, LAST_SESSION_FILE), '{not json');
    await sleep(100);
    fs.writeFileSync(path.join(home, LAST_SESSION_FILE), JSON.stringify({ at: 'not a time' }));
    await sleep(100);
    assert.equal(stops.count, 0);
    await helper.close();
  });
});

test('a reading that is idle once and fresh on the second look does not stop it', { skip: !unix && 'socket files exist only on macOS and Linux' }, async () => {
  const home = shortHome();
  await as(home, async () => {
    recordLastSession(home, { now: later(-2 * HOUR) });
    const { helper, stops } = await started(home, () => new Date(), { idleConfirmMs: 120 });
    await sleep(60);
    recordLastSession(home);
    await sleep(250);
    assert.equal(stops.count, 0);
    await helper.close();
  });
});

test('the default home\'s helper never idles out, through a link or in another letter case', { skip: !unix && 'socket files exist only on macOS and Linux' }, async () => {
  const userHome = tempFolder('wh-user-');
  const realHome = path.join(userHome, '.wheelhouse');
  fs.mkdirSync(realHome);
  const link = path.join(tempFolder('wh-link-'), 'home');
  fs.symlinkSync(realHome, link);
  const before = process.env.HOME;
  process.env.HOME = userHome;
  try {
    assert.equal(os.homedir(), userHome);
    for (const home of [realHome, link, path.join(userHome, '.WheelHouse')]) {
      if (!fs.existsSync(home)) continue; // another letter case reaches the same folder only on a case-blind disk
      await as(home, async () => {
        recordLastSession(realHome, { now: later(-5 * HOUR) });
        const { helper, stops } = await started(home, later(0));
        await sleep(150);
        assert.equal(stops.count, 0, `${home} is the default home`);
        await helper.close();
      });
    }
  } finally {
    if (before === undefined) delete process.env.HOME; else process.env.HOME = before;
  }
});
