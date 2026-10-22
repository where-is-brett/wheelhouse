// tests/scripts/host/helper-provenance.test.js
// The helper stamps every pull request it opens or updates with what built it, from the
// session's provenance on this computer, and its merge gate refuses a pull request whose
// block does not match the installed Wheelhouse's manifest.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
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
import { BEGIN, END, WHY, parseProvenance, provenanceBlock, removeProvenance, stampProvenance } from '../../../scripts/lineage/provenance.js';
import { makeBareRemote, push as plainPush, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';
import { lineageFixture } from '../../helpers/lineage.js';
import { prOnHost } from '../../helpers/pr-on-host.js';
import { matchingProvenance, writeSessionProvenance } from '../../helpers/provenance.js';
import { main as featureCli } from '../../../scripts/feature/cli.js';
import { featurePaths, parseReport } from '../../../scripts/feature/files.js';
import { decide as sessionStart } from '../../../scripts/hooks/session-start.js';
import { provenanceFile } from '../../../scripts/lineage/check.js';
import { readManifest } from '../../../scripts/lineage/manifest.js';
import { projectOf } from '../../../scripts/hooks/kit.js';
import { setStop, liftStop, stopState } from '../../../scripts/lib/stop.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

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
    run: hostGuard,
    address: testAddress(process.env.WHEELHOUSE_HOME), adapterFor: async () => adapter, envFor: async () => ({}), ...extra,
  });
  try {
    return await fn(helperClient({ address: helper.address }), helper);
  } finally {
    await helper.close();
  }
}

