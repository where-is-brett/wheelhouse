// tests/scripts/host/helper-engine.test.js
// The helper keeps the build engine's continuation host for each project on the new engine (design on Archon,
// section 6.3): the fake engine stands in, and the wake process is a stand-in child that runs nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { engineForProject, packedArchon, ENGINE_CONFIG } from '../../../scripts/host/helper-main.js';
import { engineDir, stateDir } from '../../../scripts/lib/paths.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { listEvents, makeEvent, eventPath, dataHash } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { READER_WORK } from '../../../scripts/delegation/reader.js';
import { PACK_NAME } from '../../../scripts/engine/pack-build.js';
import { TICKET_FILE } from '../../../scripts/engine/ticket.js';
import { fakeEngine, loadRecordings } from '../../../scripts/engine/fake.js';
import { readCursorFile } from '../../../scripts/engine/host.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { until } from '../../helpers/until.js';

const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const recordings = loadRecordings(path.join(import.meta.dirname, '..', '..', 'fixtures', 'engine'));

function stubSpawn() {
  const children = [];
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.pid = 5000 + children.length;
    child.killed = false;
    child.kill = (signal = 'SIGTERM') => { child.killed = signal; setImmediate(() => child.emit('exit', null, signal)); return true; };
    children.push({ command, args, options, child });
    return child;
  };
  return { spawn, children };
}

async function projects(names) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  await as(home, async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-29T00:00:00.000Z' });
    for (const project of names) {
      writeProject(project, {
        folder: os.tmpdir(), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
      });
      await openTestRecord({ env: LOCAL_PATHS, project, remoteUrl: remote.url });
    }
  });
  return { home, cleanup: () => { remote.cleanup(); fs.rmSync(home, { recursive: true, force: true }); } };
}

