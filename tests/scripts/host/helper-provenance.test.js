// tests/scripts/host/helper-provenance.test.js
// The helper stamps every pull request it opens or updates with what built it, from the
// session's provenance on this computer, and its merge gate refuses a pull request whose
// block does not match the installed Wheelhouse's manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { makeEvent, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { takeLock } from '../../../scripts/state/lock.js';
import { BEGIN, WHY, parseProvenance, provenanceBlock, removeProvenance, stampProvenance } from '../../../scripts/lineage/provenance.js';
import { makeBareRemote, push as plainPush } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';
import { lineageFixture } from '../../helpers/lineage.js';
import { prOnHost } from '../../helpers/pr-on-host.js';
import { matchingProvenance, writeSessionProvenance } from '../../helpers/provenance.js';
import { main as featureCli } from '../../../scripts/feature/cli.js';
import { featurePaths, parseReport } from '../../../scripts/feature/files.js';

const T0 = new Date('2026-10-18T01:00:00.000Z');
const at = (ms) => () => new Date(T0.getTime() + ms);
const NO_PROVENANCE = /this session's provenance is not on this computer/;
const MISMATCH = 'the pull request\'s provenance does not match the manifest';

function fakeAdapter(overrides = {}) {
  const calls = { openPr: [], updatePr: [], merges: [] };
  return {
    calls,
    defaultBranch: async () => 'main',
    prState: async () => ({ state: 'closed' }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async (args) => { calls.merges.push(args); return { merged: true }; },
    openPr: async (args) => { calls.openPr.push(args); return { number: 7, url: 'https://example.com/pull/7' }; },
    updatePr: async (args) => { calls.updatePr.push(args); return { number: args.number }; },
    ...overrides,
  };
}

async function withHelper(adapter, fn, extra = {}) {
  const helper = await startHelper({
    address: testAddress(process.env.WHEELHOUSE_HOME), adapterFor: async () => adapter, envFor: async () => ({}), ...extra,
  });
  try {
    return await fn(helperClient({ address: helper.address }), helper);
  } finally {
    await helper.close();
  }
}

async function project() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  await as(home, async () => {
    writeProject('o__p', {
      folder: os.tmpdir(), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await cloneState({ project: 'o__p', remoteUrl: remote.url });
    assert.equal((await takeLock({ project: 'o__p', push: plainPush, now: at(0) })).taken, true);
  });
  return { remote, home, cleanup: () => { remote.cleanup(); fs.rmSync(home, { recursive: true, force: true }); } };
}

function record(kind, data) {
  const event = makeEvent({ kind, data, now: at(1000) });
  const file = path.join(stateDir('o__p'), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}

test('a caller\'s own block is replaced by the helper\'s', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      writeSessionProvenance('o__p', 'sess-1', { models: ['model-a', 'model-b'] });
      const forged = stampProvenance('Shipped the sign-in page.', matchingProvenance(undefined, { models: ['model-z'], claudeCode: '99.0.0' }));
      const adapter = fakeAdapter();
      await withHelper(adapter, async (client) => {
        const opened = await client.openPr({ project: 'o__p', head: 'feature', title: 't', body: forged, session: 'sess-1' });
        assert.equal(opened.ok, true, JSON.stringify(opened));
        const sent = adapter.calls.openPr[0].body;
        assert.equal(sent.split(BEGIN).length, 2, 'one block');
        assert.equal(removeProvenance(sent), 'Shipped the sign-in page.');
        assert.deepEqual(parseProvenance(sent), matchingProvenance(undefined, { models: ['model-a', 'model-b'] }));
        assert.equal(sent.includes('transcript'), false, 'the block never carries the transcript\'s path');

        // An update's new body is stamped the same way; a title alone leaves the body alone.
        assert.equal((await client.updatePr({ project: 'o__p', number: 7, body: `New text.\n\n${provenanceBlock({})}`, session: 'sess-1' })).ok, true);
        assert.deepEqual(parseProvenance(adapter.calls.updatePr[0].body), matchingProvenance(undefined, { models: ['model-a', 'model-b'] }));
        assert.equal(removeProvenance(adapter.calls.updatePr[0].body), 'New text.');
        assert.equal((await client.updatePr({ project: 'o__p', number: 7, title: 'New title', session: 'sess-1' })).ok, true);
        assert.equal(adapter.calls.updatePr[1].body, undefined);

        // A session with no provenance on this computer is refused, and the host is not asked.
        for (const session of [undefined, 'sess-elsewhere', '../sess-1']) {
          const open = await client.openPr({ project: 'o__p', head: 'feature', title: 't', body: 'b', ...(session ? { session } : {}) });
          assert.equal(open.ok, false);
          assert.match(open.refused, NO_PROVENANCE);
          const update = await client.updatePr({ project: 'o__p', number: 7, body: 'b', ...(session ? { session } : {}) });
          assert.match(update.refused, NO_PROVENANCE);
        }
        assert.equal(adapter.calls.openPr.length, 1);
        assert.equal(adapter.calls.updatePr.length, 2);
      });
    });
  } finally { p.cleanup(); }
});

