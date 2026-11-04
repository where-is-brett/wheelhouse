// tests/scripts/host/helper-update-routes.test.js
// The helper's /update/* routes as a client reaches them (update design, sections 4, 6 and 15): the plan and the hash, apply
// refused under All stop, status and answer still served while the helper makes way for an update, and the answer relay that
// signs nothing. No host tool and no network: the helper's runs go through a guard, the releases are a stand-in and no process
// starts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { run } from '../../../scripts/lib/run.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { as, shortHome, testAddress, tempFolder } from '../../helpers/homes.js';
import { openJournal } from '../../../scripts/update/journal.js';

const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const NEWER = 'b'.repeat(40);
const OLDER = 'a'.repeat(40);

function seams(started) {
  return {
    from: () => 'v0.2.6',
    list: async () => [{ tag: 'v0.2.6', sha: OLDER }, { tag: 'v0.2.7', sha: NEWER }],
    fetch: async (tag) => ({ ok: true, sha: tag === 'v0.2.7' ? NEWER : OLDER }),
    check: async () => ({ ok: true, says: 'A line.' }),
    kind: async () => 'pins-only',
    locked: async () => ({ locked: false, others: [] }),
    startRunner: (args) => started.push(args),
    clicked: () => true,
  };
}

async function withHelper(fn, extra = {}) {
  const home = shortHome();
  return as(home, async () => {
    const folder = fs.realpathSync(tempFolder('wh-hu-'));
    writeProject('p1', { folder, remoteUrl: 'https://example.com/o/p1.git', host: 'github', repo: 'o/p1', connection: { host: 'github', mode: 'narrow', project: 'o/p1' } });
    const started = [];
    const helper = await startHelper({
      run: hostGuard, address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({}), updateSeams: seams(started), ...extra,
    });
    try {
      return await fn(helperClient({ address: helper.address }), { folder, started, helper });
    } finally {
      await helper.close();
    }
  });
}

test('the helper answers the update routes: a plan with its card, and an apply that starts the plan once', () => withHelper(async (client, { folder, started }) => {
  const plan = await client.update.plan({ folder });
  assert.equal(plan.ok, true);
  assert.match(plan.card.question, /v0\.2\.6 → v0\.2\.7/);
  const applied = await client.update.apply({ folder, hash: plan.hash });
  assert.deepEqual([applied.ok, applied.started], [true, true]);
  assert.equal(started.length, 1);
  const bad = await client.update.apply({ folder, hash: 'e'.repeat(64) });
  assert.equal(bad.ok, false);
  assert.match(bad.refused, /not the plan on the card/);
}));

test('under All stop a plan gives the line and an apply is refused', () => withHelper(async (client, { folder, started }) => {
  const plan = await client.update.plan({ folder });
  setStop({ by: 'helper' });
  assert.deepEqual(await client.update.plan({ folder }), { ok: true, lines: ['Lift All stop first.'] });
  const refused = await client.update.apply({ folder, hash: plan.hash });
  assert.equal(refused.ok, false);
  assert.equal(refused.refused, 'Lift All stop first.');
  assert.deepEqual(started, []);
}));

test('a feature session\'s folder is refused by the helper', () => withHelper(async (client, { folder }) => {
  const worktree = `${folder}/.claude/worktrees/f1`;
  fs.mkdirSync(worktree, { recursive: true });
  const got = await client.update.plan({ folder: worktree });
  assert.equal(got.ok, false);
  assert.match(got.refused, /director's own command/);
}));

test('status and answer are still served while the helper makes way for an update; other routes are not', () => withHelper(async (client, { folder }) => {
  // Hold the lock as an update would, from this process, so the retire for an update is accepted.
  const release = openJournal('p1').lock();
  try {
    assert.deepEqual(await client.retire({ forUpdate: true }), { ok: true, retired: true });
    const status = await client.update.status({ folder });
    assert.equal(status.ok, true);
    assert.equal(status.state, 'none');
    const answer = await client.update.answer({ folder, card: 'update-helper-1-x', label: 'Stop it' });
    assert.match(answer.refused, /No card of the update/);
    const plan = await client.update.plan({ folder });
    assert.match(plan.refused, /updating/);
  } finally {
    release?.();
  }
}, { updateHeld: () => true }));