// A run's start in the project's record, as what started the run writes it: the host knows a run only by it.
function started(project, runId, work) {
  const event = makeEvent({ kind: 'run', data: { work, lane: 'quick', engine: 'fake', runId, state: 'started', branch: `wh/${work}` }, now: () => new Date('2026-10-29T01:00:00.000Z') });
  const file = path.join(stateDir(project), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}

const engineRecords = (project) => listEvents(stateDir(project), { report: () => {} }).filter((e) => e.kind === 'run' || e.kind === 'ask');

test("the helper keeps the engine's host for a project on the new engine, writing its records and keeping the cursor beside them", async () => {
  const p = await projects(['o__on', 'o__off']);
  const engine = fakeEngine({ recordings });
  const { runId } = engine.start({ recording: 'quick-blocked' });
  const { spawn, children } = stubSpawn();
  try {
    await as(p.home, async () => {
      started('o__on', runId, 'card-13');
      const helper = await startHelper({
        run: hostGuard, address: testAddress(p.home), adapterFor: async () => ({}), envFor: async () => ({}),
        spawn, engineFor: (project) => (project === 'o__on' ? engine : null),
      });
      try {
        await until(() => engineRecords('o__on').some((e) => e.data.state === 'paused'), { what: 'the ask and the pause in the record' });
        const kinds = engineRecords('o__on').map((e) => `${e.kind} ${e.data.state ?? e.data.id}`).sort();
        assert.deepEqual(kinds, ['ask rec-blocked-1:blocked:1', 'run paused', 'run started']);
        assert.equal(engineRecords('o__on').find((e) => e.kind === 'ask').data.runId, runId);
        assert.deepEqual(engineRecords('o__off'), [], 'a project on the old engine gets no host');
        const file = path.join(stateDir('o__on'), '..', 'engine', 'cursor.json');
        const cursor = await until(() => (readCursorFile(file).cursor === '3' ? readCursorFile(file) : null), { what: 'the cursor after the ask' });
        assert.ok(cursor.written.includes('ask:rec-blocked-1:blocked:1'));
        assert.equal(children.length, 1, 'one wake process');
        assert.deepEqual(children[0].args, engine.wakeCommand().args);
      } finally {
        await helper.close();
      }
      assert.equal(children[0].child.killed, 'SIGTERM', 'the wake process ends with the helper');
    });
  } finally { p.cleanup(); }
});

test("a helper started again writes none of the engine's records twice", async () => {
  const p = await projects(['o__on']);
  const engine = fakeEngine({ recordings });
  const { runId } = engine.start({ recording: 'quick-approved' });
  try {
    await as(p.home, async () => {
      started('o__on', runId, 'card-12');
      const start = () => startHelper({
        run: hostGuard, address: testAddress(p.home), adapterFor: async () => ({}), envFor: async () => ({}),
        spawn: stubSpawn().spawn, engineFor: () => engine,
      });
      let helper = await start();
      await until(() => engineRecords('o__on').some((e) => e.data.state === 'paused'), { what: 'the ask and the pause in the record' });
      await helper.close();
      const count = engineRecords('o__on').length;
      // The cursor is lost: the snapshot brings the open ask back, and the ids kept beside it hold it to one record.
      const file = path.join(stateDir('o__on'), '..', 'engine', 'cursor.json');
      fs.writeFileSync(file, JSON.stringify({ cursor: null, written: readCursorFile(file).written }));
      helper = await start();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await helper.close();
      assert.equal(engineRecords('o__on').length, count);
    });
  } finally { p.cleanup(); }
});

test('the real helper gives Archon only to a project whose engine setting is Archon', () => {
  const made = [];
  const engineFor = engineForProject({
    adapter: () => { made.push(1); return { name: 'archon' }; },
    views: (project) => ({ project: project === 'o__on' || project === 'o__waiting' ? { engine: { key: 'engine', value: 'archon' } } : {}, profile: {} }),
    // The engine can build o__on; o__waiting's switch hasn't merged yet (scripts/engine/switch.js).
    ready: (project) => project === 'o__on',
    platform: 'darwin',
  });
  assert.equal(engineFor('o__waiting'), null);
  assert.equal(engineFor('o__off'), null);
  assert.equal(engineFor('o__on').name, 'archon');
  assert.equal(engineFor('o__on'), engineFor('o__on'));
  assert.equal(made.length, 1, 'one adapter for every project');
});

test("the real helper's Archon reads the pack built into the engine's folder, with Wheelhouse's run layer", () => {
  const engine = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-engine-'));
  const seen = [];
  const adapter = (options) => { seen.push(options); return { name: 'archon' }; };
  packedArchon({ engine, adapter });
  assert.equal(seen[0].packDir, path.join(engine, 'pack'));
  assert.equal(seen[0].configFile, ENGINE_CONFIG);
  assert.ok(fs.existsSync(path.join(engine, 'pack', '.archon', 'workflows', 'wheelhouse', 'wheelhouse-quick', 'wheelhouse-quick.yaml')));
  assert.ok(fs.existsSync(ENGINE_CONFIG));
  // A pack that fails its check gives no pack folder, so the adapter refuses to start runs.
  packedArchon({ engine, adapter, build: () => { throw new Error('The pack fails its check'); } });
  assert.equal(seen[1].packDir, undefined);
  fs.rmSync(engine, { recursive: true, force: true });
});

test('a card the router writes gets its signed seal, and the card doesn\'t wait for it', async () => {
  const p = await projects(['o__on']);
  const engine = fakeEngine({ recordings });
  const { runId } = engine.start({ recording: 'quick-blocked' });
  try {
    await as(p.home, async () => {
      started('o__on', runId, 'card-13');
      const helper = await startHelper({
        run: hostGuard, address: testAddress(p.home), adapterFor: async () => ({ defaultBranch: async () => 'main' }), envFor: async () => ({}),
        spawn: stubSpawn().spawn, engineFor: () => engine, dispatchMs: 60 * 60 * 1000,
      });
      try {
        const ofKind = (kind) => listEvents(stateDir('o__on'), { report: () => {} }).filter((e) => e.kind === kind);
        await until(() => ofKind('question').length === 1, { what: 'the card' });
        assert.deepEqual(ofKind('shadow'), [], 'no seal before a tick');
        const kept = path.join(stateDir('o__on'), '..', 'engine', 'shadow.json');
        await until(() => fs.existsSync(kept), { what: 'the card queued for its seal' });
        await helper.engine.seal();
        const [seal] = ofKind('shadow');
        assert.equal(seal.data.card, ofKind('question')[0].data.id);
        assert.ok(seal.sig, 'the line is signed');
        assert.equal(ofKind('shadow').filter((e) => e.data.line === 'seal').length, 1);
        // A reader that couldn't start leaves a line saying so. The card stays open until its answer, and then closes with no score.
        assert.equal(ofKind('shadow').filter((e) => e.data.line === 'reading' && e.data.reader === 'none').length, 1);
        assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(kept, 'utf8')).open), [seal.data.card]);
        await helper.engine.seal();
        assert.equal(ofKind('shadow').length, 2);
        assert.equal(JSON.parse(fs.readFileSync(kept, 'utf8')).waiting.length, 0);
      } finally {
        await helper.close();
      }
    });
  } finally { p.cleanup(); }
});

