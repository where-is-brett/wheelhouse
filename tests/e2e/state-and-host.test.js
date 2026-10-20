// tests/e2e/state-and-host.test.js
// State and the host end to end: a bare repository stands in for the host, a
// fake adapter for gh and glab, and each computer is its own WHEELHOUSE_HOME
// with its own real helper on a socket (a named pipe on Windows). State and
// the lock are written through the helper's own requests: client -> helper ->
// the helper's clone and mirror -> the bare repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHelper, PUSH_REFUSALS } from '../../scripts/host/helper.js';
import { helperClient } from '../../scripts/host/helper-client.js';
import { computerId, stateDir } from '../../scripts/lib/paths.js';
import { writeProject } from '../../scripts/lib/projects.js';
import { run } from '../../scripts/lib/run.js';
import { makeEvent, eventPath, confirmationFor } from '../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../scripts/state/signing.js';
import { writeViews } from '../../scripts/state/views.js';
import { makeBareRemote, g } from '../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../helpers/homes.js';
import { prOnHost } from '../helpers/pr-on-host.js';
import { matchingBody } from '../helpers/provenance.js';
import { waitLongerOnTheHelper } from '../helpers/until.js';

// These tests run the real helper and check what reaches it, however loaded the computer is.
waitLongerOnTheHelper();

// A pull request body stamped with what matches the installed manifest, so the gate's provenance condition passes.
const BODY = matchingBody();