// Merges pull request 7, whose body is `body`, against the Wheelhouse installed at `pluginRoot`.
async function mergeWith(p, body, pluginRoot) {
  const head = await prOnHost(p.remote.url);
  record('review', { pr: 7, commit: head, verdict: 'CLEAN' });
  const adapter = fakeAdapter({ prState: async () => ({ headSha: head, mergeable: 'mergeable', state: 'open', body }) });
  const answer = await withHelper(adapter, (client) => client.merge({ project: 'o__p', number: 7, stop: false, bypass: false }), { pluginRoot });
  return { answer, merges: adapter.calls.merges, head };
}

test('a PR built with a mismatched or older install cannot merge', async () => {
  // Scenario 31: the session ran on installed skills that differ from the manifest, or on an older
  // Wheelhouse or Claude Code; the pull request it opened says so, and the gate refuses it.
  const { root } = lineageFixture(tempFolder('wh-project-'));
  const match = matchingProvenance(root);
  const cases = [
    [{ fingerprints: 'mismatch' }, WHY.fingerprints],
    [{ wheelhouse: '1.2.2' }, WHY.wheelhouse],
    [{ upstreams: { superpowers: 'c'.repeat(40) } }, WHY.upstream],
    [{ claudeCode: '2.1.200' }, WHY.claudeCode],
  ];
  for (const [over, why] of cases) {
    const p = await project();
    try {
      await as(p.home, async () => {
        const { answer, merges } = await mergeWith(p, stampProvenance('The change.', { ...match, ...over }), root);
        assert.equal(answer.ok, false, JSON.stringify(over));
        assert.deepEqual(answer.reasons, [`${MISMATCH}: ${why}`]);
        assert.deepEqual(merges, []);
      });
    } finally { p.cleanup(); }
  }
  // The same pull request built on what the manifest names merges.
  const p = await project();
  try {
    await as(p.home, async () => {
      const { answer, merges, head } = await mergeWith(p, stampProvenance('The change.', match), root);
      assert.equal(answer.ok, true, JSON.stringify(answer));
      assert.deepEqual(merges, [{ number: 7, sha: head }]);
    });
  } finally { p.cleanup(); }
});

test('a PR with no block cannot merge', async () => {
  const { root } = lineageFixture(tempFolder('wh-project-'));
  for (const [body, why] of [['The change.', WHY.none], [undefined, WHY.none], [`${BEGIN}\n- Wheelhouse: 1.2.3`, WHY.unreadable]]) {
    const p = await project();
    try {
      await as(p.home, async () => {
        const { answer, merges } = await mergeWith(p, body, root);
        assert.deepEqual(answer.reasons, [`${MISMATCH}: ${why}`]);
        assert.deepEqual(merges, []);
      });
    } finally { p.cleanup(); }
  }
  // An installed Wheelhouse whose manifest can't be read refuses every block.
  const p = await project();
  try {
    await as(p.home, async () => {
      const { answer } = await mergeWith(p, stampProvenance('The change.', matchingProvenance(root)), tempFolder('wh-no-manifest-'));
      assert.deepEqual(answer.reasons, [`${MISMATCH}: ${WHY.manifest}`]);
    });
  } finally { p.cleanup(); }
});

