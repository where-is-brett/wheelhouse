// tests/scripts/host/helper-decisions-batch.test.js
// The day's decision records that belong to no piece (or to a dropped one) reach the project by one change the helper makes,
// which adds files under docs/decisions/ and nothing else, and merges through the gate with no review and no approval. The
// helper also keeps whether the repository is public, and gives a piece's session how the director answered.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeEvent, eventPath, listEvents } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { makeBareRemote, push as plainPush, g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { raiseBuildQuestion, typedAnswer } from '../../helpers/decisions-world.js';
import { dayOf } from '../../../scripts/decisions/record-file.js';
import { readPublic } from '../../../scripts/decisions/visibility.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';

const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const PROJECT = 'o__p';
const T0 = new Date('2026-11-06T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const ANSWERED = '2026-11-06T12:00:00.000Z';
const ADDRESS = 'https://github.com/o/p.git';

function put(kind, data, ms) {
  const event = makeEvent({ kind, data, now: at(ms) });
  const file = path.join(stateDir(PROJECT), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
  return event;
}

async function oldProject() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-work-'));
  await g(work, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, 'README.md'), 'x\n');
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Base');
  await g(work, 'push', '-q', remote.url, 'main');
  const base = await g(work, 'rev-parse', 'HEAD');
  return { remote, base, cleanup: () => { remote.cleanup(); fs.rmSync(work, { recursive: true, force: true }); } };
}

// `failOpen`: 'before' makes the first request to open a pull request fail with nothing made; 'after' makes it fail once the host
// has made it (the answer was lost).
function host(remote, { visibility = true, failOpen = null } = {}) {
  const prs = new Map();
  const merges = [];
  const opened = [];
  let failed = false;
  return {
    merges,
    opened,
    prs,
    defaultBranch: async () => 'main',
    login: async () => 'ann-oneil',
    isPublic: async () => {
      if (visibility === null) throw new Error('the host would not say');
      return visibility;
    },
    openRequests: async () => [...prs.entries()].filter(([, pr]) => pr.state === 'open')
      .map(([number, pr]) => ({ number, title: '', body: pr.body ?? '', branch: pr.headRef, head: pr.headSha, draft: false, fork: false })),
    openPr: async ({ head, base, title, body }) => {
      if (failOpen === 'before' && !failed) { failed = true; throw new Error('the host would not open it'); }
      const number = 8 + opened.length;
      const sha = await g(remote.url, 'rev-parse', `refs/heads/${head}`);
      await g(remote.url, 'update-ref', `refs/pull/${number}/head`, sha);
      prs.set(number, { headSha: sha, headRef: head, baseRef: base, state: 'open', mergeable: 'mergeable', body });
      opened.push({ number, head, base, title, body });
      if (failOpen === 'after' && !failed) { failed = true; throw new Error('the answer was lost'); }
      return { number, url: `https://github.com/o/p/pull/${number}` };
    },
    prState: async (number) => {
      const pr = prs.get(number);
      return pr ? { ...pr } : null;
    },
    closePr: async (number) => { prs.set(number, { ...prs.get(number), state: 'closed' }); return { number }; },
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async ({ number, sha }) => {
      merges.push({ number, sha });
      await g(remote.url, 'update-ref', 'refs/heads/main', sha);
      prs.set(number, { ...prs.get(number), state: 'merged' });
      return { merged: true };
    },
  };
}

