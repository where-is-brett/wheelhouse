// tests/scripts/host/helper-dispatch.test.js
// The helper's dispatcher and card router for a project on the engine (Archon design, sections 7.3, 8 and 10): the
// fake engine stands in, and the wake process is a stand-in child that runs nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { listEvents, makeEvent, eventPath } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { fakeEngine, loadRecordings } from '../../../scripts/engine/fake.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { until } from '../../helpers/until.js';

// The fake engine reads no fetch mirror.
const noMirror = async () => ({ ok: true });
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const recordings = loadRecordings(path.join(import.meta.dirname, '..', '..', 'fixtures', 'engine'));
const P = 'o__p';

function stubSpawn() {
  return () => {
    const child = new EventEmitter();
    child.pid = 7000;
    child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
    return child;
  };
}

async function setUp() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-proj-'));
  const artefacts = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-art-'));
  // A project whose tests run with `npm test`.
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: 'node --test' } }));
  await as(home, async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-29T00:00:00.000Z' });
    writeProject(P, { folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    await openTestRecord({ env: LOCAL_PATHS, project: P, remoteUrl: remote.url });
  });
  return { home, folder, artefacts, cleanup: () => { remote.cleanup(); for (const d of [home, folder, artefacts]) fs.rmSync(d, { recursive: true, force: true }); } };
}