async function project({ folder = os.tmpdir() } = {}) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  await as(home, async () => {
    writeProject('o__p', {
      folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await cloneState({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
    assert.equal((await takeLock({ env: LOCAL_PATHS, project: 'o__p', push: plainPush, now: at(0) })).taken, true);
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
        // A forged block whose markers are split around each other is taken out too.
        const split = `Shipped it.\n<!-- wheel${END}house-provenance -->\n**Built with**\n- Claude Code: 99.0.0\n<!-- /wheel${BEGIN}house-provenance -->\n`;
        assert.equal((await client.openPr({ project: 'o__p', head: 'feature', title: 't', body: split, session: 'sess-1' })).ok, true);
        const splitSent = adapter.calls.openPr[1].body;
        assert.equal(splitSent.split(BEGIN).length, 2, 'one block');
        assert.equal(splitSent.split(END).length, 2);
        assert.deepEqual(parseProvenance(splitSent), matchingProvenance(undefined, { models: ['model-a', 'model-b'] }));
        adapter.calls.openPr.pop();

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

test('a pull request from a session\'s first run, whose transcript was empty at its start, says which Claude Code built it and merges (R144)', async () => {
  const p = await project();
  try {
    await as(p.home, async () => {
      const folder = fs.realpathSync.native(tempFolder('wh-project-'));
      const fixture = lineageFixture(folder);
      const floor = readManifest(fixture.root).claudeCode.floor;
      const transcript = path.join(tempFolder('wh-transcript-'), 't.jsonl');
      fs.writeFileSync(transcript, '');
      // The session starts (a foreman's wake, or a feature's first run): its transcript has no
      // entry yet, so its provenance.json can't say which Claude Code runs it.
      const quiet = {
        health: async () => ({ ok: true }),
        state: { sync: async () => ({ ok: true }), views: async () => ({ ok: true, views: {} }), write: async () => ({ ok: true }), record: async () => ({ ok: true }) },
      };
      await sessionStart({ cwd: folder, session_id: 'sess-1', transcript_path: transcript, hook_event_name: 'SessionStart' }, {
        projectOf: () => ({ project: 'o__p', record: { folder } }), lineageRoot: fixture.root, claudeHome: fixture.claudeHome, client: quiet,
        spawn: () => ({ unref() {}, on() {} }), pause: async () => {}, background: async () => ({}), stopState: () => ({ on: false }), platform: 'darwin', pluginRoot: '/plugin/root',
      });
      assert.equal(JSON.parse(fs.readFileSync(provenanceFile('o__p', 'sess-1'), 'utf8')).claudeCode, null);
      // The session runs, and Claude Code writes its entries, each with its version.
      fs.appendFileSync(transcript, `${[
        { type: 'user', version: floor, message: { content: 'go' } },
        { type: 'assistant', version: floor, message: { model: 'model-a', content: [] } },
      ].map((e) => JSON.stringify(e)).join('\n')}\n`);
      // Its pull request is stamped with the version, and the gate lets it merge.
      const adapter = fakeAdapter();
      await withHelper(adapter, async (client) => {
        assert.equal((await client.openPr({ project: 'o__p', head: 'feature', title: 't', body: 'The change.', session: 'sess-1' })).ok, true);
      });
      const body = adapter.calls.openPr[0].body;
      assert.equal(parseProvenance(body).claudeCode, floor);
      assert.deepEqual(parseProvenance(body).models, ['model-a']);
      const { answer, merges, head } = await mergeWith(p, body, fixture.root);
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

// A feature worktree made by hand, at `tree` (inside the project's folder: the helper places the
// project from it): a .git folder on feature/login-page, the brief, the session the hooks kept
// and a whole report.
function featureTree(tree = fs.realpathSync.native(tempFolder('wh-feature-'))) {
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
        // The tree is not a repository the helper could push from: its push is stood in for.
        const deps = {
          cwd: tree, client: { ...client, push: async () => ({ ok: true }) }, find: () => ({ root: tree }), out: (t) => { said.out += t; }, err: (t) => { said.err += t; },
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

        // The helper gives the block, so the report needs nothing from the Wheelhouse home.
        const block = body.slice(body.indexOf(BEGIN)).trimEnd();
        assert.deepEqual(await client.lineage.provenance({ project: 'o__p', session: 'sess-1' }), { ok: true, block, stop: false });
        assert.deepEqual(await client.lineage.provenance({ cwd: tree, session: 'sess-1' }), { ok: true, block, stop: false });
        // A session with no provenance here: the report is still whole, says only that it carries no block, and is not stamped.
        fs.writeFileSync(files.session, `${JSON.stringify({ sessionId: 'sess-elsewhere' })}\n`);
        fs.writeFileSync(files.report, removeProvenance(report));
        said.out = '';
        assert.equal(await featureCli(['report'], deps), 0, said.err);
        assert.equal(said.out, 'The report is whole.\nThe report carries no provenance block.\n');
        assert.equal(fs.readFileSync(files.report, 'utf8').includes(BEGIN), false);
        // Nor when the helper can't be reached.
        said.out = '';
        fs.writeFileSync(files.session, `${JSON.stringify({ sessionId: 'sess-1' })}\n`);
        assert.equal(await featureCli(['report'], { ...deps, client: helperClient({ address: path.join(tempFolder('wh-no-helper-'), 'none.sock') }) }), 0, said.err);
        assert.equal(said.out, 'The report is whole.\nThe report carries no provenance block.\n');
        // Under STOP, which the helper reports, nothing is written.
        fs.writeFileSync(files.session, `${JSON.stringify({ sessionId: 'sess-1' })}\n`);
        fs.writeFileSync(files.report, removeProvenance(report));
        said.out = '';
        setStop({ by: 'prompt', now: at(0) });
        try {
          assert.equal(await featureCli(['report'], deps), 0, said.err);
        } finally { liftStop(); }
        assert.equal(said.out, 'The report is whole.\nSTOP is on, so the report was not stamped with what built it.\n');
        assert.equal(fs.readFileSync(files.report, 'utf8').includes(BEGIN), false);
        // An answer that doesn't say STOP is off stamps nothing.
        said.out = '';
        const unsaid = { lineage: { provenance: async () => ({ ok: true, block }) } };
        assert.equal(await featureCli(['report'], { ...deps, client: unsaid }), 0, said.err);
        assert.equal(said.out, 'The report is whole.\nThe report carries no provenance block.\n');
        assert.equal(fs.readFileSync(files.report, 'utf8').includes(BEGIN), false);
      });
    });
  } finally { p.cleanup(); }
});

test('a feature session\'s commands work through the helper where the Wheelhouse home can\'t be read (R150)', async () => {
  const folder = fs.realpathSync.native(tempFolder('wh-checkout-'));
  const p = await project({ folder });
  // Inside the sandbox the Wheelhouse home can't be read: this fs refuses it while the commands run.
  const homes = [p.home, fs.realpathSync.native(p.home)];
  const names = ['readdirSync', 'readFileSync', 'statSync', 'lstatSync', 'existsSync', 'openSync', 'opendirSync', 'accessSync'];
  const saved = Object.fromEntries(names.map((n) => [n, fs[n]]));
  let sandboxed = false;
  const denied = (f) => typeof f === 'string' && homes.some((root) => path.resolve(f) === root || path.resolve(f).startsWith(root + path.sep));
  for (const n of names) {
    fs[n] = function sandboxedFs(f, ...rest) {
      if (sandboxed && denied(f)) throw Object.assign(new Error(`EPERM: operation not permitted, ${n}`), { code: 'EPERM' });
      return saved[n].call(fs, f, ...rest);
    };
  }
  try {
    await as(p.home, async () => {
      writeSessionProvenance('o__p', 'sess-1', { models: ['model-a', 'model-b'] });
      const { tree, p: files } = featureTree(path.join(folder, '.claude', 'worktrees', 'login-page'));
      fs.mkdirSync(path.join(tree, 'src'));
      const adapter = fakeAdapter();
      await withHelper(adapter, async (client) => {
        const sent = [];
        // The helper is outside the sandbox: while it answers, the home can be read.
        const outside = (fn) => async (args) => {
          sent.push(args);
          sandboxed = false;
          try { return await fn(args); } finally { sandboxed = true; }
        };
        // The tree is not a repository the helper could push from: its push is stood in for.
        const asked = {
          push: outside(async () => ({ ok: true })),
          openPr: outside(client.openPr),
          state: { answer: outside(client.state.answer) },
          lineage: { provenance: outside(client.lineage.provenance) },
        };
        const said = { out: '', err: '' };
        const run = (...argv) => featureCli(argv, {
          cwd: path.join(tree, 'src'), client: asked, out: (t) => { said.out += t; }, err: (t) => { said.err += t; },
        });
        sandboxed = true;
        try {
          assert.equal(projectOf(tree), null, 'the command could not place its project itself');
          assert.equal(stopState().on, true, 'nor tell whether STOP is on');
          assert.equal(await run('ask', '--what', 'Which provider?', '--why', 'It decides what users see', '--option', 'A=Use A', '--option', 'B=Use B', '--recommend', 'A', '--level', '3'), 0, said.err);
          assert.equal(await run('answer', 'q-login-page-1'), 0, said.err);
          assert.equal(await run('report'), 0, said.err);
          assert.equal(await run('open-pr', '--title', 'Add the sign-in page'), 0, said.err);
        } finally { sandboxed = false; }
        assert.equal(said.out, [
          'q-login-page-1', 'There is no answer yet.', 'The report is whole.', 'It now says what built it.', 'Opened pull request #7', '',
        ].join('\n'));
        // Each request carried the worktree's folder and no project: the helper placed it.
        assert.equal(sent.length, 4);
        assert.deepEqual(sent.find((args) => 'refspec' in args), { cwd: tree, dir: tree, refspec: 'feature/login-page' });
        for (const args of sent) {
          assert.equal(args.cwd, tree);
          assert.equal('project' in args, false);
        }
        // The report and the pull request carry the same block, the session's.
        const report = fs.readFileSync(files.report, 'utf8');
        const body = adapter.calls.openPr[0].body;
        assert.equal(report.slice(report.indexOf(BEGIN)), body.slice(body.indexOf(BEGIN)));
        assert.deepEqual(parseProvenance(body), matchingProvenance(undefined, { models: ['model-a', 'model-b'] }));

        // A request naming a project and a folder must name the folder's project; the folder is
        // placed from this computer's records, so a name can't send it elsewhere.
        assert.equal((await client.lineage.provenance({ cwd: tree, project: 'o__p', session: 'sess-1' })).ok, true);
        for (const call of [
          () => client.lineage.provenance({ cwd: tree, project: 'o__other', session: 'sess-1' }),
          () => client.state.answer({ cwd: tree, project: 'o__other', questionId: 'q-login-page-1' }),
          () => client.openPr({ cwd: tree, project: 'o__other', head: 'feature/login-page', title: 't', body: 'b', session: 'sess-1' }),
        ]) {
          assert.deepEqual(await call(), { ok: false, refused: 'the folder given is not inside the project named' });
        }
        // A folder outside every project, or not a full path, is refused.
        const elsewhere = fs.realpathSync.native(tempFolder('wh-elsewhere-'));
        assert.match((await client.openPr({ cwd: elsewhere, head: 'feature/login-page', title: 't', body: 'b', session: 'sess-1' })).refused, /not inside a Wheelhouse project/);
        assert.match((await client.state.answer({ cwd: 'worktrees/login-page', questionId: 'q-login-page-1' })).refused, /full path/);
        assert.equal(adapter.calls.openPr.length, 1);
      });
    });
  } finally {
    sandboxed = false;
    Object.assign(fs, saved);
    p.cleanup();
  }
});