async function working(fn, options) {
  const p = await oldProject();
  const home = shortHome();
  try {
    await as(home, async () => {
      writeProject(PROJECT, {
        folder: path.join(home, 'work'), remoteUrl: p.remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
      });
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-11-01T00:00:00.000Z' });
      await openTestRecord({ env: LOCAL_PATHS, project: PROJECT, remoteUrl: p.remote.url });
      assert.equal((await takeLock({ env: LOCAL_PATHS, project: PROJECT, push: plainPush, now: at(0) })).taken, true);
      const adapter = host(p.remote, options);
      const helper = await startHelper({
        run: hostGuard, address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), mirrorAddress: () => ADDRESS,
      });
      try {
        await fn({ client: helperClient({ address: helper.address }), adapter, remote: p.remote, base: p.base });
      } finally { await helper.close(); }
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    p.cleanup();
  }
}

// A question the piece asked, its decision card, and the director's answer to it.
function decided(id, work, askedAt, { private: isPrivate = false, ask = `Which way for ${id}?` } = {}) {
  const card = raiseBuildQuestion(id, askedAt, { project: PROJECT, ask, labels: ['Daily', 'Weekly'], recommend: 'Weekly', work });
  typedAnswer(card, { n: 1, label: 'B', private: isPrivate }, ANSWERED, PROJECT);
  return card;
}
const closed = (work) => put('report', { work, outcome: 'closed', summary: 'Dropped at the director\'s request before it began.', rulings: [] }, 500);

test('a dropped piece\'s decisions reach the project by one change that touches only docs/decisions/ and merges with no review or approval', async () => {
  await working(async ({ client, adapter, remote, base }) => {
    closed('w-tide-1');
    decided('q-w-tide-1-1', 'w-tide-1', '2026-11-06T09:00:00.000Z', { ask: 'Which digest rhythm?' });
    decided('q-w-tide-1-2', 'w-tide-1', '2026-11-06T09:10:00.000Z', { private: true, ask: 'Which secret colour?' });
    // A piece that is still being built keeps its decisions on its own branch.
    decided('q-w-tide-2-1', 'w-tide-2', '2026-11-06T09:20:00.000Z', { ask: 'Which map style?' });

    const opened = await client.decisions.batch({ project: PROJECT, date: '2026-11-07' });
    assert.equal(opened.step, 'opened', JSON.stringify(opened));
    assert.equal(opened.files, 1);
    assert.deepEqual(adapter.opened.map((o) => [o.number, o.head, o.base]), [[8, 'wheelhouse/decisions-2026-11-07', 'main']]);
    assert.equal(await g(remote.url, 'rev-parse', `${opened.head}^`), base);
    const changed = (await g(remote.url, 'diff', '--name-status', base, opened.head)).split('\n');
    assert.deepEqual(changed, [`A\tdocs/decisions/${dayOf(ANSWERED)}-which-digest-rhythm.md`]);
    const text = await g(remote.url, 'show', `${opened.head}:docs/decisions/${dayOf(ANSWERED)}-which-digest-rhythm.md`);
    assert.match(text, /^<!-- docs\/decisions\/.*-which-digest-rhythm\.md -->\n# Which digest rhythm\?/);
    assert.match(text, /- \*\*Piece:\*\* w-tide-1\n/);
    assert.match(text, /- \*\*Chosen:\*\* Weekly\n/);
    assert.deepEqual(adapter.merges, []);

    // The next call merges it through the gate: no review, no approval.
    const merged = await client.decisions.batch({ project: PROJECT, date: '2026-11-07' });
    assert.deepEqual(merged, { ok: true, step: 'merged', pr: 8 });
    assert.deepEqual(adapter.merges, [{ number: 8, sha: opened.head }]);
    // Nothing is left to batch: the private one stays private, and the live piece's rides with its piece.
    assert.deepEqual(await client.decisions.batch({ project: PROJECT, date: '2026-11-07' }), { ok: true, step: 'none' });
    assert.equal(adapter.opened.length, 1);
  });
});

test('a decision-records change whose head is not the one the helper made is judged by the ordinary rules', async () => {
  await working(async ({ client, adapter, remote }) => {
    closed('w-tide-1');
    decided('q-w-tide-1-1', 'w-tide-1', '2026-11-06T09:00:00.000Z', { ask: 'Which digest rhythm?' });
    const opened = await client.decisions.batch({ project: PROJECT, date: '2026-11-07' });
    assert.equal(opened.step, 'opened');
    // Someone moves the branch: the kept head no longer matches, so there is no review to stand in for.
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-moved-'));
    try {
      await g(clone, 'init', '-q', '-b', 'x');
      await g(clone, 'fetch', '-q', remote.url, `${opened.head}:refs/moved`);
      await g(clone, 'checkout', '-q', '-B', 'x', 'refs/moved');
      // Only a decision record is added, so the files are still decisions-only: just the head differs from the one kept.
      fs.mkdirSync(path.join(clone, 'docs', 'decisions'), { recursive: true });
      fs.writeFileSync(path.join(clone, 'docs', 'decisions', '2026-11-06-an-extra-record.md'), '<!-- docs/decisions/2026-11-06-an-extra-record.md -->\n# Extra\n');
      await g(clone, 'add', '-A');
      await g(clone, 'commit', '-q', '-m', 'More');
      await g(clone, 'push', '-q', '-f', remote.url, 'x:refs/heads/wheelhouse/decisions-2026-11-07');
    } finally { fs.rmSync(clone, { recursive: true, force: true }); }
    const sha = await g(remote.url, 'rev-parse', 'refs/heads/wheelhouse/decisions-2026-11-07');
    await g(remote.url, 'update-ref', 'refs/pull/8/head', sha);
    adapter.prState = async () => ({ headSha: sha, headRef: 'wheelhouse/decisions-2026-11-07', baseRef: 'main', state: 'open', mergeable: 'mergeable' });
    const files = (await g(remote.url, 'diff', '--name-only', opened.head, sha)).split('\n');
    assert.deepEqual(files, ['docs/decisions/2026-11-06-an-extra-record.md']);
    const waiting = await client.decisions.batch({ project: PROJECT, date: '2026-11-07' });
    assert.equal(waiting.step, 'waiting', JSON.stringify(waiting));
    assert.deepEqual(adapter.merges, []);
  });
});

// A change on a piece's own branch that adds only decision records.
async function featureBranch(remote, base, branch) {
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-feature-'));
  try {
    await g(clone, 'init', '-q', '-b', 'x');
    await g(clone, 'fetch', '-q', remote.url, `${base}:refs/base`);
    await g(clone, 'checkout', '-q', '-B', 'x', 'refs/base');
    fs.mkdirSync(path.join(clone, 'docs', 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(clone, 'docs', 'decisions', '2026-11-06-which-way.md'), '<!-- docs/decisions/2026-11-06-which-way.md -->\n# Which way?\n');
    await g(clone, 'add', '-A');
    await g(clone, 'commit', '-q', '-m', 'Keep the decision');
    await g(clone, 'push', '-q', remote.url, `x:refs/heads/${branch}`);
  } finally { fs.rmSync(clone, { recursive: true, force: true }); }
  return g(remote.url, 'rev-parse', `refs/heads/${branch}`);
}

test('a piece\'s change that adds only decision records still needs the approval the caller asked for', async () => {
  await working(async ({ client, adapter, remote, base }) => {
    const sha = await featureBranch(remote, base, 'feature/w-tide-2');
    const { number } = await adapter.openPr({ head: 'feature/w-tide-2', base: 'main', title: 'A piece', body: 'x' });
    const refused = await client.merge({ project: PROJECT, number, approvalRequired: true });
    assert.equal(refused.ok, false, JSON.stringify(refused));
    assert.equal(refused.merged, undefined);
    assert.match(JSON.stringify(refused), /approval/i);
    assert.deepEqual(adapter.merges, []);
    assert.equal(await g(remote.url, 'rev-parse', 'refs/heads/main'), base);
    assert.ok(sha);
  });
});

test('a change closed without merging is not made again, the same day or after, and says so in a note', async () => {
  await working(async ({ client, adapter }) => {
    closed('w-tide-1');
    decided('q-w-tide-1-1', 'w-tide-1', '2026-11-06T09:00:00.000Z', { ask: 'Which digest rhythm?' });
    const opened = await client.decisions.batch({ project: PROJECT, date: '2026-11-07' });
    assert.equal(opened.step, 'opened');
    await adapter.closePr(8);
    for (const date of ['2026-11-07', '2026-11-07', '2026-11-08', undefined]) {
      assert.deepEqual(await client.decisions.batch({ project: PROJECT, ...(date === undefined ? {} : { date }) }), { ok: true, step: 'none' });
    }
    assert.equal(adapter.opened.length, 1);
    assert.deepEqual(adapter.merges, []);
    const notes = listEvents(stateDir(PROJECT), { report: () => {} }).filter((e) => e.kind === 'note' && /decision records will not be added again/.test(e.data?.words ?? ''));
    assert.equal(notes.length, 1);
    // No card is made for it.
    assert.equal(listEvents(stateDir(PROJECT), { report: () => {} }).filter((e) => e.kind === 'card' && /decision records will not/.test(JSON.stringify(e.data))).length, 0);
  });
});

test('a pull request that could not be opened is opened on the next call, not left stuck', async () => {
  await working(async ({ client, adapter }) => {
    closed('w-tide-1');
    decided('q-w-tide-1-1', 'w-tide-1', '2026-11-06T09:00:00.000Z', { ask: 'Which digest rhythm?' });
    const failed = await client.decisions.batch({ project: PROJECT, date: '2026-11-07' }).catch((e) => ({ ok: false, error: e.message }));
    assert.notEqual(failed.step, 'opened');
    assert.deepEqual(adapter.opened, []);
    const next = await client.decisions.batch({ project: PROJECT, date: '2026-11-07' });
    assert.equal(next.step, 'merged', JSON.stringify(next));
    assert.equal(adapter.opened.length, 1);
    assert.deepEqual(adapter.merges.map((m) => m.number), [8]);
    assert.deepEqual(await client.decisions.batch({ project: PROJECT, date: '2026-11-07' }), { ok: true, step: 'none' });
  }, { failOpen: 'before' });
});

test('a pull request the host made but whose answer was lost is found by its branch and carried on, never made twice', async () => {
  await working(async ({ client, adapter }) => {
    closed('w-tide-1');
    decided('q-w-tide-1-1', 'w-tide-1', '2026-11-06T09:00:00.000Z', { ask: 'Which digest rhythm?' });
    const failed = await client.decisions.batch({ project: PROJECT, date: '2026-11-07' }).catch((e) => ({ ok: false, error: e.message }));
    assert.notEqual(failed.step, 'opened');
    assert.equal(adapter.opened.length, 1);
    const next = await client.decisions.batch({ project: PROJECT, date: '2026-11-07' });
    assert.equal(next.step, 'merged', JSON.stringify(next));
    assert.equal(adapter.opened.length, 1, 'the one the host made is the one merged');
    assert.deepEqual(adapter.merges.map((m) => m.number), [8]);
  }, { failOpen: 'after' });
});

test('a pull request found on the helper\'s branch with a different head is left alone and its records are not batched again', async () => {
  await working(async ({ client, adapter }) => {
    closed('w-tide-1');
    decided('q-w-tide-1-1', 'w-tide-1', '2026-11-06T09:00:00.000Z', { ask: 'Which digest rhythm?' });
    await client.decisions.batch({ project: PROJECT, date: '2026-11-07' }).catch(() => null);
    assert.equal(adapter.opened.length, 1);
    // The host's pull request on that branch now has a head the helper did not keep.
    adapter.prs.get(8).headSha = 'f'.repeat(40);
    assert.deepEqual(await client.decisions.batch({ project: PROJECT, date: '2026-11-07' }), { ok: true, step: 'none' });
    assert.deepEqual(adapter.merges, []);
    assert.equal(adapter.opened.length, 1);
    const notes = listEvents(stateDir(PROJECT), { report: () => {} }).filter((e) => e.kind === 'note' && /was left alone/.test(e.data?.words ?? ''));
    assert.equal(notes.length, 1);
  }, { failOpen: 'after' });
});

test('every record the change took is marked batched once it merges, so none is made twice', async () => {
  await working(async ({ client, adapter }) => {
    decided('q-w-tide-1-1', 'w-tide-1', '2026-11-06T09:00:00.000Z', { ask: 'Which digest rhythm?' });
    decided('q-w-tide-1-2', 'w-tide-1', '2026-11-06T09:10:00.000Z', { ask: 'Which colour?' });
    closed('w-tide-1');
    const opened = await client.decisions.batch({ project: PROJECT, date: '2026-11-07' });
    assert.equal(opened.step, 'opened', JSON.stringify(opened));
    assert.equal(opened.files, 2);
    assert.equal((await client.decisions.batch({ project: PROJECT, date: '2026-11-07' })).step, 'merged');
    assert.deepEqual(await client.decisions.batch({ project: PROJECT, date: '2026-11-07' }), { ok: true, step: 'none' });
    assert.equal(adapter.opened.length, 1);
  });
});

test('the helper keeps whether the repository is public, and keeps nothing when the host will not say', async () => {
  await working(async ({ client }) => {
    assert.equal(readPublic(PROJECT), null);
    assert.deepEqual(await client.host.public({ project: PROJECT }), { ok: true, public: false });
    assert.equal(readPublic(PROJECT), false);
  }, { visibility: false });
  await working(async ({ client }) => {
    assert.deepEqual(await client.host.public({ project: PROJECT }), { ok: true, public: true });
    assert.equal(readPublic(PROJECT), true);
  }, { visibility: true });
  await working(async ({ client }) => {
    assert.deepEqual(await client.host.public({ project: PROJECT }), { ok: true, public: null });
    assert.equal(readPublic(PROJECT), null);
  }, { visibility: null });
});

test('/state/answer gives how the director answered, for the record the piece keeps', async () => {
  await working(async ({ client }) => {
    decided('q-w-tide-1-1', 'w-tide-1', '2026-11-06T09:00:00.000Z', { private: true });
    const got = await client.state.answer({ project: PROJECT, questionId: 'q-w-tide-1-1' });
    assert.equal(got.ok, true);
    assert.deepEqual(got.decision, { at: ANSWERED, option: 'Weekly', words: '', private: true });
    const none = await client.state.answer({ project: PROJECT, questionId: 'q-w-tide-1-9' });
    assert.equal(none.decision, undefined);
  });
});