// A record in the project's history, as the First Mate's work record is written.
function put(kind, data, at) {
  const event = makeEvent({ kind, data, now: () => new Date(at) });
  const file = path.join(stateDir(P), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`);
}
const records = (kind) => listEvents(stateDir(P), { report: () => {} }).filter((e) => e.kind === kind);

const helperFor = (p, engine) => startHelper({
  run: hostGuard, address: testAddress(p.home), adapterFor: async () => ({}), envFor: async () => ({}),
  spawn: stubSpawn(), refreshMirror: noMirror, engineFor: () => engine, dispatchMs: 60 * 60 * 1000,
});

test('the dispatcher starts quick work through the helper\'s own start, with its order, its ticket and its run record', async () => {
  const p = await setUp();
  const engine = fakeEngine({ recordings: { 'quick-approved': recordings['quick-approved'] }, artefacts: p.artefacts });
  try {
    await as(p.home, async () => {
      put('work', { id: 'card-12', title: 'Fix the heading', lane: 'quick', visible: false, dependsOn: [], level: 4 }, '2026-10-29T08:00:00.000Z');
      const helper = await helperFor(p, engine);
      try {
        await helper.engine.tick();
        const starts = engine.calls.filter((c) => c.call === 'start');
        assert.equal(starts.length, 1);
        assert.equal(starts[0].order.work, 'card-12');
        const runs = records('run');
        assert.equal(runs.length, 1);
        assert.equal(runs[0].data.work, 'card-12');
        const runId = runs[0].data.runId;
        assert.ok(fs.existsSync(path.join(p.artefacts, runId, '.wheelhouse-ticket')), 'the run\'s ticket is in its artefacts');
        const order = JSON.parse(fs.readFileSync(path.join(stateDir(P), '..', 'engine', 'orders', `${runId}.json`), 'utf8'));
        assert.equal(order.level, 4, 'the work\'s level is in the order, for the permit');
        assert.equal(order.goal, 'Fix the heading');
        await helper.engine.tick();
        assert.equal(engine.calls.filter((c) => c.call === 'start').length, 1, 'work that ran isn\'t started again');
      } finally {
        await helper.close();
      }
    });
  } finally { p.cleanup(); }
});

test('the dispatcher starts nothing under All stop', async () => {
  const p = await setUp();
  const engine = fakeEngine({ recordings: { 'quick-approved': recordings['quick-approved'] }, artefacts: p.artefacts });
  try {
    await as(p.home, async () => {
      put('work', { id: 'card-12', title: 'Fix the heading', lane: 'quick', visible: false, dependsOn: [] }, '2026-10-29T08:00:00.000Z');
      const helper = await helperFor(p, engine);
      try {
        setStop({ by: 'helper' });
        await helper.engine.tick();
        assert.equal(engine.calls.filter((c) => c.call === 'start').length, 0);
      } finally {
        await helper.close();
      }
    });
  } finally { p.cleanup(); }
});

test('an ask from a run the helper started becomes a question card in the record', async () => {
  const p = await setUp();
  const engine = fakeEngine({ recordings: { 'quick-blocked': recordings['quick-blocked'] }, artefacts: p.artefacts });
  try {
    await as(p.home, async () => {
      put('work', { id: 'card-13', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [] }, '2026-10-29T08:00:00.000Z');
      const helper = await helperFor(p, engine);
      try {
        await helper.engine.tick();
        const question = await until(() => records('question')[0], { what: 'the question card for the ask' });
        assert.match(question.data.id, /^q-card-13-5000\d\d$/);
        assert.equal(question.data.what, 'The change needs a file the builder may not edit.');
        assert.deepEqual(question.data.options.map((o) => o.label), ['Stop the work', 'Try again']);
      } finally {
        await helper.close();
      }
    });
  } finally { p.cleanup(); }
});

test('an ask from the merge queue\'s own run is routed: a red main line\'s hold is answered with no card', async () => {
  const p = await setUp();
  const merge = [
    { type: 'run-started', at: '2026-10-29T09:00:00.000Z', work: null, lane: 'merge' },
    { type: 'ask', at: '2026-10-29T09:01:00.000Z', id: 'mq:red:1', kind: 'question', level: 1, recommend: 'hold', answer: 'hold', card: false, line: 'The main line is red, so the merge queue holds merges until it is green again.', options: [{ id: 'hold', label: 'Hold' }] },
    { type: 'ask-resolved', at: '2026-10-29T09:02:00.000Z', id: 'mq:red:1' },
    { type: 'run-ended', at: '2026-10-29T09:03:00.000Z', outcome: 'completed' },
  ];
  const engine = fakeEngine({ recordings: { merge }, artefacts: p.artefacts });
  try {
    await as(p.home, async () => {
      // A pull request the helper marked ready for the merge queue.
      const files = path.join(stateDir(P), '..', 'engine');
      fs.mkdirSync(files, { recursive: true });
      fs.writeFileSync(path.join(files, 'verdicts.json'), JSON.stringify({ ready: { 7: { work: 'card-7', head: 'a'.repeat(40) } } }));
      const helper = await helperFor(p, engine);
      try {
        await helper.engine.tick();
        const starts = engine.calls.filter((c) => c.call === 'start' && c.order.lane === 'merge');
        assert.equal(starts.length, 1);
        // The registered repository, which Archon's queue needs (check 81).
        assert.deepEqual(starts[0].order.repo, { host: 'github.com', path: 'o/p' });
        const held = await until(() => engine.calls.find((c) => c.call === 'act' && c.action?.answer?.choice === 'hold'), { what: 'the hold answered' });
        assert.equal(held.action.answer.ask, 'mq:red:1');
        assert.equal(records('question').length + records('card').length, 0);
      } finally {
        await helper.close();
      }
    });
  } finally { p.cleanup(); }
});

test('the order carries the project\'s test command and the models of the column in force', async () => {
  const p = await setUp();
  fs.mkdirSync(path.join(p.folder, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(p.folder, '.claude', 'wheelhouse.json'), JSON.stringify({
    v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], testCommand: 'node --test test/',
    tiers: { pins: { mostCapable: 'model-top', midSized: 'model-mid' } },
  }));
  const engine = fakeEngine({ recordings: { 'quick-approved': recordings['quick-approved'] }, artefacts: p.artefacts });
  try {
    await as(p.home, async () => {
      put('work', { id: 'card-12', title: 'Fix the heading', lane: 'quick', visible: false, dependsOn: [] }, '2026-10-29T08:00:00.000Z');
      const helper = await helperFor(p, engine);
      try {
        await helper.engine.tick();
        const runId = records('run')[0].data.runId;
        const order = JSON.parse(fs.readFileSync(path.join(stateDir(P), '..', 'engine', 'orders', `${runId}.json`), 'utf8'));
        assert.equal(order.testCommand, 'node --test test/');
        assert.deepEqual(order.done, [{ command: 'node --test test/', expect: 0 }]);
        assert.deepEqual(order.bindings, { tiers: { large: 'model-top', medium: 'model-top', small: 'model-mid' } }, 'Balanced: building on the most capable, mechanical work on the mid-sized');
        assert.deepEqual(engine.calls.find((c) => c.call === 'start').order.bindings, order.bindings);
      } finally {
        await helper.close();
      }
    });
  } finally { p.cleanup(); }
});

test('a project whose tests Wheelhouse can\'t run starts no work, and the Logbook says why', async () => {
  const p = await setUp();
  fs.rmSync(path.join(p.folder, 'package.json'));
  const engine = fakeEngine({ recordings: { 'quick-approved': recordings['quick-approved'] }, artefacts: p.artefacts });
  try {
    await as(p.home, async () => {
      put('work', { id: 'card-12', title: 'Fix the heading', lane: 'quick', visible: false, dependsOn: [] }, '2026-10-29T08:00:00.000Z');
      const helper = await helperFor(p, engine);
      try {
        await helper.engine.tick();
        assert.equal(engine.calls.filter((c) => c.call === 'start').length, 0);
        assert.ok(records('note').some((n) => /tests/.test(n.data.words ?? '')));
      } finally {
        await helper.close();
      }
    });
  } finally { p.cleanup(); }
});