test('a question card\'s reader starts from the helper, gets its view by its ticket, and costs no card', async () => {
  const p = await projects(['o__on']);
  const artefacts = path.join(p.home, 'artefacts');
  const spend = { tokens: 10, dollars: 0.01, source: 'reported' };
  const engine = fakeEngine({ artefacts, recordings: { ...recordings, reader: [{ type: 'step-finished', at: 't', step: 'read', role: 'reader', spend, output: 'not a reading' }] } });
  const { runId } = engine.start({ recording: 'quick-blocked' });
  try {
    await as(p.home, async () => {
      started('o__on', runId, 'card-13');
      const helper = await startHelper({
        run: hostGuard, address: testAddress(p.home), adapterFor: async () => ({ defaultBranch: async () => 'main' }), envFor: async () => ({}),
        spawn: stubSpawn().spawn, engineFor: () => engine, dispatchMs: 60 * 60 * 1000,
      });
      try {
        const ofKind = (kind) => listEvents(stateDir('o__on'), { report: () => {} }).filter((e) => e.kind === kind);
        await until(() => ofKind('question').length === 1, { what: 'the card' });
        const card = ofKind('question')[0].data;
        await until(() => fs.existsSync(path.join(stateDir('o__on'), '..', 'engine', 'shadow.json')), { what: 'the card queued for its seal' });
        await helper.engine.seal();
        const start = engine.calls.find((c) => c.call === 'start' && c.order.lane === 'reader');
        assert.equal(start.order.card, card.id);
        assert.equal(start.order.work, READER_WORK);
        const reader = [...engine.calls].filter((c) => c.call === 'start').length;
        assert.equal(reader, 2);
        const run = fs.readdirSync(artefacts).find((name) => name.endsWith('reader'));
        const ticket = fs.readFileSync(path.join(artefacts, run, TICKET_FILE), 'utf8').trim();
        const client = helperClient({ address: testAddress(p.home) });
        const given = await client.engine.readerView({ runId: run, ticket });
        assert.equal(given.ok, true);
        assert.equal(given.view.question, card.what);
        assert.equal((await client.engine.readerView({ runId: run })).ok, false);
        assert.equal(ofKind('question').length, 1);
        assert.equal(ofKind('card').length, 0);
      } finally {
        await helper.close();
      }
    });
  } finally { p.cleanup(); }
});

test('a reading from the installed pack and the director\'s answer make one score, through the helper', async () => {
  const p = await projects(['o__on']);
  const artefacts = path.join(p.home, 'artefacts');
  const source = path.join(p.home, 'frozen');
  const spend = { tokens: 10, dollars: 0.01, source: 'reported' };
  const engine = fakeEngine({ artefacts, source, recordings: { ...recordings, reader: [{ type: 'step-finished', at: 't', step: 'read', role: 'reader', spend, output: '' }, { type: 'run-ended', at: 't', outcome: 'completed', branch: null, pr: null }] } });
  const { runId } = engine.start({ recording: 'quick-blocked' });
  try {
    await as(p.home, async () => {
      for (const root of [path.join(engineDir(), 'pack'), path.join(source, 'project')]) {
        const pack = path.join(root, '.archon', 'workflows', PACK_NAME);
        fs.mkdirSync(pack, { recursive: true });
        fs.writeFileSync(path.join(pack, 'step.yaml'), 'name: the installed pack\n');
      }
      started('o__on', runId, 'card-13');
      const helper = await startHelper({
        run: hostGuard, address: testAddress(p.home), adapterFor: async () => ({ defaultBranch: async () => 'main' }), envFor: async () => ({}),
        spawn: stubSpawn().spawn, engineFor: () => engine, dispatchMs: 60 * 60 * 1000,
      });
      try {
        const ofKind = (kind) => listEvents(stateDir('o__on'), { report: () => {} }).filter((e) => e.kind === kind);
        const lines = (line) => ofKind('shadow').filter((e) => e.data.line === line);
        await until(() => ofKind('question').length === 1, { what: 'the card' });
        const [{ data: card }] = ofKind('question');
        await until(() => fs.existsSync(path.join(stateDir('o__on'), '..', 'engine', 'shadow.json')), { what: 'the card queued for its seal' });
        await helper.engine.seal();
        const reader = engine.calls.find((c) => c.call === 'start' && c.order.lane === 'reader');
        assert.ok(reader, 'the reader started');
        const run = fs.readdirSync(artefacts).find((name) => name.endsWith('reader'));
        const labels = card.options.map((o) => o.label ?? o);
        const pick = labels[0];
        engine.setOutput(run, 'read', JSON.stringify({ frame: 'sound', why: 'They fit.', kind: 'can-see', fits: 'no-rule', pick, tags: labels.map((label) => ({ label, leans: [] })) }));
        await helper.engine.seal();
        assert.equal(lines('reading').length, 1);
        assert.equal(lines('reading')[0].data.reader, 'read');
        assert.equal(ofKind('cost').filter((e) => e.data.work === READER_WORK).length, 1);
        assert.equal(lines('reading')[0].data.pick, pick);
        assert.equal(lines('reading')[0].data.afterAnswer, false);
        assert.equal(lines('score').length, 0, 'no score before the answer');

        const answer = makeEvent({ kind: 'action', data: { action: 'answer', question: card.what, questionId: card.id, questionHash: dataHash(card), label: pick }, now: () => new Date() });
        const file = path.join(stateDir('o__on'), eventPath(answer));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(answer, null, 2)}\n`);
        await helper.engine.seal();
        assert.equal(lines('score').length, 1);
        assert.equal(lines('score')[0].data.score, 'match');
        assert.equal(lines('score')[0].data.seal, lines('seal')[0].data.hash);
        await helper.engine.seal();
        assert.equal(lines('score').length, 1);
      } finally {
        await helper.close();
      }
    });
  } finally { p.cleanup(); }
});