// A feature worktree made by hand: a .git folder on feature/login-page, the brief, the
// session the hooks kept and a whole report.
function featureTree() {
  const tree = fs.realpathSync.native(tempFolder('wh-feature-'));
  const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;
  const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  const p = featurePaths(tree);
  put(path.join(tree, '.git', 'HEAD'), 'ref: refs/heads/feature/login-page\n');
  put(p.brief, `${fence({
    v: 1, work: 'login-page', lane: 'feature', version: 1, goal: 'Let people sign in', done: ['Sign in works'],
    appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true,
  })}\nThe brief.\n`);
  put(p.session, `${JSON.stringify({ sessionId: 'sess-1' })}\n`);
  put(p.report, `${fence({ v: 1, work: 'login-page', status: 'done', tests: '10 pass', assumptions: [], concerns: [], rulings: [] })}\nShipped the sign-in page.\n`);
  return { tree, p };
}

test('the report carries the same block', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      writeSessionProvenance('o__p', 'sess-1', { models: ['model-a', 'model-b'] });
      const { tree, p: files } = featureTree();
      const adapter = fakeAdapter();
      await withHelper(adapter, async (client) => {
        const said = { out: '', err: '' };
        const deps = {
          cwd: tree, client, find: () => ({ root: tree }), projectOf: () => ({ project: 'o__p' }), stopped: () => false,
          out: (t) => { said.out += t; }, err: (t) => { said.err += t; },
        };
        assert.equal(await featureCli(['report'], deps), 0, said.err);
        assert.match(said.out, /It now says what built it/);
        const report = fs.readFileSync(files.report, 'utf8');
        // The block is not part of the report's text, so it neither counts as words nor reaches the summary.
        assert.equal(parseReport(report).body.trim(), 'Shipped the sign-in page.');
        // A second run finds it stamped already.
        assert.equal(await featureCli(['report'], deps), 0, said.err);
        assert.equal(fs.readFileSync(files.report, 'utf8'), report);

        assert.equal(await featureCli(['open-pr', '--title', 'Add the sign-in page'], deps), 0, said.err);
        const body = adapter.calls.openPr[0].body;
        assert.equal(adapter.calls.openPr[0].body.split(BEGIN).length, 2);
        assert.deepEqual(parseProvenance(report), parseProvenance(body));
        assert.equal(report.slice(report.indexOf(BEGIN)), body.slice(body.indexOf(BEGIN)), 'the same block, word for word');
        assert.deepEqual(parseProvenance(body), matchingProvenance(undefined, { models: ['model-a', 'model-b'] }));

        // A session with no provenance here: the report is still whole, says so, and is not stamped.
        fs.writeFileSync(files.session, `${JSON.stringify({ sessionId: 'sess-elsewhere' })}\n`);
        said.out = '';
        assert.equal(await featureCli(['report'], deps), 0, said.err);
        assert.match(said.out, /provenance is not on this computer/);
        // Under STOP nothing is written.
        fs.writeFileSync(files.session, `${JSON.stringify({ sessionId: 'sess-1' })}\n`);
        fs.writeFileSync(files.report, removeProvenance(report));
        said.out = '';
        assert.equal(await featureCli(['report'], { ...deps, stopped: () => true }), 0, said.err);
        assert.match(said.out, /STOP is on/);
        assert.equal(fs.readFileSync(files.report, 'utf8').includes(BEGIN), false);
      });
    });
  } finally { p.cleanup(); }
});
