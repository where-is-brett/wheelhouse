// tests/scripts/host/helper-release-look.test.js
// The helper's weekly look for a newer Wheelhouse release: made in the background, kept, and never in the board's way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { readLatest } from '../../../scripts/update/board.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { until } from '../../helpers/until.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');

async function withHelper(releaseList, fn) {
  const home = shortHome();
  await as(home, async () => {
    const helper = await startHelper({ address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({}), now: () => NOW, releaseList });
    try {
      await fn(helperClient({ address: helper.address }));
    } finally {
      await helper.close();
    }
  });
}

test('release look: the first /health starts a look, and its answer is kept for the board', async () => {
  let asked = 0;
  await withHelper(async () => { asked += 1; return [{ tag: 'v0.2.6', sha: 'a'.repeat(40) }, { tag: 'v0.2.7', sha: 'b'.repeat(40) }]; }, async (client) => {
    assert.equal((await client.health()).ok, true);
    await until(() => readLatest({ now: () => NOW }).tag === 'v0.2.7');
    await client.health();
    assert.equal(asked, 1, 'asked once, not again within the week');
  });
});

test('release look: a look that never answers does not hold /health up', async () => {
  await withHelper(() => new Promise(() => {}), async (client) => {
    const started = Date.now();
    assert.equal((await client.health()).ok, true);
    assert.ok(Date.now() - started < 2000);
  });
});

test('release look: a look that fails leaves /health as it was', async () => {
  await withHelper(async () => { throw new Error('offline'); }, async (client) => {
    assert.equal((await client.health()).ok, true);
  });
});
