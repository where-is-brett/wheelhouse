// tests/e2e/state-and-host.test.js
// State and the host end to end: a bare repository stands in for the host, a
// fake adapter for gh and glab, and each computer is its own WHEELHOUSE_HOME
// with its own real helper on a socket (a named pipe on Windows). State and
// lock pushes go agent -> helper -> the helper's mirror -> the bare repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHelper, PUSH_REFUSALS } from '../../scripts/host/helper.js';
import { helperClient, pushFor } from '../../scripts/host/helper-client.js';
import { computerId, stateDir } from '../../scripts/lib/paths.js';
import { run } from '../../scripts/lib/run.js';
import { cloneState } from '../../scripts/state/clone.js';
import { makeEvent, eventPath, writeEvent, syncState, confirmationFor } from '../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../scripts/state/signing.js';
import { takeLock } from '../../scripts/state/lock.js';
import { writeViews } from '../../scripts/state/views.js';
import { makeBareRemote } from '../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../helpers/homes.js';

const PROJECT = 'o__p';
const PR = 7;
const HEAD = `abc1234${'0'.repeat(33)}`;
const SHORT = HEAD.slice(0, 7);
const T0 = new Date('2026-10-18T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const LOCK_REASON = 'this computer no longer holds the lock';

async function g(dir, ...args) {
  const r = await run('git', ['-c', 'user.name=T', '-c', 'user.email=t@invalid', ...args], { cwd: dir, env: { GIT_TERMINAL_PROMPT: '0' } });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

// gh and glab stood in for: one open pull request at HEAD, CI green on it, main the default branch.
function fakeAdapter() {
  const merges = [];
  return {
    merges,
    defaultBranch: async () => 'main',
    prState: async () => ({ headSha: HEAD, mergeable: 'mergeable', state: 'open' }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async (args) => { merges.push(args); return { merged: true }; },
    openPr: async () => ({ number: PR }),
    updatePr: async () => ({ number: PR }),
    issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
  };
}

// One computer: its own home, signing key and helper. `act` runs fn with this
// computer's home and a client of its helper.
async function makeComputer(adapter) {
  const home = shortHome();
  const entry = await as(home, async () => ({ ...makeSigningKey(), enrolledAt: '2026-10-18T00:00:00.000Z' }));
  const helper = await as(home, () => startHelper({
    address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}),
  }));
  const client = helperClient({ address: helper.address });
  return {
    home,
    entry,
    adapter,
    act: (fn) => as(home, () => fn(client)),
    close: async () => {
      await helper.close();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

// Computers enrolled in one shared profile (each home holds the same list),
// each with a state clone of one bare repository.
async function setUp(count) {
  const remote = await makeBareRemote();
  const computers = [];
  for (let i = 0; i < count; i++) computers.push(await makeComputer(fakeAdapter()));
  for (const c of computers) {
    await c.act(async () => {
      for (const other of computers) enrol(other.entry);
      await cloneState({ project: PROJECT, remoteUrl: remote.url });
    });
  }
  return {
    remote,
    computers,
    cleanup: async () => {
      for (const c of computers) await c.close();
      remote.cleanup();
    },
  };
}

// Makes an event on the current computer and writes it through its helper.
async function write(client, kind, data, ms) {
  const event = makeEvent({ kind, data, now: at(ms) });
  const written = await writeEvent({ project: PROJECT, event, push: pushFor(client, PROJECT) });
  assert.equal(written.pushed, true, `the ${kind} event reached the remote`);
  return event;
}

const remoteEvents = async (remoteUrl) => (await run('git', ['ls-tree', '-r', '--name-only', 'wheelhouse-state', 'events'], { cwd: remoteUrl }))
  .stdout.split('\n').filter(Boolean);
const remoteHeads = async (remoteUrl) => (await run('git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], { cwd: remoteUrl }))
  .stdout.split('\n').filter(Boolean);

test('two computers: events from both land, the lock passes on, and the old holder can no longer merge', async () => {
  const { remote, computers: [a, b], cleanup } = await setUp(2);
  try {
    const idA = await a.act(async () => computerId());
    const idB = await b.act(async () => computerId());
    assert.notEqual(idA, idB);

    // Computer A takes the lock, writes a ruling and its signed confirmation, and the review and approval of PR 7.
    const ruling = await a.act(async (client) => {
      assert.deepEqual(await takeLock({ project: PROJECT, push: pushFor(client, PROJECT), now: at(0) }), { taken: true, counter: 1 });
      const r = await write(client, 'ruling', { words: 'Prices show two decimal places', reason: 'the director asked', scope: 'project' }, 1000);
      await write(client, 'confirmation', confirmationFor(r).data, 2000);
      await write(client, 'review', { pr: PR, commit: HEAD, verdict: 'CLEAN' }, 3000);
      await write(client, 'approval', { pr: PR, commit: HEAD }, 4000);
      return r;
    });

    // B is refused the lock while A's is fresh.
    await b.act(async (client) => {
      const refused = await takeLock({ project: PROJECT, push: pushFor(client, PROJECT), now: at(HOUR) });
      assert.deepEqual(refused, { taken: false, holder: idA, since: T0.toISOString() });
      await write(client, 'note', { words: 'from computer B' }, HOUR + 1000);
    });

    // Events from both computers are on the remote.
    const names = await remoteEvents(remote.url);
    assert.ok(names.some((n) => n.includes(`_${idA}_ruling_`)), 'A\'s ruling landed');
    assert.ok(names.some((n) => n.includes(`_${idB}_note_`)), 'B\'s note landed');

    // A's lock goes stale two hours on; B takes it, and the counter moves on.
    await b.act(async (client) => {
      const taken = await takeLock({ project: PROJECT, push: pushFor(client, PROJECT), now: at(2 * HOUR + MINUTE) });
      assert.deepEqual(taken, { taken: true, counter: 2 });
    });

    // A's merge through its helper is refused, for the lock alone: review, approval and CI all stand.
    await a.act(async (client) => {
      const answer = await client.merge({ project: PROJECT, number: PR, stop: false, bypass: false });
      assert.equal(answer.ok, false);
      assert.ok(answer.reasons.includes(LOCK_REASON), JSON.stringify(answer));
      assert.deepEqual(answer.reasons, [LOCK_REASON]);
    });
    assert.deepEqual(a.adapter.merges, [], 'nothing reached the host from A');

    // B pulls; its views show A's ruling as accepted, and B, holding the lock, may merge.
    await b.act(async (client) => {
      await syncState({ project: PROJECT, push: pushFor(client, PROJECT) });
      const views = await writeViews(PROJECT, { now: at(2 * HOUR + 2 * MINUTE) });
      const entry = views.rulebook.find((r) => r.id === ruling.id);
      assert.equal(entry?.status, 'accepted');
      assert.equal(entry.words, 'Prices show two decimal places');
      const merged = await client.merge({ project: PROJECT, number: PR, stop: false, bypass: false });
      assert.deepEqual(merged, { ok: true, merged: true, sha: HEAD });
    });
    assert.deepEqual(b.adapter.merges, [{ number: PR, sha: HEAD }]);

    // A pulls and sees B's note.
    await a.act(async (client) => {
      await syncState({ project: PROJECT, push: pushFor(client, PROJECT) });
      const files = fs.readdirSync(path.join(stateDir(PROJECT), 'events', '2026', '10'));
      assert.ok(files.some((n) => n.includes(`_${idB}_note_`)));
    });
  } finally {
    await cleanup();
  }
});

test('an approval written by hand without a signature changes nothing', async () => {
  const { remote, computers: [a], cleanup } = await setUp(1);
  try {
    await a.act(async (client) => {
      assert.equal((await takeLock({ project: PROJECT, push: pushFor(client, PROJECT), now: at(0) })).taken, true);
      await write(client, 'review', { pr: PR, commit: HEAD, verdict: 'CLEAN' }, 1000);

      // writeEvent refuses an unsigned approval...
      const unsigned = {
        v: 1, id: crypto.randomUUID(), at: at(2000)().toISOString(), computer: computerId(), kind: 'approval', data: { pr: PR, commit: HEAD },
      };
      await assert.rejects(writeEvent({ project: PROJECT, event: unsigned, push: pushFor(client, PROJECT) }), /must be signed/);

      // ...so it is written straight into the clone and pushed with plain git, past the helper.
      const dir = stateDir(PROJECT);
      const rel = eventPath(unsigned);
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), `${JSON.stringify(unsigned, null, 2)}\n`);
      await g(dir, 'add', '--', rel);
      await g(dir, 'commit', '-q', '-m', 'approval by hand');
      await g(dir, 'push', '-q', 'origin', 'wheelhouse-state');
      assert.ok((await remoteEvents(remote.url)).includes(rel.split(path.sep).join('/')), 'the hand-written approval is on the remote');

      const views = await writeViews(PROJECT, { now: at(3000) });
      assert.equal(views.approvals[String(PR)], undefined, 'the views ignore it');
      assert.ok(views.reviews[String(PR)]?.[HEAD], 'the signed review still counts');

      const answer = await client.merge({ project: PROJECT, number: PR, stop: false, bypass: false, approvalRequired: true });
      assert.equal(answer.ok, false);
      assert.deepEqual(answer.reasons, [`no approval of ${SHORT}`]);
    });
    assert.deepEqual(a.adapter.merges, []);
  } finally {
    await cleanup();
  }
});

test('a builder asking the helper to push main is refused', async () => {
  const { remote, computers: [a], cleanup } = await setUp(1);
  const builder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-bd-'));
  try {
    // A builder's folder with a commit on main, and on a feature branch.
    await g(builder, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(builder, 'app.txt'), 'hello\n');
    await g(builder, 'add', '-A');
    await g(builder, 'commit', '-q', '-m', 'Start');
    await g(builder, 'branch', 'feature');

    await a.act(async (client) => {
      // Even while this computer holds the lock.
      assert.equal((await takeLock({ project: PROJECT, push: pushFor(client, PROJECT), now: at(0) })).taken, true);
      for (const refspec of ['main', 'main:main']) {
        assert.deepEqual(await client.push({ project: PROJECT, dir: builder, refspec }), { ok: false, refused: PUSH_REFUSALS.defaultBranch });
      }
      assert.deepEqual(await client.push({ project: PROJECT, dir: builder, refspec: '+main' }), { ok: false, refused: PUSH_REFUSALS.force });
      assert.deepEqual(await client.push({ project: PROJECT, dir: builder, refspec: 'feature:main' }), { ok: false, refused: PUSH_REFUSALS.same });
      // A branch of its own goes through.
      assert.deepEqual(await client.push({ project: PROJECT, dir: builder, refspec: 'feature' }), { ok: true });
    });
    const heads = await remoteHeads(remote.url);
    assert.ok(heads.includes('refs/heads/feature'));
    assert.ok(!heads.includes('refs/heads/main'), 'main never reached the remote');
  } finally {
    fs.rmSync(builder, { recursive: true, force: true });
    await cleanup();
  }
});