const PROJECT = 'o__p';
const PR = 7;
const HEAD = `abc1234${'0'.repeat(33)}`;
const T0 = new Date('2026-10-18T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const LOCK_REASON = 'this computer no longer holds the lock';

// gh and glab stood in for: one open pull request at the head `headOf` gives (HEAD unless the
// host holds one), CI green on it, main the default branch.
function fakeAdapter(headOf = () => HEAD) {
  const merges = [];
  return {
    merges,
    defaultBranch: async () => 'main',
    prState: async () => ({ headSha: headOf(), mergeable: 'mergeable', state: 'open', body: BODY }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async (args) => { merges.push(args); return { merged: true }; },
    openPr: async () => ({ number: PR }),
    updatePr: async () => ({ number: PR }),
    issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
  };
}

// One computer: its own home, signing key and helper. `act` runs fn with this
// computer's home and a client of its helper.
async function makeComputer(adapter, remoteUrl) {
  const home = shortHome();
  const entry = await as(home, async () => {
    writeProject(PROJECT, {
      folder: os.tmpdir(), remoteUrl, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    return { ...makeSigningKey(), enrolledAt: '2026-10-18T00:00:00.000Z' };
  });
  // The helper's clock is set by the test, so the lock's age is the test's to move.
  let ms = 0;
  const helper = await as(home, () => startHelper({
    address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), now: () => new Date(T0.getTime() + ms),
  }));
  const client = helperClient({ address: helper.address });
  return {
    home,
    entry,
    adapter,
    time: (to) => { ms = to; },
    act: (fn) => as(home, () => fn(client)),
    close: async () => {
      await helper.close();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

// Computers enrolled in one shared profile (each home holds the same list),
// each with a state clone of one bare repository. With `pr`, the repository holds pull
// request 7, up to date with main, and `head` is its head commit.
async function setUp(count, { pr = false } = {}) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const computers = [];
  let head = HEAD;
  for (let i = 0; i < count; i++) computers.push(await makeComputer(fakeAdapter(() => head), remote.url));
  for (const c of computers) {
    await c.act(async (client) => {
      for (const other of computers) enrol(other.entry);
      assert.deepEqual(await client.state.clone({ project: PROJECT }), { ok: true });
    });
  }
  if (pr) head = await prOnHost(remote.url);
  return {
    remote,
    head,
    computers,
    cleanup: async () => {
      for (const c of computers) await c.close();
      remote.cleanup();
    },
  };
}

// Writes an event through the computer's helper: a plain kind is made by the
// helper; a signed kind is made and signed here, as a hook would, and recorded.
async function write(computer, client, kind, data, ms) {
  computer.time(ms);
  let written;
  let event;
  if (['confirmation', 'approval', 'review'].includes(kind)) {
    event = makeEvent({ kind, data, now: at(ms) });
    written = await client.state.record({ project: PROJECT, event });
  } else {
    written = await client.state.write({ project: PROJECT, kind, data });
    event = { id: written.id, kind, data, at: at(ms)().toISOString(), computer: computerId(), v: 1 };
  }
  assert.equal(written.ok, true, JSON.stringify(written));
  assert.equal(written.pushed, true, `the ${kind} event reached the remote`);
  return event;
}

const remoteEvents = async (remoteUrl) => (await run('git', ['ls-tree', '-r', '--name-only', 'wheelhouse-state', 'events'], { cwd: remoteUrl }))
  .stdout.split('\n').filter(Boolean);
const remoteHeads = async (remoteUrl) => (await run('git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], { cwd: remoteUrl }))
  .stdout.split('\n').filter(Boolean);

test('two computers: events from both land, the lock passes on, and the old holder can no longer merge', async () => {
  const { remote, head, computers: [a, b], cleanup } = await setUp(2, { pr: true });
  try {
    const idA = await a.act(async () => computerId());
    const idB = await b.act(async () => computerId());
    assert.notEqual(idA, idB);

    // Computer A takes the lock, writes a ruling and its signed confirmation, and the review and approval of PR 7.
    const ruling = await a.act(async (client) => {
      a.time(0);
      assert.deepEqual(await client.lock.take({ project: PROJECT }), { ok: true, result: { taken: true, counter: 1 } });
      const r = await write(a, client, 'ruling', { words: 'Prices show two decimal places', reason: 'the director asked', scope: 'project' }, 1000);
      await write(a, client, 'confirmation', confirmationFor(r).data, 2000);
      await write(a, client, 'review', { pr: PR, commit: head, verdict: 'CLEAN' }, 3000);
      await write(a, client, 'approval', { pr: PR, commit: head }, 4000);
      return r;
    });

    // B is refused the lock while A's is fresh.
    await b.act(async (client) => {
      b.time(HOUR);
      const refused = await client.lock.take({ project: PROJECT });
      assert.deepEqual(refused, { ok: true, result: { taken: false, holder: idA, since: T0.toISOString() } });
      await write(b, client, 'note', { words: 'from computer B' }, HOUR + 1000);
    });

    // Events from both computers are on the remote.
    const names = await remoteEvents(remote.url);
    assert.ok(names.some((n) => n.includes(`_${idA}_ruling_`)), 'A\'s ruling landed');
    assert.ok(names.some((n) => n.includes(`_${idB}_note_`)), 'B\'s note landed');

    // A's lock goes stale two hours on; B takes it, and the counter moves on.
    await b.act(async (client) => {
      b.time(2 * HOUR + MINUTE);
      const taken = await client.lock.take({ project: PROJECT });
      assert.deepEqual(taken, { ok: true, result: { taken: true, counter: 2 } });
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
      assert.deepEqual(await client.state.sync({ project: PROJECT }), { ok: true, pulled: true, unpushed: 0 });
      b.time(2 * HOUR + 2 * MINUTE);
      const { views } = await client.state.views({ project: PROJECT });
      const entry = views.rulebook.find((r) => r.id === ruling.id);
      assert.equal(entry?.status, 'accepted');
      assert.equal(entry.words, 'Prices show two decimal places');
      const merged = await client.merge({ project: PROJECT, number: PR, stop: false, bypass: false });
      assert.deepEqual(merged, { ok: true, merged: true, sha: head, guardrailPaths: [], criticalAreas: [] });
    });
    assert.deepEqual(b.adapter.merges, [{ number: PR, sha: head }]);

    // A pulls and sees B's note.
    await a.act(async (client) => {
      assert.deepEqual(await client.state.sync({ project: PROJECT }), { ok: true, pulled: true, unpushed: 0 });
      // The month the note was written in, worked out from the helper's clock.
      const [year, month] = at(HOUR + 1000)().toISOString().split('-');
      const files = fs.readdirSync(path.join(stateDir(PROJECT), 'events', year, month));
      assert.ok(files.some((n) => n.includes(`_${idB}_note_`)));
    });
  } finally {
    await cleanup();
  }
});

test('an approval written by hand without a signature changes nothing', async () => {
  const { remote, head, computers: [a], cleanup } = await setUp(1, { pr: true });
  try {
    await a.act(async (client) => {
      a.time(0);
      assert.equal((await client.lock.take({ project: PROJECT })).result.taken, true);
      await write(a, client, 'review', { pr: PR, commit: head, verdict: 'CLEAN' }, 1000);

      // The helper refuses an unsigned approval...
      const unsigned = {
        v: 1, id: crypto.randomUUID(), at: at(2000)().toISOString(), computer: computerId(), kind: 'approval', data: { pr: PR, commit: head },
      };
      const refusedUnsigned = await client.state.record({ project: PROJECT, event: unsigned });
      assert.equal(refusedUnsigned.ok, false);
      assert.match(refusedUnsigned.refused, /signed/);

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
      assert.ok(views.reviews[String(PR)]?.[head], 'the signed review still counts');

      const answer = await client.merge({ project: PROJECT, number: PR, stop: false, bypass: false, approvalRequired: true });
      assert.equal(answer.ok, false);
      assert.deepEqual(answer.reasons, [`no approval of ${head.slice(0, 7)}`]);
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
      a.time(0);
      assert.equal((await client.lock.take({ project: PROJECT })).result.taken, true);
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
