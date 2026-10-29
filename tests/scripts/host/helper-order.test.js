// tests/scripts/host/helper-order.test.js
// The helper starts a run of a work order and keeps the order under the run's id (Archon design, section 7.4): a
// step asks for it by the run's id with the run's own ticket, and an id the helper didn't start gets nothing. No
// route starts a run: only the helper does (part 3b's H3).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { listEvents } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { fakeEngine, loadRecordings } from '../../../scripts/engine/fake.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { TICKET_FILE, withTicket } from '../../../scripts/engine/ticket.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';

// The fake engine reads no fetch mirror.
const noMirror = async () => ({ ok: true });
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const recordings = loadRecordings(path.join(import.meta.dirname, '..', '..', 'fixtures', 'engine'));
const ORDER = workOrder({ work: { id: 'card-12', lane: 'quick', goal: 'Fix the heading', done: [{ test: 'tests/heading.test.js' }] }, routing: { tiers: { medium: 'model-b' } } });

function stubSpawn() {
  return (command, args) => {
    const child = new EventEmitter();
    child.pid = 6000;
    child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
    return child;
  };
}

async function setUp() {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-proj-'));
  await as(home, async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-29T00:00:00.000Z' });
    writeProject('o__p', { folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
  });
  const artefacts = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-art-'));
  return { home, folder, artefacts, cleanup: () => { remote.cleanup(); for (const d of [home, folder, artefacts]) fs.rmSync(d, { recursive: true, force: true }); } };
}

// The ticket the helper wrote into the run's artefacts folder.
const ticketOf = (artefacts, runId) => fs.readFileSync(path.join(artefacts, runId, TICKET_FILE), 'utf8').trim();

test('only the helper starts a run: no route starts one', async () => {
  const p = await setUp();
  const engine = fakeEngine({ recordings: { 'quick-approved': recordings['quick-approved'] }, artefacts: p.artefacts });
  try {
    await as(p.home, async () => {
      const helper = await startHelper({
        run: hostGuard, address: testAddress(p.home), adapterFor: async () => ({}), envFor: async () => ({}),
        spawn: stubSpawn(), refreshMirror: noMirror, engineFor: () => engine,
      });
      try {
        const client = helperClient({ address: testAddress(p.home) });
        assert.equal(client.engine.start, undefined, 'the client has no way to start a run');
        const posted = await new Promise((resolve) => {
          const req = http.request({ socketPath: testAddress(p.home), method: 'POST', path: '/engine/start', headers: { 'content-type': 'application/json' } }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
          });
          req.end(JSON.stringify({ project: 'o__p', order: ORDER }));
        });
        assert.equal(posted.status, 404);
        assert.equal(engine.calls.filter((c) => c.call === 'start').length, 0);
      } finally {
        await helper.close();
      }
    });
  } finally { p.cleanup(); }
});

test('a run the helper started gets its order back with its own ticket, and nothing without it', async () => {
  const p = await setUp();
  const engine = fakeEngine({ recordings: { 'quick-approved': recordings['quick-approved'] }, artefacts: p.artefacts });
  try {
    await as(p.home, async () => {
      const helper = await startHelper({
        run: hostGuard, address: testAddress(p.home), adapterFor: async () => ({}), envFor: async () => ({}),
        spawn: stubSpawn(), refreshMirror: noMirror, engineFor: () => engine,
      });
      try {
        const client = helperClient({ address: testAddress(p.home) });
        const started = await helper.engine.start({ project: 'o__p', order: ORDER, branch: 'wh/card-12' });
        assert.equal(started.ok, true, started.refused);
        assert.equal(engine.calls[0].order.work, 'card-12');
        assert.equal(engine.calls[0].order.project, p.folder);
        assert.ok(!JSON.stringify(engine.calls[0].order).includes('Fix the heading'), 'the order\'s words never go to the engine');
        const ticket = ticketOf(p.artefacts, started.runId);
        assert.deepEqual(await client.engine.order({ runId: started.runId, ticket }), { ok: true, order: ORDER });
        assert.deepEqual(await client.engine.order({ runId: started.runId }), { ok: false, refused: 'the call didn\'t carry the run\'s own ticket' });
        assert.equal((await client.engine.order({ runId: started.runId, ticket: 'f'.repeat(64) })).ok, false);
        assert.deepEqual(await client.engine.order({ runId: 'fake-99-other', ticket }), { ok: false, refused: 'there is no work order for that run' });
        assert.equal((await client.engine.order({ runId: '../orders', ticket })).ok, false);
        // Another run's ticket opens nothing of this one.
        const second = await helper.engine.start({ project: 'o__p', order: { ...ORDER, work: 'card-13' } });
        assert.equal((await client.engine.order({ runId: started.runId, ticket: ticketOf(p.artefacts, second.runId) })).ok, false);
        for (const route of ['review', 'openPr', 'ready', 'previewFind', 'preview', 'lesson']) {
          assert.equal((await client.engine[route]({ runId: started.runId, step: 'review-spec' })).refused, 'the call didn\'t carry the run\'s own ticket', route);
        }
        const runs = listEvents(stateDir('o__p'), { report: () => {} }).filter((e) => e.kind === 'run');
        assert.deepEqual(runs.map((e) => [e.data.runId, e.data.state, e.data.work, e.data.branch]).slice(0, 1), [[started.runId, 'started', 'card-12', 'wh/card-12']]);
        // A step finds its ticket in its artefacts folder.
        const wrapped = withTicket(client, ['--run', started.runId, '--artefacts', path.join(p.artefacts, started.runId)]);
        assert.equal((await wrapped.engine.order({ runId: started.runId })).ok, true);
      } finally {
        await helper.close();
      }
    });
  } finally { p.cleanup(); }
});

test('no run starts under All stop', async () => {
  const p = await setUp();
  const engine = fakeEngine({ recordings: { 'quick-approved': recordings['quick-approved'] }, artefacts: p.artefacts });
  try {
    await as(p.home, async () => {
      const helper = await startHelper({
        run: hostGuard, address: testAddress(p.home), adapterFor: async () => ({}), envFor: async () => ({}),
        spawn: stubSpawn(), refreshMirror: noMirror, engineFor: () => engine,
      });
      try {
        setStop({ by: 'helper' });
        const started = await helper.engine.start({ project: 'o__p', order: ORDER });
        assert.equal(started.ok, false);
        assert.match(started.refused, /All stop/);
        assert.equal(engine.calls.filter((c) => c.call === 'start').length, 0);
      } finally {
        await helper.close();
      }
    });
  } finally { p.cleanup(); }
});
